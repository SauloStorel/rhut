// Uma pessoa compartilha a tela (host) e manda uma conexão WebRTC para cada pessoa assistindo (viewer);
// qualquer um pode ligar a câmera. Uma conexão só com a sala troca a "apresentação" WebRTC e avisa quem está lá.
// Este arquivo monta a página; assistir e transmitir moram em watch.js e broadcast.js.

import { broadcast } from "./broadcast.js";
import { audioWarning, captureScreen } from "./capture.js";
import { createCameras } from "./cameras.js";
import { hardwareFirstCodecs } from "./codecs.js";
import { createPeer } from "./peer.js";
import { DEFAULT_QUALITY, QUALITY_PRESETS } from "./quality.js";
import { connectRoom } from "./signaling.js";
import { accentFromIcon, inkFor } from "./ui/accent.js";
import { createCameraStrip } from "./ui/camera-strip.js";
import { icon, setIcon } from "./ui/dom.js";
import { createDropdown } from "./ui/dropdown.js";
import { createPlayer } from "./ui/player.js";
import { createPresence } from "./ui/presence.js";
import { createShareGuide } from "./ui/share-guide.js";
import { showToast } from "./ui/toast.js";
import { watch } from "./watch.js";

const WARNING_MS = 9000;
const FALLBACK_ACCENT = "#5865f2";
// Sem a configuração da sala (rede instável, erro no servidor) a página ainda funciona: sem a marca do servidor e só com STUN.
const FALLBACK_CONFIG = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], guild: null, accentColor: "auto" };

const roomId = location.pathname.split("/").pop();
const canShare = Boolean(navigator.mediaDevices?.getDisplayMedia);
const canUseCamera = Boolean(navigator.mediaDevices?.getUserMedia);
const preferences = safeStorage(() => localStorage);
const tabStorage = safeStorage(() => sessionStorage);

const statusText = document.querySelector("#status");
const connectionBadge = document.querySelector("#connection");
const shareButton = document.querySelector("#share");
const stopButton = document.querySelector("#stop");
const cameraButton = document.querySelector("#camera-toggle");
const qualityPicker = document.querySelector("#quality-picker");
const dock = document.querySelector("#dock");
const idle = document.querySelector("#idle");
const stage = document.querySelector("#stage");

const SHARE_INVITE = canShare ? " Para transmitir, escolha a qualidade e clique em Compartilhar tela." : "";

// O que a tela mostra quando não tem vídeo, e quais controles ficam disponíveis em cada caso.
const IDLE_SCREENS = {
  waiting: { title: "Ninguém está transmitindo ainda", hint: `Quando alguém compartilhar a tela, a imagem aparece aqui sozinha.${SHARE_INVITE}`, pulse: true, controls: "idle" },
  connecting: { title: "Conectando à transmissão", hint: "A imagem aparece aqui em alguns segundos.", pulse: true, controls: "watching" },
  ended: { title: "A transmissão terminou", hint: `Fique por aqui: se alguém compartilhar de novo, aparece automaticamente.${SHARE_INVITE}`, pulse: true, controls: "idle" },
  closed: { title: "Sala encerrada", hint: "Abra outra com /live no Discord.", pulse: false, controls: "none" },
};

// Quem está só assistindo não vê "Compartilhar tela": já tem alguém transmitindo e o servidor recusaria.
const CONTROLS = {
  idle: { share: canShare, quality: canShare, stop: false, camera: canUseCamera },
  watching: { share: false, quality: false, stop: false, camera: canUseCamera },
  guide: { share: false, quality: true, stop: false, camera: false },
  broadcasting: { share: false, quality: true, stop: true, camera: canUseCamera },
  none: { share: false, quality: false, stop: false, camera: false },
};

const { iceServers, guild, accentColor } = await fetch(`/api/rooms/${roomId}`)
  .then((response) => (response.ok ? response.json() : FALLBACK_CONFIG))
  .catch(() => FALLBACK_CONFIG);
showBranding(guild);
applyAccent(guild, accentColor);

