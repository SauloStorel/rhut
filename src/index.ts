import { handleInteraction } from "./discord";
import { verifyPass } from "./identity";
import { USER_HEADER, roomStub } from "./room";
import { ROOM_ID_PATTERN } from "./room-id";
import { iceServers } from "./turn";

export { Room } from "./room";

type Params = Record<string, string | undefined>;
type Handler = (request: Request, env: Env, params: Params) => Response | Promise<Response>;

const routes: { method: string; pattern: URLPattern; handle: Handler }[] = [
  { method: "POST", pattern: new URLPattern({ pathname: "/interactions" }), handle: handleInteraction },
  { method: "GET", pattern: new URLPattern({ pathname: `/r/:room(${ROOM_ID_PATTERN})` }), handle: serveRoomPage },
  { method: "GET", pattern: new URLPattern({ pathname: `/api/rooms/:room(${ROOM_ID_PATTERN})/ws` }), handle: connectToRoom },
  { method: "GET", pattern: new URLPattern({ pathname: `/api/rooms/:room(${ROOM_ID_PATTERN})` }), handle: serveRoomConfig },
];

export default {
  fetch(request, env) {
    const route = routes.find((r) => r.method === request.method && r.pattern.test(request.url));
    if (!route) return new Response("Not found", { status: 404 });

    return route.handle(request, env, route.pattern.exec(request.url)!.pathname.groups);
  },
} satisfies ExportedHandler<Env>;

function serveRoomPage(request: Request, env: Env) {
  return env.ASSETS.fetch(new URL("/room.html", request.url));
}

async function connectToRoom(request: Request, env: Env, { room }: Params) {
  if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });

  // O header de identidade só pode vir daqui, depois de validar o passe.
  const headers = new Headers(request.headers);
  const userId = await verifyPass(env, room!, new URL(request.url).searchParams.get("pass"));
  headers.delete(USER_HEADER);
  if (userId) headers.set(USER_HEADER, userId);

  return roomStub(env, room!).fetch(new Request(request, { headers }));
}

// Tudo que a página da sala precisa para começar: marca do servidor, cor e servidores ICE.
async function serveRoomConfig(_request: Request, env: Env, { room }: Params) {
  const [info, ice] = await Promise.all([roomStub(env, room!).info(), iceServers(env)]);
  return Response.json({ guild: info?.guild ?? null, accentColor: env.ACCENT_COLOR, ...ice });
}
