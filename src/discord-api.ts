const API = "https://discord.com/api/v10";
const MAX_ATTEMPTS = 3;

// No limite de taxa (429), espera o tempo que o Discord pede e tenta de novo.
export async function discordApi(env: Env, method: string, path: string, body?: object, attempt = 1): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (response.status !== 429 || attempt >= MAX_ATTEMPTS) return response;

  const { retry_after } = await response.json<{ retry_after: number }>();
  await scheduler.wait(retry_after * 1000);
  return discordApi(env, method, path, body, attempt + 1);
}
