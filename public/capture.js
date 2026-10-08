import { videoConstraints } from "./quality.js";

// Pede a tela já com o áudio certo para jogos:
// - windowAudio "window" (Chrome 141+): compartilhar a janela do jogo leva só o som dela, sem as vozes do Discord.
// - systemAudio "include": quem escolher a tela inteira ainda pode mandar o som do PC todo.
// - displaySurface "window": a escolha do navegador já abre na aba de janelas, onde está o jogo.
// - surfaceSwitching "include": o Chrome mostra um botão para trocar de janela sem parar a live.
// - selfBrowserSurface "exclude": tira a própria aba da sala da lista (evita a imagem em "espelho infinito").
// - sem os filtros de microfone: redução de ruído e ganho automático abaixam e abafam som de jogo.
export function captureScreen(quality) {
  return navigator.mediaDevices.getDisplayMedia({
    video: { ...videoConstraints(quality), displaySurface: "window" },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
    windowAudio: "window",
    systemAudio: "include",
    surfaceSwitching: "include",
    selfBrowserSurface: "exclude",
  });
}

const AUDIO_WARNINGS = {
  "monitor:audio": "Você está mandando o som do PC inteiro, inclusive as vozes do Discord. Para mandar só o som do jogo, compartilhe a janela do jogo.",
  "window:silent": "A janela foi compartilhada sem som. Atualize o Chrome ou o Edge para mandar o som do jogo junto.",
};

// Avisa quem transmite quando o áudio escolhido vai causar eco no Discord ou não vai ter som.
export function audioWarning(stream) {
  const surface = stream.getVideoTracks()[0].getSettings().displaySurface;
  const audio = stream.getAudioTracks().length > 0 ? "audio" : "silent";
  return AUDIO_WARNINGS[`${surface}:${audio}`];
}
