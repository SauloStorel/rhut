import { DurableObject } from "cloudflare:workers";
import { announcement } from "./announcement";
import { discordApi } from "./discord-api";
import type { Guild } from "./guild";
import type { Profile } from "./identity";

// Uma sala = no máximo uma pessoa transmitindo a tela (host) e o resto assistindo (viewers); qualquer um pode
// ligar a câmera. O servidor só faz a "apresentação" WebRTC entre os navegadores; vídeo e câmeras vão direto.
// Cada pessoa tem uma conexão só: começar/parar de transmitir é uma mensagem, para a câmera não cair na troca.
// Salas abertas pelo /live também têm um aviso no canal do Discord, que acompanha o estado da sala.
//
// Quem cai sem querer (Wi-Fi oscilou, celular trocou de rede) vira um "fantasma" por alguns segundos: continua
// na sala para os outros e, se reconectar a tempo, volta como a mesma pessoa, sem derrubar a transmissão.

type Role = "host" | "viewer";
type Peer = { id: string; role: Role; camera: boolean; profile: Profile };
type Ghost = { peer: Peer; expiresAt: number };
type Message = { type: string; to?: string; [key: string]: unknown };
type Command = (ws: WebSocket, peer: Peer, message: Message) => unknown;

export type RoomStatus = "waiting" | "live" | "closed";
export type OpenStatus = Exclude<RoomStatus, "closed">;

export type NewRoom = { roomId: string; guild: Guild | null; openerId: string; channelId: string };

export type RoomInfo = NewRoom & {
  messageId: string;
  status: RoomStatus;
  liveSince: number | null;
  host: Profile | null;
};

// Sinais WebRTC que o servidor só repassa: os da tela (offer/answer/candidate/request-offer) e os das câmeras.
const RELAYED_SIGNALS = new Set(["offer", "answer", "candidate", "request-offer", "cam-offer", "cam-answer", "cam-candidate"]);
const IDLE_CLOSE_MS = 15 * 60 * 1000;
const RECONNECT_GRACE_MS = 20 * 1000;
// Aba fechada ou página saindo: a pessoa sai na hora, sem esperar por uma volta.
const DELIBERATE_CLOSE_CODES = new Set([1000, 1001]);
const RESUME_TOKEN_PATTERN = /^[0-9a-f-]{36}$/;
const ANNOUNCEMENT_ATTEMPTS = 3;
const HOST_TAKEN = "Já tem alguém transmitindo nesta sala.";
const GHOST_PREFIX = "ghost:";

// Header que o Worker preenche depois de validar o passe; nunca vem do navegador (o Worker remove).
export const USER_HEADER = "X-Room-User";

export class Room extends DurableObject<Env> {
  // Sockets que já saíram da sala mas ainda aparecem em getWebSockets() enquanto fecham.
  private readonly departed = new WeakSet<WebSocket>();
  private announcementEdits = Promise.resolve();

  private readonly onLeave: Record<Role, (peer: Peer) => unknown> = {
    host: (peer) => this.endBroadcast(peer.id),
    viewer: (peer) => this.sendToHost({ type: "viewer-left", id: peer.id }),
  };

  private readonly commands: Record<string, Command> = {
    "start-broadcast": (ws, peer) => this.startBroadcast(ws, peer),
    "stop-broadcast": (ws, peer) => this.stopBroadcast(ws, peer),
    camera: (ws, peer, { on }) => {
      this.setPeer(ws, { ...peer, camera: Boolean(on) });
      return this.broadcastPresence();
    },
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // O "ping" da página é respondido sem acordar o objeto: mantém a conexão viva e deixa a página notar quando ela cai.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // Chamado pelo /live. Retorna false se o bot não conseguiu postar o aviso no canal.
  async open(room: NewRoom) {
    const info = { ...room, messageId: "", status: "waiting", liveSince: null, host: null } satisfies RoomInfo;
    const response = await discordApi(this.env, "POST", `/channels/${room.channelId}/messages`, announcement(info, this.env.ACCENT_COLOR));
    if (!response.ok) return false;

    const { id } = await response.json<{ id: string }>();
    await this.save({ ...info, messageId: id });
    await this.scheduleAlarm();
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

  // Um alarme só por sala: tira os fantasmas que não voltaram e fecha a sala que ficou vazia por IDLE_CLOSE_MS.
  async alarm() {
    const now = Date.now();
    const expired = (await this.ghosts()).filter((ghost) => ghost.expiresAt <= now);
    for (const { peer } of expired) {
      await this.ctx.storage.delete(GHOST_PREFIX + peer.id);
      await this.leave(peer);
    }

    const idleCloseAt = await this.ctx.storage.get<number>("idleCloseAt");
    if (idleCloseAt && idleCloseAt <= now && (await this.isEmpty())) return this.close();
    await this.scheduleAlarm();
  }

  async fetch(request: Request) {
    const [client, server] = Object.values(new WebSocketPair());
    if ((await this.info())?.status === "closed") return this.reject(server, client, { type: "room-closed" });

    const id = await peerIdFor(new URL(request.url).searchParams.get("resume"));
    const returning = this.takeOverSocket(id) ?? (await this.takeGhost(id));
    const peer = returning ?? { id, role: "viewer", camera: false, profile: await this.profileFor(request) };

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(peer);
    send(server, { type: "welcome", you: peer.profile, peerId: peer.id, resumed: Boolean(returning) });

    // Quem volta já tem (ou pede) a conexão com quem transmite; só quem chegou agora é apresentado.
    if (!returning) this.sendToHost({ type: "viewer-joined", id: peer.id });
    await this.broadcastPresence();
    await this.scheduleAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const peer = peerOf(ws);
    if (!peer || this.departed.has(ws)) return;

    const message: Message = JSON.parse(raw as string);
    if (RELAYED_SIGNALS.has(message.type)) return this.relay(peer, message);
    await this.commands[message.type]?.(ws, peer, message);
  }

  async webSocketClose(ws: WebSocket, code: number) {
    finishClose(ws, code);
    const peer = this.depart(ws);
    if (!peer) return;

    if (DELIBERATE_CLOSE_CODES.has(code)) await this.leave(peer);
    else await this.ctx.storage.put<Ghost>(GHOST_PREFIX + peer.id, { peer, expiresAt: Date.now() + RECONNECT_GRACE_MS });
    await this.scheduleAlarm();
  }

  // Conexão que terminou com erro: para a sala, é uma queda como outra qualquer.
  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1006);
  }

