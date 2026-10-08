const SVG_NS = "http://www.w3.org/2000/svg";

export function icon(name, className = "icon") {
  const svg = document.createElementNS(SVG_NS, "svg");
  const use = document.createElementNS(SVG_NS, "use");
  svg.setAttribute("class", className);
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

export function setIcon(svg, name) {
  svg.querySelector("use").setAttribute("href", `#i-${name}`);
}

export function element(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
}

// Foto do Discord quando tem; sem foto (convidado), a inicial do nome.
export function avatar({ name, avatarUrl }, className = "avatar") {
  if (!avatarUrl) return element("span", className, name.slice(0, 1).toUpperCase());

  const image = element("img", className);
  image.src = avatarUrl;
  image.alt = "";
  return image;
}
