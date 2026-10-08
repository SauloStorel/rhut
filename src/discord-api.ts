const API = "https://discord.com/api/v10";

export function discordApi(env: Env, method: string, path: string, body?: object) {
  return fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
}