  // Repetir o pedido (a página repete ao reconectar) só reenvia a lista de quem está assistindo.
  private async startBroadcast(ws: WebSocket, peer: Peer) {
    if (peer.role === "host") return this.sendViewers(ws);
    if (this.host() || (await this.ghosts()).some((ghost) => ghost.peer.role === "host")) return send(ws, { type: "error", message: HOST_TAKEN });

    this.setPeer(ws, { ...peer, role: "host" });
    this.sendViewers(ws);
    await this.broadcastPresence();
    await this.transition({ status: "live", liveSince: Date.now(), host: peer.profile });
  }

  private async stopBroadcast(ws: WebSocket, peer: Peer) {
    if (peer.role !== "host") return;

    this.setPeer(ws, { ...peer, role: "viewer" });
    await this.endBroadcast(peer.id);
    await this.broadcastPresence();
  }

  // `hostId` é quem acabou de parar (ou de sair); não precisa receber o próprio aviso.
  private async endBroadcast(hostId: string) {
    this.viewers()
      .filter((viewer) => peerOf(viewer)!.id !== hostId)
      .forEach((viewer) => send(viewer, { type: "host-left" }));
    await this.transition({ status: "waiting", liveSince: null, host: null });
  }

  private async leave(peer: Peer) {
    await this.onLeave[peer.role](peer);
    await this.broadcastPresence();
  }

  // Com `to`, vai para aquela pessoa; sem `to` (quem assiste falando com a tela), vai para quem transmite.
  private relay(from: Peer, { to, ...payload }: Message) {
    const target = to ? this.members().find((ws) => peerOf(ws)!.id === to) : this.host();
    if (target) send(target, { ...payload, from: from.id });
  }

  private async close() {
    await this.transition({ status: "closed" });
    this.ctx.getWebSockets().forEach((ws) => {
      this.depart(ws);
      send(ws, { type: "room-closed" });
      ws.close(1000, "room closed");
    });
    await this.ctx.storage.delete((await this.ghosts()).map(({ peer }) => GHOST_PREFIX + peer.id));
    await this.ctx.storage.deleteAlarm();
  }

  // A mesma página reconectou antes de a sala notar que a conexão antiga caiu: a nova assume o lugar dela.
  private takeOverSocket(id: string) {
    const stale = this.members().find((ws) => peerOf(ws)!.id === id);
    if (!stale) return null;

    const peer = this.depart(stale);
    stale.close(4001, "replaced");
    return peer;
  }

  private async takeGhost(id: string) {
    const ghost = await this.ctx.storage.get<Ghost>(GHOST_PREFIX + id);
    if (ghost) await this.ctx.storage.delete(GHOST_PREFIX + id);
    return ghost?.peer ?? null;
  }

  // Marca o socket como fora da sala e devolve quem estava nele (null se já tinha saído).
  private depart(ws: WebSocket) {
    if (this.departed.has(ws)) return null;
    this.departed.add(ws);
    return peerOf(ws);
  }