// Daqui até registrar os handlers não pode ter `await`: as primeiras mensagens da sala chegam logo após conectar.
const signaling = connectRoom({ roomId, pass: takePass(), resume: resumeToken(), onStatus: (status) => (connectionBadge.hidden = status !== "reconnecting") });
const newPeer = (sendCandidate) => createPeer(iceServers, sendCandidate);
const player = createPlayer(stage, { preferences });
const presence = createPresence();
const cameraStrip = createCameraStrip();
const cameras = createCameras({ signaling, createPeer: newPeer, onChange: renderCameras });
const codecPreferences = hardwareFirstCodecs();
const qualityPickerControl = setupQualityPicker();
let idleScreen = "waiting";
let myPeerId = null;
let hostPeerId = null;
const shareGuide = createShareGuide({ stage, preferences, onContinue: startSharing, onCancel: () => showIdle(idleScreen) });

// O que assistir e transmitir precisam da página.
const screen = { idle: showIdle, controls: showControls, status: showStatus, renderCameras, current: () => idleScreen };

// Mensagens que valem para a página inteira, assistindo ou transmitindo.
signaling.on({
  welcome: ({ you, peerId }) => {
    myPeerId = peerId;
    presence.setMe(you);
  },
  presence: ({ people }) => {
    const host = presence.update(people);
    hostPeerId = host?.peerId ?? null;
    player.setHost(host);
    cameras.sync(people);
    session.hostChanged?.(hostPeerId === myPeerId ? null : host);
  },
  "room-closed": showRoomClosed,
});

let session = startWatching();

shareButton.addEventListener("click", () => {
  if (shareGuide.open()) showControls("guide");
  else startSharing();
});

stopButton.addEventListener("click", switchToWatching);

cameraButton.addEventListener("click", async () => {
  if (cameras.isOn()) return cameras.turnOff();

  await cameras.turnOn().catch((error) => warn(`Não deu para ligar a câmera: ${cameraError(error)}`));
});

async function startSharing() {
  const quality = QUALITY_PRESETS[qualityPickerControl.value()];
  const stream = await captureScreen(quality).catch(() => null);
  if (!stream) return showIdle(idleScreen);

  session.close();
  session = broadcast(stream, quality, { signaling, createPeer: newPeer, player, screen, codecPreferences, onStop: switchToWatching });

  const warning = audioWarning(stream);
  if (warning) warn(warning);
}

function switchToWatching() {
  session.close();
  session = startWatching();
}

function startWatching() {
  return watch({ signaling, createPeer: newPeer, player, screen });
}

// A câmera de quem está transmitindo vira a facecam sobre a tela; as outras vão para a faixa.
function renderCameras() {
  const screenIsLive = stage.dataset.screen === "video";
  cameraStrip.render(cameras.tiles(), { facecamPeerId: screenIsLive ? hostPeerId : null });

  const on = cameras.isOn();
  cameraButton.setAttribute("aria-pressed", String(on));
  cameraButton.setAttribute("aria-label", on ? "Desligar câmera" : "Ligar câmera");
  setIcon(cameraButton.querySelector("svg"), on ? "camera-off" : "camera");
}

// Sala fechada pelo Discord (botão "Fechar sala") ou por ficar vazia: não tem mais o que fazer aqui.
function showRoomClosed() {
  session.close();
  session = { close() {} };
  if (cameras.isOn()) cameras.turnOff();
  showIdle("closed");
}

function showIdle(screen) {
  const { title, hint, pulse, controls } = IDLE_SCREENS[screen];
  idleScreen = screen;
  player.clear();
  idle.toggleAttribute("data-pulse", pulse);
  document.querySelector("#idle-title").textContent = title;
  document.querySelector("#idle-hint").textContent = hint;
  showControls(controls);
  showStatus("");
  renderCameras();
}

function showControls(mode) {
  const { share, quality, stop, camera } = CONTROLS[mode];
  shareButton.hidden = !share;
  qualityPicker.hidden = !quality;
  stopButton.hidden = !stop;
  cameraButton.hidden = !camera;
  dock.hidden = !(share || quality || stop || camera);
}

