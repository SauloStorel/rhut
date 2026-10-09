import { personToast } from "./toast.js";

// A galera vai entrando na sala do topo, com o aviso de "entrou na sala" igual ao do app.
// Sem JS ou com menos movimento, a sala já aparece cheia.
const ARRIVALS = [
  { initial: "L", name: "Léo", at: 1600 },
  { initial: "T", name: "Tati", at: 3200 },
  { initial: "R", name: "Rafa", at: 4800 },
];

export function playArrivals() {
  const avatars = document.querySelector("#avatars");
  const count = document.querySelector("#presence-count");
  const showCount = () => (count.textContent = `${avatars.children.length} na sala`);

  avatars.replaceChildren(avatars.firstElementChild);
  showCount();

  ARRIVALS.forEach(({ initial, name, at }) =>
    setTimeout(() => {
      const avatar = document.createElement("span");
      avatar.textContent = initial;
      avatar.dataset.arriving = "";
      avatars.append(avatar);
      showCount();
      personToast(initial, name, "entrou na sala");
    }, at),
  );
}
