import { signSfuSession, verifySfuPass, verifySfuSession } from "./identity";

// SFU do Cloudflare Realtime (opcional): quem transmite manda uma cópia só da tela para o SFU, e ele distribui para
// quem assiste, em vez de uma cópia por pessoa saindo do PC de quem transmite. O navegador não pode ter o segredo do
// app, então fala com o SFU por aqui. Só cria sessão quem está conectado na sala (passe do "welcome"), e cada sessão
// só aceita mudanças de quem a criou (passe da sessão): ninguém fecha a transmissão de outra pessoa.
// https://developers.cloudflare.com/realtime/sfu/https-api/

const API = "https://rtc.live.cloudflare.com/v1/apps";
export const SFU_PASS_HEADER = "X-Sfu-Pass";
export const SFU_SESSION_HEADER = "X-Sfu-Session";
// O que a página pode pedir numa sessão dela: publicar ou puxar trilhas, responder a renegociação e fechar trilhas.
export const SESSION_ACTIONS = {
  tracks: { method: "POST", path: "tracks/new" },
  renegotiate: { method: "PUT", path: "renegotiate" },
  close: { method: "PUT", path: "tracks/close" },
} as const;
const MAX_BODY_LENGTH = 64 * 1024;

type Params = Record<string, string | undefined>;

export function sfuEnabled(env: Env) {
  return Boolean(env.REALTIME_APP_ID && env.REALTIME_APP_SECRET);
}

export async function createSfuSession(request: Request, env: Env, { room }: Params) {
  if (!sfuEnabled(env) || !(await verifySfuPass(env, room!, request.headers.get(SFU_PASS_HEADER)))) return forbidden();

  const response = await sfuApi(env, "POST", "sessions/new");
  if (!response.ok) return relayed(response);

  const { sessionId } = await response.json<{ sessionId: string }>();
  return Response.json({ sessionId, grant: await signSfuSession(env, room!, sessionId) });
}

export async function updateSfuSession(request: Request, env: Env, { room, action }: Params) {
  const sessionId = sfuEnabled(env) ? await verifySfuSession(env, room!, request.headers.get(SFU_SESSION_HEADER)) : null;
  if (!sessionId) return forbidden();

  const body = await request.text();
  if (body.length > MAX_BODY_LENGTH) return new Response("Too large", { status: 413 });

  const { method, path } = SESSION_ACTIONS[action as keyof typeof SESSION_ACTIONS];
  return relayed(await sfuApi(env, method, `sessions/${sessionId}/${path}`, body));
}

function sfuApi(env: Env, method: string, path: string, body?: string) {
  return fetch(`${API}/${env.REALTIME_APP_ID}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.REALTIME_APP_SECRET}`, "Content-Type": "application/json" },
    body,
  });
}

// A resposta do SFU vai como veio: a página lê os erros por trilha (errorCode) do próprio corpo.
function relayed(response: Response) {
  return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json" } });
}

function forbidden() {
  return new Response("Forbidden", { status: 403 });
}
