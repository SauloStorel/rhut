// Lê do WebRTC o que está sendo transmitido de verdade (não o preset escolhido, que é só o teto).

const LIMIT_HINTS = {
  cpu: "CPU no limite, tente uma qualidade menor",
  bandwidth: "upload no limite, tente uma qualidade menor",
};

// Do lado de quem transmite: pega a pessoa que está recebendo pior.
export async function sendingQuality(peers) {
  const reports = await Promise.all(peers.map((peer) => videoReport(peer, "outbound-rtp")));
  const worst = reports.filter(Boolean).toSorted((a, b) => a.frameHeight - b.frameHeight)[0];
  return worst && { label: qualityLabel(worst), codec: worst.codec, hint: LIMIT_HINTS[worst.qualityLimitationReason] };
}

export const DELAY_HINT =
  "Atraso estimado de rede + buffer + decodificação nesta conexão. A captura e a codificação no PC de quem transmite somam mais uns 20–50 ms.";

// Do lado de quem assiste: qualidade que está chegando e o atraso estimado. Mede a variação entre uma leitura
// e a próxima (não a média desde o início), para o número reagir quando a rede piora ou melhora.
export function createReceiveMeter(peer) {
  let previous = { jitterBufferDelay: 0, jitterBufferEmittedCount: 0, totalDecodeTime: 0, framesDecoded: 0 };

  return async function measure() {
    const stats = [...(await peer.getStats()).values()];
    const video = stats.find((entry) => entry.type === "inbound-rtp" && entry.kind === "video" && entry.frameHeight);
    if (!video) return null;

    const pair = stats.find((entry) => entry.type === "candidate-pair" && entry.nominated && entry.state === "succeeded");
    const network = (pair?.currentRoundTripTime ?? 0) / 2;
    const buffer = perUnit(video.jitterBufferDelay - previous.jitterBufferDelay, video.jitterBufferEmittedCount - previous.jitterBufferEmittedCount);
    const decode = perUnit(video.totalDecodeTime - previous.totalDecodeTime, video.framesDecoded - previous.framesDecoded);
    previous = video;

    return `${qualityLabel(video)} · ~${Math.round((network + buffer + decode) * 1000)} ms`;
  };
}

function perUnit(total, count) {
  return count > 0 ? total / count : 0;
}

function qualityLabel({ frameHeight, framesPerSecond }) {
  return `${frameHeight}p · ${Math.round(framesPerSecond ?? 0)} fps`;
}

async function videoReport(peer, type) {
  const stats = await peer.getStats();
  const report = [...stats.values()].find((entry) => entry.type === type && entry.kind === "video" && entry.frameHeight);
  return report && { ...report, codec: stats.get(report.codecId)?.mimeType.replace("video/", "") ?? "" };
}
