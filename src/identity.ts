// Identifica quem entra na sala sem tela de login: o botão "Entrar na sala" no Discord já diz quem clicou,
// e o bot responde com um link pessoal assinado (HMAC) que só vale para aquela sala, por algumas horas.

const CDN = "https://cdn.discordapp.com";
const PASS_TTL_SECONDS = 12 * 60 * 60;
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

export async function signPass(env: Env, roomId: string, userId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + PASS_TTL_SECONDS;
  const signature = await crypto.subtle.sign("HMAC", await passKey(env), encoder.encode(`${roomId}.${userId}.${expiresAt}`));
  return `${userId}.${expiresAt}.${toBase64Url(signature)}`;
}

// Retorna o id de quem é dono do passe, ou null se ele for inválido, de outra sala ou expirado.
export async function verifyPass(env: Env, roomId: string, pass: string | null) {
  const [userId, expiresAt, signature] = pass?.split(".") ?? [];
  if (!userId || !signature || Number(expiresAt) < Date.now() / 1000) return null;

  const valid = await crypto.subtle.verify("HMAC", await passKey(env), fromBase64Url(signature), encoder.encode(`${roomId}.${userId}.${expiresAt}`));
  return valid ? userId : null;
}

function passKey(env: Env) {
  return crypto.subtle.importKey("raw", encoder.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toBase64Url(buffer: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string) {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
}
