// Uma conexão só com a sala por página. Cada parte da página (assistir, transmitir, câmeras) registra os
// handlers das mensagens que entende e remove quando para; mensagens enviadas antes de conectar esperam na fila.
export function connectRoom({ roomId, pass }) {
  const url = new URL(`/api/rooms/${roomId}/ws`, location.href);
  url.protocol = location.protocol.replace("http", "ws");
  if (pass) url.searchParams.set("pass", pass);

  const socket = new WebSocket(url);
  const listeners = new Set();
  const queue = [];

  socket.addEventListener("open", () => queue.splice(0).forEach((message) => socket.send(message)));
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    listeners.forEach((handlers) => handlers[message.type]?.(message));
  });

  return {
    send(message) {
      const text = JSON.stringify(message);
      if (socket.readyState === WebSocket.OPEN) socket.send(text);
      else queue.push(text);
    },

    // Devolve a função que desliga esses handlers.
    on(handlers) {
      listeners.add(handlers);
      return () => listeners.delete(handlers);
    },
  };
}
