import { SESSION_MAX_AGE_SECONDS, signSession, verifySession } from "./identity";
import { ROOM_ID_PATTERN } from "./room-id";

// Entrar com um clique: o "Entrar" do Discord é um link direto para a sala. Na primeira vez, a pessoa autoriza o
// rhut no Discord (só o escopo `identify`, para saber quem é) e volta para a sala com um cookie de sessão assinado.
// Quem cancela a autorização entra como convidado. Sem DISCORD_APPLICATION_ID e DISCORD_CLIENT_SECRET, nada
// disso liga, e o "Entrar" continua mandando o link pessoal pelo bot.

const SESSION_COOKIE = "rhut_session";
const STATE_COOKIE = "rhut_oauth";
const STATE_MAX_AGE_SECONDS = 10 * 60;
const CALLBACK_PATH = "/auth/callback";
export const GUEST_PARAM = "convidado";

export function oauthEnabled(env: Env) {
  return Boolean(env.DISCORD_APPLICATION_ID && env.DISCORD_CLIENT_SECRET);
}

// Quem tem sessão é essa pessoa; null para quem não tem (ou tem uma inválida ou vencida).
export function sessionUserId(request: Request, env: Env) {
  return verifySession(env, cookieOf(request, SESSION_COOKIE));
}

// Abriu a sala sem passe, sem sessão e sem ter escolhido entrar como convidado: vai autorizar no Discord.
// Null quando a página da sala pode abrir direto.
export async function signInIfNeeded(request: Request, env: Env, roomId: string) {
  if (!oauthEnabled(env)) return null;

  const url = new URL(request.url);
  const identified = url.searchParams.has("pass") || url.searchParams.has(GUEST_PARAM) || (await sessionUserId(request, env));
  if (identified) return null;

  const state = crypto.randomUUID();
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.search = new URLSearchParams({
    client_id: env.DISCORD_APPLICATION_ID!,
    response_type: "code",
    scope: "identify",
    redirect_uri: new URL(CALLBACK_PATH, url).href,
    state,
    // Quem já autorizou antes não vê a tela de novo.
    prompt: "none",
  }).toString();

  return redirect(authorize.href, cookie(STATE_COOKIE, `${state}.${roomId}`, STATE_MAX_AGE_SECONDS));
}

// Volta do Discord: confere que a autorização é a que esta página pediu, descobre quem é e cria a sessão.
export async function handleOAuthCallback(request: Request, env: Env) {
  const url = new URL(request.url);
  const [expectedState, roomId] = cookieOf(request, STATE_COOKIE)?.split(".") ?? [];
  if (!roomId || !new RegExp(`^${ROOM_ID_PATTERN}$`).test(roomId)) return new Response("Link de entrada expirado. Volte ao Discord e clique em Entrar de novo.", { status: 400 });

  const room = new URL(`/r/${roomId}`, url);
  const clearState = cookie(STATE_COOKIE, "", 0);
  const code = url.searchParams.get("code");
  const userId = code && url.searchParams.get("state") === expectedState ? await discordUserId(env, code, new URL(CALLBACK_PATH, url).href) : null;
  if (!userId) {
    room.searchParams.set(GUEST_PARAM, "");
    return redirect(room.href, clearState);
  }

  return redirect(room.href, clearState, cookie(SESSION_COOKIE, await signSession(env, userId), SESSION_MAX_AGE_SECONDS));
}

async function discordUserId(env: Env, code: string, redirectUri: string) {
  const token = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_APPLICATION_ID!,
      client_secret: env.DISCORD_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!token.ok) return null;

  const { access_token } = await token.json<{ access_token: string }>();
  const me = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bearer ${access_token}` } });
  return me.ok ? (await me.json<{ id: string }>()).id : null;
}

function cookieOf(request: Request, name: string) {
  const pair = request.headers.get("Cookie")?.split(/;\s*/).find((entry) => entry.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

function cookie(name: string, value: string, maxAgeSeconds: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

function redirect(location: string, ...cookies: string[]) {
  const headers = new Headers({ Location: location });
  cookies.forEach((value) => headers.append("Set-Cookie", value));
  return new Response(null, { status: 302, headers });
}
