import { createAmbient } from "./ambient.js";
import { setIcon } from "./dom.js";
import { MAX_VOLUME, createSound } from "./sound.js";

// Controles próprios do vídeo. Dois modos:
// - "watch": quem assiste; tem som (até 200%), volume e o convite "Ativar som" (o som começa mudo pelo autoplay).
// - "preview": quem transmite vendo a própria tela; sempre mudo, só tela cheia.
const HIDE_CONTROLS_AFTER_MS = 2500;

export function createPlayer(stage, { preferences }) {
  const video = stage.querySelector("#video");
  const ambient = createAmbient(video, document.querySelector("#ambient"));
  const ambientToggle = stage.querySelector("#ambient-toggle");
  let ambientOn = preferences.get("ambient") !== "off";
  const muteToggle = stage.querySelector("#mute-toggle");
  const volumeControl = stage.querySelector("#volume");
  const slider = stage.querySelector("#volume-slider");
  const unmutePrompt = stage.querySelector("#unmute-prompt");
  const fullscreenToggle = stage.querySelector("#fullscreen-toggle");
  const hostName = stage.querySelector("#live-host-name");
  const hostAvatar = stage.querySelector("#live-host-avatar");
  const quality = stage.querySelector("#live-quality");
  const sound = createSound(syncSound);
  let mode = "watch";
  let hideTimer;

  slider.addEventListener("input", () => sound.setVolume(Number(slider.value)));
  muteToggle.addEventListener("click", () => sound.toggleMute());
  unmutePrompt.addEventListener("click", () => sound.unmute());

  ambientToggle.addEventListener("click", () => {
    ambientOn = !ambientOn;
    preferences.set("ambient", ambientOn ? "on" : "off");
    syncAmbient();
  });

  fullscreenToggle.addEventListener("click", toggleFullscreen);
  video.addEventListener("dblclick", toggleFullscreen);

  document.addEventListener("fullscreenchange", syncFullscreen);
  document.addEventListener("webkitfullscreenchange", syncFullscreen);

  stage.addEventListener("pointermove", revealControls);
  stage.addEventListener("focusin", revealControls);

  function revealControls() {
    stage.removeAttribute("data-idle-pointer");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => stage.setAttribute("data-idle-pointer", ""), HIDE_CONTROLS_AFTER_MS);
  }

  function syncSound({ muted, volume, hasAudio }) {
    const level = muted ? 0 : volume;
    setIcon(muteToggle.querySelector("svg"), level === 0 ? "muted" : "volume");
    muteToggle.setAttribute("aria-label", level === 0 ? "Ativar som" : "Silenciar");
    slider.value = String(level);
    slider.setAttribute("aria-valuetext", `${Math.round(level * 100)}%`);
    slider.title = `Volume ${Math.round(level * 100)}%`;
    slider.style.setProperty("--fill", `${(level / MAX_VOLUME) * 100}%`);
    volumeControl.hidden = mode !== "watch" || !hasAudio;
    unmutePrompt.hidden = mode !== "watch" || !hasAudio || !muted;
  }

  function syncAmbient() {
    ambientToggle.setAttribute("aria-pressed", String(ambientOn));
    if (ambientOn && stage.dataset.screen === "video") ambient.start();
    else ambient.stop();
  }

  // Safari antigo só tem a versão com prefixo webkit; no iPhone nenhum elemento da página entra em tela cheia,
  // só o próprio <video>, com o player do sistema.
  function toggleFullscreen() {
    if (fullscreenElement()) return (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);

    const enter = stage.requestFullscreen ?? stage.webkitRequestFullscreen;
    return enter ? enter.call(stage) : video.webkitEnterFullscreen?.();
  }

  function syncFullscreen() {
    const fullscreen = Boolean(fullscreenElement());
    setIcon(fullscreenToggle.querySelector("svg"), fullscreen ? "shrink" : "expand");
    fullscreenToggle.setAttribute("aria-label", fullscreen ? "Sair da tela cheia" : "Tela cheia");
  }

  // Chamado uma vez por trilha que chega (vídeo e depois áudio), sempre com o mesmo stream.
  function show(stream, nextMode) {
    mode = nextMode;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      quality.hidden = true;
      sound.detach();
    }
    if (mode === "watch") sound.attach(stream);
    stage.dataset.screen = "video";
    syncAmbient();
    revealControls();
  }

  return {
    watch: (stream) => show(stream, "watch"),
    preview: (stream) => show(stream, "preview"),

    clear() {
      video.srcObject = null;
      sound.detach();
      stage.dataset.screen = "idle";
      syncAmbient();
      if (fullscreenElement()) toggleFullscreen();
    },

    // Resolução/FPS reais (e, para quem assiste, o atraso) no selo "Ao vivo". Vazio esconde.
    setQuality(label, hint = "") {
      quality.textContent = label ?? "";
      quality.title = hint;
      quality.hidden = !label;
    },

    // Quem aparece no selo "Ao vivo".
    setHost(profile) {
      hostName.textContent = profile?.name ?? "";
      hostAvatar.hidden = !profile?.avatarUrl;
      hostAvatar.src = profile?.avatarUrl ?? "";
    },
  };
}

function fullscreenElement() {
  return document.fullscreenElement ?? document.webkitFullscreenElement;
}
