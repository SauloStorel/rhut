// Etapas do "Como funciona": cada uma "edita" o aviso do Discord, como o bot faz de verdade.
// Avançam sozinhas enquanto a seção está na tela; param com o mouse ou o foco em cima, e sem animação
// para quem pediu menos movimento.
const STEP_MS = 5200;
const KEY_STEPS = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

const flow = document.querySelector(".flow");
const flowInner = flow.querySelector(".flow-inner");
const discord = document.querySelector("#discord");
const tabs = [...flow.querySelectorAll('[role="tab"]')];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

flow.style.setProperty("--step-ms", `${STEP_MS}ms`);

function select(tab) {
  const state = tab.dataset.step;
  discord.dataset.state = state;
  discord.setAttribute("aria-labelledby", tab.id);
  discord.querySelectorAll("[data-for]").forEach((part) => (part.hidden = !part.dataset.for.split(" ").includes(state)));
  tabs.forEach((other) => {
    other.setAttribute("aria-selected", String(other === tab));
    other.tabIndex = other === tab ? 0 : -1;
  });
}

function neighbor(tab, step) {
  return tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => select(tab));
  tab.querySelector(".step-progress span").addEventListener("animationend", () => select(neighbor(tab, 1)));
});

flow.querySelector('[role="tablist"]').addEventListener("keydown", (event) => {
  const step = KEY_STEPS[event.key];
  if (!step) return;

  event.preventDefault();
  const next = neighbor(document.activeElement, step);
  select(next);
  next.focus();
});

const pause = (paused) => () => flow.toggleAttribute("data-paused", paused);
flowInner.addEventListener("pointerenter", pause(true));
flowInner.addEventListener("pointerleave", pause(false));
flowInner.addEventListener("focusin", pause(true));
flowInner.addEventListener("focusout", pause(false));

new IntersectionObserver(([entry]) => flow.toggleAttribute("data-playing", entry.isIntersecting && !reduceMotion), {
  threshold: 0.4,
}).observe(flow);

document.querySelectorAll("[data-copy]").forEach((button) => {
  const label = button.querySelector("span");

  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.previousElementSibling.textContent);
    button.toggleAttribute("data-copied", true);
    label.textContent = "Copiado";
    setTimeout(() => {
      button.removeAttribute("data-copied");
      label.textContent = "Copiar";
    }, 1800);
  });
});
