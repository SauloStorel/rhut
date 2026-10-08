import { avatar, element } from "./dom.js";
import { showToast } from "./toast.js";

const MAX_AVATARS = 5;

// Avatares de quem está na sala e avisos de "entrou" / "começou a transmitir".
export function createPresence() {
  const root = document.querySelector("#presence");
  const stack = document.querySelector("#avatar-stack");
  const count = document.querySelector("#presence-count");
  const seen = new Set();
  let me = null;
  let host = null;
  let firstUpdate = true;

  return {
    setMe(profile) {
      me = profile;
    },

    // Recebe a lista do servidor e devolve quem está transmitindo (ou null).
    update(people) {
      const everyone = uniqueById(people);
      const nextHost = everyone.find((person) => person.role === "host") ?? null;

      renderStack(everyone);
      if (!firstUpdate) announceChanges(everyone, nextHost);

      everyone.forEach((person) => seen.add(person.id));
      host = nextHost;
      firstUpdate = false;
      return host;
    },
  };

  function renderStack(everyone) {
    const visible = everyone.slice(0, MAX_AVATARS);
    const hidden = everyone.length - visible.length;

    stack.replaceChildren(
      ...visible.map((person) => {
        const item = element("li", "", avatar(person));
        item.title = person.id === me?.id ? `${person.name} (você)` : person.name;
        item.dataset.role = person.role;
        return item;
      }),
      ...(hidden > 0 ? [element("li", "", element("span", "avatar avatar-more", `+${hidden}`))] : []),
    );
    count.textContent = everyone.length === 1 ? "1 na sala" : `${everyone.length} na sala`;
    root.hidden = everyone.length === 0;
  }

  function announceChanges(everyone, nextHost) {
    everyone
      .filter((person) => !seen.has(person.id) && person.id !== me?.id)
      .forEach((person) => toast(person, "entrou na sala"));

    if (nextHost && nextHost.id !== host?.id && nextHost.id !== me?.id) toast(nextHost, "começou a transmitir");
  }

  function toast(person, action) {
    showToast([avatar(person, "avatar avatar-xs"), element("span", "", element("strong", "", person.name), ` ${action}`)]);
  }
}

// A mesma pessoa pode estar em duas abas; aparece uma vez só, e como host se alguma aba estiver transmitindo.
function uniqueById(people) {
  const byId = new Map();
  people.forEach((person) => {
    if (byId.get(person.id)?.role !== "host") byId.set(person.id, person);
  });
  return [...byId.values()].toSorted((a, b) => (b.role === "host") - (a.role === "host"));
}
