// localStorage/sessionStorage podem estar bloqueados (aba anônima, cookies desligados), e até acessar
// a propriedade pode lançar erro. Aí só não lembra a escolha.
export function safeStorage(getStorage) {
  return {
    get(key) {
      try {
        return getStorage().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        getStorage().setItem(key, value);
      } catch {}
    },
  };
}
