// O passe vem no link pessoal do Discord (?pass=...). Guarda na aba e tira da URL, junto com o ?convidado de quem
// cancelou o login: copiar o endereço da barra não leva a identidade de ninguém nem pula o login de quem recebe.
export function takePass(roomId, tabStorage) {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get("pass");
  const storageKey = `pass:${roomId}`;

  if (fromUrl) tabStorage.set(storageKey, fromUrl);
  url.searchParams.delete("pass");
  url.searchParams.delete("convidado");
  history.replaceState(null, "", url);
  return fromUrl ?? tabStorage.get(storageKey);
}

// O segredo de reconexão sobrevive a recarregar a página: quem recarrega volta como a mesma pessoa em vez de
// aparecer duplicado até a sala desistir da conexão antiga (o navegador nem sempre avisa que a página saiu).
// Só na recarga: uma aba duplicada (que copia o sessionStorage) entra como outra pessoa.
export function resumeToken(roomId, tabStorage) {
  const storageKey = `resume:${roomId}`;
  const [navigation] = /** @type {PerformanceNavigationTiming[]} */ (performance.getEntriesByType("navigation"));
  const isReload = navigation?.type === "reload";
  const token = (isReload && tabStorage.get(storageKey)) || crypto.randomUUID();
  tabStorage.set(storageKey, token);
  return token;
}