function showBranding(guild) {
  if (!guild) return;

  document.title = `${guild.name} · rhut`;
  document.querySelector("#brand-name").textContent = guild.name;
  if (!guild.iconUrl) return;

  // Só troca o ícone padrão pelo do servidor depois que a imagem carregar de verdade.
  // (SVG não tem a propriedade `hidden` do HTML, então os fallbacks usam o atributo.)
  const serverIcons = document.querySelectorAll(".server-icon");
  serverIcons[0].addEventListener("load", () => {
    serverIcons.forEach((serverIcon) => (serverIcon.hidden = false));
    document.querySelectorAll(".brand-fallback").forEach((fallback) => fallback.setAttribute("hidden", ""));
  });
  serverIcons.forEach((serverIcon) => (serverIcon.src = guild.iconUrl));
}

// ACCENT_COLOR "auto" tira a cor do ícone do servidor; um hex fixo (ex: "#e5242b") manda.
async function applyAccent(guild, accentColor) {
  const fromIcon = accentColor === "auto" && guild?.iconUrl ? await accentFromIcon(guild.iconUrl) : null;
  const accent = fromIcon ?? (accentColor === "auto" ? FALLBACK_ACCENT : accentColor);
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-ink", inkFor(accent));
}

function setupQualityPicker() {
  const saved = preferences.get("quality");
  const showCurrent = (key) => {
    document.querySelector("#quality-name").textContent = QUALITY_PRESETS[key].name;
    document.querySelector("#quality-bitrate").textContent = `${QUALITY_PRESETS[key].bitrate} por pessoa`;
  };
  let current = Object.hasOwn(QUALITY_PRESETS, saved) ? saved : DEFAULT_QUALITY;

  createDropdown({
    trigger: document.querySelector("#quality-trigger"),
    list: document.querySelector("#quality-list"),
    options: Object.entries(QUALITY_PRESETS).map(([value, { name, detail, bitrate }]) => ({ value, name, detail, aside: bitrate })),
    initial: current,
    onChange(key) {
      current = key;
      showCurrent(key);
      preferences.set("quality", key);
      session.setQuality?.(QUALITY_PRESETS[key]);
    },
  });
  showCurrent(current);

  return { value: () => current };
}

// O passe vem no link pessoal do Discord (?pass=...). Guarda na aba e tira da URL,
// para que copiar o endereço da barra não leve a identidade junto.
function takePass() {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get("pass");
  const storageKey = `pass:${roomId}`;

  if (fromUrl) {
    url.searchParams.delete("pass");
    history.replaceState(null, "", url);
    tabStorage.set(storageKey, fromUrl);
  }
  return fromUrl ?? tabStorage.get(storageKey);
}

// O segredo de reconexão sobrevive a recarregar a página: quem recarrega volta como a mesma pessoa em vez de
// aparecer duplicado até a sala desistir da conexão antiga (o navegador nem sempre avisa que a página saiu).
// Só na recarga: uma aba duplicada (que copia o sessionStorage) entra como outra pessoa.
function resumeToken() {
  const storageKey = `resume:${roomId}`;
  const isReload = performance.getEntriesByType("navigation")[0]?.type === "reload";
  const token = (isReload && tabStorage.get(storageKey)) || crypto.randomUUID();
  tabStorage.set(storageKey, token);
  return token;
}

const CAMERA_ERRORS = {
  NotAllowedError: "o navegador não deu permissão. Libere a câmera no cadeado da barra de endereço.",
  NotFoundError: "nenhuma câmera encontrada.",
  NotReadableError: "a câmera está em uso por outro programa.",
};

function cameraError(error) {
  return CAMERA_ERRORS[error.name] ?? error.message;
}

function warn(text) {
  showToast([icon("alert"), text], { tone: "warning", duration: WARNING_MS });
}

function showStatus(text) {
  statusText.textContent = text;
}

// localStorage/sessionStorage podem estar bloqueados (aba anônima, cookies desligados), e até acessar
// a propriedade pode lançar erro. Aí só não lembra a escolha.
function safeStorage(getStorage) {
  return {
    get(key) {
      try {
        return getStorage().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        getStorage().setItem(key, value);
      } catch {}
    },
  };
}
