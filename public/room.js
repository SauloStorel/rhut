// Uma pessoa compartilha a tela (host) e manda uma conexão WebRTC para cada pessoa assistindo (viewer);
// qualquer um pode ligar a câmera. Uma conexão só com a sala troca a "apresentação" WebRTC e avisa quem está lá.

import { audioWarning, captureScreen } from "./capture.js";
import { createCameras } from "./cameras.js";
import { hardwareFirstCodecs } from "./codecs.js";
import { DELAY_HINT, createReceiveMeter, sendingQuality } from "./diagnostics.js";
import { withStereoOpus } from "./opus.js";
import { DEFAULT_QUALITY, QUALITY_PRESETS, applyQuality, tuneSender } from "./quality.js";
import { connectRoom } from "./signaling.js";
import { accentFromIcon, inkFor } from "./ui/accent.js";
import { createCameraStrip } from "./ui/camera-strip.js";
import { icon, setIcon } from "./ui/dom.js";
import { createDropdown } from "./ui/dropdown.js";
import { createPlayer } from "./ui/player.js";
import { createPresence } from "./ui/presence.js";
import { createShareGuide } from "./ui/share-guide.js";
import { showToast } from "./ui/toast.js";

const STATS_INTERVAL_MS = 2000;
const WARNING_MS = 9000;
const FALLBACK_ACCENT = "#5865f2";

const roomId = location.pathname.split("/").pop();
const canShare = Boolean(navigator.mediaDevices?.getDisplayMedia);
const canUseCamera = Boolean(navigator.mediaDevices?.getUserMedia);
const preferences = safeStorage(() => localStorage);
const tabStorage = safeStorage(() => sessionStorage);

const statusText = document.querySelector("#status");
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

const { iceServers, guild, accentColor } = await fetch(`/api/rooms/${roomId}`).then((response) => response.json());
showBranding(guild);
applyAccent(guild, accentColor);

// Daqui até registrar os handlers não pode ter `await`: as primeiras mensagens da sala chegam logo após conectar.
const signaling = connectRoom({ roomId, pass: takePass() });
const player = createPlayer(stage, { preferences });
const presence = createPresence();
const cameraStrip = createCameraStrip();
const cameras = createCameras({ signaling, createPeer, onChange: renderCameras });
const codecPreferences = hardwareFirstCodecs();
const qualityPickerControl = setupQualityPicker();
let idleScreen = "waiting";
let hostPeerId = null;
const shareGuide = createShareGuide({ stage, preferences, onContinue: startSharing, onCancel: () => showIdle(idleScreen) });

// Mensagens que valem para a página inteira, assistindo ou transmitindo.
signaling.on({
  welcome: ({ you }) => presence.setMe(you),
  presence: ({ people }) => {
    const host = presence.update(people);
    hostPeerId = host?.peerId ?? null;
    player.setHost(host);
    cameras.sync(people);
  },
  "room-closed": showRoomClosed,
});

let session = watch();

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
  session = broadcast(stream, quality);

  const warning = audioWarning(stream);
  if (warning) warn(warning);
}

function switchToWatching() {
  session.close();
  session = watch();
}

function watch() {
  let peer = null;
  let measure = null;
  showIdle("waiting");

  const statsTimer = setInterval(async () => {
    if (measure) player.setQuality(await measure(), DELAY_HINT);
  }, STATS_INTERVAL_MS);

  const stopListening = signaling.on({
    offer: async ({ description }) => {
      peer?.close();
      peer = createPeer((candidate) => signaling.send({ type: "candidate", candidate }));
      measure = createReceiveMeter(peer);
      peer.addEventListener("track", ({ streams: [stream] }) => {
        player.watch(stream);
        showControls("watching");
        renderCameras();
      });

      await peer.setRemoteDescription(description);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription({ type: "answer", sdp: withStereoOpus(answer.sdp) });
      signaling.send({ type: "answer", description: peer.localDescription });
    },
    candidate: ({ candidate }) => peer?.addIceCandidate(candidate),
    "host-left": () => {
      peer?.close();
      peer = null;
      measure = null;
      showIdle("ended");
    },
  });

  return {
    close() {
      clearInterval(statsTimer);
      stopListening();
      peer?.close();
    },
  };
}

function broadcast(stream, initialQuality) {
  const peers = new Map();
  const [videoTrack] = stream.getVideoTracks();
  let quality = initialQuality;
  let active = true;

  const refreshStatus = async () => {
    const sending = await sendingQuality([...peers.values()]);
    const watching = peers.size === 1 ? "1 pessoa assistindo" : `${peers.size} pessoas assistindo`;
    // Uma leitura que terminou depois do "Parar" não pode sobrescrever o status novo.
    if (!active) return;

    player.setQuality(sending?.label);
    showStatus([watching, sending && `${sending.label} ${sending.codec}`, sending?.hint].filter(Boolean).join(" · "));
  };
  const statsTimer = setInterval(refreshStatus, STATS_INTERVAL_MS);

  refreshStatus();
  player.preview(stream);
  showControls("broadcasting");
  videoTrack.contentHint = quality.contentHint;

  const stopListening = signaling.on({
    "viewer-joined": async ({ id }) => {
      const peer = createPeer((candidate) => signaling.send({ type: "candidate", to: id, candidate }));
      const transceiver = peer.addTransceiver(videoTrack, { direction: "sendonly", streams: [stream] });
      transceiver.setCodecPreferences(await codecPreferences);
      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
      peers.set(id, peer);
      refreshStatus();

      await peer.setLocalDescription();
      await tuneSender(transceiver.sender, quality);
      signaling.send({ type: "offer", to: id, description: peer.localDescription });
    },
    answer: ({ from, description }) => peers.get(from)?.setRemoteDescription(description),
    candidate: ({ from, candidate }) => peers.get(from)?.addIceCandidate(candidate),
    "viewer-left": ({ id }) => {
      peers.get(id)?.close();
      peers.delete(id);
      refreshStatus();
    },
    error: ({ message }) => {
      switchToWatching();
      showStatus(message);
    },
  });
  signaling.send({ type: "start-broadcast" });

  // Usuário clicou em "Parar de compartilhar" na barra do navegador.
  videoTrack.addEventListener("ended", switchToWatching);

  return {
    setQuality(preset) {
      quality = preset;
      const videoSenders = [...peers.values()].map((peer) => peer.getSenders().find((sender) => sender.track === videoTrack));
      applyQuality(preset, videoTrack, videoSenders).catch((error) => showStatus(`Não deu pra trocar a qualidade: ${error.message}`));
    },
    close() {
      active = false;
      clearInterval(statsTimer);
      stopListening();
      signaling.send({ type: "stop-broadcast" });
      stream.getTracks().forEach((track) => track.stop());
      peers.forEach((peer) => peer.close());
    },
  };
}

function createPeer(sendCandidate) {
  const peer = new RTCPeerConnection({ iceServers });
  peer.addEventListener("icecandidate", ({ candidate }) => {
    if (candidate) sendCandidate(candidate);
  });
  return peer;
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

  document.title = `${guild.name} · Transmissão`;
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
