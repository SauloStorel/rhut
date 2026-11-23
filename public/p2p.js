import { addCandidate } from "./peer.js";

// Conexões WebRTC de mão única entre duas pessoas da sala, para um tipo de mídia (`kind`: "screen" ou "cam").
// Quem tem a mídia oferece (`<kind>-offer`) e quem recebe responde (`<kind>-answer`). Duas pessoas podem estar
// mandando mídia uma para a outra ao mesmo tempo, então cada candidato ICE diz de que lado saiu (`side`).

// Lado de quem manda: uma conexão por pessoa. `setup` põe a mídia na conexão antes da oferta.
export function createSender({ signaling, kind, createPeer, setup }) {
  const links = new Map(); // peerId → RTCPeerConnection

  const stopListening = signaling.on({
    // Resposta atrasada a uma oferta que já foi trocada é recusada; a resposta certa vem logo depois.
    [`${kind}-answer`]: ({ from, description }) => links.get(from)?.setRemoteDescription(description).catch(() => {}),
    [`${kind}-candidate`]: ({ from, side, candidate }) => side === "receiver" && addCandidate(links.get(from), candidate),
  });

  return {
    // Abre (ou refaz) a conexão com essa pessoa. Devolve a conexão, ou null se outra a substituiu no meio do caminho.
    async connect(peerId) {
      links.get(peerId)?.close();
      const peer = createPeer((candidate) => signaling.send({ type: `${kind}-candidate`, to: peerId, side: "sender", candidate }));
      links.set(peerId, peer);

      await setup(peer, peerId);
      if (links.get(peerId) !== peer) return null;

      await peer.setLocalDescription();
      // A oferta sai antes de qualquer outro await: assim chega antes dos primeiros candidatos ICE.
      signaling.send({ type: `${kind}-offer`, to: peerId, description: peer.localDescription });
      return peer;
    },

    disconnect(peerId) {
      links.get(peerId)?.close();
      links.delete(peerId);
    },

    get: (peerId) => links.get(peerId),
    peerIds: () => [...links.keys()],
    peers: () => [...links.values()],

    close() {
      stopListening();
      links.forEach((peer) => peer.close());
      links.clear();
    },
  };
}

// Lado de quem recebe: aceita a oferta de quem `accepts` deixar e responde. `onPeer` vê cada conexão nova
// (para acompanhar quedas) e `onTrack` cada trilha que chega, já com o stream de quem mandou.
export function createReceiver({ signaling, kind, createPeer, accepts = () => true, onPeer = () => {}, onTrack, mungeAnswer = (sdp) => sdp }) {
  const links = new Map(); // peerId → RTCPeerConnection

  signaling.on({
    [`${kind}-offer`]: async ({ from, description }) => {
      if (!accepts(from)) return;

      links.get(from)?.close();
      const peer = createPeer((candidate) => signaling.send({ type: `${kind}-candidate`, to: from, side: "receiver", candidate }));
      links.set(from, peer);
      onPeer(from, peer);
      peer.addEventListener("track", ({ streams: [stream] }) => links.get(from) === peer && onTrack(from, stream, peer));

      await peer.setRemoteDescription(description);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription({ type: "answer", sdp: mungeAnswer(answer.sdp) });
      signaling.send({ type: `${kind}-answer`, to: from, description: peer.localDescription });
    },
    [`${kind}-candidate`]: ({ from, side, candidate }) => side === "sender" && addCandidate(links.get(from), candidate),
  });

  return {
    get: (peerId) => links.get(peerId),
    peerIds: () => [...links.keys()],

    disconnect(peerId) {
      links.get(peerId)?.close();
      links.delete(peerId);
    },
  };
}
