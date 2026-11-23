import { AUDIO_ENCODINGS, withGameAudio } from "./audio.js";
import { createReceiver, createSender } from "./p2p.js";
import { onFailure } from "./peer.js";
import { applyQuality, tuneSender } from "./quality.js";

// Telas em P2P: quem transmite manda uma cópia para cada pessoa que escolheu assistir. Quem assiste pede a tela
// (`screen-request`) e quem transmite responde com uma oferta; quem desiste avisa (`screen-stop`).
// Mesma interface do transporte pelo SFU (screen-sfu.js): `publish` e `subscribe`.
export function createP2PScreens({ signaling, createPeer, codecPreferences }) {
  const subscriptions = new Map(); // peerId de quem transmite → { onStream, onLost }

  const receiver = createReceiver({
    signaling,
    kind: "screen",
    createPeer,
    accepts: (from) => subscriptions.has(from),
    onPeer: (from, peer) => onFailure(peer, () => receiver.get(from) === peer && subscriptions.get(from)?.onLost()),
    onTrack: (from, stream) => subscriptions.get(from)?.onStream(stream),
    mungeAnswer: withGameAudio,
  });

  return {
    // Em P2P dá para pedir a tela assim que a pessoa começa a transmitir.
    streamKey: (sharer) => sharer.peerId,

    async publish(stream, quality) {
      const [videoTrack] = stream.getVideoTracks();
      let current = quality;
      const videoSender = (peer) => peer.getSenders().find((sender) => sender.track === videoTrack);
      const connected = () => sender.peers().filter((peer) => peer.connectionState === "connected").length;

      const sender = createSender({
        signaling,
        kind: "screen",
        createPeer,
        async setup(peer) {
          const video = peer.addTransceiver(videoTrack, { direction: "sendonly", streams: [stream] });
          stream.getAudioTracks().forEach((track) => peer.addTransceiver(track, { direction: "sendonly", streams: [stream], sendEncodings: AUDIO_ENCODINGS }));
          video.setCodecPreferences(await codecPreferences);
        },
      });

      // Encodings só existem depois da oferta: a qualidade é aplicada quando a conexão já saiu.
      const stopListening = signaling.on({
        "screen-request": async ({ from }) => {
          const peer = await sender.connect(from);
          if (peer) await tuneSender(videoSender(peer), current);
        },
        "screen-stop": ({ from }) => sender.disconnect(from),
      });

      return {
        // Nada a anunciar: quem quiser assistir pede direto a quem transmite.
        announcement: null,
        videoSenders: () => sender.peers().map(videoSender).filter(Boolean),
        // Cada pessoa conectada recebe uma cópia.
        watching: connected,
        copies: connected,

        setQuality(preset) {
          current = preset;
          return applyQuality(preset, videoTrack, sender.peers().map(videoSender).filter(Boolean));
        },

        // Quem saiu da sala não recebe mais a tela.
        sync(people) {
          const present = new Set(people.map((person) => person.peerId));
          sender.peerIds().filter((peerId) => !present.has(peerId)).forEach(sender.disconnect);
        },

        close() {
          stopListening();
          sender.close();
        },
      };
    },

    subscribe(sharer, { onStream, onLost }) {
      const peerId = sharer.peerId;
      subscriptions.set(peerId, { onStream, onLost });
      signaling.send({ type: "screen-request", to: peerId });

      return {
        videoReceiver: () => receiver.get(peerId)?.getReceivers().find((item) => item.track.kind === "video") ?? null,

        close() {
          subscriptions.delete(peerId);
          receiver.disconnect(peerId);
          signaling.send({ type: "screen-stop", to: peerId });
        },
      };
    },
  };
}
