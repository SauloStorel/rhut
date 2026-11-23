import { DurableObject } from "cloudflare:workers";
import { type BoardName, boardOf } from "./boards";
import { type Guild, fetchProfile, voiceChannelOf } from "./guild";
import { type Profile, signSfuPass } from "./identity";
import { sfuEnabled } from "./sfu";

// Uma sala = até MAX_SCREENS pessoas transmitindo a tela ao mesmo tempo, e qualquer um pode ligar a câmera.
// O servidor só faz a "apresentação" WebRTC entre os navegadores (ou entre o navegador e o SFU, quando ligado);
// vídeo e câmeras nunca passam por aqui. Cada pessoa tem uma conexão só com a sala: começar ou parar de transmitir
// é uma mensagem, para a câmera não cair na troca.
// Salas abertas pelo Discord aparecem lá (aviso próprio no canal ou linha no painel, ver boards.ts) e acompanham o estado da sala.
//
// Quem cai sem querer (Wi-Fi oscilou, celular trocou de rede) vira um "fantasma" por alguns segundos: continua
// na sala para os outros e, se reconectar a tempo, volta como a mesma pessoa, sem derrubar a transmissão.

// Com o SFU, quem transmite publica as trilhas numa sessão dele lá, e quem assiste puxa por esses nomes.
type SfuTracks = { sessionId: string; tracks: string[] };
type Peer = { id: string; sharing: boolean; sfu: SfuTracks | null; camera: boolean; profile: Profile };
type Ghost = { peer: Peer; expiresAt: number };
type Message = { type: string; to?: string; [key: string]: unknown };
type Command = (ws: WebSocket, peer: Peer, message: Message) => unknown;

export type RoomStatus = "waiting" | "live" | "closed";
export type OpenStatus = Exclude<RoomStatus, "closed">;

export type NewRoom = {
  roomId: string;
  guildId: string | null;
  guild: Guild | null;
  openerId: string;
  openerName: string;
  channelId: string;
  board: BoardName;
  // Link direto da sala para o "Entrar" (com login pelo Discord), ou null para o "Entrar" que manda o link pessoal.
  pageUrl: string | null;
  // Call em que a galera está: de quem abriu a sala e, depois, de quem começou a transmitir.
  voiceChannelId: string | null;
};

export type RoomInfo = NewRoom & {
  messageId: string;
  status: RoomStatus;
  liveSince: number | null;
  // Quem está transmitindo agora. Salas de antes da transmissão múltipla não têm o campo.
  sharers?: Profile[];
  // Pessoas na sala (a mesma pessoa em duas abas conta uma vez), contando quem transmite.
  people: number;
};

// Sinais WebRTC que o servidor só repassa, e quem pode mandar cada um: só quem está transmitindo oferece a própria
// tela, e só quem está com a câmera ligada oferece a câmera. Assim ninguém troca a imagem que os outros estão vendo.
const RELAYED_SIGNALS = new Map<string, (from: Peer) => boolean>([
  ["screen-request", () => true],
  ["screen-stop", () => true],
  ["screen-offer", (from) => from.sharing],
  ["screen-answer", () => true],
  ["screen-candidate", () => true],
  ["cam-offer", (from) => from.camera],
  ["cam-answer", () => true],
  ["cam-candidate", () => true],
]);

// Em P2P quem transmite manda uma cópia para cada pessoa; mais telas que isso e quem assiste não dá conta de baixar.
export const MAX_SCREENS = 4;
const SCREENS_FULL = `Já tem ${MAX_SCREENS} telas sendo transmitidas nesta sala. Espere alguém parar.`;
const REACTIONS = new Set(["👏", "😂", "🔥", "😮", "❤️", "💀"]);
const REACTION_INTERVAL_MS = 300;
// Um SDP com todos os codecs tem uns 10 KB; nada legítimo chega perto disso.
const MAX_MESSAGE_LENGTH = 64 * 1024;
const SFU_NAME_PATTERN = /^[\w-]{1,64}$/;
const IDLE_CLOSE_MS = 15 * 60 * 1000;
const RECONNECT_GRACE_MS = 20 * 1000;
// Aba fechada ou página saindo: a pessoa sai na hora, sem esperar por uma volta.
const DELIBERATE_CLOSE_CODES = new Set([1000, 1001]);
const RESUME_TOKEN_PATTERN = /^[0-9a-f-]{36}$/;
// Entradas e saídas de alguns segundos viram uma edição só no Discord, que limita quantas edições aceita.
const PEOPLE_SYNC_DELAY_MS = 3000;
const GHOST_PREFIX = "ghost:";

