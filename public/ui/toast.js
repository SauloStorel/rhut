import { element } from "./dom.js";

const DEFAULT_DURATION_MS = 4000;

/** @param {(Node | string)[]} children @param {{ tone?: string, duration?: number }} [options] */
export function showToast(children, { tone, duration = DEFAULT_DURATION_MS } = {}) {
  const item = element("li", "toast", ...children);
  if (tone) item.dataset.tone = tone;
  document.getElementById("toasts").append(item);

  setTimeout(() => {
    item.setAttribute("data-leaving", "");
    item.addEventListener("animationend", () => item.remove(), { once: true });
  }, duration);
}
