import type { RoomInfo, RoomStatus } from "./room";

// Aviso que o bot posta no canal e vai editando conforme a sala muda de estado.

export const JOIN_ROOM_ACTION = "join-room";
export const CLOSE_ROOM_ACTION = "close-room";

const ComponentType = { ACTION_ROW: 1, BUTTON: 2 } as const;
const ButtonStyle = { PRIMARY: 1, DANGER: 4, LINK: 5 } as const;
const LIVE_RED = 0xda373c;
const CLOSED_GREY = 0x4e5058;
const DISCORD_BLURPLE = 0x5865f2;

type View = { title: string; description: string; color: number; components: object[]; thumbnail?: { url: string } };

const views: Record<RoomStatus, (info: RoomInfo, accentColor: number) => View> = {
  waiting: (info, accentColor) => ({
    title: "Sala aberta",
    description: `<@${info.openerId}> abriu uma sala. Clique em **Entrar na sala**. Quem for transmitir clica em **Compartilhar tela** lá dentro.`,
    color: accentColor,
    components: roomButtons(info),
  }),
  live: (info) => ({
    title: "Ao vivo agora",
    description: `**${escapeMarkdown(info.host?.name ?? "Alguém")}** está transmitindo desde ${discordTime(info.liveSince!, "R")}.`,
    color: LIVE_RED,
    components: roomButtons(info),
    thumbnail: info.host?.avatarUrl ? { url: info.host.avatarUrl } : undefined,
  }),
  closed: (info) => ({
    title: "Sala encerrada",
    description: `Ficou aberta das ${discordTime(info.openedAt, "t")} às ${discordTime(info.closedAt!, "t")} · ${peakText(info.peakViewers)}.`,
    color: CLOSED_GREY,
    components: [],
  }),
};

export function announcement(info: RoomInfo, accentColor: string) {
  const { components, ...embed } = views[info.status](info, embedColor(accentColor));

  return {
    embeds: [{ ...embed, author: info.guild && { name: info.guild.name, icon_url: info.guild.iconUrl ?? undefined } }],
    components,
    allowed_mentions: { parse: [] },
  };
}

// "auto" só dá para calcular no navegador (precisa ler o ícone); no aviso do Discord fica o azul padrão.
function embedColor(accentColor: string) {
  return /^#[0-9a-f]{6}$/i.test(accentColor) ? parseInt(accentColor.slice(1), 16) : DISCORD_BLURPLE;
}

function roomButtons(info: RoomInfo) {
  return [
    {
      type: ComponentType.ACTION_ROW,
      components: [
        { type: ComponentType.BUTTON, style: ButtonStyle.PRIMARY, label: "Entrar na sala", custom_id: `${JOIN_ROOM_ACTION}:${info.roomId}` },
        { type: ComponentType.BUTTON, style: ButtonStyle.DANGER, label: "Fechar sala", custom_id: `${CLOSE_ROOM_ACTION}:${info.roomId}` },
      ],
    },
  ];
}

// Link pessoal que o bot manda (só para quem clicou) depois do "Entrar na sala".
export function personalLink(url: string) {
  return {
    content: "Seu link pessoal para a sala. Ele mostra seu nome e avatar para quem estiver lá, então não repasse.",
    components: [
      { type: ComponentType.ACTION_ROW, components: [{ type: ComponentType.BUTTON, style: ButtonStyle.LINK, label: "Abrir transmissão", url }] },
    ],
  };
}

function escapeMarkdown(text: string) {
  return text.replace(/[\\*_`~|>]/g, "\\$&");
}

// Timestamps do Discord se ajustam ao fuso de quem lê; "R" vira "há 5 minutos" e atualiza sozinho.
function discordTime(ms: number, style: "t" | "R") {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

const PEAK_TEXTS: Record<number, string> = { 0: "ninguém assistiu", 1: "pico de 1 pessoa assistindo" };

function peakText(peak: number) {
  return PEAK_TEXTS[peak] ?? `pico de ${peak} pessoas assistindo`;
}
