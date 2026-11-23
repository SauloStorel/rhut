import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Os testes rodam dentro do workerd, com os Durable Objects de verdade. Segredos de mentira; o Discord e o SFU
// são simulados em cada teste (fetch), então nada sai da máquina.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          SESSION_SECRET: "segredo-de-teste",
          DISCORD_BOT_TOKEN: "token-de-teste",
          DISCORD_PUBLIC_KEY: "0".repeat(64),
          REALTIME_APP_ID: "app-de-teste",
          REALTIME_APP_SECRET: "token-do-sfu",
        },
      },
    }),
  ],
});
