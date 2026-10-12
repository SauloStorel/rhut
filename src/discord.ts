import { personalLink } from "./announcement";
import { discordApi } from "./discord-api";
import { CLOSE_ROOM_ACTION, JOIN_ROOM_ACTION, OPEN_ROOM_ACTION } from "./discord-ui";
import { type DiscordMember, type DiscordUser, profileOf, signPass } from "./identity";
import { type Opener, installPanel, openRoom } from "./open-room";
import { roomStub } from "./room";

// https://discord.com/developers/docs/interactions/receiving-and-responding
const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 } as const;
const ResponseType = { PONG: 1, CHANNEL_MESSAGE: 4, DEFERRED_CHANNEL_MESSAGE: 5, DEFERRED_UPDATE_MESSAGE: 6 } as const;
const EPHEMERAL = 1 << 6;
const PUBLIC_KEY_PATTERN = /^[0-9a-f]{64}$/i;

type Interaction = {
  type: number;
  application_id: string;
  token: string;
  guild_id?: string;
  channel_id: string;
  data?: { name?: string; custom_id?: string };
  member?: DiscordMember;
  user?: DiscordUser;
};

type Responder = (interaction: Interaction, request: Request, env: Env, ctx: ExecutionContext) => Promise<object | undefined> | object | undefined;

// Abrir sala ou postar o painel passa dos 3 s que o Discord espera quando o Worker acorda frio. Os comandos
// respondem "pensando..." na hora (só para quem digitou) e resolvem essa resposta quando terminam.
const commands: Record<string, Responder> = {
  live: (interaction, request, env, ctx) => {
    ctx.waitUntil(openRoom(openerOf(interaction, request), env).then((message) => finishThinking(interaction, env, message)));
    return { type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } };
  },
  painel: (interaction, _request, env, ctx) => {
    ctx.waitUntil(installPanel(interaction.guild_id!, interaction.channel_id, env).then((message) => finishThinking(interaction, env, message)));
    return { type: ResponseType.DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } };
  },
};

type ComponentHandler = (interaction: Interaction, request: Request, env: Env, ctx: ExecutionContext, roomId: string) => Promise<object> | object;

const components: Record<string, ComponentHandler> = {
  [JOIN_ROOM_ACTION]: async (interaction, request, env, _ctx, roomId) => {
    const user = userOf(interaction);
    await roomStub(env, roomId).admit(profileOf(user, interaction.member, interaction.guild_id));

    const url = new URL(`/r/${roomId}`, request.url);
    url.searchParams.set("pass", await signPass(env, roomId, user.id));
    return { type: ResponseType.CHANNEL_MESSAGE, data: { ...personalLink(url.href), flags: EPHEMERAL } };
  },
  [CLOSE_ROOM_ACTION]: async (interaction, _request, env, _ctx, roomId) => {
    const closed = await roomStub(env, roomId).requestClose(userOf(interaction).id);
    return closed
      ? { type: ResponseType.DEFERRED_UPDATE_MESSAGE }
      : privateReply("Só quem está na sala pode fechar. Entre pelo botão **Entrar na sala** e tente de novo.");
  },
  // "Abrir sala" do painel: o clique não gera mensagem (o painel ganha a linha nova); só um problema vira aviso.
  [OPEN_ROOM_ACTION]: (interaction, request, env, ctx) => {
    ctx.waitUntil(openRoom(openerOf(interaction, request), env).then((message) => followUp(interaction, env, message)));
    return { type: ResponseType.DEFERRED_UPDATE_MESSAGE };
  },
};

const responders: Record<number, Responder> = {
  [InteractionType.PING]: () => ({ type: ResponseType.PONG }),
  [InteractionType.APPLICATION_COMMAND]: (interaction, request, env, ctx) => commands[interaction.data!.name!]?.(interaction, request, env, ctx),
  [InteractionType.MESSAGE_COMPONENT]: (interaction, request, env, ctx) => {
    const [action, roomId] = interaction.data!.custom_id!.split(":");
    return components[action]?.(interaction, request, env, ctx, roomId);
  },
};

export async function handleInteraction(request: Request, env: Env, ctx: ExecutionContext) {
  const body = await request.text();
  if (!(await isSignedByDiscord(request, body, env.DISCORD_PUBLIC_KEY))) return new Response("Bad signature", { status: 401 });

  const interaction: Interaction = JSON.parse(body);
  const response = await responders[interaction.type]?.(interaction, request, env, ctx);

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

function openerOf(interaction: Interaction, request: Request): Opener {
  return { guildId: interaction.guild_id, channelId: interaction.channel_id, user: userOf(interaction), member: interaction.member, origin: request.url };
}

function privateReply(content: string) {
  return { type: ResponseType.CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL } };
}

// Resolve o "pensando...": vira a mensagem, ou some quando não há nada a dizer.
function finishThinking(interaction: Interaction, env: Env, message: string | null) {
  const path = `${webhookPath(interaction)}/messages/@original`;
  return message ? discordApi(env, "PATCH", path, { content: message }) : discordApi(env, "DELETE", path);
}

// Mensagem só para quem clicou, depois de um clique que não deixou resposta.
async function followUp(interaction: Interaction, env: Env, message: string | null) {
  if (message) await discordApi(env, "POST", webhookPath(interaction), { content: message, flags: EPHEMERAL });
}

function webhookPath(interaction: Interaction) {
  return `/webhooks/${interaction.application_id}/${interaction.token}`;
}

function hexToBytes(hex: string) {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));
}
