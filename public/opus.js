// O WebRTC manda áudio pensando em voz: mono, ~32 kbps. Para som de jogo/música, pede estéreo e 128 kbps.
const AUDIO_BITRATE = 128_000;

// Quem assiste coloca isso na resposta SDP; é o que faz o navegador de quem transmite codificar em estéreo.
export function withStereoOpus(sdp) {
  const payloadType = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i)?.[1];
  if (!payloadType) return sdp;

  return sdp.replace(new RegExp(`(a=fmtp:${payloadType} [^\\r\\n]*)`), `$1;stereo=1;sprop-stereo=1;maxaveragebitrate=${AUDIO_BITRATE}`);
}
