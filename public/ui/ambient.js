// Modo ambiente: as cores do vídeo "vazam" em volta do palco, como no YouTube.
// Desenha o vídeo num canvas minúsculo (o blur do CSS faz o resto) e mistura cada quadro novo com o anterior,
// para a luz mudar suave em vez de piscar.
const WIDTH = 32;
const HEIGHT = 18;
const FRAME_MS = 120;
const BLEND = 0.25;

export function createAmbient(video, canvas) {
  const context = canvas.getContext("2d");
  let timer = null;
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const paint = () => {
    if (video.readyState < 2) return;
    context.globalAlpha = BLEND;
    context.drawImage(video, 0, 0, WIDTH, HEIGHT);
  };

  return {
    start() {
      if (timer) return;
      context.clearRect(0, 0, WIDTH, HEIGHT);
      timer = setInterval(paint, FRAME_MS);
      canvas.dataset.on = "";
    },

    stop() {
      clearInterval(timer);
      timer = null;
      delete canvas.dataset.on;
    },
  };
}
