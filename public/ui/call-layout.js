const TILE_RATIO = 16 / 9;
const GAP_PX = 10;

// Organiza a sala como uma chamada do Discord: telas transmitidas, câmeras e o card de aviso são "cards".
// - Grade: todos do mesmo tamanho, divididos conforme o espaço.
// - Foco: clicar num card deixa ele grande e manda os outros para a barra de baixo.
// Os elementos mudam de lugar (palco ↔ barra) sem ser recriados, para o vídeo não piscar.
export function createCallLayout({ onChange }) {
  const main = document.querySelector(".stage-area");
  const bar = document.querySelector("#cameras");
  const clickable = new WeakSet();
  let tiles = []; // { id, element }, na ordem em que aparecem
  let focused = null;

  new ResizeObserver(arrange).observe(main);

  return {
    render(nextTiles) {
      tiles = nextTiles;
      tiles.filter(({ element }) => !clickable.has(element)).forEach(listenForFocus);
      place();
    },

    focus(id) {
      focused = id;
      place();
    },

    showGrid() {
      focused = null;
      place();
    },

    isFocused: () => main.dataset.layout === "focus",

    // O card que está sozinho no palco (em foco, ou o único da grade), ou null.
    soloId() {
      const inMain = tiles.filter(({ element }) => element.parentElement === main);
      return inMain.length === 1 ? inMain[0].id : null;
    },
  };

  function place() {
    if (!tiles.some(({ id }) => id === focused)) focused = null;
    const focusing = focused !== null && tiles.length > 1;
    const inMain = tiles.filter(({ id }) => !focusing || id === focused);
    const inBar = tiles.filter(({ id }) => focusing && id !== focused);

    // Card que saiu da lista (a pessoa parou de transmitir, o aviso não é mais necessário) sai da tela.
    const current = new Set(tiles.map(({ element }) => element));
    [...main.querySelectorAll(":scope > .tile"), ...bar.children].filter((child) => !current.has(child)).forEach((child) => child.remove());
    putInOrder(main, inMain);
    putInOrder(bar, inBar);

    main.dataset.layout = focusing ? "focus" : "grid";
    bar.hidden = inBar.length === 0;
    arrange();
    onChange();
  }

  function arrange() {
    const count = main.querySelectorAll(":scope > .tile").length;
    main.style.setProperty("--cols", bestColumns(count, main.clientWidth, main.clientHeight));
  }

  // Clicar num card que não está em foco traz ele para o foco; botões e controles do card não contam,
  // nem o card que está sozinho (ele já ocupa tudo).
  function listenForFocus({ element }) {
    clickable.add(element);
    element.addEventListener("click", (event) => {
      const id = tiles.find((tile) => tile.element === element)?.id;
      if (event.target.closest("button, input, a, .guide") || id === undefined || focused === id || tiles.length < 2) return;
      focused = id;
      place();
    });
  }
}

// Move só o que está fora do lugar: mover um <video> já tocando não o reinicia, mas não precisa.
function putInOrder(container, tiles) {
  const ordered = tiles.map(({ element }) => element);
  const placed = [...container.querySelectorAll(":scope > .tile")];
  if (ordered.length === placed.length && ordered.every((element, index) => placed[index] === element)) return;
  container.append(...ordered);
}

// A divisão em colunas que deixa os cards (16:9) maiores no espaço disponível:
// em tela larga fica lado a lado, em tela de celular (alta) empilha.
function bestColumns(count, width, height) {
  const area = (cols) => {
    const rows = Math.ceil(count / cols);
    const cellWidth = (width - GAP_PX * (cols - 1)) / cols;
    const cellHeight = (height - GAP_PX * (rows - 1)) / rows;
    return Math.min(cellWidth, cellHeight * TILE_RATIO) ** 2;
  };
  const options = Array.from({ length: Math.max(count, 1) }, (_, index) => index + 1);
  return options.reduce((best, cols) => (area(cols) > area(best) ? cols : best), 1);
}
