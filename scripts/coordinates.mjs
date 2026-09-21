/**
 * Convert a Foundry canvas emitter position into Web Audio listener-local space.
 *
 * Foundry's canvas has +X east/right and +Y south/down. Token rotation is in
 * degrees with 0 south, 90 west, 180 north, and 270 east. Web Audio's default
 * listener faces -Z with +X to the listener's right.
 *
 * Elevation is intentionally omitted for this MVP. The transform preserves the
 * original planar distance; the PannerNode itself is configured for zero
 * distance rolloff so Foundry remains solely responsible for attenuation.
 *
 * @param {{x: number, y: number}} emitter
 * @param {{x: number, y: number}} listener
 * @param {number} rotation Foundry token rotation in degrees.
 * @returns {{x: number, y: 0, z: number}}
 */
export function toListenerSpace(emitter, listener, rotation) {
  const radians = rotation * (Math.PI / 180);
  const dx = emitter.x - listener.x;
  const dy = emitter.y - listener.y;

  // Foundry-facing and listener-right unit vectors in canvas coordinates.
  const forwardX = -Math.sin(radians);
  const forwardY = Math.cos(radians);
  const rightX = -Math.cos(radians);
  const rightY = -Math.sin(radians);

  const right = (dx * rightX) + (dy * rightY);
  const forward = (dx * forwardX) + (dy * forwardY);

  // Web Audio's default AudioListener looks toward negative Z.
  return {x: right, y: 0, z: -forward};
}

/**
 * Resolve the current client's listener from its first controlled token.
 * An absent controlled token intentionally returns null instead of falling
 * back to owned tokens, as required by the module's native-audio fallback.
 *
 * @returns {{token: object, position: {x: number, y: number}, rotation: number}|null}
 */
export function getControlledTokenListener() {
  if (!globalThis.canvas?.ready) {
    return null;
  }

  const token = canvas.tokens?.controlled?.[0];
  if (!token) {
    return null;
  }

  const position = token.document.getCenterPoint();

  return {
    token,
    position: {x: position.x, y: position.y},
    rotation: Number(token.document.rotation) || 0
  };
}
