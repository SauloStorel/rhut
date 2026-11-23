export function fullscreenElement() {
  return document.fullscreenElement ?? document.webkitFullscreenElement;
}

// Safari antigo só tem a versão com prefixo webkit; no iPhone nenhum elemento da página entra em tela cheia,
// só o próprio <video>, com o player do sistema.
export function toggleFullscreen(target, video) {
  if (fullscreenElement()) return (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);

  const enter = target.requestFullscreen ?? target.webkitRequestFullscreen;
  return enter ? enter.call(target) : video.webkitEnterFullscreen?.();
}

export function onFullscreenChange(callback) {
  document.addEventListener("fullscreenchange", callback);
  document.addEventListener("webkitfullscreenchange", callback);
}
