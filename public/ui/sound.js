// O som de quem assiste passa por um GainNode (Web Audio) em vez do <video>, para o volume poder passar de 100%.
// O <video> continua tocando a trilha, sempre mudo: o Chrome só entrega áudio WebRTC remoto ao Web Audio
// se a trilha também estiver presa a um elemento de mídia.
export const MAX_VOLUME = 2;

export function createSound(onChange) {
  let output = null;
  let muted = true;
  let volume = 1;

  return {
    attach(stream) {
      if (output?.stream === stream || stream.getAudioTracks().length === 0) return;

      output?.context.close();
      const context = new AudioContext();
      const gain = context.createGain();
      context.createMediaStreamSource(stream).connect(gain).connect(context.destination);
      output = { context, gain, stream };
      apply();
    },

    detach() {
      output?.context.close();
      output = null;
      muted = true;
      apply();
    },

    setVolume(next) {
      volume = next;
      muted = next === 0;
      apply();
    },

    toggleMute() {
      muted = !muted;
      if (!muted && volume === 0) volume = 1;
      apply();
    },

    unmute() {
      muted = false;
      apply();
    },
  };

  function apply() {
    if (output) {
      output.gain.gain.value = muted ? 0 : volume;
      // O AudioContext nasce suspenso pelo autoplay; o clique em "Ativar som" é o gesto que libera.
      if (!muted) output.context.resume();
    }
    onChange({ muted, volume, hasAudio: Boolean(output) });
  }
}
