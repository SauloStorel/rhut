// O aviso do Discord acompanha a rolagem: cada passo lido "edita" a mensagem, como o bot faz de verdade.
const discord = document.querySelector("#discord");
const steps = document.querySelectorAll("[data-step]");

function showState(state) {
  if (discord.dataset.state === state) return;

  discord.dataset.state = state;
  discord.querySelectorAll("[data-for]").forEach((part) => (part.hidden = !part.dataset.for.split(" ").includes(state)));
  steps.forEach((step) => step.toggleAttribute("data-active", step.dataset.step === state));
}

// A faixa do meio da tela decide qual passo está sendo lido.
const observer = new IntersectionObserver(
  (entries) => entries.filter((entry) => entry.isIntersecting).forEach((entry) => showState(entry.target.dataset.step)),
  { rootMargin: "-45% 0px -45% 0px" },
);

steps.forEach((step) => observer.observe(step));
steps[0].toggleAttribute("data-active", true);

document.querySelectorAll("[data-copy]").forEach((button) => {
  const label = button.querySelector("span");

  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.previousElementSibling.textContent);
    button.toggleAttribute("data-copied", true);
    label.textContent = "Copiado";
    setTimeout(() => {
      button.removeAttribute("data-copied");
      label.textContent = "Copiar";
    }, 1800);
  });
});
