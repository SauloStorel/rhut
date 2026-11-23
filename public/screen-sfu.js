import { applyQuality, tuneSender } from "./quality.js";
import { createSfuSession } from "./sfu-session.js";

// Telas pelo SFU do Cloudflare Realtime: quem transmite publica uma cópia só, e o SFU entrega a quem assistir.
// Quem transmite anuncia na sala os nomes das trilhas publicadas; quem assiste puxa por esses nomes.
// Mesma interface do transporte P2P (screen-p2p.js): `publish` e `subscribe`.
export function createSfuScreens({ roomId, sfuPass, iceServers, codecPreferences }) {
  const session = createSfuSession({ roomId, pass: sfuPass, iceServers });

  return {
    // A tela de quem transmite só dá para puxar depois que as trilhas foram anunciadas; trilhas novas (publicou
    // de novo depois de uma queda) são outra tela, e quem assiste puxa de novo.
    streamKey: (sharer) => sharer.sfu?.tracks.join() ?? null,

    // `onLost`: a conexão com o SFU caiu, e quem transmite precisa publicar de novo (com trilhas novas).
    /** @param {MediaStream} stream @param {import("./quality.js").QualityPreset} quality @param {{ onLost?: () => void }} [options] */
    async publish(stream, quality, { onLost } = {}) {
      const published = await session.push(stream, await codecPreferences);
      const [videoSender] = published.senders.filter((sender) => sender.track.kind === "video");
      const stopWatchingLoss = session.onLost(() => onLost?.());
      await tuneSender(videoSender, quality);

      return {
        announcement: published.announcement,
        videoSenders: () => [videoSender],
        // O SFU distribui: sai uma cópia só, não importa quantas pessoas assistem (e quem são, ele não conta).
        watching: () => null,
        copies: () => 1,
        setQuality: (preset) => applyQuality(preset, videoSender.track, [videoSender]),
        sync() {},

        close() {
          stopWatchingLoss();
          session.close(published).catch(() => {});
        },
      };
    },

    subscribe(sharer, { onStream, onLost }) {
      let pulled = null;
      let closed = false;
      const stopWatchingLoss = session.onLost(onLost);

      session.pull(sharer.sfu).then(
        (result) => {
          pulled = result;
          // Desistiu enquanto a trilha chegava: devolve na hora.
          if (closed) return session.close(result).catch(() => {});
          onStream(result.stream);
        },
        () => !closed && onLost(),
      );

      return {
        videoReceiver: () => pulled?.receivers.find((receiver) => receiver.track.kind === "video") ?? null,

        close() {
          closed = true;
          stopWatchingLoss();
          if (pulled) session.close(pulled).catch(() => {});
        },
      };
    },
  };
}
