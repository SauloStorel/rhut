// Uma conexão só com a sala por página. Cada parte da página (assistir, transmitir, câmeras) registra os
// handlers das mensagens que entende e remove quando para; mensagens enviadas sem conexão esperam na fila.
// Se a conexão cair (rede oscilou, deploy do servidor), reconecta sozinha com o mesmo segredo `resume`,
// e a sala trata quem voltou como a mesma pessoa.
const HEARTBEAT_MS = 15_000;
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

// 1000: sala encerrada; 4000+: conexão recusada ou substituída. Nesses casos tentar de novo não adianta.
const isFinal = (code) => code === 1000 || code >= 4000;

export function connectRoom({ roomId, pass, resume, onStatus }) {
  const url = new URL(`/api/rooms/${roomId}/ws`, location.href);
  url.protocol = location.protocol.replace("http", "ws");
  url.searchParams.set("resume", resume);
  if (pass) url.searchParams.set("pass", pass);

  const listeners = new Set();
  const queue = [];
  let socket = null;
  let attempt = 0;
  let pingedAt = 0;
  let heardAt = 0;

  connect();
  setInterval(heartbeat, HEARTBEAT_MS);

  function connect() {
    const current = new WebSocket(url);
    socket = current;

    current.addEventListener("open", () => {
      attempt = 0;
      pingedAt = 0;
      onStatus("connected");
      queue.splice(0).forEach((message) => current.send(message));
    });
    current.addEventListener("message", ({ data }) => {
      heardAt = Date.now();
      if (data === "pong") return;

      const message = JSON.parse(data);
      listeners.forEach((handlers) => handlers[message.type]?.(message));
    });
    // Eventos de uma conexão já abandonada (trocada por outra) não contam.
    current.addEventListener("close", ({ code }) => {
      if (current === socket && !isFinal(code)) retry();
    });
  }

  function retry() {
    socket = null;
    onStatus("reconnecting");
    setTimeout(connect, RETRY_DELAYS_MS[Math.min(attempt++, RETRY_DELAYS_MS.length - 1)]);
  }

  // Conexão que parou de responder sem fechar (comum em troca de rede) só é notada pelo ping sem resposta.
  // Compara com o último ping, não com o relógio: em aba de fundo o navegador atrasa o timer, e isso não é queda.
  function heartbeat() {
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (pingedAt > heardAt) {
      socket.close();
      return retry();
    }

    pingedAt = Date.now();
    socket.send("ping");
  }

  return {
    send(message) {
      const text = JSON.stringify(message);
      if (socket?.readyState === WebSocket.OPEN) socket.send(text);
      else queue.push(text);
    },

    // Devolve a função que desliga esses handlers.
    on(handlers) {
      listeners.add(handlers);
      return () => listeners.delete(handlers);
    },
  };
}