  // O próximo alarme é o primeiro prazo que vencer: a volta de um fantasma ou o fechamento da sala vazia.
  private async scheduleAlarm() {
    const ghostDeadlines = (await this.ghosts()).map((ghost) => ghost.expiresAt);
    const idleCloseAt = (await this.isEmpty()) ? ((await this.ctx.storage.get<number>("idleCloseAt")) ?? Date.now() + IDLE_CLOSE_MS) : null;
    await (idleCloseAt ? this.ctx.storage.put("idleCloseAt", idleCloseAt) : this.ctx.storage.delete("idleCloseAt"));

    const next = Math.min(...ghostDeadlines, idleCloseAt ?? Infinity);
    await (next === Infinity ? this.ctx.storage.deleteAlarm() : this.ctx.storage.setAlarm(next));
  }

  private async isEmpty() {
    return this.members().length === 0 && (await this.ghosts()).length === 0;
  }

  // Muda o estado e atualiza o aviso no Discord. "closed" é final: nada mais muda depois dele.
  // Salas sem aviso (abertas pelo link direto, sem /live) não têm estado para guardar.
  private async transition(changes: Partial<RoomInfo>) {
    const info = await this.info();
    if (!info || info.status === "closed") return;

    await this.save({ ...info, ...changes });
    await this.editAnnouncement();
  }

  // As atualizações entram numa fila e cada uma manda o estado mais recente: duas mudanças rápidas não chegam fora
  // de ordem ao Discord, e um limite de taxa (429) espera o tempo pedido em vez de deixar o aviso desatualizado.
  private editAnnouncement() {
    this.announcementEdits = this.announcementEdits
      .then(() => this.sendAnnouncement())
      .catch((error) => console.error("Não deu para atualizar o aviso no Discord:", error));
    return this.announcementEdits;
  }

  // Sala aberta: o aviso mostra o estado atual. Sala encerrada: o aviso sai do canal.
  private async sendAnnouncement(attempt = 1): Promise<void> {
    const { status, ...info } = (await this.info())!;
    const path = `/channels/${info.channelId}/messages/${info.messageId}`;
    const response =
      status === "closed"
        ? await discordApi(this.env, "DELETE", path)
        : await discordApi(this.env, "PATCH", path, announcement({ ...info, status }, this.env.ACCENT_COLOR));
    if (response.status !== 429 || attempt >= ANNOUNCEMENT_ATTEMPTS) return;

    const { retry_after } = await response.json<{ retry_after: number }>();
    await scheduler.wait(retry_after * 1000);
    return this.sendAnnouncement(attempt + 1);
  }

  // Quem entrou sem passe (link copiado, sala aberta pelo link direto) aparece como convidado.
  private async profileFor(request: Request): Promise<Profile> {
    const userId = request.headers.get(USER_HEADER);
    const profile = userId && (await this.ctx.storage.get<Profile>(`profile:${userId}`));
    return profile || { id: crypto.randomUUID(), name: "Convidado", avatarUrl: null };
  }

  // Manda para todo mundo a lista de quem está na sala; fantasmas continuam nela até o prazo de voltar acabar.
  private async broadcastPresence() {
    const peers = [...this.members().map((ws) => peerOf(ws)!), ...(await this.ghosts()).map((ghost) => ghost.peer)];
    const people = peers.map(({ id, role, camera, profile }) => ({ ...profile, peerId: id, role, camera }));
    this.members().forEach((ws) => send(ws, { type: "presence", people }));
  }

  private sendViewers(host: WebSocket) {
    send(host, { type: "viewers", ids: this.viewers().map((ws) => peerOf(ws)!.id) });
  }

  private async ghosts() {
    return [...(await this.ctx.storage.list<Ghost>({ prefix: GHOST_PREFIX })).values()];
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

  // Quem está na sala de verdade: sem os sockets recusados (sem attachment) e sem os que já saíram.
  private members() {
    return this.ctx.getWebSockets().filter((ws) => peerOf(ws) && !this.departed.has(ws));
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

// A página manda um segredo próprio ao conectar (e o mesmo ao reconectar). O id que os outros veem é o hash dele,
// então ninguém se passa por outra pessoa só por saber o id que aparece na presença.
async function peerIdFor(resumeToken: string | null) {
  if (!resumeToken || !RESUME_TOKEN_PATTERN.test(resumeToken)) return crypto.randomUUID();

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resumeToken));
  return Array.from(new Uint8Array(digest, 0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Responde o fechamento que o navegador começou; sem a resposta, ele fica 10 s esperando antes de largar a conexão.
// 1005 e 1006 só descrevem quedas e não podem ser enviados. Socket que já morreu (erro) não aceita mais nada.
function finishClose(ws: WebSocket, code: number) {
  try {
    ws.close(code === 1005 || code === 1006 ? 1000 : code);
  } catch {}
}

// Null para sockets recusados (aceitos só para receber o aviso de erro).
function peerOf(ws: WebSocket): Peer | null {
  return ws.deserializeAttachment();
}

function send(ws: WebSocket, message: object) {
  ws.send(JSON.stringify(message));
}
