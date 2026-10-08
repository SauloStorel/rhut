import { DurableObject } from "cloudflare:workers";
import { announcement } from "./announcement";
import { discordApi } from "./discord-api";
import type { Guild } from "./guild";
import type { Profile } from "./identity";

// Uma sala = no máximo uma pessoa transmitindo a tela (host) e o resto assistindo (viewers); qualquer um pode
// ligar a câmera. O servidor só faz a "apresentação" WebRTC entre os navegadores; vídeo e câmeras vão direto.
// Cada pessoa tem uma conexão só: começar/parar de transmitir é uma mensagem, para a câmera não cair na troca.
// Salas abertas pelo /live também têm um aviso no canal do Discord, que acompanha o estado da sala.

type Role = "host" | "viewer";
type Peer = { id: string; role: Role; camera: boolean; profile: Profile };
type Message = { type: string; to?: string; [key: string]: unknown };
type Command = (ws: WebSocket, peer: Peer, message: Message) => unknown;

export type RoomStatus = "waiting" | "live" | "closed";

export type NewRoom = { roomId: string; guild: Guild | null; openerId: string; channelId: string };

export type RoomInfo = NewRoom & {
  messageId: string;
  status: RoomStatus;
  openedAt: number;
  liveSince: number | null;
  host: Profile | null;
  closedAt: number | null;
  peakViewers: number;
};

// Sinais WebRTC que o servidor só repassa: os da tela (offer/answer/candidate) e os das câmeras.
const RELAYED_SIGNALS = new Set(["offer", "answer", "candidate", "cam-offer", "cam-answer", "cam-candidate"]);
const IDLE_CLOSE_MS = 15 * 60 * 1000;
const HOST_TAKEN = "Já tem alguém transmitindo nesta sala.";

// Header que o Worker preenche depois de validar o passe; nunca vem do navegador (o Worker remove).
export const USER_HEADER = "X-Room-User";

export class Room extends DurableObject<Env> {
  private readonly onLeave: Record<Role, (ws: WebSocket, peer: Peer) => unknown> = {
    host: (ws) => this.endBroadcast(ws),
    viewer: (_ws, peer) => this.sendToHost({ type: "viewer-left", id: peer.id }),
  };

  private readonly commands: Record<string, Command> = {
    "start-broadcast": (ws, peer) => this.startBroadcast(ws, peer),
    "stop-broadcast": (ws, peer) => this.stopBroadcast(ws, peer),
    camera: (ws, peer, { on }) => {
      this.setPeer(ws, { ...peer, camera: Boolean(on) });
      this.broadcastPresence();
    },
  };

  // Chamado pelo /live. Retorna false se o bot não conseguiu postar o aviso no canal.
  async open(room: NewRoom) {
    const info: RoomInfo = { ...room, messageId: "", status: "waiting", openedAt: Date.now(), liveSince: null, host: null, closedAt: null, peakViewers: 0 };
    const response = await discordApi(this.env, "POST", `/channels/${room.channelId}/messages`, announcement(info, this.env.ACCENT_COLOR));
    if (!response.ok) return false;

    const { id } = await response.json<{ id: string }>();
    await this.save({ ...info, messageId: id });
    await this.ctx.storage.setAlarm(Date.now() + IDLE_CLOSE_MS);
    return true;
  }

  // Chamado quando alguém clica em "Entrar na sala": guarda nome e avatar para quando a pessoa conectar.
  async admit(profile: Profile) {
    await this.ctx.storage.put(`profile:${profile.id}`, profile);
  }

  // Só quem está conectado na sala (entrou pelo "Entrar na sala") pode fechar.
  async requestClose(userId: string) {
    const isInRoom = this.members().some((ws) => peerOf(ws)!.profile.id === userId);
    if (!isInRoom) return false;

    await this.close();
    return true;
  }

  async info() {
    return (await this.ctx.storage.get<RoomInfo>("info")) ?? null;
  }

  // Sala vazia por IDLE_CLOSE_MS fecha sozinha.
  async alarm() {
    if (this.ctx.getWebSockets().length === 0) await this.close();
  }

  async fetch(request: Request) {
    const [client, server] = Object.values(new WebSocketPair());
    if ((await this.info())?.status === "closed") return this.reject(server, client, { type: "room-closed" });

    const peer: Peer = { id: crypto.randomUUID(), role: "viewer", camera: false, profile: await this.profileFor(request) };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(peer);
    send(server, { type: "welcome", you: peer.profile, peerId: peer.id });

    this.sendToHost({ type: "viewer-joined", id: peer.id });
    this.broadcastPresence();
    await this.recordViewerPeak();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const peer = peerOf(ws);
    const message: Message = JSON.parse(raw as string);
    if (!peer) return;

    if (RELAYED_SIGNALS.has(message.type)) return this.relay(peer, message);
    await this.commands[message.type]?.(ws, peer, message);
  }

