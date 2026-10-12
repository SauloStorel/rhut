// Cada letra do "/live" muda de peso conforme o cursor chega perto (a Onest é variável, de 400 a 800).
const HEAVY = 800;
const LIGHT = 400;
const REACH_PX = 260;

export function kinetic(title, area) {
  const text = title.textContent;
  title.setAttribute("aria-label", text);
  const letters = [...text].map((char) => {
    const letter = document.createElement("span");
    letter.textContent = char;
    letter.setAttribute("aria-hidden", "true");
    return letter;
  });
  title.replaceChildren(...letters);

  let pointer = null;
  let frame = null;

  area.addEventListener("pointermove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    frame ??= requestAnimationFrame(render);
  });
  area.addEventListener("pointerleave", () => {
    pointer = null;
    frame ??= requestAnimationFrame(render);
  });

  // Lê a posição de todas as letras antes de mexer em qualquer uma: ler depois de escrever obrigaria o navegador
  // a recalcular o layout a cada letra.
  function render() {
    frame = null;
    const pulls = letters.map((letter) => {
      const box = letter.getBoundingClientRect();
      const distance = pointer ? Math.hypot(pointer.x - (box.left + box.width / 2), pointer.y - (box.top + box.height / 2)) : Infinity;
      return Math.max(0, 1 - distance / REACH_PX);
    });
    letters.forEach((letter, index) => {
      letter.style.fontVariationSettings = `"wght" ${Math.round(HEAVY - (HEAVY - LIGHT) * pulls[index])}`;
      letter.style.transform = `translateY(${-pulls[index] * 14}px)`;
    });
  }
}
