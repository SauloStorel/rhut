interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<import("./room").Room>;
  LOBBIES: DurableObjectNamespace<import("./lobby").Lobby>;
  ACCENT_COLOR: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  SESSION_SECRET: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}
