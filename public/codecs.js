// Em P2P o host codifica o vídeo uma vez por pessoa assistindo, então encoder em hardware (GPU) faz muita diferença.
// Coloca na frente o primeiro codec que o navegador diz ser "powerEfficient"; sem nenhum, mantém a ordem padrão.
const HARDWARE_CANDIDATES = ["video/AV1", "video/H264", "video/VP9"];

export async function hardwareFirstCodecs() {
  const { codecs } = RTCRtpSender.getCapabilities("video");
  const hardware = await firstHardwareCodec();
  return codecs.toSorted((a, b) => (b.mimeType === hardware) - (a.mimeType === hardware));
}

async function firstHardwareCodec() {
  const results = await Promise.all(
    HARDWARE_CANDIDATES.map((contentType) =>
      navigator.mediaCapabilities
        .encodingInfo({ type: "webrtc", video: { contentType, width: 1920, height: 1080, bitrate: 4_500_000, framerate: 30 } })
        .then(({ supported, powerEfficient }) => supported && powerEfficient && contentType, () => null),
    ),
  );
  return results.find(Boolean);
}
