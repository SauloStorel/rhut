// https://developers.cloudflare.com/realtime/turn/generate-credentials/
const STUN_ONLY = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] };
const CREDENTIALS_TTL_SECONDS = 12 * 60 * 60;

type IceServer = { urls: string | string[]; username?: string; credential?: string };

export async function iceServers(env: Env): Promise<{ iceServers: IceServer[] }> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_ONLY;

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: CREDENTIALS_TTL_SECONDS }),
    },
  );
  if (!response.ok) return STUN_ONLY;

  const { iceServers } = await response.json<{ iceServers: IceServer[] }>();
  return { iceServers: iceServers.map(withoutPort53) };
}

// Navegadores bloqueiam a porta 53; a própria Cloudflare recomenda remover essas URLs.
function withoutPort53(server: IceServer): IceServer {
  return { ...server, urls: [server.urls].flat().filter((url) => !/:53(\?|$)/.test(url)) };
}
