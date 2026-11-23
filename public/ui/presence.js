import { playChime } from "./chime.js";
import { avatar, element } from "./dom.js";
import { showToast } from "./toast.js";

const MAX_AVATARS = 5;

// Avatares de quem está na sala e avisos de "entrou" / "começou a transmitir", com som ao entrar e sair.
export function createPresence() {
  const root = document.querySelector("#presence");
  const stack = document.querySelector("#avatar-stack");
  const count = document.querySelector("#presence-count");
  let present = new Set();
  let sharing = new Set();
  let me = null;
  let firstUpdate = true;

  return {
    setMe(profile) {
      me = profile;
    },

    // Recebe a lista do servidor a cada mudança.
    update(people) {
      const everyone = uniqueById(people);
      const nextPresent = new Set(everyone.map((person) => person.id));
      const nextSharing = new Set(everyone.filter((person) => person.sharing).map((person) => person.id));

      renderStack(everyone);
      if (!firstUpdate) announceChanges(everyone, nextPresent, nextSharing);

      present = nextPresent;
      sharing = nextSharing;
      firstUpdate = false;
    },
  };

  function renderStack(everyone) {
    const visible = everyone.slice(0, MAX_AVATARS);
    const hidden = everyone.length - visible.length;

    stack.replaceChildren(
      ...visible.map((person) => {
        const item = element("li", "", avatar(person));
        item.title = person.id === me?.id ? `${person.name} (você)` : person.name;
        item.toggleAttribute("data-sharing", person.sharing);
        return item;
      }),
      ...(hidden > 0 ? [element("li", "", element("span", "avatar avatar-more", `+${hidden}`))] : []),
    );
    count.textContent = everyone.length === 1 ? "1 na sala" : `${everyone.length} na sala`;
    root.hidden = everyone.length === 0;
  }

  // Quem cai por instabilidade continua na lista por um tempo (o servidor espera a volta), então não soa.
  function announceChanges(everyone, nextPresent, nextSharing) {
    const others = everyone.filter((person) => person.id !== me?.id);
    const arrivals = others.filter((person) => !present.has(person.id));
    const someoneLeft = [...present].some((id) => !nextPresent.has(id) && id !== me?.id);

    arrivals.forEach((person) => toast(person, "entrou na sala"));
    if (arrivals.length > 0) playChime("join");
    if (someoneLeft) playChime("leave");

    others.filter((person) => nextSharing.has(person.id) && !sharing.has(person.id)).forEach((person) => toast(person, "começou a transmitir"));
  }

  function toast(person, action) {
    showToast([avatar(person, "avatar avatar-xs"), element("span", "", element("strong", "", person.name), ` ${action}`)]);
  }
}

// A mesma pessoa pode estar em duas abas; aparece uma vez só, e transmitindo se alguma aba estiver.
// Quem transmite vem primeiro.
function uniqueById(people) {
  const byId = new Map();
  people.forEach((person) => {
    if (!byId.get(person.id)?.sharing) byId.set(person.id, person);
  });
  return [...byId.values()].toSorted((a, b) => b.sharing - a.sharing);
}
