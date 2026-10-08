import { element } from "./dom.js";

// Mostra as câmeras: a de quem está transmitindo vira a "facecam" em bolinha sobre a tela;
// as outras ficam na faixa abaixo do palco. Reaproveita o <video> de cada pessoa para não piscar.
export function createCameraStrip() {
  const strip = document.querySelector("#cameras");
  const facecam = document.querySelector("#facecam");
  const tiles = new Map();

  return {
    render(cameras, { facecamPeerId }) {
      const visible = new Set(cameras.map((camera) => camera.peerId));
      [...tiles.keys()].filter((peerId) => !visible.has(peerId)).forEach((peerId) => {
        tiles.get(peerId).remove();
        tiles.delete(peerId);
      });

      cameras.forEach((camera) => {
        const tile = tiles.get(camera.peerId) ?? createTile(camera);
        tiles.set(camera.peerId, tile);
        tile.querySelector("figcaption").textContent = camera.self ? "Você" : camera.person.name;
        const video = tile.querySelector("video");
        if (video.srcObject !== camera.stream) video.srcObject = camera.stream;

        const target = camera.peerId === facecamPeerId ? facecam : strip;
        if (tile.parentElement !== target) target.append(tile);
      });

      strip.hidden = strip.children.length === 0;
      facecam.hidden = facecam.children.length === 0;
    },
  };
}

function createTile({ self }) {
  const video = element("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  const tile = element("figure", "camera-tile", video, element("figcaption"));
  tile.toggleAttribute("data-self", self);
  return tile;
}
