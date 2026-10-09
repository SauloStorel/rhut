// Links do menu rolam até a seção sem colocar "#secao" na URL.
// O href continua no HTML, então sem JS o link ainda funciona do jeito normal.
export function scrollWithoutHash() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    const target = link && document.querySelector(link.getAttribute("href"));
    if (!target) return;

    event.preventDefault();
    target.scrollIntoView();
  });
}