// Header que o Worker preenche depois de validar o passe; nunca vem do navegador (o Worker remove).
export const USER_HEADER = "X-Room-User";

export class Room extends DurableObject<Env> {
  // Sockets que já saíram da sala mas ainda aparecem em getWebSockets() enquanto fecham.
  private readonly departed = new WeakSet<WebSocket>();
  private readonly lastReaction = new WeakMap<WebSocket, number>();
  private boardSyncs = Promise.resolve();
  private peopleSync: Promise<void> | null = null;

  private readonly commands = new Map<string, Command>([
    ["share", (ws, peer, { on, sfu }) => this.share(ws, peer, Boolean(on), sfuTracksOf(sfu))],
    ["camera", (ws, peer, { on }) => this.updatePeer(ws, { ...peer, camera: Boolean(on) })],
    ["reaction", (ws, peer, { emoji }) => this.react(ws, peer, emoji)],
  ]);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // O "ping" da página é respondido sem acordar o objeto: mantém a conexão viva e deixa a página notar quando ela cai.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // Chamado pelo /live ou pelo "Abrir sala" do painel. Retorna false se o bot não conseguiu mostrar a sala no Discord.
  async open(room: NewRoom) {
    const info: RoomInfo = { ...room, messageId: "", status: "waiting", liveSince: null, sharers: [], people: 0 };
    const shown = await boardOf(info).open(info, this.env);
    if (!shown) return false;

    await this.save({ ...info, ...shown });
    await this.scheduleAlarm();
    return true;
  }

  // Chamado quando alguém clica em "Entrar na sala": guarda nome e avatar para quando a pessoa conectar.
  async admit(profile: Profile) {
    await this.ctx.storage.put(`profile:${profile.id}`, profile);
  }

  // Fecha quem está conectado na sala (entrou pelo "Entrar na sala") ou é admin do servidor. Responde na hora e fecha
  // em seguida: o clique no Discord precisa de resposta em 3 s, e atualizar o Discord pode esperar um limite de taxa.
  async requestClose(userId: string, isAdmin: boolean) {
    const canClose = isAdmin || this.members().some((ws) => peerOf(ws)!.profile.id === userId);
    if (canClose) this.ctx.waitUntil(this.close());
    return canClose;
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
      await this.leave();
    }

