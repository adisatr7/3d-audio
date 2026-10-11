import { getControlledTokenListener } from "./coordinates.mjs";
import {
  createDirectionalPanner,
  detachPanner,
  positionPanner,
} from "./panner.mjs";
import { ENABLED_SETTING, MODULE_ID } from "./spatial-audio.mjs";

export const DOORS_SETTING = "doorsEnabled";
const WRAPPED = Symbol.for("3d-audio.Wall._playDoorSound");
const states = new Set();

function boundedNumber(value, fallback, minimum, maximum = Infinity) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

export function getDoorAudioConfig(document, defaultRadius) {
  const flag = document.getFlag(MODULE_ID, "door") ?? {};

  return {
    enabled: flag.enabled !== false,
    radius: boundedNumber(flag.radius, defaultRadius, 0.1),
    volume: boundedNumber(flag.volume, 1, 0, 1),
    easing: flag.easing !== false,
    walls: flag.walls === true,
  };
}

function enabled(wall, listener) {
  return (
    canvas.ready &&
    wall.isDoor &&
    listener &&
    game.settings.get(MODULE_ID, ENABLED_SETTING) &&
    game.settings.get(MODULE_ID, DOORS_SETTING) &&
    wall.document.getFlag(MODULE_ID, "door")?.enabled !== false
  );
}

function selectDoorSound(wall, interaction) {
  const preset = CONFIG.Wall.doorSounds[wall.document.doorSound];
  const sounds = preset?.[interaction];

  if (Array.isArray(sounds)) {
    if (sounds.length) {
      return sounds[Math.floor(Math.random() * sounds.length)];
    }
  } else if (sounds) {
    return sounds;
  }

  // Match core's locked-door attempt fallback, even with no preset selected
  if (interaction === "test") {
    return CONFIG.sounds.lock;
  }

  return null;
}

function removePanner(state) {
  if (state.panner) {
    detachPanner(state.sound, state.panner);
    state.panner = null;
  }
}

function dispose(state) {
  state.disposed = true;
  states.delete(state);
  state.sound.removeEventListener("stop", state.onStop);
  state.sound.removeEventListener("end", state.onStop);
  removePanner(state);
}

function reportError(error) {
  console.error(`${MODULE_ID} | Door sound playback failed`, error);
}

function spatialize(state, listener) {
  if (!enabled(state.wall, listener)) {
    removePanner(state);
    return;
  }

  if (!state.panner) {
    state.panner = createDirectionalPanner(state.sound.context);
    positionPanner(state.panner, state.wall.center, listener);
    const effects = [...state.sound.effects, state.panner];

    if (state.sound.playing) {
      state.sound.applyEffects(effects);
    } else {
      state.sound.effects = effects;
    }

    return;
  }

  positionPanner(state.panner, state.wall.center, listener);
}

async function playDoorSound(wall, interaction, nativePlayback, args) {
  const src = selectDoorSound(wall, interaction);
  if (!src) {
    return;
  }

  const sound = game.audio.create({
    src,
    context: game.audio.environment,
    singleton: false,
  });

  const state = { wall, sound, panner: null, disposed: false, onStop: null };
  state.onStop = () => dispose(state);
  states.add(state);
  sound.addEventListener("stop", state.onStop);
  sound.addEventListener("end", state.onStop);

  try {
    await sound.load();

    // Teardown or wall deletion can occur while a file is loading
    if (state.disposed) {
      return;
    }

    // Core resolves load failures instead of rejecting; no stop/end event
    // will release a Sound which never starts playing.
    if (sound.failed || !sound.loaded) {
      dispose(state);
      return;
    }

    const listener = getControlledTokenListener();

    if (!enabled(wall, listener)) {
      dispose(state);
      return nativePlayback.apply(wall, args);
    }

    spatialize(state, listener);
    const { radius, volume, easing, walls } = getDoorAudioConfig(
      wall.document,
      wall.soundRadius,
    );

    // This public API performs native hearing tests, gain, and muffling and
    // plays exactly once. No AmbientSound documents or socket messages exist
    const result = await sound.playAtPosition(wall.center, radius, {
      volume,
      easing,
      walls,
      // Unlike vanilla's always-audible GM preview, this one respect
      // the controlled GM token's hearing radius like AmbientSounds
      gmAlways: false,
      muffledEffect: { type: "lowpass", intensity: 5 },
    });

    if (state.disposed) {
      await sound.stop();
    } else if (!result) {
      dispose(state);
    }

    return result;
  } catch (error) {
    dispose(state);
    await sound.stop();
    throw error;
  }
}

/**
 * The only protected API dependency: core has no door-specific playback hook.
 * Isolated to Wall
 */
export function installDoorAudio() {
  const prototype = CONFIG.Wall.objectClass?.prototype;
  const original = prototype?._playDoorSound;

  if (typeof original !== "function") {
    console.warn(
      `${MODULE_ID} | Door playback API unavailable; leaving doors native`,
    );
    return;
  }

  if (original[WRAPPED]) {
    return;
  }

  function playDoorSoundWithSpatialization(interaction, ...args) {
    const parameters = [interaction, ...args];

    if (
      !CONST.WALL_DOOR_INTERACTIONS.includes(interaction) ||
      !enabled(this, getControlledTokenListener())
    ) {
      return original.apply(this, parameters);
    }

    return playDoorSound(this, interaction, original, parameters).catch(
      reportError,
    );
  }

  Object.defineProperty(playDoorSoundWithSpatialization, WRAPPED, {
    value: true,
  });

  prototype._playDoorSound = playDoorSoundWithSpatialization;
}

/**
 * Only active door clips are visited, on token/control/setting/wall events
 */
export function updateDoorSpatialPositions(
  listener = getControlledTokenListener(),
) {
  for (const state of states) {
    if (state.sound.playing) {
      spatialize(state, listener);
    }
  }
}

/**
 * Cancel pending loads and stop existing voices on deletion or scene teardown
 */
export function stopDoorSounds(document) {
  for (const state of [...states]) {
    if (document && state.wall.document !== document) {
      continue;
    }
    dispose(state);
    state.sound.stop().catch(reportError);
  }
}
