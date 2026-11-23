import { element, icon, setIcon } from "./dom.js";
import { fullscreenElement, onFullscreenChange, toggleFullscreen } from "./fullscreen.js";

export const SCREEN = "screen";
const TILE_RATIO = 16 / 9;
const GAP_PX = 10;

// Organiza a sala como uma chamada do Discord: a tela transmitida e as câmeras são "cards".
// - Grade: todos do mesmo tamanho, divididos conforme o espaço.
// - Foco: clicar num card deixa ele grande e manda os outros para a barra de baixo.
// Os elementos mudam de lugar (palco ↔ barra) sem ser recriados, para o vídeo não piscar.
export function createCallLayout({ isStageOptional, onChange }) {
  const main = document.querySelector(".stage-area");
  const bar = document.querySelector("#cameras");
  const stage = document.querySelector("#stage");
  const tiles = new Map(); // peerId → card da câmera
  let focused = null;
  let cameras = [];

  stage.addEventListener("click", (event) => focusOnClick(event, SCREEN));
  new ResizeObserver(arrange).observe(main);
  onFullscreenChange(() => tiles.forEach(syncFullscreenButton));

  return {
    render(nextCameras) {
      cameras = nextCameras;
      removeGoneTiles();
      cameras.forEach(updateTile);
      place();
    },

    focus(id) {
      focused = id;
      place();
    },

    showGrid() {
      focused = null;
      place();
    },

    isFocused: () => main.dataset.layout === "focus",
  };

  // O palco só fica de fora quando não tem nada a mostrar (ninguém transmitindo) e há câmeras para ver.
  function showsStage() {
    return !isStageOptional() || cameras.length === 0;
  }

  function cardIds() {
    return [...(showsStage() ? [SCREEN] : []), ...cameras.map((camera) => camera.peerId)];
  }

  function place() {
    const ids = cardIds();
    if (!ids.includes(focused)) focused = null;
    const focusing = focused !== null && ids.length > 1;

    stage.hidden = !showsStage();
    ids.forEach((id) => {
      const target = !focusing || id === focused ? main : bar;
      const tile = id === SCREEN ? stage : tiles.get(id);
      if (tile.parentElement !== target) target.append(tile);
    });

    main.dataset.layout = focusing ? "focus" : "grid";
    bar.hidden = bar.children.length === 0;
    arrange();
    onChange();
  }

  function arrange() {
    const count = [...main.children].filter((child) => child.matches(".stage:not([hidden]), .camera-tile")).length;
    main.style.setProperty("--cols", bestColumns(count, main.clientWidth, main.clientHeight));
  }

  function removeGoneTiles() {
    const visible = new Set(cameras.map((camera) => camera.peerId));
    [...tiles.keys()].filter((peerId) => !visible.has(peerId)).forEach((peerId) => {
      tiles.get(peerId).remove();
      tiles.delete(peerId);
    });
  }

  function updateTile(camera) {
    const tile = tiles.get(camera.peerId) ?? createTile(camera.peerId);
    tiles.set(camera.peerId, tile);
    tile.querySelector("figcaption").textContent = camera.self ? "Você" : camera.person.name;
    tile.toggleAttribute("data-mirrored", camera.mirrored);
    const video = tile.querySelector("video");
    if (video.srcObject !== camera.stream) video.srcObject = camera.stream;
  }

  function createTile(peerId) {
    const video = element("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    const fullscreen = tileButton("tile-fullscreen", "expand", "Tela cheia");

    const tile = element("figure", "camera-tile", video, element("figcaption"), element("div", "tile-actions", fullscreen));
    const toggle = () => toggleFullscreen(tile, video);
    fullscreen.addEventListener("click", toggle);
    video.addEventListener("dblclick", toggle);
    tile.addEventListener("click", (event) => focusOnClick(event, peerId));
    return tile;
  }

  // Clicar num card que não está em foco traz ele para o foco; botões e controles do card não contam,
  // nem o card que está sozinho (ele já ocupa tudo).
  function focusOnClick(event, id) {
    if (event.target.closest("button, input, .guide") || focused === id || cardIds().length < 2) return;
    focused = id;
    place();
  }
}

// A divisão em colunas que deixa os cards (16:9) maiores no espaço disponível:
// em tela larga fica lado a lado, em tela de celular (alta) empilha.
function bestColumns(count, width, height) {
  const area = (cols) => {
    const rows = Math.ceil(count / cols);
    const cellWidth = (width - GAP_PX * (cols - 1)) / cols;
    const cellHeight = (height - GAP_PX * (rows - 1)) / rows;
    return Math.min(cellWidth, cellHeight * TILE_RATIO) ** 2;
  };
  const options = Array.from({ length: count }, (_, index) => index + 1);
  return options.reduce((best, cols) => (area(cols) > area(best) ? cols : best), 1);
}

function tileButton(className, iconName, label) {
  const button = element("button", `icon-button ${className}`, icon(iconName));
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  return button;
}

function syncFullscreenButton(tile) {
  const on = fullscreenElement() === tile;
  const button = tile.querySelector(".tile-fullscreen");
  const label = on ? "Sair da tela cheia" : "Tela cheia";
  setIcon(button.querySelector("svg"), on ? "shrink" : "expand");
  button.title = label;
  button.setAttribute("aria-label", label);
}
