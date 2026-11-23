// O `env` dos testes (cloudflare:workers) tem os mesmos bindings do Worker (src/env.d.ts).
type ProjectEnv = Env;

declare namespace Cloudflare {
  interface Env extends ProjectEnv {}
}
