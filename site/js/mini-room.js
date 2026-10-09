import { showToast } from "./toast.js";

// A mini sala da seção de recursos: os controles fazem de verdade o que fazem na sala.
// O vídeo é uma imagem; a qualidade escolhida muda a nitidez dela e o que o selo "Ao vivo" mostra.
const PRESETS = {
  "720p30": { name: "720p · 30 fps", live: "720p · 30 fps", rate: "~2,5 Mbps por pessoa", screen: "blur(1.2px) saturate(0.92)" },
  "1080p30": { name: "1080p · 30 fps", live: "1080p · 30 fps", rate: "~4,5 Mbps por pessoa", screen: "none" },
  "1080p60": { name: "1080p · 60 fps", live: "1080p · 60 fps", rate: "~8 Mbps por pessoa", screen: "none" },
  text: { name: "Texto nítido", live: "1440p · 15 fps", rate: "~3 Mbps por pessoa", screen: "contrast(1.1)" },
};

const WATCHING = "3 pessoas assistindo";
const LATENCY_MS = 2000;
const MAX_VOLUME = 2;

const CAMERA_ERRORS = {
  NotAllowedError: "o navegador não deu permissão.",
  NotFoundError: "nenhuma câmera encontrada.",
  NotReadableError: "a câmera está em uso por outro programa.",
};

const MENU_KEYS = { ArrowDown: 1, ArrowUp: -1 };

export function setupMiniRoom(room) {
  const $ = (selector) => room.querySelector(selector);
  const stage = $("#mr-stage");

  setupVolume();
  setupAmbient();
  setupFullscreen();
  setupCamera();
  setupQuality();
  setInterval(() => ($("#mr-latency").textContent = 33 + Math.round(Math.random() * 11)), LATENCY_MS);

  function setupVolume() {
    const slider = $("#mr-slider");
    const mute = $("#mr-mute");
    let lastAudible = 1;

    const render = () => {
      const level = Number(slider.value);
      $("#mr-volume-value").textContent = `${Math.round(level * 100)}%`;
      slider.style.setProperty("--fill", `${(level / MAX_VOLUME) * 100}%`);
      mute.querySelector("use").setAttribute("href", level === 0 ? "#i-muted" : "#i-volume");
      mute.setAttribute("aria-label", level === 0 ? "Ativar som" : "Silenciar");
      if (level > 0) lastAudible = level;
    };

    slider.addEventListener("input", render);
    mute.addEventListener("click", () => {
      slider.value = Number(slider.value) === 0 ? lastAudible : 0;
      render();
    });
    render();
  }

  function setupAmbient() {
    const toggle = $("#mr-ambient");
    toggle.addEventListener("click", () => {
      const on = room.toggleAttribute("data-ambient");
      toggle.setAttribute("aria-pressed", String(on));
    });
  }

  function setupFullscreen() {
    const toggle = $("#mr-fullscreen");
    const fullscreenElement = () => document.fullscreenElement ?? document.webkitFullscreenElement;

    toggle.addEventListener("click", () => {
      if (fullscreenElement()) return (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
      (stage.requestFullscreen ?? stage.webkitRequestFullscreen)?.call(stage);
    });
    document.addEventListener("fullscreenchange", () => {
      const on = Boolean(fullscreenElement());
      toggle.querySelector("use").setAttribute("href", on ? "#i-shrink" : "#i-expand");
      toggle.setAttribute("aria-label", on ? "Sair da tela cheia" : "Tela cheia");
    });
  }

  // A câmera de verdade, só no navegador de quem clicou: aparece espelhada na faixa, como na sala.
  function setupCamera() {
    const button = $("#mr-camera");
    let stream = null;
    let tile = null;

    const render = () => {
      button.setAttribute("aria-pressed", String(Boolean(stream)));
      button.querySelector("use").setAttribute("href", stream ? "#i-camera-off" : "#i-camera");
    };

    button.addEventListener("click", async () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        tile.remove();
        stream = tile = null;
        return render();
      }

      stream = await navigator.mediaDevices
        ?.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 } }, audio: false })
        .catch((error) => {
          showToast(`Não deu para ligar a câmera: ${CAMERA_ERRORS[error.name] ?? error.message}`);
          return null;
        });
      if (!stream) return render();

      tile = selfTile(stream);
      $("#mr-cams").prepend(tile);
      render();
    });
  }

  function setupQuality() {
    const trigger = $("#mr-quality-trigger");
    const list = $("#mr-quality-list");
    const options = [...list.querySelectorAll("[data-quality]")];

    const open = () => {
      list.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      list.querySelector('[aria-checked="true"]').focus();
    };
    const close = ({ focusTrigger = false } = {}) => {
      list.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (focusTrigger) trigger.focus();
    };

    trigger.addEventListener("click", () => (list.hidden ? open() : close()));
    options.forEach((option) =>
      option.addEventListener("click", () => {
        choose(option);
        close({ focusTrigger: true });
      }),
    );

    list.addEventListener("keydown", (event) => {
      if (event.key === "Escape") return close({ focusTrigger: true });
      const step = MENU_KEYS[event.key];
      if (!step) return;

      event.preventDefault();
      const index = options.indexOf(document.activeElement);
      options[(index + step + options.length) % options.length].focus();
    });

    document.addEventListener("pointerdown", (event) => {
      if (!list.hidden && !trigger.parentElement.contains(event.target)) close();
    });

    function choose(option) {
      const preset = PRESETS[option.dataset.quality];
      options.forEach((other) => other.setAttribute("aria-checked", String(other === option)));
      $("#mr-quality-name").textContent = preset.name;
      $("#mr-quality-rate").textContent = preset.rate;
      $("#mr-quality-label").textContent = preset.live;
      $("#mr-status").textContent = `${WATCHING} · ${preset.live} H264`;
      $("#mr-screen").style.filter = preset.screen;
      flash(room.querySelector(".mr-stage .live-badge"));
    }
  }
}

function selfTile(stream) {
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  const name = document.createElement("em");
  name.textContent = "Você";
  const tile = document.createElement("span");
  tile.className = "cam cam-self";
  tile.append(video, name);
  return tile;
}

// Pisca o elemento para mostrar que o valor mudou; reinicia a animação se clicarem de novo.
function flash(element) {
  element.removeAttribute("data-flash");
  void element.offsetWidth;
  element.setAttribute("data-flash", "");
}
