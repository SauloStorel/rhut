import { DurableObject } from "cloudflare:workers";
import { discordApi } from "./discord-api";
import type { Guild } from "./guild";
import { panel } from "./panel";
import type { OpenStatus, RoomInfo } from "./room";

// Um por servidor do Discord. Guarda onde está o painel (canal escolhido com /painel) e as salas abertas, que
// avisam aqui quando mudam de estado; cada mudança edita a mesma mensagem do painel.

export type RoomCard = Pick<RoomInfo, "roomId" | "guildId" | "openerName" | "host" | "liveSince" | "people" | "pageUrl" | "voiceChannelId"> & {
  status: OpenStatus;
};

type PanelPlace = { channelId: string; messageId: string; guild: Guild | null };

export class Lobby extends DurableObject<Env> {
  private edits = Promise.resolve();

  // Posta o painel no canal e apaga o anterior, se havia. Retorna false se o bot não conseguiu postar.
  async install(channelId: string, guild: Guild | null) {
    const previous = await this.place();
    const response = await discordApi(this.env, "POST", `/channels/${channelId}/messages`, panel(await this.cards(), guild, this.env.ACCENT_COLOR));
    if (!response.ok) return false;

    const { id } = await response.json<{ id: string }>();
    await this.ctx.storage.put<PanelPlace>("place", { channelId, messageId: id, guild });
    if (previous) await discordApi(this.env, "DELETE", messagePath(previous));
    return true;
  }

  // Canal do painel, ou null se o servidor não tem painel.
  async panelChannel() {
    return (await this.place())?.channelId ?? null;
  }

  // Sala nova entra no fim da lista; sala que já está nela só é atualizada, sem mudar de lugar.
  async track(card: RoomCard) {
    const cards = await this.cards();
    const known = cards.some((other) => other.roomId === card.roomId);
    await this.saveCards(known ? cards.map((other) => (other.roomId === card.roomId ? card : other)) : [...cards, card]);
    await this.editPanel();
  }

  async untrack(roomId: string) {
    await this.saveCards((await this.cards()).filter((card) => card.roomId !== roomId));
    await this.editPanel();
  }

  // As edições entram numa fila e cada uma manda a lista mais recente, para não chegarem fora de ordem.
  private editPanel() {
    this.edits = this.edits
      .then(() => this.sendPanel())
      .catch((error) => console.error("Não deu para editar o painel no Discord:", error));
    return this.edits;
  }

  // Mensagem do painel apagada no Discord: o servidor fica sem painel, e as próximas salas voltam a ter aviso próprio.
  private async sendPanel() {
    const place = await this.place();
    if (!place) return;

    const response = await discordApi(this.env, "PATCH", messagePath(place), panel(await this.cards(), place.guild, this.env.ACCENT_COLOR));
    if (response.status === 404) await this.ctx.storage.delete("place");
  }

  private place() {
    return this.ctx.storage.get<PanelPlace>("place");
  }

  private async cards() {
    return (await this.ctx.storage.get<RoomCard[]>("cards")) ?? [];
  }

  private saveCards(cards: RoomCard[]) {
    return this.ctx.storage.put("cards", cards);
  }
}

export function lobbyStub(env: Env, guildId: string) {
  return env.LOBBIES.get(env.LOBBIES.idFromName(guildId));
}

function messagePath({ channelId, messageId }: PanelPlace) {
  return `/channels/${channelId}/messages/${messageId}`;
}
