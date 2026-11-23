import { createReceiver, createSender } from "./p2p.js";
import { onFailure } from "./peer.js";

// Câmeras de todo mundo, em P2P: cada câmera ligada manda uma conexão só de ida para cada pessoa da sala.
// 360p e sem microfone (a voz já está no Discord), então 5 câmeras ainda pesam pouco no upload.
const CAMERA_SIZE = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } };
// Virar a câmera é coisa de celular: num computador com duas webcams não faz sentido.
const CAN_FLIP = matchMedia("(pointer: coarse)").matches;
const CAMERA_BITRATE = 400_000;
const RETRY_MS = 3000;

export function createCameras({ signaling, createPeer, onChange }) {
  const streams = new Map(); // peerId → stream da câmera dessa pessoa para mim
  let myPeerId = null;
  let local = null;
  let facing = "user"; // "user" é a câmera da frente; "environment", a de trás (celular)
  let starting = null;
  let people = [];

  // Minha câmera vai para cada pessoa da sala; se a conexão com alguém cair, abre outra.
  const sender = createSender({
    signaling,
    kind: "cam",
    createPeer,
    setup(peer, peerId) {
      local.getVideoTracks().forEach((track) =>
        peer.addTransceiver(track, { direction: "sendonly", streams: [local], sendEncodings: [{ maxBitrate: CAMERA_BITRATE }] }),
      );
      onFailure(peer, () => setTimeout(() => retrySend(peerId, peer), RETRY_MS));
    },
  });

  const receiver = createReceiver({
    signaling,
    kind: "cam",
    createPeer,
    onTrack(from, stream) {
      streams.set(from, stream);
      onChange();
    },
  });

  signaling.on({
    // Ao voltar, a sala pode lembrar de uma câmera que não está mais ligada (página recarregada) ou ter esquecido
    // a que está (a volta demorou); reafirma o estado real.
    welcome: ({ peerId, resumed }) => {
      myPeerId = peerId;
      if (resumed || local) signaling.send({ type: "camera", on: Boolean(local) });
    },
  });

  return {
    isOn: () => Boolean(local),
    canFlip: () => Boolean(local) && CAN_FLIP,

    // Dois cliques rápidos não abrem a câmera duas vezes (a primeira ficaria ligada sem ninguém para desligar).
    async turnOn() {
      if (local || starting) return;
      starting = openCamera(facing).finally(() => (starting = null));
      local = await starting;
      signaling.send({ type: "camera", on: true });
      others().forEach((person) => sender.connect(person.peerId));
      onChange();
    },

    // Troca entre a câmera da frente e a de trás sem desligar: a imagem nova entra nas conexões que já existem.
    // Para a antiga antes de abrir a nova porque muitos celulares não deixam as duas abertas ao mesmo tempo.
    // "exact" obriga o navegador a trocar de verdade (com "ideal" ele pode devolver a mesma câmera); se o aparelho
    // não diz qual câmera é a da frente (alguns navegadores dentro de apps), abre qualquer outra que ele tenha.
    async flip() {
      if (!local || starting) return;
      const next = facing === "user" ? "environment" : "user";
      const current = local.getVideoTracks()[0].getSettings().deviceId;
      local.getTracks().forEach((track) => track.stop());

      starting = openCamera({ exact: next })
        .catch(() => openOtherCamera(current))
        .finally(() => (starting = null));
      const opened = await starting.then((stream) => ({ stream }), (error) => ({ error }));
      if (opened.stream) facing = next;
      // Sem a outra câmera, volta para a que estava.
      local = opened.stream ?? (await openCamera(facing));
      await replaceTrack();
      onChange();
      if (opened.error) throw opened.error;
    },

    turnOff() {
      local?.getTracks().forEach((track) => track.stop());
      local = null;
      sender.peerIds().forEach(sender.disconnect);
      signaling.send({ type: "camera", on: false });
      onChange();
    },

    // Chamado a cada atualização de presença: abre conexão para quem chegou e fecha a de quem saiu
    // ou desligou a câmera.
    sync(nextPeople) {
      people = nextPeople;
      const present = new Set(people.map((person) => person.peerId));
      const withCamera = new Set(people.filter((person) => person.camera).map((person) => person.peerId));

      sender.peerIds().filter((peerId) => !present.has(peerId)).forEach(sender.disconnect);
      receiver.peerIds().filter((peerId) => !withCamera.has(peerId)).forEach((peerId) => {
        receiver.disconnect(peerId);
        streams.delete(peerId);
      });
      if (local) others().filter((person) => !sender.get(person.peerId)).forEach((person) => sender.connect(person.peerId));
      onChange();
    },

    // O que a interface mostra: minha câmera primeiro, depois a de cada pessoa.
    tiles() {
      // A câmera da frente aparece espelhada, como num espelho de verdade.
      const mine = local ? [{ peerId: myPeerId, person: personOf(myPeerId), stream: local, self: true, mirrored: facing === "user" }] : [];
      const theirs = [...streams].map(([peerId, stream]) => ({ peerId, person: personOf(peerId), stream, self: false, mirrored: false }));
      return [...mine, ...theirs].filter((tile) => tile.person && tile.stream);
    },
  };

  function openCamera(facingMode) {
    return navigator.mediaDevices.getUserMedia({ video: { ...CAMERA_SIZE, facingMode }, audio: false });
  }

  async function openOtherCamera(currentDeviceId) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const other = devices.find((device) => device.kind === "videoinput" && device.deviceId !== currentDeviceId);
    if (!other) throw new DOMException("Sem outra câmera", "OverconstrainedError");

    return navigator.mediaDevices.getUserMedia({ video: { ...CAMERA_SIZE, deviceId: { exact: other.deviceId } }, audio: false });
  }

  function replaceTrack() {
    const [track] = local.getVideoTracks();
    return Promise.all(sender.peers().map((peer) => peer.getSenders()[0]?.replaceTrack(track).catch(() => {})));
  }

  // A conexão da minha câmera com essa pessoa caiu: abre outra, se a câmera e a pessoa ainda estiverem aí.
  function retrySend(peerId, failed) {
    if (local && sender.get(peerId) === failed && personOf(peerId)) sender.connect(peerId);
  }

  function others() {
    return people.filter((person) => person.peerId !== myPeerId);
  }

  function personOf(peerId) {
    return people.find((person) => person.peerId === peerId);
  }
}
