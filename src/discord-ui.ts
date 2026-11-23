import type { Guild } from "./guild";
import type { Profile } from "./identity";
import type { OpenStatus, RoomInfo } from "./room";

// Peças das mensagens do bot no Discord, usadas pelo aviso da sala e pelo painel.

export const JOIN_ROOM_ACTION = "join-room";
export const CLOSE_ROOM_ACTION = "close-room";
export const OPEN_ROOM_ACTION = "open-room";
export const PICK_ROOM_ACTION = "pick-room";

export const ButtonStyle = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4, LINK: 5 } as const;
export const LIVE_RED = 0xda373c;

const ComponentType = { ACTION_ROW: 1, BUTTON: 2, STRING_SELECT: 3 } as const;
const DISCORD_BLURPLE = 0x5865f2;
const MAX_LABEL = 80;
const MAX_OPTION_TEXT = 100;
export const MAX_SELECT_OPTIONS = 25;

type Button = { style: number; label: string } & ({ custom_id: string } | { url: string });
type SelectOption = { label: string; value: string; description?: string };
type RoomLinks = Pick<RoomInfo, "roomId" | "guildId" | "pageUrl" | "voiceChannelId">;
type Crowd = Pick<RoomInfo, "people" | "voiceChannelId" | "sharers">;

// Quem transmite não conta como "assistindo".
const CROWD: Record<OpenStatus, (people: number, sharing: number) => string | null> = {
  waiting: (people) => (people > 0 ? `${people} na sala` : null),
  live: (people, sharing) => (people > sharing ? `${people - sharing} assistindo` : null),
};

export function row(...buttons: Button[]) {
  return { type: ComponentType.ACTION_ROW, components: buttons.map((button) => ({ type: ComponentType.BUTTON, ...button, label: truncate(button.label) })) };
}

// Menu de escolha numa fileira só (cabe até MAX_SELECT_OPTIONS opções, contra 5 botões por fileira).
export function selectRow(customId: string, placeholder: string, options: SelectOption[]) {
  const option = ({ label, value, description }: SelectOption) => ({ label: truncate(label, MAX_OPTION_TEXT), value, description: description && truncate(description, MAX_OPTION_TEXT) });
  return { type: ComponentType.ACTION_ROW, components: [{ type: ComponentType.STRING_SELECT, custom_id: customId, placeholder, options: options.map(option) }] };
}

// Com login pelo Discord, "Entrar" é um link direto para a sala; sem, o clique pede ao bot o link pessoal.
// (Botão de link no Discord é sempre cinza; não dá para deixá-lo na cor de destaque.)
export function joinButton({ roomId, pageUrl }: RoomLinks, label: string): Button {
  return pageUrl ? { style: ButtonStyle.LINK, label, url: pageUrl } : { style: ButtonStyle.PRIMARY, label, custom_id: `${JOIN_ROOM_ACTION}:${roomId}` };
}

// Link do canal de voz: clicar nele no Discord entra na call. Sala sem call não tem o botão.
export function callButtons({ guildId, voiceChannelId }: RoomLinks): Button[] {
  return guildId && voiceChannelId ? [{ style: ButtonStyle.LINK, label: "Ir para a call", url: `https://discord.com/channels/${guildId}/${voiceChannelId}` }] : [];
}

// O que acompanha o estado da sala no aviso e no painel: quantas pessoas e em qual call ("3 assistindo", "na call #Geral").
// Salas abertas antes da contagem não guardaram `people`.
export function roomDetails(status: OpenStatus, { people, voiceChannelId, sharers }: Crowd) {
  return [CROWD[status](people ?? 0, sharers?.length ?? 0), voiceChannelId && `na call <#${voiceChannelId}>`].filter((detail): detail is string => Boolean(detail));
}

// "**Ana** está transmitindo desde há 5 minutos", "**Ana** e **Bia** estão transmitindo desde...".
export function sharingSentence(sharers: Profile[] | undefined, liveSince: number) {
  const names = (sharers?.length ? sharers.map((sharer) => sharer.name) : ["Alguém"]).map((name) => `**${escapeMarkdown(name)}**`);
  const listed = names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names.at(-1)}` : names[0];
  return `${listed} ${names.length > 1 ? "estão" : "está"} transmitindo desde ${relativeTime(liveSince)}`;
}

// "auto" só dá para calcular no navegador (precisa ler o ícone); no Discord fica o azul padrão.
export function embedColor(accentColor: string) {
  return /^#[0-9a-f]{6}$/i.test(accentColor) ? parseInt(accentColor.slice(1), 16) : DISCORD_BLURPLE;
}

export function guildAuthor(guild: Guild | null) {
  return guild ? { name: guild.name, icon_url: guild.iconUrl ?? undefined } : undefined;
}

export function escapeMarkdown(text: string) {
  return text.replace(/[\\*_`~|>]/g, "\\$&");
}

// Timestamp do Discord no estilo "R": vira "há 5 minutos" no fuso de quem lê e atualiza sozinho.
export function relativeTime(ms: number) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

function truncate(text: string, max = MAX_LABEL) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
