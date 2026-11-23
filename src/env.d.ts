interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<import("./room").Room>;
  LOBBIES: DurableObjectNamespace<import("./lobby").Lobby>;
  ACCENT_COLOR: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  SESSION_SECRET: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  REALTIME_APP_ID?: string;
  REALTIME_APP_SECRET?: string;
  // "on" deixa qualquer link /r/<id> abrir uma sala, sem /live; só para desenvolvimento.
  DEV_ROOMS?: string;
}
