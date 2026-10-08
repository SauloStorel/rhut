// Passo nosso antes da escolha do navegador (que não dá para personalizar):
// explica como mandar só o som do jogo. Quem marcar "Não mostrar de novo" vai direto.
const SKIP_KEY = "skip-share-guide";

export function createShareGuide({ stage, preferences, onContinue, onCancel }) {
  const guide = stage.querySelector("#guide");
  const skip = stage.querySelector("#guide-skip");
  const continueButton = stage.querySelector("#guide-continue");

  // O clique em "Continuar" é o gesto que o navegador exige para abrir a escolha de tela.
  continueButton.addEventListener("click", () => {
    if (skip.checked) preferences.set(SKIP_KEY, "1");
    onContinue();
  });
  stage.querySelector("#guide-cancel").addEventListener("click", onCancel);
  guide.addEventListener("keydown", (event) => {
    if (event.key === "Escape") onCancel();
  });

  return {
    // Mostra o passo e devolve true; devolve false para quem pediu para não ver mais.
    open() {
      if (preferences.get(SKIP_KEY)) return false;

      stage.dataset.screen = "guide";
      continueButton.focus();
      return true;
    },
  };
}
