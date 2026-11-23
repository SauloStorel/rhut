import { AUDIO_ENCODINGS, withGameAudio } from "./audio.js";
import { onFailure } from "./peer.js";

// Uma conexão só com o SFU do Cloudflare Realtime por página, aberta na primeira vez que precisa: por ela saem as
// trilhas que eu publico e chegam as que eu puxo. O SFU exige terminar uma negociação antes de começar a próxima,
// então toda mudança (publicar, puxar, fechar) entra numa fila. O Worker repassa as chamadas e guarda o segredo.
// https://developers.cloudflare.com/realtime/sfu/https-api/

// `pass` é uma função: o passe só chega no "welcome" da sala, depois de a página montar.
export function createSfuSession({ roomId, pass, iceServers }) {
  const lostListeners = new Set();
  let current = null; // Promise da conexão: { pc, sessionId, grant }
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();

  return {
    // Publica as trilhas do stream. Devolve os nomes (para quem assiste puxar) e o que fechar depois.
    push: (stream, codecPreferences) =>
      enqueue(async () => {
        const connection = await connect();
        const transceivers = stream.getTracks().map((track) =>
          connection.pc.addTransceiver(track, { direction: "sendonly", ...(track.kind === "audio" && { sendEncodings: AUDIO_ENCODINGS }) }),
        );
        transceivers.find((transceiver) => transceiver.sender.track.kind === "video")?.setCodecPreferences(codecPreferences);

        await connection.pc.setLocalDescription();
        const tracks = transceivers.map((transceiver) => ({ location: "local", mid: transceiver.mid, trackName: crypto.randomUUID() }));
        const result = await call(connection, "tracks", { sessionDescription: connection.pc.localDescription, tracks });
        await connection.pc.setRemoteDescription({ type: "answer", sdp: withGameAudio(result.sessionDescription.sdp) });

        return {
          connection,
          mids: tracks.map((track) => track.mid),
          announcement: { sessionId: connection.sessionId, tracks: tracks.map((track) => track.trackName) },
          senders: transceivers.map((transceiver) => transceiver.sender),
        };
      }),

    // Puxa as trilhas que outra pessoa publicou. O SFU responde com uma oferta, que esta página responde.
    pull: ({ sessionId, tracks }) =>
      enqueue(async () => {
        const connection = await connect();
        const result = await call(connection, "tracks", { tracks: tracks.map((trackName) => ({ location: "remote", sessionId, trackName })) });
        if (result.requiresImmediateRenegotiation) await answer(connection, result.sessionDescription);

        const mids = result.tracks.map((track) => track.mid);
        const receivers = connection.pc.getTransceivers().filter((transceiver) => mids.includes(transceiver.mid)).map((transceiver) => transceiver.receiver);
        return { connection, mids, receivers, stream: new MediaStream(receivers.map((receiver) => receiver.track)) };
      }),

    // Fecha trilhas publicadas ou puxadas. Se a conexão em que elas estavam já caiu, não tem o que fechar.
    close: ({ connection, mids }) =>
      enqueue(async () => {
        if (connection !== (await current?.catch(() => null))) return;

        connection.pc.getTransceivers().filter((transceiver) => mids.includes(transceiver.mid)).forEach((transceiver) => transceiver.stop());
        await connection.pc.setLocalDescription();
        const result = await call(connection, "close", { tracks: mids.map((mid) => ({ mid })), sessionDescription: connection.pc.localDescription, force: false });
        await connection.pc.setRemoteDescription(result.sessionDescription);
      }),

    // A conexão com o SFU caiu: tudo que passava por ela (publicado ou puxado) precisa ser refeito.
    onLost(listener) {
      lostListeners.add(listener);
      return () => lostListeners.delete(listener);
    },
  };

  // Uma falha não trava a fila: cada tarefa devolve o próprio erro e a próxima segue.
  /** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
  function enqueue(task) {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }

  function connect() {
    current ??= open().catch((error) => {
      current = null;
      throw error;
    });
    return current;
  }

  async function open() {
    const response = await fetch(`/api/rooms/${roomId}/sfu/sessions`, { method: "POST", headers: { "X-Sfu-Pass": pass() } });
    if (!response.ok) throw new Error(`SFU recusou a sessão (${response.status})`);

    const { sessionId, grant } = await response.json();
    const pc = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle" });
    const connection = { pc, sessionId, grant };
    onFailure(pc, () => {
      pc.close();
      current = null;
      lostListeners.forEach((listener) => listener());
    });
    return connection;
  }

  async function answer(connection, offer) {
    await connection.pc.setRemoteDescription(offer);
    const local = await connection.pc.createAnswer();
    await connection.pc.setLocalDescription({ type: "answer", sdp: withGameAudio(local.sdp) });
    await call(connection, "renegotiate", { sessionDescription: connection.pc.localDescription });
  }

  // Erro do SFU pode vir no corpo de uma resposta 200, para a chamada toda ou só para uma trilha.
  async function call({ grant }, action, body) {
    const response = await fetch(`/api/rooms/${roomId}/sfu/${action}`, {
      method: "POST",
      headers: { "X-Sfu-Session": grant, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    const error = result.errorDescription ?? result.tracks?.find((track) => track.errorCode && track.errorCode !== "close_track_error")?.errorDescription;
    if (!response.ok || error) throw new Error(`SFU: ${error ?? response.status}`);
    return result;
  }
}
