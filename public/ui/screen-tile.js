import { avatar, setIcon } from "./dom.js";
import { fullscreenElement, onFullscreenChange, toggleFullscreen } from "./fullscreen.js";
import { MAX_VOLUME, createSound } from "./sound.js";

const HIDE_CONTROLS_AFTER_MS = 2500;

// Card de uma tela transmitida, montado a partir do <template id="screen-tile">. Estados (data-state):
// - "invite": alguém está transmitindo e eu ainda não escolhi assistir (como no Discord, nada chega até lá);
// - "connecting": escolhi assistir e a imagem ainda não chegou (ou caiu e está voltando);
// - "playing": a tela de outra pessoa, com som (até 200%) e o convite "Ativar som" (o som começa mudo pelo autoplay);
// - "preview": a minha tela, sempre muda, só com tela cheia.
export function createScreenTile({ self, onWatch, onStopWatching, onAmbientToggle }) {
  const template = /** @type {HTMLTemplateElement} */ (document.getElementById("screen-tile"));
  const element = /** @type {HTMLElement} */ (template.content.firstElementChild.cloneNode(true));
  const part = (name) => /** @type {HTMLElement} */ (element.querySelector(`[data-part="${name}"]`));
  const video = /** @type {HTMLVideoElement} */ (part("video"));
  const slider = /** @type {HTMLInputElement} */ (part("slider"));
  const hostAvatar = /** @type {HTMLImageElement} */ (part("avatar"));
  const sound = createSound(syncSound);
  let hideTimer;

  part("watch").addEventListener("click", onWatch);
  part("stop-watching").addEventListener("click", onStopWatching);
  part("ambient").addEventListener("click", onAmbientToggle);
  part("mute").addEventListener("click", () => sound.toggleMute());
  part("unmute").addEventListener("click", () => sound.unmute());
  slider.addEventListener("input", () => sound.setVolume(Number(slider.value)));

  const toggleTileFullscreen = () => toggleFullscreen(element, video);
  part("fullscreen").addEventListener("click", toggleTileFullscreen);
  video.addEventListener("dblclick", toggleTileFullscreen);
  onFullscreenChange(syncFullscreen);

  element.addEventListener("pointermove", revealControls);
  element.addEventListener("focusin", revealControls);

  return {
    element,
    video,
    isPlaying: () => element.dataset.state === "playing",

    setSharer(person) {
      const name = self ? "Você" : person.name;
      part("name").textContent = name;
      hostAvatar.hidden = !person.avatarUrl;
      hostAvatar.src = person.avatarUrl ?? "";
      part("invite-avatar").replaceChildren(avatar(person, "avatar avatar-lg"));
      part("invite-title").textContent = `${name} está transmitindo`;
    },

    invite: () => show("invite", null),
    connecting: () => show("connecting", null),
    // Chamado uma vez por trilha que chega (vídeo e depois áudio), sempre com o mesmo stream.
    play: (stream) => show("playing", stream),
    preview: (stream) => show("preview", stream),

    // Resolução/FPS reais (e, para quem assiste, o atraso) no selo "Ao vivo". Vazio esconde.
    setQuality(label, hint = "") {
      part("quality").textContent = label ?? "";
      part("quality").title = hint;
      part("quality").hidden = !label;
    },

    setAmbient(on) {
      part("ambient").setAttribute("aria-pressed", String(on));
    },

    remove() {
      sound.detach();
      if (fullscreenElement() === element) toggleTileFullscreen();
      element.remove();
    },
  };

  function show(state, stream) {
    element.dataset.state = state;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      sound.detach();
      part("quality").hidden = true;
    }
    if (state === "playing") sound.attach(stream);
    syncSound(sound.state());
    revealControls();
  }

  function revealControls() {
    element.removeAttribute("data-idle-pointer");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => element.setAttribute("data-idle-pointer", ""), HIDE_CONTROLS_AFTER_MS);
  }

  function syncSound({ muted, volume, hasAudio }) {
    const level = muted ? 0 : volume;
    const audible = element.dataset.state === "playing" && hasAudio;
    setIcon(part("mute").querySelector("svg"), level === 0 ? "muted" : "volume");
    part("mute").setAttribute("aria-label", level === 0 ? "Ativar som" : "Silenciar");
    slider.value = String(level);
    slider.setAttribute("aria-valuetext", `${Math.round(level * 100)}%`);
    slider.title = `Volume ${Math.round(level * 100)}%`;
    slider.style.setProperty("--fill", `${(level / MAX_VOLUME) * 100}%`);
    part("volume").hidden = !audible;
    part("unmute").hidden = !audible || !muted;
  }

  function syncFullscreen() {
    const fullscreen = fullscreenElement() === element;
    setIcon(part("fullscreen").querySelector("svg"), fullscreen ? "shrink" : "expand");
    part("fullscreen").setAttribute("aria-label", fullscreen ? "Sair da tela cheia" : "Tela cheia");
  }
}
