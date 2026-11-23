// Página da sala. Até 4 pessoas transmitem a tela ao mesmo tempo, cada uma num card; quem quiser assistir escolhe
// a tela, e qualquer um pode ligar a câmera. As telas vão em P2P (uma cópia para cada pessoa assistindo) ou pelo
// SFU do Cloudflare Realtime, quando configurado (uma cópia só). Uma conexão só com a sala troca a "apresentação"
// WebRTC e avisa quem está lá. Este arquivo monta as peças e liga os controles.

import { audioWarning, captureScreen } from "./capture.js";
import { createCameras } from "./cameras.js";
import { hardwareFirstCodecs } from "./codecs.js";
import { createPeer } from "./peer.js";
import { DEFAULT_QUALITY, QUALITY_PRESETS } from "./quality.js";
import { resumeToken, takePass } from "./room-tokens.js";
import { createP2PScreens } from "./screen-p2p.js";
import { createSfuScreens } from "./screen-sfu.js";
import { OWN_SCREEN, createScreens } from "./screens.js";
import { share } from "./share.js";
import { connectRoom } from "./signaling.js";
import { safeStorage } from "./storage.js";
import { createAmbient } from "./ui/ambient.js";
import { applyAccent, showBranding } from "./ui/branding.js";
import { createCallLayout } from "./ui/call-layout.js";
import { createCameraTiles } from "./ui/camera-tiles.js";
import { icon, setIcon } from "./ui/dom.js";
import { createDropdown } from "./ui/dropdown.js";
import { createPresence } from "./ui/presence.js";
import { createReactions } from "./ui/reactions.js";
import { createShareGuide } from "./ui/share-guide.js";
import { showToast } from "./ui/toast.js";

const WARNING_MS = 9000;
const CLOSE_TAB_DELAY_MS = 3000;
const STAGE = "stage";
// Sem a configuração da sala (rede instável, erro no servidor) a página ainda funciona: sem a marca do servidor, só com STUN e em P2P.
const FALLBACK_CONFIG = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], guild: null, accentColor: "auto", sfu: false };

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
const flipButton = document.querySelector("#camera-flip");
const gridButton = document.querySelector("#grid-toggle");
const qualityPicker = document.querySelector("#quality-picker");
const reactionsControl = document.querySelector("#reactions");
const dock = document.querySelector("#dock");
const stage = document.querySelector("#stage");

const SHARE_INVITE = canShare ? " Para transmitir, escolha a qualidade e clique em Compartilhar tela." : "";

// O card de aviso: aparece quando não tem nenhum outro card (ninguém transmitindo nem com câmera), no passo antes
// de compartilhar e com a sala encerrada.
const MESSAGES = {
  waiting: { title: "Ninguém está transmitindo ainda", hint: `Quando alguém compartilhar a tela, o convite para assistir aparece aqui.${SHARE_INVITE}`, pulse: true },
  closed: { title: "Sala encerrada", hint: "Abra outra com /live no Discord.", pulse: false },
  closing: { title: "Sala encerrada", hint: "Esta aba fecha sozinha em instantes.", pulse: false },
};

// Os controles do dock em cada momento da página.
const CONTROLS = {
  idle: { share: canShare, quality: canShare, stop: false, camera: canUseCamera, reactions: true },
  guide: { share: false, quality: true, stop: false, camera: false, reactions: false },
  sharing: { share: false, quality: true, stop: true, camera: canUseCamera, reactions: true },
  closed: { share: false, quality: false, stop: false, camera: false, reactions: false },
};

const config = await fetch(`/api/rooms/${roomId}`)
  .then((response) => (response.ok ? response.json() : FALLBACK_CONFIG))
  .catch(() => FALLBACK_CONFIG);
showBranding(config.guild);
applyAccent(config.guild, config.accentColor);

let mode = "idle";
let myPeerId = null;
let me = null;
let sfuPass = null;
let people = [];
let sharing = null;

// Daqui até registrar os handlers não pode ter `await`: as primeiras mensagens da sala chegam logo após conectar.
const signaling = connectRoom({ roomId, pass: takePass(roomId, tabStorage), resume: resumeToken(roomId, tabStorage), onStatus: (status) => (connectionBadge.hidden = status !== "reconnecting") });
const newPeer = (sendCandidate) => createPeer(config.iceServers, sendCandidate);
const codecPreferences = hardwareFirstCodecs();
const transport = config.sfu
  ? createSfuScreens({ roomId, sfuPass: () => sfuPass, iceServers: config.iceServers, codecPreferences })
  : createP2PScreens({ signaling, createPeer: newPeer, codecPreferences });
const layout = createCallLayout({ onChange: syncWithLayout });
const screens = createScreens({
  transport,
  ambient: createAmbient(document.querySelector("#ambient")),
  preferences,
  onChange: renderCall,
  // Como no Discord: a tela ganha o foco ao começar a assistir, e parar volta para a grade.
  onWatch: (id) => layout.focus(id),
  onStopWatching: () => layout.showGrid(),
});
const cameraTiles = createCameraTiles();
const cameras = createCameras({ signaling, createPeer: newPeer, onChange: renderCall });
const presence = createPresence();
const qualityPickerControl = setupQualityPicker();
const shareGuide = createShareGuide({ stage, preferences, onContinue: startSharing, onCancel: closeGuide });
createReactions({ signaling, nameOf: (peerId) => people.find((person) => person.peerId === peerId)?.name ?? "Alguém" });

