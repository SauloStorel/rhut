// Com P2P quem transmite manda uma cópia para cada pessoa, então o bitrate é "por pessoa assistindo".
// Prioriza fluidez pela degradationPreference, sem contentHint "motion": com ele o Chrome trata a tela
// como câmera e começa em 270p, mesmo com banda sobrando (medido com getStats).
const MOTION = { contentHint: "", degradationPreference: "maintain-framerate" };
const DETAIL = { contentHint: "detail", degradationPreference: "maintain-resolution" };

export const QUALITY_PRESETS = {
  "720p30": { name: "720p · 30 fps", detail: "Leve, para upload mais fraco", bitrate: "~2,5 Mbps", width: 1280, height: 720, frameRate: 30, maxBitrate: 2_500_000, ...MOTION },
  "1080p30": { name: "1080p · 30 fps", detail: "Equilíbrio entre nitidez e fluidez", bitrate: "~4,5 Mbps", width: 1920, height: 1080, frameRate: 30, maxBitrate: 4_500_000, ...MOTION },
  "1080p60": { name: "1080p · 60 fps", detail: "Jogos e movimento rápido", bitrate: "~8 Mbps", width: 1920, height: 1080, frameRate: 60, maxBitrate: 8_000_000, ...MOTION },
  // Sem limite de resolução: captura na nativa do monitor, que é o que deixa código legível.
  text: { name: "Texto nítido", detail: "Código e slides na resolução do monitor", bitrate: "~3 Mbps", frameRate: 15, maxBitrate: 3_000_000, ...DETAIL },
};

export const DEFAULT_QUALITY = "1080p30";

export function videoConstraints({ width, height, frameRate }) {
  return { width: { max: width }, height: { max: height }, frameRate: { ideal: frameRate, max: frameRate } };
}

// Precisa rodar depois do setLocalDescription, quando o sender já tem encodings.
export function tuneSender(sender, { maxBitrate, frameRate, degradationPreference }) {
  const parameters = sender.getParameters();
  parameters.encodings.forEach((current) => Object.assign(current, { maxBitrate, maxFramerate: frameRate }));
  parameters.degradationPreference = degradationPreference;
  return sender.setParameters(parameters);
}

// Troca a qualidade no meio da transmissão, sem reconectar ninguém.
export async function applyQuality(preset, track, senders) {
  track.contentHint = preset.contentHint;
  await track.applyConstraints(videoConstraints(preset));
  await Promise.all(senders.map((sender) => tuneSender(sender, preset)));
}