  async webSocketClose(ws: WebSocket) {
    const peer = peerOf(ws);
    if (peer) await this.onLeave[peer.role](ws, peer);
    this.broadcastPresence(ws);

    const remaining = this.ctx.getWebSockets().filter((other) => other !== ws);
    if (remaining.length === 0) await this.ctx.storage.setAlarm(Date.now() + IDLE_CLOSE_MS);
  }

  private async startBroadcast(ws: WebSocket, peer: Peer) {
    if (this.host()) return send(ws, { type: "error", message: HOST_TAKEN });

    this.setPeer(ws, { ...peer, role: "host" });
    this.viewers().forEach((viewer) => send(ws, { type: "viewer-joined", id: peerOf(viewer)!.id }));
    this.broadcastPresence();
    await this.transition({ status: "live", liveSince: Date.now(), host: peer.profile });
  }

  private async stopBroadcast(ws: WebSocket, peer: Peer) {
    if (peer.role !== "host") return;

    this.setPeer(ws, { ...peer, role: "viewer" });
    await this.endBroadcast(ws);
    this.broadcastPresence();
  }

  // `hostSocket` é quem acabou de parar (ou de sair); não precisa receber o próprio aviso.
  private async endBroadcast(hostSocket: WebSocket) {
    this.viewers()
      .filter((viewer) => viewer !== hostSocket)
      .forEach((viewer) => send(viewer, { type: "host-left" }));
    await this.transition({ status: "waiting", liveSince: null, host: null });
  }

  // Com `to`, vai para aquela pessoa; sem `to` (quem assiste respondendo à tela), vai para quem transmite.
  private relay(from: Peer, { to, ...payload }: Message) {
    const target = to ? this.members().find((ws) => peerOf(ws)!.id === to) : this.host();
    if (target) send(target, { ...payload, from: from.id });
  }

  private async close() {
    await this.transition({ status: "closed", closedAt: Date.now() });
    this.ctx.getWebSockets().forEach((ws) => {
      send(ws, { type: "room-closed" });
      ws.close(1000, "room closed");
    });
  }

  // Muda o estado e edita o aviso no Discord. "closed" é final: nada mais muda depois dele.
  // Salas sem aviso (abertas pelo link direto, sem /live) não têm estado para guardar.
  private async transition(changes: Partial<RoomInfo>) {
    const info = await this.info();
    if (!info || info.status === "closed") return;

    const updated = { ...info, ...changes };
    await this.save(updated);
    await discordApi(this.env, "PATCH", `/channels/${info.channelId}/messages/${info.messageId}`, announcement(updated, this.env.ACCENT_COLOR));
  }

  private async recordViewerPeak() {
    const info = await this.info();
    if (info) await this.save({ ...info, peakViewers: Math.max(info.peakViewers, this.viewers().length) });
  }

  // Quem entrou sem passe (link copiado, sala aberta pelo link direto) aparece como convidado.
  private async profileFor(request: Request): Promise<Profile> {
    const userId = request.headers.get(USER_HEADER);
    const profile = userId && (await this.ctx.storage.get<Profile>(`profile:${userId}`));
    return profile || { id: crypto.randomUUID(), name: "Convidado", avatarUrl: null };
  }

  // Manda para todo mundo a lista de quem está na sala. `leaving` é o socket que está fechando agora.
  private broadcastPresence(leaving?: WebSocket) {
    const members = this.members().filter((ws) => ws !== leaving);
    const people = members.map((ws) => {
      const { id, role, camera, profile } = peerOf(ws)!;
      return { ...profile, peerId: id, role, camera };
    });
    members.forEach((ws) => send(ws, { type: "presence", people }));
  }

  private setPeer(ws: WebSocket, peer: Peer) {
    ws.serializeAttachment(peer);
  }

  private save(info: RoomInfo) {
    return this.ctx.storage.put("info", info);
  }

  // Aceito sem attachment: fica fora da sala e só recebe o aviso.
  private reject(server: WebSocket, client: WebSocket, message: object) {
    this.ctx.acceptWebSocket(server);
    send(server, message);
    server.close(4000, "rejected");
    return new Response(null, { status: 101, webSocket: client });
  }

  // Quem está na sala de verdade (sockets recusados não têm attachment).
  private members() {
    return this.ctx.getWebSockets().filter((ws) => peerOf(ws));
  }

  private host() {
    return this.members().find((ws) => peerOf(ws)!.role === "host");
  }

  private viewers() {
    return this.members().filter((ws) => peerOf(ws)!.role === "viewer");
  }

  private sendToHost(message: object) {
    const host = this.host();
    if (host) send(host, message);
  }
}

export function roomStub(env: Env, roomId: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(roomId));
}

// Null para sockets recusados (aceitos só para receber o aviso de erro).
function peerOf(ws: WebSocket): Peer | null {
  return ws.deserializeAttachment();
}

function send(ws: WebSocket, message: object) {
  ws.send(JSON.stringify(message));
}
