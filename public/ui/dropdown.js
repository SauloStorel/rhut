import { element, icon } from "./dom.js";

// Seletor no padrão "listbox" da WAI-ARIA: abre por clique ou setas, navega com setas/Home/End,
// escolhe com Enter/Espaço e fecha com Esc, Tab ou clique fora.
export function createDropdown({ trigger, list, options, initial, onChange }) {
  let selected = initial;
  let active = initial;

  const items = new Map(options.map((option) => [option.value, renderOption(option)]));
  list.append(...items.values());

  const indexOf = (value) => options.findIndex((option) => option.value === value);
  const move = (step) => setActive(options[(indexOf(active) + step + options.length) % options.length].value);

  const listKeys = {
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    Home: () => setActive(options[0].value),
    End: () => setActive(options.at(-1).value),
    Enter: () => choose(active),
    " ": () => choose(active),
    Escape: () => close({ focusTrigger: true }),
  };

  trigger.addEventListener("click", () => (list.hidden ? open() : close()));
  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    open();
  });

  list.addEventListener("keydown", (event) => {
    if (event.key === "Tab") return close();
    const action = listKeys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  });

  list.addEventListener("pointermove", (event) => {
    const item = event.target.closest("[role=option]");
    if (item) setActive(item.dataset.value);
  });
  list.addEventListener("click", (event) => {
    const item = event.target.closest("[role=option]");
    if (item) choose(item.dataset.value);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!list.hidden && !trigger.parentElement.contains(event.target)) close();
  });

  render();

  function open() {
    list.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    setActive(selected);
    list.focus();
  }

  function close({ focusTrigger = false } = {}) {
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (focusTrigger) trigger.focus();
  }

  function choose(value) {
    const changed = value !== selected;
    selected = value;
    render();
    close({ focusTrigger: true });
    if (changed) onChange(value);
  }

  function setActive(value) {
    active = value;
    items.forEach((item, key) => item.toggleAttribute("data-active", key === value));
    list.setAttribute("aria-activedescendant", items.get(value).id);
    items.get(value).scrollIntoView({ block: "nearest" });
  }

  function render() {
    items.forEach((item, key) => item.setAttribute("aria-selected", String(key === selected)));
  }

  function renderOption({ value, name, detail, aside }) {
    const item = element(
      "li",
      "quality-option",
      element("span", "quality-option-name", name),
      element("span", "quality-option-detail", `${detail} · `, element("span", "quality-option-rate", aside)),
      icon("check"),
    );
    item.id = `${list.id}-${value}`;
    item.role = "option";
    item.dataset.value = value;
    return item;
  }
}
