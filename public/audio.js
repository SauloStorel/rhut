// Som de jogo, não de voz. Sem ajuste, o WebRTC trata o áudio como fala: mono, ~32 kbps, cortando o que parece
// silêncio. Aqui ele vira som de jogo e música: estéreo, bitrate alto, resistente a perda de pacote e com
// prioridade sobre o vídeo quando o upload aperta.
const AUDIO_BITRATE = 160_000;

// Parâmetros do Opus no SDP: estéreo nos dois sentidos, teto de bitrate, FEC (quem assiste reconstrói pacote
// perdido a partir do seguinte, em vez de ouvir um estalo) e sem DTX (que corta trechos baixos achando que é silêncio).
const OPUS_PARAMS = { stereo: "1", "sprop-stereo": "1", maxaveragebitrate: String(AUDIO_BITRATE), useinbandfec: "1", usedtx: "0" };

// Com o upload no limite, o navegador corta a qualidade do vídeo antes da do som.
export const AUDIO_ENCODINGS = [{ maxBitrate: AUDIO_BITRATE, priority: "high", networkPriority: "high" }];

// "music" tira o codificador Opus do modo de voz (VoIP) e põe no modo de áudio geral, que preserva graves e efeitos.
export function tuneGameAudio(stream) {
  stream.getAudioTracks().forEach((track) => (track.contentHint = "music"));
}

// Vale para os dois lados da negociação: na resposta de quem assiste e na resposta que o SFU dá a quem transmite.
// Os parâmetros que o navegador já pôs (minptime etc.) ficam; os nossos têm prioridade.
/** @param {string} sdp @returns {string} */
export function withGameAudio(sdp) {
  const payloadType = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i)?.[1];
  if (!payloadType) return sdp;

  return sdp.replace(new RegExp(`a=fmtp:${payloadType} ([^\\r\\n]*)`), (_line, params) => {
    const current = Object.fromEntries(params.split(";").filter(Boolean).map((param) => param.trim().split("=")));
    const merged = Object.entries({ ...current, ...OPUS_PARAMS }).map(([key, value]) => `${key}=${value}`);
    return `a=fmtp:${payloadType} ${merged.join(";")}`;
  });
}
