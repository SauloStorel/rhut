import { createReceiveMeter } from "./diagnostics.js";

const RETRY_MS = 3000;
const NO_STREAM_TIMEOUT_MS = 10_000;

// Assistir à tela de uma pessoa, pelo transporte da sala (P2P ou SFU). Se a imagem não chega em alguns segundos
// (quem transmite estava reconectando) ou cai depois de chegar, pede de novo até voltar. Quando a tela muda
// (pelo SFU, quem transmite publicou de novo depois de uma queda), pede a nova.
export function watchScreen(sharer, { transport, onStream, onWaiting }) {
  let latest = sharer;
  let key = null;
  let subscription = null;
  let timer = null;
  let meter = null;

  update(sharer);

  function update(next) {
    latest = next;
    const nextKey = transport.streamKey(next);
    if (nextKey === key) return;

    key = nextKey;
    stop();
    onWaiting();
    if (key !== null) start();
  }

  function start() {
    stop();
    subscription = transport.subscribe(latest, {
      onStream(stream) {
        clearTimeout(timer);
        onStream(stream);
      },
      onLost: retry,
    });
    timer = setTimeout(start, NO_STREAM_TIMEOUT_MS);
  }

  // A imagem congelou: tira da tela, espera um pouco e pede de novo.
  function retry() {
    stop();
    onWaiting();
    timer = setTimeout(start, RETRY_MS);
  }

  function stop() {
    clearTimeout(timer);
    subscription?.close();
    subscription = null;
    meter = null;
  }

  return {
    update,

    // Qualidade que está chegando e o atraso estimado, ou null antes de a imagem chegar.
    async measure() {
      const receiver = subscription?.videoReceiver();
      if (!receiver) return null;
      meter ??= createReceiveMeter(receiver);
      return meter();
    },

    close: stop,
  };
}
