import { DELAY_HINT, createReceiveMeter } from "./diagnostics.js";
import { withStereoOpus } from "./opus.js";
import { addCandidate, onFailure } from "./peer.js";

const STATS_INTERVAL_MS = 2000;
const RETRY_MS = 3000;
const OFFER_TIMEOUT_MS = 10_000;

// Quem assiste recebe a tela de quem transmite, mas só depois de escolher assistir (como no Discord): até lá,
// a sala mostra o convite e as ofertas de vídeo são ignoradas. Se a conexão de vídeo cair, pede outra para quem
// transmite (request-offer) até voltar; a mesma coisa depois de reconectar à sala, se o vídeo não estiver passando.
export function watch({ signaling, createPeer, player, screen }) {
  let peer = null;
  let measure = null;
  let playing = false;
  let paused = true; // ainda não escolheu assistir (ou parou): a conexão de vídeo não é aberta
  let retryTimer = null;
  screen.idle("waiting");

  const statsTimer = setInterval(async () => {
    if (measure) player.setQuality(await measure(), DELAY_HINT);
  }, STATS_INTERVAL_MS);

  const stopListening = signaling.on({
    // Voltou à sala (reconexão ou página recarregada). Se estava transmitindo antes de recarregar, não está mais;
    // e se o vídeo não está passando, pede uma conexão nova.
    welcome: ({ resumed }) => {
      if (!resumed) return;
      signaling.send({ type: "stop-broadcast" });
      if (!paused && peer?.connectionState !== "connected") requestOffer();
    },
    offer: async ({ description }) => {
      if (paused) return;
      clearTimeout(retryTimer);
      peer?.close();
      const current = createPeer((candidate) => signaling.send({ type: "candidate", candidate }));
      peer = current;
      measure = createReceiveMeter(current);
      current.addEventListener("track", ({ streams: [stream] }) => {
        playing = true;
        player.watch(stream);
        screen.controls("watching");
        screen.renderCall();
      });
      onFailure(current, () => current === peer && reconnect());

      await current.setRemoteDescription(description);
      const answer = await current.createAnswer();
      await current.setLocalDescription({ type: "answer", sdp: withStereoOpus(answer.sdp) });
      signaling.send({ type: "answer", description: current.localDescription });
    },
    candidate: ({ candidate }) => addCandidate(peer, candidate),
    // A próxima transmissão começa de novo com o convite.
    "host-left": () => {
      paused = true;
      reset();
      screen.idle("ended");
    },
  });

  // A imagem congelou: tira do palco, avisa e pede uma conexão nova.
  function reconnect() {
    reset();
    screen.idle("connecting");
    retryTimer = setTimeout(requestOffer, RETRY_MS);
  }

  // Sem resposta (quem transmite também estava reconectando), pede de novo enquanto a tela estiver esperando.
  function requestOffer() {
    signaling.send({ type: "request-offer" });
    retryTimer = setTimeout(() => screen.current() === "connecting" && requestOffer(), OFFER_TIMEOUT_MS);
  }

  function reset() {
    clearTimeout(retryTimer);
    peer?.close();
    peer = null;
    measure = null;
    playing = false;
  }

  return {
    // Tem alguém transmitindo: convite para assistir ou, se já escolheu assistir, "conectando".
    hostChanged(host) {
      if (playing) return;
      if (host) return screen.idle(paused ? "invite" : "connecting");
      if (["connecting", "invite"].includes(screen.current())) screen.idle("waiting");
    },

    // Para de receber a tela (e de gastar a banda dela) e volta ao convite.
    pause() {
      paused = true;
      reset();
      screen.idle("invite");
    },

    resume() {
      paused = false;
      screen.idle("connecting");
      requestOffer();
    },

    close() {
      clearInterval(statsTimer);
      stopListening();
      reset();
    },
  };
}
