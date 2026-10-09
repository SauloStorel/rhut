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
