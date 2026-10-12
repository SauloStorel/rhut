import { discordApi } from "./discord-api";
import { type DiscordMember, type DiscordUser, type Profile, profileOf } from "./identity";

// O que o bot consulta sobre o servidor e as pessoas dele, com o próprio token.

export type Guild = { name: string; iconUrl: string | null };

export async function fetchGuild(env: Env, guildId: string | undefined): Promise<Guild | null> {
  if (!guildId) return null;

  const response = await discordApi(env, "GET", `/guilds/${guildId}`);
  if (!response.ok) return null;

  const { name, icon } = await response.json<{ name: string; icon: string | null }>();
  return { name, iconUrl: icon && `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=128` };
}

// Nome e avatar como aparecem no servidor (apelido e avatar do servidor têm prioridade). Fora de um servidor,
// ou se a pessoa não está nele, fica o perfil da conta. Null se o id nem é de uma conta do Discord.
export async function fetchProfile(env: Env, guildId: string | null, userId: string): Promise<Profile | null> {
  const member = guildId ? await getJson<DiscordMember>(env, `/guilds/${guildId}/members/${userId}`) : null;
  if (member) return profileOf(member.user, member, guildId!);

  const user = await getJson<DiscordUser>(env, `/users/${userId}`);
  return user && profileOf(user, undefined, undefined);
}

// Canal de voz em que a pessoa está agora no servidor, ou null se ela não está em nenhum.
export async function voiceChannelOf(env: Env, guildId: string | null, userId: string) {
  if (!guildId) return null;
  return (await getJson<{ channel_id: string | null }>(env, `/guilds/${guildId}/voice-states/${userId}`))?.channel_id ?? null;
}

async function getJson<T>(env: Env, path: string) {
  const response = await discordApi(env, "GET", path);
  return response.ok ? response.json<T>() : null;
}
