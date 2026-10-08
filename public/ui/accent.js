// Cor de destaque tirada do ícone do servidor: agrupa os pixels coloridos por matiz e fica com a faixa
// de mais peso (quantidade × saturação). Depois ajusta o brilho para funcionar em botão sobre fundo escuro.
const SIZE = 32;
const HUE_BUCKETS = 12;

export async function accentFromIcon(url) {
  const pixels = await readPixels(url).catch(() => null);
  if (!pixels) return null;

  const buckets = Array.from({ length: HUE_BUCKETS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, alpha] = pixels.subarray(i, i + 4);
    const { h, s, l } = toHsl(r, g, b);
    if (alpha < 128 || s < 0.25 || l < 0.12 || l > 0.92) continue;

    const bucket = buckets[Math.floor(h * HUE_BUCKETS) % HUE_BUCKETS];
    bucket.weight += s;
    bucket.r += r * s;
    bucket.g += g * s;
    bucket.b += b * s;
  }

  const best = buckets.toSorted((a, b) => b.weight - a.weight)[0];
  if (best.weight === 0) return null;

  const { h, s, l } = toHsl(best.r / best.weight, best.g / best.weight, best.b / best.weight);
  return toHex(h, Math.min(Math.max(s, 0.55), 0.85), Math.min(Math.max(l, 0.48), 0.62));
}

// Texto preto ou branco, o que tiver mais contraste com a cor.
export function inkFor(hex) {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.36 ? "#111214" : "#ffffff";
}

async function readPixels(url) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, SIZE, SIZE);
  return context.getImageData(0, 0, SIZE, SIZE).data;
}

function toHsl(r, g, b) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };

  const s = d / (1 - Math.abs(2 * l - 1));
  const hues = { [red]: (green - blue) / d + (green < blue ? 6 : 0), [green]: (blue - red) / d + 2, [blue]: (red - green) / d + 4 };
  return { h: hues[max] / 6, s, l };
}

function toHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h * 12) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255);
  };
  return `#${[0, 8, 4].map((n) => channel(n).toString(16).padStart(2, "0")).join("")}`;
}
