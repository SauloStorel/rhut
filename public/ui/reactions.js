import { element } from "./dom.js";

// A mesma lista que a sala aceita (src/room.ts).
const REACTIONS = ["👏", "😂", "🔥", "😮", "❤️", "💀"];

// Reações rápidas: o botão do dock abre a fileira de emojis, e cada reação sobe pelo palco de todo mundo com o
// nome de quem mandou. Dá para mandar várias seguidas; a fileira fecha ao clicar fora ou com Esc.
export function createReactions({ signaling, nameOf }) {
  const trigger = document.querySelector("#reactions-trigger");
  const tray = document.querySelector("#reactions-tray");
  const layer = document.querySelector("#reactions-layer");

  tray.replaceChildren(...REACTIONS.map(reactionButton));
  trigger.addEventListener("click", () => setOpen(tray.hidden));
  document.addEventListener("click", (event) => {
    if (!tray.hidden && !event.target.closest("#reactions")) setOpen(false);
  });
  tray.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setOpen(false);
    trigger.focus();
  });

  signaling.on({ reaction: ({ emoji, peerId }) => float(emoji, nameOf(peerId)) });

  function reactionButton(emoji) {
    const button = element("button", "reaction-option", emoji);
    button.type = "button";
    button.setAttribute("aria-label", `Reagir com ${emoji}`);
    button.addEventListener("click", () => signaling.send({ type: "reaction", emoji }));
    return button;
  }

  function setOpen(open) {
    tray.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  }

  // Cada reação nasce num ponto diferente da base do palco, para várias seguidas não se empilharem.
  function float(emoji, name) {
    const reaction = element("span", "reaction", element("span", "reaction-emoji", emoji), element("span", "reaction-name", name));
    reaction.style.setProperty("--x", `${10 + Math.random() * 80}%`);
    reaction.addEventListener("animationend", () => reaction.remove(), { once: true });
    layer.append(reaction);
  }
}
