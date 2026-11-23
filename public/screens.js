import { DELAY_HINT } from "./diagnostics.js";
import { createScreenTile } from "./ui/screen-tile.js";
import { watchScreen } from "./watch.js";

const STATS_INTERVAL_MS = 2000;
export const OWN_SCREEN = "screen:me";

// As telas da sala: um card para cada pessoa transmitindo, e o meu quando sou eu. Como no Discord, a tela dos
// outros só começa a chegar quando escolho assistir; até lá o card mostra o convite.
// O modo ambiente (as cores do vídeo em volta do palco) segue a tela que está sozinha em destaque.
export function createScreens({ transport, ambient, preferences, onChange, onWatch, onStopWatching }) {
  const others = new Map(); // id do card → { sharer, tile, watching }
  let own = null;
  let ambientOn = preferences.get("ambient") !== "off";
  let ambientTile = null;
  setInterval(refreshQualities, STATS_INTERVAL_MS);

  return {
    // Chamado a cada atualização de presença com quem está transmitindo (sem mim).
    sync(sharers) {
      const ids = new Set(sharers.map(tileId));
      [...others.keys()].filter((id) => !ids.has(id)).forEach(remove);
      sharers.forEach((sharer) => {
        const entry = others.get(tileId(sharer)) ?? add(sharer);
        entry.sharer = sharer;
        entry.tile.setSharer(sharer);
        entry.watching?.update(sharer);
      });
      onChange();
    },

    showOwn(stream, profile) {
      own ??= createTile({ self: true });
      own.setSharer(profile);
      own.preview(stream);
      onChange();
    },

    hideOwn() {
      own?.remove();
      own = null;
      onChange();
    },

    setOwnQuality: (label) => own?.setQuality(label),

    tiles: () => [...(own ? [{ id: OWN_SCREEN, element: own.element }] : []), ...[...others].map(([id, { tile }]) => ({ id, element: tile.element }))],

    // O id do card que está sozinho em destaque, ou null (grade com vários cards).
    followAmbient(id) {
      ambientTile = others.get(id)?.tile ?? null;
      syncAmbient();
    },

    closeAll() {
      [...others.keys()].forEach(remove);
      own?.remove();
      own = null;
      onChange();
    },
  };

  function add(sharer) {
    const id = tileId(sharer);
    const entry = { sharer, watching: null, tile: createTile({ self: false, watch: () => watch(id), stopWatching: () => stopWatching(id) }) };
    entry.tile.invite();
    others.set(id, entry);
    return entry;
  }

  function remove(id) {
    const entry = others.get(id);
    entry.watching?.close();
    entry.tile.remove();
    others.delete(id);
    if (ambientTile === entry.tile) ambientTile = null;
    syncAmbient();
  }

  function watch(id) {
    const entry = others.get(id);
    entry.watching ??= watchScreen(entry.sharer, {
      transport,
      onWaiting: () => entry.tile.connecting(),
      onStream: (stream) => {
        entry.tile.play(stream);
        syncAmbient();
      },
    });
    onWatch(id);
  }

  // Para de receber a tela (e de gastar a banda dela) e volta ao convite.
  function stopWatching(id) {
    const entry = others.get(id);
    entry.watching?.close();
    entry.watching = null;
    entry.tile.invite();
    syncAmbient();
    onStopWatching(id);
  }

  /** @param {{ self: boolean, watch?: () => void, stopWatching?: () => void }} options */
  function createTile({ self, watch, stopWatching }) {
    const tile = createScreenTile({ self, onWatch: watch, onStopWatching: stopWatching, onAmbientToggle: toggleAmbient });
    tile.setAmbient(ambientOn);
    return tile;
  }

  function toggleAmbient() {
    ambientOn = !ambientOn;
    preferences.set("ambient", ambientOn ? "on" : "off");
    others.forEach(({ tile }) => tile.setAmbient(ambientOn));
    syncAmbient();
  }

  function syncAmbient() {
    ambient.follow(ambientOn && ambientTile?.isPlaying() ? ambientTile.video : null);
  }

  async function refreshQualities() {
    for (const { watching, tile } of others.values()) {
      if (watching) tile.setQuality(await watching.measure(), DELAY_HINT);
    }
  }
}

function tileId(sharer) {
  return `screen:${sharer.peerId}`;
}
