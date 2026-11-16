import { sendingQuality } from "./diagnostics.js";
import { addCandidate, isHealthy } from "./peer.js";
import { applyQuality, tuneSender } from "./quality.js";

const STATS_INTERVAL_MS = 2000;

// Quem transmite manda uma conexão WebRTC para cada pessoa assistindo. A sala diz quem está assistindo
// (viewers, viewer-joined, viewer-left) e quem assiste pede uma conexão nova quando a sua cai (request-offer).
export function broadcast(stream, initialQuality, { signaling, createPeer, player, screen, codecPreferences, onStop }) {
  const peers = new Map();
  const [videoTrack] = stream.getVideoTracks();
  let quality = initialQuality;
  let active = true;

  const refreshStatus = async () => {
    const sending = await sendingQuality([...peers.values()]);
    // Uma leitura que terminou depois do "Parar" não pode sobrescrever o status novo.
    if (!active) return;

    player.setQuality(sending?.label);
    screen.status([watchingText(peers.size), uploadText(quality, peers.size), sending && `${sending.label} ${sending.codec}`, sending?.hint].filter(Boolean).join(" · "));
  };
  const statsTimer = setInterval(refreshStatus, STATS_INTERVAL_MS);

  refreshStatus();
  player.preview(stream);
  screen.controls("broadcasting");
  videoTrack.contentHint = quality.contentHint;

  const stopListening = signaling.on({
    // Reconectou à sala: reafirma a transmissão, e a sala responde com a lista de quem está assistindo.
    welcome: () => signaling.send({ type: "start-broadcast" }),
    viewers: ({ ids }) => {
      [...peers.keys()].filter((id) => !ids.includes(id)).forEach(disconnect);
      ids.filter((id) => !isHealthy(peers.get(id))).forEach(connect);
    },
    "viewer-joined": ({ id }) => {
      if (!isHealthy(peers.get(id))) connect(id);
    },
    "request-offer": ({ from }) => connect(from),
    // Resposta atrasada a um offer que já foi trocado é recusada; a resposta certa vem logo depois.
    answer: ({ from, description }) => peers.get(from)?.setRemoteDescription(description).catch(() => {}),
    candidate: ({ from, candidate }) => addCandidate(peers.get(from), candidate),
    "viewer-left": ({ id }) => disconnect(id),
    error: ({ message }) => {
      onStop();
      screen.status(message);
    },
  });
  signaling.send({ type: "start-broadcast" });

  // Usuário clicou em "Parar de compartilhar" na barra do navegador.
  videoTrack.addEventListener("ended", onStop);

  // No iPhone o Safari pausa a captura quando vai para segundo plano (o vídeo "congela" em vez de acabar).
  // Avisa em vez de deixar parecer que travou, e a imagem volta sozinha quando o sistema liberar de novo.
  videoTrack.addEventListener("mute", () => active && screen.status("Transmissão pausada: o sistema pausa a captura quando o navegador fica em segundo plano. Volte para o navegador para continuar."));
  videoTrack.addEventListener("unmute", () => active && refreshStatus());

  // Mantém a tela do celular acesa enquanto transmite (a tela apagada também pausa a captura) e pede o bloqueio
  // de novo ao voltar para a aba, porque o navegador o solta sempre que a aba some.
  let wakeLock = null;
  const keepAwake = async () => {
    if (!active || document.visibilityState !== "visible" || wakeLock) return;
    wakeLock = await navigator.wakeLock?.request("screen").catch(() => null);
    wakeLock?.addEventListener("release", () => (wakeLock = null));
  };
  document.addEventListener("visibilitychange", keepAwake);
  keepAwake();

  async function connect(id) {
    peers.get(id)?.close();
    const peer = createPeer((candidate) => signaling.send({ type: "candidate", to: id, candidate }));
    peers.set(id, peer);
    const transceiver = peer.addTransceiver(videoTrack, { direction: "sendonly", streams: [stream] });
    stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
    refreshStatus();

    transceiver.setCodecPreferences(await codecPreferences);
    // Outro pedido para a mesma pessoa chegou durante a espera e já trocou esta conexão.
    if (peers.get(id) !== peer) return;

    await peer.setLocalDescription();
    // O offer sai antes de qualquer outro await: assim chega a quem assiste antes dos primeiros candidatos ICE.
    signaling.send({ type: "offer", to: id, description: peer.localDescription });
    await tuneSender(transceiver.sender, quality);
  }

  function disconnect(id) {
    peers.get(id)?.close();
    peers.delete(id);
    refreshStatus();
  }

  return {
    setQuality(preset) {
      quality = preset;
      const videoSenders = [...peers.values()].map((peer) => peer.getSenders().find((sender) => sender.track === videoTrack));
      applyQuality(preset, videoTrack, videoSenders).catch((error) => screen.status(`Não deu pra trocar a qualidade: ${error.message}`));
      refreshStatus();
    },
    close() {
      active = false;
      clearInterval(statsTimer);
      document.removeEventListener("visibilitychange", keepAwake);
      wakeLock?.release().catch(() => {});
      stopListening();
      signaling.send({ type: "stop-broadcast" });
      stream.getTracks().forEach((track) => track.stop());
      peers.forEach((peer) => peer.close());
    },
  };
}

function watchingText(count) {
  return count === 1 ? "1 pessoa assistindo" : `${count} pessoas assistindo`;
}

// Em P2P cada pessoa recebe uma cópia: o upload total é o teto do preset vezes quem está assistindo.
function uploadText({ maxBitrate }, count) {
  const mbps = (maxBitrate * count) / 1_000_000;
  return count > 0 && `até ${mbps.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} Mbps de upload`;
}
