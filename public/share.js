import { tuneGameAudio } from "./audio.js";
import { sendingQuality } from "./diagnostics.js";

const STATS_INTERVAL_MS = 2000;
const REPUBLISH_MS = 3000;
const PAUSED = "Transmissão pausada: o sistema pausa a captura quando o navegador fica em segundo plano. Volte para o navegador para continuar.";

// Minha transmissão: publica a tela pelo transporte (P2P ou SFU), anuncia na sala e mostra no status o que está
// saindo de verdade. A sala pode recusar (já tem telas demais); aí `onRefused` recebe o motivo.
export function share(stream, quality, { transport, signaling, onStatus, onQuality, onStop, onRefused }) {
  const [videoTrack] = stream.getVideoTracks();
  let current = quality;
  let publication = null;
  let active = true;

  videoTrack.contentHint = quality.contentHint;
  tuneGameAudio(stream);

  const stopListening = signaling.on({
    // Reconectou à sala: reafirma a transmissão (a sala pode ter dado a vaga como perdida).
    welcome: () => publication && announce(),
    "share-refused": ({ message }) => onRefused(message),
  });
  // Clicou em "Parar de compartilhar" na barra do navegador.
  videoTrack.addEventListener("ended", onStop);
  // No iPhone o Safari pausa a captura quando vai para segundo plano (o vídeo "congela" em vez de acabar).
  // Avisa em vez de deixar parecer que travou; a imagem volta sozinha quando o sistema liberar.
  const showPaused = () => onStatus(PAUSED);
  videoTrack.addEventListener("mute", showPaused);
  videoTrack.addEventListener("unmute", refreshStatus);
  const releaseScreen = keepScreenAwake();
  const statsTimer = setInterval(refreshStatus, STATS_INTERVAL_MS);
  publish();

  // O anúncio só sai com a tela pronta: em P2P, quem assiste pede a tela assim que vê o anúncio.
  async function publish() {
    const published = await transport.publish(stream, current, { onLost: republish }).catch((error) => {
      onStatus(`Não deu para publicar a tela (${error.message}). Tentando de novo…`);
      return null;
    });
    if (!active) return published?.close();
    if (!published) return setTimeout(publish, REPUBLISH_MS);

    publication = published;
    announce();
    refreshStatus();
  }

  // A conexão com o SFU caiu: anuncia que a tela está voltando (quem assiste espera) e publica de novo.
  function republish() {
    publication?.close();
    publication = null;
    announce();
    setTimeout(() => active && publish(), REPUBLISH_MS);
  }

  function announce() {
    signaling.send({ type: "share", on: true, sfu: publication?.announcement ?? null });
  }

  // Com a captura pausada, o aviso de pausa fica no lugar dos números.
  async function refreshStatus() {
    if (!publication || videoTrack.muted) return;
    const watching = publication.watching();
    const sending = await sendingQuality(publication.videoSenders());
    // Uma leitura que terminou depois do "Parar" não pode sobrescrever o status novo.
    if (!active) return;

    onQuality(sending?.label);
    onStatus([watchingText(watching), uploadText(current, publication.copies()), sending && `${sending.label} ${sending.codec}`, sending?.hint].filter(Boolean).join(" · "));
  }

  return {
    stream,

    setQuality(preset) {
      current = preset;
      publication?.setQuality(preset).catch((error) => onStatus(`Não deu pra trocar a qualidade: ${error.message}`));
      refreshStatus();
    },

    // Em P2P, quem saiu da sala para de receber a tela.
    sync(people) {
      publication?.sync(people);
    },

    close() {
      active = false;
      clearInterval(statsTimer);
      stopListening();
      videoTrack.removeEventListener("ended", onStop);
      videoTrack.removeEventListener("mute", showPaused);
      videoTrack.removeEventListener("unmute", refreshStatus);
      releaseScreen();
      signaling.send({ type: "share", on: false });
      stream.getTracks().forEach((track) => track.stop());
      publication?.close();
    },
  };
}

// Mantém a tela do celular acesa enquanto transmite (tela apagada também pausa a captura). O navegador solta o
// bloqueio sempre que a aba some, então pede de novo ao voltar. Devolve a função que solta de vez.
function keepScreenAwake() {
  let lock = null;
  let active = true;

  const request = async () => {
    if (!active || lock || document.visibilityState !== "visible") return;
    lock = await navigator.wakeLock?.request("screen").catch(() => null);
    // Parou de transmitir enquanto o pedido estava saindo.
    if (!active) return lock?.release().catch(() => {});
    lock?.addEventListener("release", () => (lock = null));
  };
  document.addEventListener("visibilitychange", request);
  request();

  return () => {
    active = false;
    document.removeEventListener("visibilitychange", request);
    lock?.release().catch(() => {});
  };
}

// Em P2P dá para contar quem está recebendo; pelo SFU, quem transmite não sabe quem puxou a tela.
function watchingText(count) {
  if (count === null) return "uma cópia só, pelo SFU";
  return count === 1 ? "1 pessoa assistindo" : `${count} pessoas assistindo`;
}

// O upload total é o teto do preset vezes as cópias que saem (em P2P, uma por pessoa assistindo).
function uploadText({ maxBitrate }, copies) {
  const mbps = (maxBitrate * copies) / 1_000_000;
  return copies > 0 && `até ${mbps.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mbps de upload`;
}
