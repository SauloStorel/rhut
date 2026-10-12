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

async function signToken(env: Env, scope: string, userId: string, ttlSeconds: number) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(env), encoder.encode(`${scope}.${userId}.${expiresAt}`));
  return `${userId}.${expiresAt}.${toBase64Url(signature)}`;
}

async function verifyToken(env: Env, scope: string, token: string | null) {
  const [userId, expiresAt, signature] = token?.split(".") ?? [];
  if (!userId || !signature || Number(expiresAt) < Date.now() / 1000) return null;

  const valid = await crypto.subtle.verify("HMAC", await signingKey(env), fromBase64Url(signature), encoder.encode(`${scope}.${userId}.${expiresAt}`));
  return valid ? userId : null;
}

function signingKey(env: Env) {
  return crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toBase64Url(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string) {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
}
