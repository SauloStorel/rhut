// https://developers.cloudflare.com/realtime/turn/generate-credentials/
const STUN_ONLY = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] };
const CREDENTIALS_TTL_SECONDS = 12 * 60 * 60;
// As credenciais servem para qualquer sala: ficam guardadas na instância do Worker em vez de pedir a cada página
// aberta. Metade da validade, para quem abrir a sala no fim do cache ainda ter horas de transmissão pela frente.
const CACHE_MS = (CREDENTIALS_TTL_SECONDS * 1000) / 2;

type IceServer = { urls: string | string[]; username?: string; credential?: string };
type IceConfig = { iceServers: IceServer[] };

let cached: { config: IceConfig; expiresAt: number } | null = null;

export async function iceServers(env: Env): Promise<IceConfig> {
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  const config = await generateIceServers(env).catch(() => null);
  if (!config) return STUN_ONLY;

  cached = { config, expiresAt: Date.now() + CACHE_MS };
  return config;
}

// Null quando não tem TURN configurado ou a Cloudflare não respondeu: a sala segue só com STUN e tenta de novo depois.
async function generateIceServers(env: Env): Promise<IceConfig | null> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return null;

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: CREDENTIALS_TTL_SECONDS }),
    },
  );
  if (!response.ok) return null;

  const { iceServers } = await response.json<IceConfig>();
  return { iceServers: iceServers.map(withoutPort53) };
}

// Navegadores bloqueiam a porta 53; a própria Cloudflare recomenda remover essas URLs.
function withoutPort53(server: IceServer): IceServer {
  return { ...server, urls: [server.urls].flat().filter((url) => !/:53(\?|$)/.test(url)) };
}
