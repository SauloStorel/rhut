// Conexão WebRTC com os servidores ICE da sala; cada candidato encontrado vai pela sinalização.
export function createPeer(iceServers, sendCandidate) {
  const peer = new RTCPeerConnection({ iceServers });
  peer.addEventListener("icecandidate", ({ candidate }) => {
    if (candidate) sendCandidate(candidate);
  });
  return peer;
}

// Candidato atrasado de uma conexão que já foi trocada por outra é recusado pelo navegador; é esperado e não quebra nada.
export function addCandidate(peer, candidate) {
  peer?.addIceCandidate(candidate).catch(() => {});
}

// "failed" é a queda de verdade: "disconnected" ainda pode voltar sozinho.
export function onFailure(peer, callback) {
  peer.addEventListener("connectionstatechange", () => {
    if (peer.connectionState === "failed") callback();
  });
}

const HEALTHY_STATES = new Set(["new", "connecting", "connected"]);

export function isHealthy(peer) {
  return HEALTHY_STATES.has(peer?.connectionState);
}
