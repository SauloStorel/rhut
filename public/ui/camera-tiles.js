import { element, icon, setIcon } from "./dom.js";
import { fullscreenElement, onFullscreenChange, toggleFullscreen } from "./fullscreen.js";

// Cards das câmeras. Reaproveita o <video> de cada pessoa entre uma atualização e outra, para não piscar.
export function createCameraTiles() {
  const tiles = new Map(); // id do card → <figure>
  onFullscreenChange(() => tiles.forEach(syncFullscreenButton));

  return {
    // Recebe as câmeras (cameras.js) e devolve os cards para o layout, na mesma ordem.
    render(cameras) {
      const ids = new Set(cameras.map(tileId));
      [...tiles.keys()].filter((id) => !ids.has(id)).forEach((id) => {
        tiles.get(id).remove();
        tiles.delete(id);
      });
      return cameras.map((camera) => ({ id: tileId(camera), element: update(camera) }));
    },
  };

  function update(camera) {
    const tile = tiles.get(tileId(camera)) ?? create();
    tiles.set(tileId(camera), tile);
    tile.querySelector("figcaption").textContent = camera.self ? "Você" : camera.person.name;
    tile.toggleAttribute("data-mirrored", camera.mirrored);
    const video = tile.querySelector("video");
    if (video.srcObject !== camera.stream) video.srcObject = camera.stream;
    return tile;
  }

  function create() {
    const video = element("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    const fullscreen = element("button", "icon-button tile-fullscreen", icon("expand"));
    fullscreen.type = "button";
    fullscreen.title = "Tela cheia";
    fullscreen.setAttribute("aria-label", "Tela cheia");

    const tile = element("figure", "tile camera-tile", video, element("figcaption"), element("div", "tile-actions", fullscreen));
    const toggle = () => toggleFullscreen(tile, video);
    fullscreen.addEventListener("click", toggle);
    video.addEventListener("dblclick", toggle);
    return tile;
  }
}

function tileId(camera) {
  return `camera:${camera.peerId}`;
}

function syncFullscreenButton(tile) {
  const on = fullscreenElement() === tile;
  const button = tile.querySelector(".tile-fullscreen");
  const label = on ? "Sair da tela cheia" : "Tela cheia";
  setIcon(button.querySelector("svg"), on ? "shrink" : "expand");
  button.title = label;
  button.setAttribute("aria-label", label);
}
