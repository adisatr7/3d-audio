import {getControlledTokenListener, toListenerSpace} from "./coordinates.mjs";

export const MODULE_ID = "3d-audio";
export const ENABLED_SETTING = "enabled";

/**
 * @type {Map<object, {sound: object, ambient: object, panner: PannerNode, onStop: Function}>}
 */
const states = new Map();

/**
 * Track which AmbientSound core most recently assigned to each singleton Sound.
 */
const owners = new WeakMap();

/**
 * Identify only AudioNodes created by this module.
 */
const moduleNodes = new WeakSet();

function worldEnabled() {
  return game.settings.get(MODULE_ID, ENABLED_SETTING);
}

function documentEnabled(document) {
  return document?.getFlag(MODULE_ID, "enabled") !== false;
}

function setAudioParam(param, value, context) {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, now);
}

function createPanner(sound) {
  const panner = new PannerNode(sound.context, {
    panningModel: "HRTF",
    distanceModel: "inverse",
    refDistance: 1,
    maxDistance: 10000,
    rolloffFactor: 0,
    coneInnerAngle: 360,
    coneOuterAngle: 360,
    coneOuterGain: 1
  });
  moduleNodes.add(panner);
  return panner;
}

function updateStatePosition(state, listener) {
  const document = state.ambient.document;
  const position = toListenerSpace(
    {x: document.x, y: document.y},
    listener.position,
    listener.rotation
  );
  const context = state.sound.context;
  setAudioParam(state.panner.positionX, position.x, context);
  setAudioParam(state.panner.positionY, position.y, context);
  setAudioParam(state.panner.positionZ, position.z, context);
}

function removeState(sound, {forgetOwner = false} = {}) {
  const state = states.get(sound);
  if (state) {
    states.delete(sound);
    sound.removeEventListener("stop", state.onStop);
    const effects = sound.effects.filter((node) => node !== state.panner);

    // Rebuild a live pipeline immediately. A stopped Sound has already
    // disconnected its graph, so only update its public effects array.
    if (effects.length !== sound.effects.length) {
      if (sound.playing) {
        sound.applyEffects(effects);
      } else {
        sound.effects = effects;
      }
    }
    state.panner.disconnect();
  }
  if (forgetOwner) {
    owners.delete(sound);
  }
}

/**
 * Called immediately after core AmbientSound#applyEffects. Core remains the
 * owner of base/muffled effects; this function appends one direction-only node.
 *
 * @param {object} ambient A canvas AmbientSound placeable.
 */
export function spatializeAmbientSound(ambient) {
  const sound = ambient?.sound;
  if (!sound) {
    return;
  }
  owners.set(sound, ambient);

  const listener = getControlledTokenListener();
  if (!worldEnabled() || !documentEnabled(ambient.document) || !listener) {
    removeState(sound);
    return;
  }

  let state = states.get(sound);
  if (!state) {
    const panner = createPanner(sound);
    const onStop = () => removeState(sound, {forgetOwner: true});
    state = {sound, ambient, panner, onStop};
    states.set(sound, state);
    sound.addEventListener("stop", onStop);
  } else {
    state.ambient = ambient;
  }

  updateStatePosition(state, listener);

  // AmbientSound#applyEffects replaces Sound#effects when native muffling
  // changes. Append after that replacement and never create a parallel path.
  if (!sound.effects.includes(state.panner)) {
    const effects = sound.effects.filter((node) => !moduleNodes.has(node));
    sound.applyEffects([...effects, state.panner]);
  }
}

/**
 * Update only currently-spatialized sounds after token or emitter movement.
 */
export function updateSpatialPositions() {
  const listener = getControlledTokenListener();
  if (!worldEnabled() || !listener) {
    removeAllSpatializers();
    return;
  }

  for (const state of [...states.values()]) {
    if (!documentEnabled(state.ambient.document)) {
      removeState(state.sound);
    } else {
      updateStatePosition(state, listener);
    }
  }
}

/**
 * Reconcile active canvas Ambient Sounds, for example after changing control or
 * toggling a setting. Ownership is learned from core's applyEffects call so
 * singleton Sounds shared by identical paths retain core's chosen emitter.
 */
export function reconcileActiveAmbientSounds() {
  const listener = getControlledTokenListener();
  if (!worldEnabled() || !listener) {
    removeAllSpatializers();
    return;
  }

  for (const ambient of canvas.sounds?.placeables ?? []) {
    const sound = ambient.sound;
    if (!sound?.playing || owners.get(sound) !== ambient) {
      continue;
    }
    spatializeAmbientSound(ambient);
  }
  updateSpatialPositions();
}

/**
 * Remove the module node belonging to one AmbientSound, if it owns the Sound.
 */
export function removeAmbientSpatializer(ambient, {forgetOwner = false} = {}) {
  const sound = ambient?.sound;
  if (!sound || owners.get(sound) !== ambient) {
    return;
  }
  removeState(sound, {forgetOwner});
  if (forgetOwner) {
    owners.delete(sound);
  }
}

/**
 * Disconnect and forget every PannerNode created by this module.
 */
export function removeAllSpatializers() {
  for (const sound of [...states.keys()]) {
    removeState(sound);
  }
}
