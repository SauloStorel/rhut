import { CLOSE_ROOM_ACTION, JOIN_ROOM_ACTION, personalLink } from "./announcement";
import { fetchGuild } from "./guild";
import { type DiscordMember, type DiscordUser, profileOf, signPass } from "./identity";
import { roomStub } from "./room";
import { newRoomId } from "./room-id";

// https://discord.com/developers/docs/interactions/receiving-and-responding
const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 } as const;
const ResponseType = { PONG: 1, CHANNEL_MESSAGE: 4, DEFERRED_UPDATE_MESSAGE: 6 } as const;
const EPHEMERAL = 1 << 6;
const PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/i;

type Interaction = {
  type: number;
  guild_id?: string;
  channel_id: string;
  data?: { name?: string; custom_id?: string };
  member?: DiscordMember;
  user?: DiscordUser;
};

type Responder = (interaction: Interaction, request: Request, env: Env) => Promise<object | undefined> | object | undefined;

const commands: Record<string, Responder> = {
  // O aviso é postado pelo bot (e não como resposta do comando) porque resposta de comando
  // só pode ser editada por 15 minutos, e o aviso acompanha a sala enquanto ela existir.
  live: async (interaction, request, env) => {
    const roomId = newRoomId();
    const posted = await roomStub(env, roomId).open({
      roomId,
      guild: await fetchGuild(interaction.guild_id, env),
      openerId: userIdOf(interaction),
      channelId: interaction.channel_id,
    });

    return privateReply(
      posted
        ? "Sala criada. O aviso está no canal."
        : "Não consegui postar o aviso neste canal. Confira se o bot pode **ver o canal**, **enviar mensagens** e **inserir links** aqui.",
    );
  },
};

type ComponentHandler = (interaction: Interaction, request: Request, env: Env, roomId: string) => Promise<object>;

const components: Record<string, ComponentHandler> = {
  [JOIN_ROOM_ACTION]: async (interaction, request, env, roomId) => {
    const user = userOf(interaction);
    await roomStub(env, roomId).admit(profileOf(user, interaction.member, interaction.guild_id));

    const url = new URL(`/r/${roomId}`, request.url);
    url.searchParams.set("pass", await signPass(env, roomId, user.id));
    return { type: ResponseType.CHANNEL_MESSAGE, data: { ...personalLink(url.href), flags: EPHEMERAL } };
  },
  [CLOSE_ROOM_ACTION]: async (interaction, _request, env, roomId) => {
    const closed = await roomStub(env, roomId).requestClose(userIdOf(interaction));
    return closed
      ? { type: ResponseType.DEFERRED_UPDATE_MESSAGE }
      : privateReply("Só quem está na sala pode fechar. Entre pelo botão **Entrar na sala** e tente de novo.");
  },
};

const responders: Record<number, Responder> = {
  [InteractionType.PING]: () => ({ type: ResponseType.PONG }),
  [InteractionType.APPLICATION_COMMAND]: (interaction, request, env) => commands[interaction.data!.name!]?.(interaction, request, env),
  [InteractionType.MESSAGE_COMPONENT]: (interaction, request, env) => {
    const [action, roomId] = interaction.data!.custom_id!.split(":");
    return components[action]?.(interaction, request, env, roomId);
  },
};

export async function handleInteraction(request: Request, env: Env) {
  const body = await request.text();
  if (!(await isSignedByDiscord(request, body, env.DISCORD_PUBLIC_KEY))) return new Response("Bad signature", { status: 401 });

  const interaction: Interaction = JSON.parse(body);
  const response = await responders[interaction.type]?.(interaction, request, env);

  return response ? Response.json(response) : new Response("Unsupported interaction", { status: 400 });
}

async function isSignedByDiscord(request: Request, body: string, publicKey: string) {
  // Sem essa checagem, uma chave vazia ou colada errada derruba o Worker (500) e o Discord só diz que a URL "não pôde ser verificada".
  if (!PUBLIC_KEY_PATTERN.test(publicKey)) {
    console.error("DISCORD_PUBLIC_KEY ausente ou inválida: use a Public Key do app (64 caracteres hexadecimais).");
    return false;
  }

  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp) return false;

  const key = await crypto.subtle.importKey("raw", hexToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, hexToBytes(signature), new TextEncoder().encode(timestamp + body));
}

function userOf(interaction: Interaction) {
  return (interaction.member?.user ?? interaction.user)!;
}

function userIdOf(interaction: Interaction) {
  return userOf(interaction).id;
}

function privateReply(content: string) {
  return { type: ResponseType.CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL } };
}

function hexToBytes(hex: string) {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
}
