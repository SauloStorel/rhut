import { ButtonStyle, CLOSE_ROOM_ACTION, LIVE_RED, callButtons, embedColor, escapeMarkdown, guildAuthor, joinButton, relativeTime, roomDetails, row } from "./discord-ui";
import type { OpenStatus, RoomInfo } from "./room";

// Aviso que o bot posta no canal (quando o servidor não tem painel) e vai editando conforme a sala muda de estado.
// Quando a sala fecha, ele sai do canal (não tem versão "encerrada"), para os avisos antigos não se acumularem.

type View = { title: string; description: string; color: number; thumbnail?: { url: string } };

const views: Record<OpenStatus, (info: RoomInfo, accentColor: number) => View> = {
  waiting: (info, accentColor) => ({
    title: "Sala aberta",
    description: `<@${info.openerId}> abriu uma sala. Clique em **Entrar na sala**. Quem for transmitir clica em **Compartilhar tela** lá dentro.`,
    color: accentColor,
  }),
  live: (info) => ({
    title: "Ao vivo agora",
    description: `**${escapeMarkdown(info.host?.name ?? "Alguém")}** está transmitindo desde ${relativeTime(info.liveSince!)}.`,
    color: LIVE_RED,
    thumbnail: info.host?.avatarUrl ? { url: info.host.avatarUrl } : undefined,
  }),
};

export function announcement(info: RoomInfo & { status: OpenStatus }, accentColor: string) {
  const view = views[info.status](info, embedColor(accentColor));
  const details = roomDetails(info.status, info).join(" · ");

  return {
    embeds: [{ ...view, description: [view.description, details].filter(Boolean).join("\n"), author: guildAuthor(info.guild) }],
    components: [
      row(
        joinButton(info, "Entrar na sala"),
        ...callButtons(info),
        { style: ButtonStyle.DANGER, label: "Fechar sala", custom_id: `${CLOSE_ROOM_ACTION}:${info.roomId}` },
      ),
    ],
    allowed_mentions: { parse: [] },
  };
}

// Link pessoal que o bot manda (só para quem clicou) depois do "Entrar na sala", quando não há login pelo Discord.
export function personalLink(url: string) {
  return {
    content: "Seu link pessoal para a sala. Ele mostra seu nome e avatar para quem estiver lá, então não repasse.",
    components: [row({ style: ButtonStyle.LINK, label: "Abrir transmissão", url })],
  };
}
