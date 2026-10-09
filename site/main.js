import { setupCopyButtons } from "./js/copy.js";
import { kinetic } from "./js/kinetic.js";
import { magnetic } from "./js/magnetic.js";
import { setupMiniRoom } from "./js/mini-room.js";
import { parallax } from "./js/parallax.js";
import { playArrivals } from "./js/presence.js";
import { tilt } from "./js/tilt.js";

// O que funciona para todo mundo: controles da mini sala e copiar comandos.
setupMiniRoom(document.querySelector("#mini-room"));
setupCopyButtons();

// Movimento é extra: some para quem pediu menos movimento, e o que segue o mouse só vale com mouse.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = matchMedia("(pointer: fine)").matches;

if (!reduceMotion) playArrivals();

if (!reduceMotion && finePointer) {
  parallax(document.querySelector("#hero-stage"));
  tilt(document.querySelectorAll("[data-tilt]"));
  kinetic(document.querySelector("[data-kinetic]"), document.querySelector(".command"));
  magnetic(document.querySelectorAll(".button-solid, .button-ink"));
}
