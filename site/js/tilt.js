// Cartões com data-tilt inclinam na direção do mouse, como um objeto na mão.
const MAX_DEG = 7;

export function tilt(cards) {
  cards.forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const box = card.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - 0.5;
      const y = (event.clientY - box.top) / box.height - 0.5;
      card.style.setProperty("--ry", `${x * MAX_DEG * 2}deg`);
      card.style.setProperty("--rx", `${-y * MAX_DEG * 2}deg`);
      card.dataset.tilting = "";
    });
    card.addEventListener("pointerleave", () => {
      card.style.removeProperty("--rx");
      card.style.removeProperty("--ry");
      delete card.dataset.tilting;
    });
  });
}
