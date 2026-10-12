import { ButtonStyle, CLOSE_ROOM_ACTION, LIVE_RED, OPEN_ROOM_ACTION, callButtons, embedColor, escapeMarkdown, guildAuthor, joinButton, relativeTime, roomDetails, row } from "./discord-ui";
import type { Guild } from "./guild";
import type { RoomCard } from "./lobby";
import type { OpenStatus } from "./room";

// Painel fixo no canal escolhido com /painel: as salas abertas do servidor e o botão para abrir outra.
// O Discord aceita 5 fileiras de botões numa mensagem; uma é do "Abrir sala", então só as 4 primeiras salas
// ganham botões (as outras aparecem na lista, e ainda dá para entrar por elas pelo link de quem já está lá).
const MAX_ROOMS_WITH_BUTTONS = 4;
const EMPTY = "Nenhuma sala aberta agora. Clique em **Abrir sala** para começar uma.";

const describe: Record<OpenStatus, (card: RoomCard) => { name: string; line: string }> = {
  waiting: (card) => ({
    name: `sala de ${card.openerName}`,
    line: `**Aberta** · sala de ${escapeMarkdown(card.openerName)}, esperando alguém transmitir`,
  }),
  live: (card) => ({
    name: card.host?.name ?? "Alguém",
    line: `**Ao vivo** · ${escapeMarkdown(card.host?.name ?? "Alguém")} transmitindo desde ${relativeTime(card.liveSince!)}`,
  }),
};

export function panel(cards: RoomCard[], guild: Guild | null, accentColor: string) {
  const rooms = cards.map((card) => {
    const { name, line } = describe[card.status](card);
    return { card, name, line: [line, ...roomDetails(card.status, card)].join(" · ") };
  });

  return {
    embeds: [
      {
        title: "Salas",
        description: rooms.map((room) => room.line).join("\n") || EMPTY,
        color: cards.some((card) => card.status === "live") ? LIVE_RED : embedColor(accentColor),
        author: guildAuthor(guild),
      },
    ],
    components: [
      ...rooms.slice(0, MAX_ROOMS_WITH_BUTTONS).map(({ card, name }) =>
        row(
          joinButton(card, `Entrar · ${name}`),
          ...callButtons(card),
          { style: ButtonStyle.SECONDARY, label: "Fechar", custom_id: `${CLOSE_ROOM_ACTION}:${card.roomId}` },
        ),
      ),
      row({ style: ButtonStyle.SUCCESS, label: "Abrir sala", custom_id: OPEN_ROOM_ACTION }),
    ],
    allowed_mentions: { parse: [] },
  };
}
