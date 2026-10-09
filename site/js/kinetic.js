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

  function render() {
    frame = null;
    letters.forEach((letter) => {
      const box = letter.getBoundingClientRect();
      const distance = pointer ? Math.hypot(pointer.x - (box.left + box.width / 2), pointer.y - (box.top + box.height / 2)) : Infinity;
      const pull = Math.max(0, 1 - distance / REACH_PX);
      letter.style.fontVariationSettings = `"wght" ${Math.round(HEAVY - (HEAVY - LIGHT) * pull)}`;
      letter.style.transform = `translateY(${-pull * 14}px)`;
    });
  }
}
