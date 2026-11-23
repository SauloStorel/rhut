import { accentFromIcon, inkFor } from "./accent.js";

const FALLBACK_ACCENT = "#5865f2";

// Nome e ícone do servidor na página.
export function showBranding(guild) {
  if (!guild) return;

  document.title = `${guild.name} · rhut`;
  document.querySelector("#brand-name").textContent = guild.name;
  if (!guild.iconUrl) return;

  // Só troca o ícone padrão pelo do servidor depois que a imagem carregar de verdade.
  // (SVG não tem a propriedade `hidden` do HTML, então os fallbacks usam o atributo.)
  const serverIcons = document.querySelectorAll(".server-icon");
  serverIcons[0].addEventListener("load", () => {
    serverIcons.forEach((serverIcon) => (serverIcon.hidden = false));
    document.querySelectorAll(".brand-fallback").forEach((fallback) => fallback.setAttribute("hidden", ""));
  });
  serverIcons.forEach((serverIcon) => (serverIcon.src = guild.iconUrl));
}

// ACCENT_COLOR "auto" tira a cor do ícone do servidor; um hex fixo (ex: "#e5242b") manda.
export async function applyAccent(guild, accentColor) {
  const fromIcon = accentColor === "auto" && guild?.iconUrl ? await accentFromIcon(guild.iconUrl) : null;
  const accent = fromIcon ?? (accentColor === "auto" ? FALLBACK_ACCENT : accentColor);
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent-ink", inkFor(accent));
}
