// Identifica quem entra na sala, de dois jeitos, os dois assinados com HMAC:
// - sessão: quem autorizou o rhut no Discord (OAuth) ganha um cookie que vale para qualquer sala por 30 dias;
// - passe: sem OAuth configurado, o botão "Entrar na sala" responde com um link pessoal que só vale para
//   aquela sala, por algumas horas.

const CDN = "https://cdn.discordapp.com";
const PASS_TTL_SECONDS = 12 * 60 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
// O passe é assinado junto com o id da sala ([a-z0-9]{10}); a sessão, com esta palavra. Um nunca vale como o outro.
const SESSION_SCOPE = "session";
const encoder = new TextEncoder();

export type Profile = { id: string; name: string; avatarUrl: string | null };

export type DiscordUser = { id: string; username: string; global_name?: string | null; avatar?: string | null };
export type DiscordMember = { user: DiscordUser; nick?: string | null; avatar?: string | null; permissions: string };

// Apelido no servidor e avatar do servidor têm prioridade, como no próprio Discord.
export function profileOf(user: DiscordUser, member: DiscordMember | undefined, guildId: string | undefined): Profile {
  const guildAvatar = member?.avatar && guildId && `${CDN}/guilds/${guildId}/users/${user.id}/avatars/${member.avatar}.png?size=128`;
  const userAvatar = user.avatar && `${CDN}/avatars/${user.id}/${user.avatar}.png?size=128`;
  const defaultAvatar = `${CDN}/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;

  return { id: user.id, name: member?.nick || user.global_name || user.username, avatarUrl: guildAvatar || userAvatar || defaultAvatar };
}

// O Discord manda as permissões de quem clicou já resolvidas no canal; dono do servidor vem com todas.
const ADMINISTRATOR = 1n << 3n;

export function isAdmin(member: DiscordMember | undefined) {
  return (BigInt(member?.permissions ?? 0) & ADMINISTRATOR) === ADMINISTRATOR;
}

export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_SECONDS;

export function signPass(env: Env, roomId: string, userId: string) {
  return signToken(env, roomId, userId, PASS_TTL_SECONDS);
}

// Retorna o id de quem é dono do passe, ou null se ele for inválido, de outra sala ou expirado.
export function verifyPass(env: Env, roomId: string, pass: string | null) {
  return verifyToken(env, roomId, pass);
}

export function signSession(env: Env, userId: string) {
  return signToken(env, SESSION_SCOPE, userId, SESSION_TTL_SECONDS);
}

export function verifySession(env: Env, session: string | null) {
  return verifyToken(env, SESSION_SCOPE, session);
}

// `subject` é quem o token identifica: uma pessoa do Discord, um participante da sala ou uma sessão do SFU.
async function signToken(env: Env, scope: string, subject: string, ttlSeconds: number) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(env), encoder.encode(`${scope}.${subject}.${expiresAt}`));
  return `${subject}.${expiresAt}.${toBase64Url(signature)}`;
}

// Sala aberta pelo bot com o SFU ligado: só quem está conectado nela cria sessão no SFU (o passe vem no "welcome"),
// e cada sessão só aceita mudanças de quem a criou (o passe da sessão vem na resposta de quem criou).
export function signSfuPass(env: Env, roomId: string, peerId: string) {
  return signToken(env, `sfu.${roomId}`, peerId, PASS_TTL_SECONDS);
}

export function verifySfuPass(env: Env, roomId: string, pass: string | null) {
  return verifyToken(env, `sfu.${roomId}`, pass);
}

export function signSfuSession(env: Env, roomId: string, sessionId: string) {
  return signToken(env, `sfu-session.${roomId}`, sessionId, PASS_TTL_SECONDS);
}

export function verifySfuSession(env: Env, roomId: string, grant: string | null) {
  return verifyToken(env, `sfu-session.${roomId}`, grant);
}

// Link cortado ou cookie adulterado vira "sem identidade" (convidado), nunca um erro 500.
async function verifyToken(env: Env, scope: string, token: string | null) {
  const [subject, expiresAt, signature] = token?.split(".") ?? [];
  const signatureBytes = signature && fromBase64Url(signature);
  if (!subject || !signatureBytes || Number(expiresAt) < Date.now() / 1000) return null;

  const valid = await crypto.subtle.verify("HMAC", await signingKey(env), signatureBytes, encoder.encode(`${scope}.${subject}.${expiresAt}`));
  return valid ? subject : null;
}

function signingKey(env: Env) {
  return crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toBase64Url(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Null quando o texto nem é base64 (o atob lança erro).
function fromBase64Url(text: string) {
  try {
    return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
