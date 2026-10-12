import { announcement } from "./announcement";
import { discordApi } from "./discord-api";
import { lobbyStub } from "./lobby";
import type { RoomInfo } from "./room";

// Onde a sala aparece no Discord. Sem painel no servidor, ela ganha um aviso próprio no canal do /live; com
// painel, vira uma linha nele. As duas formas têm a mesma interface, então a sala não precisa saber qual é a sua.
export type BoardName = "channel" | "panel";

type Board = {
  // Mostra a sala recém-aberta. Devolve o que guardar dela, ou null se não conseguiu mostrar.
  open(info: RoomInfo, env: Env): Promise<Partial<RoomInfo> | null>;
  // Mostra o estado atual; sala encerrada sai de onde estava.
  sync(info: RoomInfo, env: Env): Promise<unknown>;
};

const channelBoard: Board = {
  async open(info, env) {
    const response = await discordApi(env, "POST", `/channels/${info.channelId}/messages`, announcement({ ...info, status: "waiting" }, env.ACCENT_COLOR));
    return response.ok ? { messageId: (await response.json<{ id: string }>()).id } : null;
  },

  sync({ status, ...info }, env) {
    const path = `/channels/${info.channelId}/messages/${info.messageId}`;
    return status === "closed" ? discordApi(env, "DELETE", path) : discordApi(env, "PATCH", path, announcement({ ...info, status }, env.ACCENT_COLOR));
  },
};

const panelBoard: Board = {
  async open(info, env) {
    await panelBoard.sync(info, env);
    return {};
  },

  sync({ status, roomId, guildId, openerName, host, liveSince, people, pageUrl, voiceChannelId }, env) {
    const lobby = lobbyStub(env, guildId!);
    return status === "closed"
      ? lobby.untrack(roomId)
      : lobby.track({ roomId, guildId, status, openerName, host, liveSince, people, pageUrl, voiceChannelId });
  },
};

const BOARDS: Record<BoardName, Board> = { channel: channelBoard, panel: panelBoard };

// Salas abertas antes de existir o painel não guardaram `board`: todas eram aviso no canal.
export function boardOf(info: RoomInfo) {
  return BOARDS[info.board ?? "channel"];
}
