import { discordApi } from "./discord-api";

export type Guild = { name: string; iconUrl: string | null };

export async function fetchGuild(guildId: string | undefined, env: Env): Promise<Guild | null> {
  if (!guildId) return null;

  const response = await discordApi(env, "GET", `/guilds/${guildId}`);
  if (!response.ok) return null;

  const { name, icon } = await response.json<{ name: string; icon: string | null }>();
  return { name, iconUrl: icon && `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=128` };
}