    const idleCloseAt = await this.ctx.storage.get<number>("idleCloseAt");
    if (idleCloseAt && idleCloseAt <= now && (await this.isEmpty())) return this.close();
    await this.scheduleAlarm();
  }

  async fetch(request: Request) {
    const [client, server] = Object.values(new WebSocketPair());
    if (!(await this.isOpen())) return this.reject(server, client, { type: "room-closed" });

    const id = await peerIdFor(new URL(request.url).searchParams.get("resume"));
    const returning = this.takeOverSocket(id) ?? (await this.takeGhost(id));
    const peer = returning ?? { id, sharing: false, sfu: null, camera: false, profile: await this.profileFor(request) };

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(peer);
    send(server, { type: "welcome", you: peer.profile, peerId: peer.id, resumed: Boolean(returning), sfuPass: await this.sfuPassFor(peer.id) });

    await this.broadcastPresence();
    await this.scheduleAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const peer = peerOf(ws);
    const message = parseMessage(raw);
    if (!peer || !message || this.departed.has(ws)) return;

    const mayRelay = RELAYED_SIGNALS.get(message.type);
    if (mayRelay?.(peer)) return this.relay(peer, message);
    await this.commands.get(message.type)?.(ws, peer, message);
  }

  async webSocketClose(ws: WebSocket, code: number) {
    finishClose(ws, code);
    const peer = this.depart(ws);
    if (!peer) return;

    if (DELIBERATE_CLOSE_CODES.has(code)) await this.leave();
    else await this.becomeGhost(peer);
    await this.scheduleAlarm();
  }

  // Conexão que terminou com erro: para a sala, é uma queda como outra qualquer.
  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1006);
  }

  // Repetir o pedido (a página repete ao reconectar) só atualiza as trilhas do SFU, sem contar como tela nova.
  private async share(ws: WebSocket, peer: Peer, on: boolean, sfu: SfuTracks | null) {
    if (on && !peer.sharing && (await this.sharers()).length >= MAX_SCREENS) return send(ws, { type: "share-refused", message: SCREENS_FULL });

    await this.updatePeer(ws, { ...peer, sharing: on, sfu: on ? sfu : null });
  }

  private async updatePeer(ws: WebSocket, peer: Peer) {
    ws.serializeAttachment(peer);
    await this.broadcastPresence();
    await this.syncSharers();
  }

  // Continua na lista para os outros até o prazo de voltar. A presença sai de novo porque uma mensagem que chegou
  // junto com a queda pode ter sido anunciada sem a pessoa (socket fechando não aparece em getWebSockets).
  private async becomeGhost(peer: Peer) {
    await this.ctx.storage.put<Ghost>(GHOST_PREFIX + peer.id, { peer, expiresAt: Date.now() + RECONNECT_GRACE_MS });
    await this.broadcastPresence();
  }

  // Alguém saiu de vez (fechou a aba ou não voltou a tempo): os outros param de receber a tela dele pela presença.
  private async leave() {
    await this.broadcastPresence();
    await this.syncSharers();
  }

  // Reações voam na tela de todo mundo. Só as da lista, e no máximo uma a cada REACTION_INTERVAL_MS por pessoa.
  private react(ws: WebSocket, peer: Peer, emoji: unknown) {
    const now = Date.now();
    if (typeof emoji !== "string" || !REACTIONS.has(emoji) || now - (this.lastReaction.get(ws) ?? 0) < REACTION_INTERVAL_MS) return;

    this.lastReaction.set(ws, now);
    this.members().forEach((member) => send(member, { type: "reaction", emoji, peerId: peer.id }));
  }

  // Todo sinal vai para uma pessoa só; sem `to`, não tem para quem repassar.
  private relay(from: Peer, { to, ...payload }: Message) {
    const target = to && this.members().find((ws) => peerOf(ws)!.id === to);
    if (target) send(target, { ...payload, from: from.id });
  }

  private async close() {
    await this.transition({ status: "closed" });
    this.ctx.getWebSockets().forEach((ws) => {
      this.depart(ws);
      send(ws, { type: "room-closed" });
      ws.close(1000, "room closed");
    });

    // Da sala encerrada só fica o estado (para quem abrir o link ver que acabou): perfis, fantasmas e prazos saem.
    const info = await this.info();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    if (info) await this.save(info);
  }

  // Sala aberta pelo bot e ainda não encerrada. Em desenvolvimento (DEV_ROOMS), qualquer link abre uma sala.
  private async isOpen() {
    const info = await this.info();
    return info ? info.status !== "closed" : this.env.DEV_ROOMS === "on";
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

  // Muda o estado e atualiza a sala no Discord. "closed" é final: nada mais muda depois dele.
  // Salas abertas pelo link direto (sem /live nem painel) não têm estado para guardar.
  private async transition(changes: Partial<RoomInfo>) {
    const info = await this.info();
    if (!info || info.status === "closed") return;

    await this.save({ ...info, ...changes });
    await this.syncBoard();
  }

  // Leva ao Discord quem está transmitindo, só quando isso muda. A sala vai para a call de quem acabou de começar;
  // se a pessoa não está em nenhuma (ou é convidado), fica a anterior.
  private async syncSharers() {
    const info = await this.info();
    const sharers = uniqueProfiles((await this.sharers()).map((peer) => peer.profile));
    const before = info?.sharers ?? [];
    if (!info || sameProfiles(before, sharers)) return;

    const newcomer = sharers.find((sharer) => !before.some((other) => other.id === sharer.id));
    const voiceChannelId = newcomer && (await voiceChannelOf(this.env, info.guildId, newcomer.id));
    const live = sharers.length > 0;
    await this.transition({
      status: live ? "live" : "waiting",
      sharers,
      liveSince: live ? (info.liveSince ?? Date.now()) : null,
      ...(voiceChannelId ? { voiceChannelId } : {}),
    });
  }

  // As atualizações entram numa fila e cada uma manda o estado mais recente: duas mudanças rápidas não chegam
  // fora de ordem ao Discord.
  private syncBoard() {
    this.boardSyncs = this.boardSyncs
      .then(async () => {
        const info = (await this.info())!;
        await boardOf(info).sync(info, this.env);
      })
      .catch((error) => console.error("Não deu para atualizar a sala no Discord:", error));
    return this.boardSyncs;
  }

  // Nome e avatar de quem o Worker identificou: guardados no "Entrar na sala" (passe) ou buscados pelo bot na
  // primeira conexão (sessão). Quem entrou sem identidade (link copiado, cancelou o login) aparece como convidado.
  private async profileFor(request: Request): Promise<Profile> {
    const userId = request.headers.get(USER_HEADER);
    const profile = userId && ((await this.ctx.storage.get<Profile>(`profile:${userId}`)) ?? (await this.lookUpProfile(userId)));
    return profile || { id: crypto.randomUUID(), name: "Convidado", avatarUrl: null };
  }

  private async lookUpProfile(userId: string) {
    const profile = await fetchProfile(this.env, (await this.info())?.guildId ?? null, userId);
    if (profile) await this.admit(profile);
    return profile;
  }

  // Passe para criar sessão no SFU, só com ele configurado. O id da sala é o nome deste objeto.
  private async sfuPassFor(peerId: string) {
    return sfuEnabled(this.env) && this.ctx.id.name ? signSfuPass(this.env, this.ctx.id.name, peerId) : null;
  }

  // A contagem muda a cada entrada e saída; espera um pouco e manda só o número final ao Discord.
  private syncPeopleSoon() {
    this.peopleSync ??= scheduler.wait(PEOPLE_SYNC_DELAY_MS).then(async () => {
      this.peopleSync = null;
      const info = await this.info();
      const people = await this.peopleCount();
      if (info && info.people !== people) await this.transition({ people });
    });
  }

  private async peopleCount() {
    return new Set((await this.peers()).map((peer) => peer.profile.id)).size;
  }

  // Manda para todo mundo a lista de quem está na sala; fantasmas continuam nela até o prazo de voltar acabar.
  private async broadcastPresence() {
    const people = (await this.peers()).map(({ id, sharing, sfu, camera, profile }) => ({ ...profile, peerId: id, sharing, sfu, camera }));
    this.members().forEach((ws) => send(ws, { type: "presence", people }));
    this.syncPeopleSoon();
  }

  // Quem está na sala, contando os fantasmas (que ainda podem voltar).
  private async peers() {
    return [...this.members().map((ws) => peerOf(ws)!), ...(await this.ghosts()).map((ghost) => ghost.peer)];
  }

  // Quem está transmitindo, contando quem caiu e ainda pode voltar (a vaga dele continua guardada).
  private async sharers() {
    return (await this.peers()).filter((peer) => peer.sharing);
  }

  private async ghosts() {
    return [...(await this.ctx.storage.list<Ghost>({ prefix: GHOST_PREFIX })).values()];
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

// Mensagem que não é JSON, não diz o que é ou é grande demais é ignorada.
function parseMessage(raw: string | ArrayBuffer): Message | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_LENGTH) return null;
  try {
    const message = JSON.parse(raw);
    return typeof message?.type === "string" ? message : null;
  } catch {
    return null;
  }
}

// As trilhas que quem transmite publicou no SFU; qualquer coisa fora do formato vira null (transmissão em P2P).
function sfuTracksOf(value: unknown): SfuTracks | null {
  const { sessionId, tracks } = (value ?? {}) as Partial<SfuTracks>;
  const isName = (name: unknown) => typeof name === "string" && SFU_NAME_PATTERN.test(name);
  const valid = isName(sessionId) && Array.isArray(tracks) && tracks.length > 0 && tracks.length <= 2 && tracks.every(isName);
  return valid ? { sessionId: sessionId!, tracks } : null;
}

// A mesma pessoa pode transmitir de duas abas; no Discord ela aparece uma vez.
function uniqueProfiles(profiles: Profile[]) {
  return [...new Map(profiles.map((profile) => [profile.id, profile])).values()];
}

function sameProfiles(a: Profile[], b: Profile[]) {
  return a.map((profile) => profile.id).join() === b.map((profile) => profile.id).join();
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
