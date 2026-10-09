const DURATION_MS = 3600;

// Os mesmos avisos da sala: aparecem no canto e somem sozinhos.
export function showToast(...children) {
  const item = document.createElement("li");
  item.className = "toast";
  item.append(...children);
  document.querySelector("#toasts").append(item);

  setTimeout(() => {
    item.setAttribute("data-leaving", "");
    item.addEventListener("animationend", () => item.remove(), { once: true });
  }, DURATION_MS);
}

export function personToast(initial, name, action) {
  const avatar = document.createElement("span");
  avatar.className = "toast-avatar";
  avatar.textContent = initial;
  const text = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = name;
  text.append(strong, ` ${action}`);
  showToast(avatar, text);
}
