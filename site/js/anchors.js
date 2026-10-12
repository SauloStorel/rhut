// Links do menu rolam até a seção sem colocar "#secao" na URL. Param no título da seção, e não na borda dela,
// que tem um respiro grande em cima: senão o título fica no meio da tela e parece que o link parou antes.
// O href continua no HTML, então sem JS o link ainda funciona, parando na borda da seção.
export function scrollWithoutHash() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    const target = link && document.querySelector(link.getAttribute("href"));
    if (!target) return;

    event.preventDefault();
    // O título é o que a seção declara em aria-labelledby; o que não tem (o topo da página) rola até ele mesmo.
    const heading = document.getElementById(target.getAttribute("aria-labelledby")) ?? target;
    scrollTo({ top: layoutTop(heading) - stopOffset(heading) });
  });
}

// Posição pelo layout, sem as animações de entrada: antes de aparecer na tela, o título ainda está deslocado
// para baixo, e medir com o deslocamento faria a rolagem passar do ponto.
function layoutTop(element) {
  let top = 0;
  for (let node = element; node; node = node.offsetParent) top += node.offsetTop;
  return top;
}

// Altura da barra do topo (scroll-padding-top) mais o respiro do título (scroll-margin-top), como estão no CSS.
function stopOffset(element) {
  const pixels = (value) => parseFloat(value) || 0;
  return pixels(getComputedStyle(document.documentElement).scrollPaddingTop) + pixels(getComputedStyle(element).scrollMarginTop);
}
