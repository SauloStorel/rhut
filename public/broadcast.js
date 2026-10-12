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
