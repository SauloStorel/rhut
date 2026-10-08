// Câmeras de todo mundo, em P2P: cada câmera ligada manda uma conexão só de ida para cada pessoa da sala.
// 360p e sem microfone (a voz já está no Discord), então 5 câmeras ainda pesam pouco no upload.
const CAMERA_CONSTRAINTS = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } };
const CAMERA_BITRATE = 400_000;

export function createCameras({ signaling, createPeer, onChange }) {
  const sending = new Map(); // peerId → { peer } da minha câmera para essa pessoa
  const receiving = new Map(); // peerId → { peer, stream } da câmera dessa pessoa para mim
  let myPeerId = null;
  let local = null;
  let people = [];

  signaling.on({
    welcome: ({ peerId }) => (myPeerId = peerId),
    "cam-offer": receive,
    "cam-answer": ({ from, description }) => sending.get(from)?.peer.setRemoteDescription(description),
    // `owner` diz de quem é a câmera, para achar a conexão certa quando as duas pessoas estão com a câmera ligada.
    "cam-candidate": ({ from, owner, candidate }) => connectionWith(from, owner)?.addIceCandidate(candidate),
  });

  return {
    isOn: () => Boolean(local),

    async turnOn() {
      local = await navigator.mediaDevices.getUserMedia({ video: CAMERA_CONSTRAINTS, audio: false });
      signaling.send({ type: "camera", on: true });
      others().forEach((person) => sendTo(person.peerId));
      onChange();
    },

    turnOff() {
      local?.getTracks().forEach((track) => track.stop());
      local = null;
      closeAll(sending);
      signaling.send({ type: "camera", on: false });
      onChange();
    },

    // Chamado a cada atualização de presença: abre conexão para quem chegou e fecha a de quem saiu
    // ou desligou a câmera.
    sync(nextPeople) {
      people = nextPeople;
      const present = new Set(people.map((person) => person.peerId));
      const withCamera = new Set(people.filter((person) => person.camera).map((person) => person.peerId));

      closeWhere(sending, (peerId) => !present.has(peerId));
      closeWhere(receiving, (peerId) => !withCamera.has(peerId));
      if (local) others().filter((person) => !sending.has(person.peerId)).forEach((person) => sendTo(person.peerId));
      onChange();
    },

    // O que a interface mostra: minha câmera primeiro, depois a de cada pessoa.
    tiles() {
      const mine = local ? [{ peerId: myPeerId, person: personOf(myPeerId), stream: local, self: true }] : [];
      const theirs = [...receiving].map(([peerId, { stream }]) => ({ peerId, person: personOf(peerId), stream, self: false }));
      return [...mine, ...theirs].filter((tile) => tile.person && tile.stream);
    },
  };

  async function sendTo(peerId) {
    const peer = createPeer((candidate) => signaling.send({ type: "cam-candidate", to: peerId, owner: myPeerId, candidate }));
    local.getVideoTracks().forEach((track) =>
      peer.addTransceiver(track, { direction: "sendonly", streams: [local], sendEncodings: [{ maxBitrate: CAMERA_BITRATE }] }),
    );
    sending.set(peerId, { peer });

    await peer.setLocalDescription();
    signaling.send({ type: "cam-offer", to: peerId, description: peer.localDescription });
  }

  async function receive({ from, description }) {
    receiving.get(from)?.peer.close();
    const peer = createPeer((candidate) => signaling.send({ type: "cam-candidate", to: from, owner: from, candidate }));
    const link = { peer, stream: null };
    receiving.set(from, link);
    peer.addEventListener("track", ({ streams: [stream] }) => {
      link.stream = stream;
      onChange();
    });

    await peer.setRemoteDescription(description);
    await peer.setLocalDescription();
    signaling.send({ type: "cam-answer", to: from, description: peer.localDescription });
  }

  function connectionWith(peerId, owner) {
    return (owner === myPeerId ? sending : receiving).get(peerId)?.peer;
  }

  function others() {
    return people.filter((person) => person.peerId !== myPeerId);
  }

  function personOf(peerId) {
    return people.find((person) => person.peerId === peerId);
  }
}

function closeWhere(links, shouldClose) {
  [...links.keys()].filter(shouldClose).forEach((peerId) => {
    links.get(peerId).peer.close();
    links.delete(peerId);
  });
}

function closeAll(links) {
  closeWhere(links, () => true);
}
