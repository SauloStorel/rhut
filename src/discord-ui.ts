import type { Guild } from "./guild";

// Peças das mensagens do bot no Discord, usadas pelo aviso da sala e pelo painel.

export const JOIN_ROOM_ACTION = "join-room";
export const CLOSE_ROOM_ACTION = "close-room";
export const OPEN_ROOM_ACTION = "open-room";

export const ButtonStyle = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, DANGER: 4, LINK: 5 } as const;
export const LIVE_RED = 0xda373c;

const ComponentType = { ACTION_ROW: 1, BUTTON: 2 } as const;
const DISCORD_BLURPLE = 0x5865f2;
const MAX_LABEL = 80;

type Button = { style: number; label: string } & ({ custom_id: string } | { url: string });

export function row(...buttons: Button[]) {
  return { type: ComponentType.ACTION_ROW, components: buttons.map((button) => ({ type: ComponentType.BUTTON, ...button, label: truncate(button.label) })) };
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

function truncate(label: string) {
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}
