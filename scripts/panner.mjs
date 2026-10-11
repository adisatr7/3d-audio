import { toListenerSpace } from "./coordinates.mjs";

export function createDirectionalPanner(context) {
  return new PannerNode(context, {
    panningModel: "HRTF",
    distanceModel: "inverse",
    refDistance: 1,
    maxDistance: 10000,
    rolloffFactor: 0,
    coneInnerAngle: 360,
    coneOuterAngle: 360,
    coneOuterGain: 1,
  });
}

export function positionPanner(panner, emitter, listener) {
  const position = toListenerSpace(
    emitter,
    listener.position,
    listener.rotation,
  );

  const now = panner.context.currentTime;

  for (const axis of ["X", "Y", "Z"]) {
    const param = panner[`position${axis}`];
    param.cancelScheduledValues(now);
    param.setValueAtTime(position[axis.toLowerCase()], now);
  }
}

/**
 * Remove just our node, preserving every native or third-party effect.
 */
export function detachPanner(sound, panner) {
  const effects = sound.effects.filter((node) => node !== panner);
  if (effects.length !== sound.effects.length) {
    if (sound.playing) {
      sound.applyEffects(effects);
    } else {
      sound.effects = effects;
    }
  }
  panner.disconnect();
}