signaling.on({
  welcome: ({ you, peerId, resumed, sfuPass: pass }) => {
    myPeerId = peerId;
    me = you;
    sfuPass = pass;
    presence.setMe(you);
    // Voltou depois de recarregar a página: a transmissão de antes acabou junto com a página anterior.
    if (resumed && !sharing) signaling.send({ type: "share", on: false });
  },
  presence: ({ people: next }) => {
    people = next;
    presence.update(people);
    screens.sync(people.filter((person) => person.sharing && person.peerId !== myPeerId));
    cameras.sync(people);
    sharing?.sync(people);
  },
  "room-closed": showRoomClosed,
});

showMessage("waiting");
setMode("idle");

// O guia e a própria tela ganham o foco: quem transmite vê o que está mandando em destaque.
shareButton.addEventListener("click", () => {
  if (!shareGuide.open()) return startSharing();

  setMode("guide");
  layout.focus(STAGE);
});

stopButton.addEventListener("click", stopSharing);
gridButton.addEventListener("click", () => layout.showGrid());
flipButton.addEventListener("click", () => cameras.flip().catch((error) => warn(`Não deu para virar a câmera: ${cameraError(error)}`)));

cameraButton.addEventListener("click", async () => {
  if (cameras.isOn()) return cameras.turnOff();

  await cameras.turnOn().catch((error) => warn(`Não deu para ligar a câmera: ${cameraError(error)}`));
});

async function startSharing() {
  const quality = QUALITY_PRESETS[qualityPickerControl.value()];
  const stream = await captureScreen(quality).catch(() => null);
  closeGuide();
  if (!stream) return;

  sharing = share(stream, quality, {
    transport,
    signaling,
    onStatus: showStatus,
    onQuality: (label) => screens.setOwnQuality(label),
    onStop: stopSharing,
    onRefused: (message) => {
      stopSharing();
      warn(message);
    },
  });
  screens.showOwn(stream, me);
  setMode("sharing");
  layout.focus(OWN_SCREEN);

  const warning = audioWarning(stream);
  if (warning) warn(warning);
}

function stopSharing() {
  sharing?.close();
  sharing = null;
  screens.hideOwn();
  showStatus("");
  setMode("idle");
}

function closeGuide() {
  shareGuide.close();
  setMode(sharing ? "sharing" : "idle");
}

// Telas primeiro, depois câmeras; o card de aviso só quando não tem mais nada a mostrar (ou no guia e na sala encerrada).
function renderCall() {
  const tiles = [...screens.tiles(), ...cameraTiles.render(cameras.tiles())];
  const showsStage = mode === "guide" || mode === "closed" || tiles.length === 0;
  layout.render([...(showsStage ? [{ id: STAGE, element: stage }] : []), ...tiles]);

  const on = cameras.isOn();
  cameraButton.setAttribute("aria-pressed", String(on));
  cameraButton.setAttribute("aria-label", on ? "Desligar câmera" : "Ligar câmera");
  setIcon(cameraButton.querySelector("svg"), on ? "camera-off" : "camera");
}

// "Ver todos" volta para a grade quando algum card está em foco; o modo ambiente segue a tela sozinha no palco.
function syncWithLayout() {
  gridButton.hidden = !layout.isFocused();
  flipButton.hidden = cameraButton.hidden || !cameras.canFlip();
  dock.hidden = [shareButton, qualityPicker, stopButton, cameraButton, flipButton, gridButton, reactionsControl].every((control) => control.hidden);
  screens.followAmbient(layout.soloId());
}

function setMode(next) {
  const { share: canStart, quality, stop, camera, reactions } = CONTROLS[next];
  mode = next;
  shareButton.hidden = !canStart;
  qualityPicker.hidden = !quality;
  stopButton.hidden = !stop;
  cameraButton.hidden = !camera;
  reactionsControl.hidden = !reactions;
  renderCall();
}

function showMessage(name) {
  const { title, hint, pulse } = MESSAGES[name];
  stage.querySelector(".idle").toggleAttribute("data-pulse", pulse);
  document.querySelector("#idle-title").textContent = title;
  document.querySelector("#idle-hint").textContent = hint;
}

// Sala fechada pelo Discord (botão "Fechar sala") ou por ficar vazia: não tem mais o que fazer aqui.
// Quem estava na sala tem a aba fechada; quem abriu o link de uma sala já encerrada só vê o aviso.
function showRoomClosed() {
  sharing?.close();
  sharing = null;
  screens.closeAll();
  if (cameras.isOn()) cameras.turnOff();
  showStatus("");
  shareGuide.close();
  showMessage(myPeerId ? "closing" : "closed");
  setMode("closed");
  if (myPeerId) setTimeout(closeTab, CLOSE_TAB_DELAY_MS);
}

// O navegador só deixa fechar a aba aberta por um link que não navegou depois (voltar do login do Discord conta
// como navegar). Quando recusa, a aba continua aberta mostrando a sala encerrada.
function closeTab() {
  window.close();
  setTimeout(() => showMessage("closed"), CLOSE_TAB_DELAY_MS);
}

function setupQualityPicker() {
  const saved = preferences.get("quality");
  const showCurrent = (key) => {
    document.querySelector("#quality-name").textContent = QUALITY_PRESETS[key].name;
    document.querySelector("#quality-bitrate").textContent = `${QUALITY_PRESETS[key].bitrate} por ${config.sfu ? "transmissão" : "pessoa"}`;
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
      sharing?.setQuality(QUALITY_PRESETS[key]);
    },
  });
  showCurrent(current);

  return { value: () => current };
}

const CAMERA_ERRORS = {
  NotAllowedError: "o navegador não deu permissão. Libere a câmera no cadeado da barra de endereço.",
  NotFoundError: "nenhuma câmera encontrada.",
  NotReadableError: "a câmera está em uso por outro programa.",
  OverconstrainedError: "este aparelho não tem outra câmera.",
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
