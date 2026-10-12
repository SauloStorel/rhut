import { fetchGuild } from "./guild";
import { type DiscordMember, type DiscordUser, profileOf } from "./identity";
import { lobbyStub } from "./lobby";
import { roomStub } from "./room";
import { newRoomId } from "./room-id";

// Abrir sala (pelo /live ou pelo botão do painel) e colocar o painel num canal (/painel). As duas devolvem o
// que dizer a quem pediu, só para essa pessoa, ou null quando não há nada a dizer: a sala ou o painel
// aparecendo no Discord já é a confirmação.

export type Opener = { guildId?: string; channelId: string; user: DiscordUser; member?: DiscordMember };

const CANNOT_POST = "Não consegui postar neste canal. Confira se o bot pode **ver o canal**, **enviar mensagens** e **inserir links** aqui.";
const UNEXPECTED_ERROR = "Algo deu errado do nosso lado. Tente de novo em instantes.";

export function openRoom(opener: Opener, env: Env) {
  return tryOpening(opener, env).catch(unexpected);
}

export function installPanel(guildId: string, channelId: string, env: Env) {
  return tryInstalling(guildId, channelId, env).catch(unexpected);
}

// Com painel no servidor, a sala vira uma linha nele, de onde quer que o /live tenha sido digitado.
async function tryOpening({ guildId, channelId, user, member }: Opener, env: Env) {
  const panelChannelId = guildId ? await lobbyStub(env, guildId).panelChannel() : null;
  const roomId = newRoomId();
  const shown = await roomStub(env, roomId).open({
    roomId,
    guildId: guildId ?? null,
    guild: await fetchGuild(guildId, env),
    openerId: user.id,
    openerName: profileOf(user, member, guildId).name,
    channelId,
    board: panelChannelId ? "panel" : "channel",
  });
  if (!shown) return CANNOT_POST;

  // Pedida fora do painel: avisa onde a sala foi parar. No próprio canal do painel, a linha nova já diz tudo.
  return panelChannelId && panelChannelId !== channelId ? `Sua sala está em <#${panelChannelId}>.` : null;
}

async function tryInstalling(guildId: string, channelId: string, env: Env) {
  const installed = await lobbyStub(env, guildId).install(channelId, await fetchGuild(guildId, env));
  return installed ? null : CANNOT_POST;
}

function unexpected(error: unknown) {
  console.error("Falha ao atender o Discord:", error);
  return UNEXPECTED_ERROR;
}
