// Botões principais puxam levemente na direção do cursor.
const PULL = 0.28;

export function magnetic(buttons) {
  buttons.forEach((button) => {
    button.addEventListener("pointermove", (event) => {
      const box = button.getBoundingClientRect();
      const x = (event.clientX - box.left - box.width / 2) * PULL;
      const y = (event.clientY - box.top - box.height / 2) * PULL;
      button.style.translate = `${x}px ${y}px`;
    });
    button.addEventListener("pointerleave", () => (button.style.translate = ""));
  });
}
