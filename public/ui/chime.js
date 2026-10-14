// Avisos sonoros curtos de quem entra e sai da sala, no estilo do Discord: duas notas subindo ou descendo,
// sintetizadas na hora. Tocam também com a aba em segundo plano, desde que o som esteja liberado.
const CHIMES_HZ = {
  join: [659, 880],
  leave: [880, 587],
};
const NOTE_GAP_S = 0.09;
const NOTE_LENGTH_S = 0.22;
const VOLUME = 0.12;

// O navegador só libera som depois de um gesto na página. O contexto nasce já na carga porque o Chrome às vezes
// libera direto (quem costuma dar play no site); se nascer suspenso, o primeiro clique ou tecla libera.
const context = new AudioContext();
const unlock = () => context.resume();
["pointerdown", "keydown"].forEach((type) => document.addEventListener(type, unlock, { once: true, capture: true }));

export function playChime(kind) {
  if (context.state !== "running") return;

  const start = context.currentTime;
  CHIMES_HZ[kind].forEach((frequency, index) => playNote(frequency, start + index * NOTE_GAP_S));
}

function playNote(frequency, at) {
  const oscillator = new OscillatorNode(context, { type: "sine", frequency });
  const gain = new GainNode(context, { gain: 0 });
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(VOLUME, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_LENGTH_S);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + NOTE_LENGTH_S);
}
