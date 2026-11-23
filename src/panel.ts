import {
  ButtonStyle,
  CLOSE_ROOM_ACTION,
  LIVE_RED,
  MAX_SELECT_OPTIONS,
  OPEN_ROOM_ACTION,
  PICK_ROOM_ACTION,
  callButtons,
  embedColor,
  escapeMarkdown,
  guildAuthor,
  joinButton,
  roomDetails,
  row,
  selectRow,
  sharingSentence,
} from "./discord-ui";
import type { Guild } from "./guild";
import type { RoomCard } from "./lobby";
import type { OpenStatus } from "./room";

// Painel fixo no canal escolhido com /painel: as salas abertas do servidor e o botão para abrir outra.
// O Discord aceita 5 fileiras numa mensagem e uma é do "Abrir sala". Até 4 salas, cada uma ganha a sua fileira de
// botões; com mais, as 3 primeiras ganham botões e as outras vão para o menu "Entrar em outra sala".
const ROOM_ROWS = 4;
const EMPTY = "Nenhuma sala aberta agora. Clique em **Abrir sala** para começar uma.";

type Description = { name: string; state: string; line: string };
type Described = Description & { card: RoomCard };

const describe: Record<OpenStatus, (card: RoomCard) => Description> = {
  waiting: (card) => ({
    name: `sala de ${card.openerName}`,
    state: "Aberta",
    line: `**Aberta** · sala de ${escapeMarkdown(card.openerName)}, esperando alguém transmitir`,
  }),
  live: (card) => ({
    name: card.sharers?.map((sharer) => sharer.name).join(", ") || "Alguém",
    state: "Ao vivo",
    line: `**Ao vivo** · ${sharingSentence(card.sharers, card.liveSince!)}`,
  }),
};

export function panel(cards: RoomCard[], guild: Guild | null, accentColor: string) {
  const rooms: Described[] = cards.map((card) => {
    const { name, state, line } = describe[card.status](card);
    return { card, name, state, line: [line, ...roomDetails(card.status, card)].join(" · ") };
  });
  const withButtons = rooms.length > ROOM_ROWS ? ROOM_ROWS - 1 : ROOM_ROWS;
  const inPicker = rooms.slice(withButtons, withButtons + MAX_SELECT_OPTIONS);

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
      ...rooms.slice(0, withButtons).map(roomButtons),
      ...(inPicker.length > 0 ? [roomPicker(inPicker)] : []),
      row({ style: ButtonStyle.SUCCESS, label: "Abrir sala", custom_id: OPEN_ROOM_ACTION }),
    ],
    allowed_mentions: { parse: [] },
  };
}

function roomButtons({ card, name }: Described) {
  return row(
    joinButton(card, `Entrar · ${name}`),
    ...callButtons(card),
    { style: ButtonStyle.SECONDARY, label: "Fechar", custom_id: `${CLOSE_ROOM_ACTION}:${card.roomId}` },
  );
}

function roomPicker(rooms: Described[]) {
  return selectRow(
    PICK_ROOM_ACTION,
    "Entrar em outra sala…",
    rooms.map(({ card, name, state }) => ({ label: name, value: card.roomId, description: state })),
  );
}
