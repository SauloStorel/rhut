// Camadas com data-depth seguem o mouse com inércia; profundidade negativa anda ao contrário.
const RANGE_PX = 36;
const EASE = 0.08;

export function parallax(root) {
  const layers = [...root.querySelectorAll("[data-depth]")];
  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  let frame = null;

  root.addEventListener("pointermove", (event) => {
    const box = root.getBoundingClientRect();
    target.x = (event.clientX - box.left) / box.width - 0.5;
    target.y = (event.clientY - box.top) / box.height - 0.5;
    request();
  });
  root.addEventListener("pointerleave", () => {
    target.x = target.y = 0;
    request();
  });

  function request() {
    frame ??= requestAnimationFrame(step);
  }

  function step() {
    frame = null;
    current.x += (target.x - current.x) * EASE;
    current.y += (target.y - current.y) * EASE;
    layers.forEach((layer) => {
      const depth = Number(layer.dataset.depth);
      layer.style.transform = `translate3d(${current.x * depth * RANGE_PX}px, ${current.y * depth * RANGE_PX}px, 0) rotate(${current.x * depth * 5}deg)`;
    });
    if (Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.001) request();
  }
}
