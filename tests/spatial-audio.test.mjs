import assert from "node:assert/strict";
import test from "node:test";

class FakeAudioParam {
  value = 0;
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
}

class FakePannerNode {
  constructor(context, options) {
    this.context = context;
    Object.assign(this, options);
    this.positionX = new FakeAudioParam();
    this.positionY = new FakeAudioParam();
    this.positionZ = new FakeAudioParam();
    this.disconnected = false;
  }

  disconnect() { this.disconnected = true; }
}

globalThis.PannerNode = FakePannerNode;

let settingEnabled = true;
const controlled = [{
  document: {
    rotation: 0,
    getCenterPoint: () => ({x: 100, y: 100})
  }
}];

globalThis.game = {
  settings: {
    get: () => settingEnabled
  }
};

globalThis.canvas = {
  ready: true,
  tokens: {controlled},
  sounds: {placeables: []}
};

const {
  reconcileActiveAmbientSounds,
  removeAllSpatializers,
  spatializeAmbientSound,
  updateSpatialPositions
} = await import("../scripts/spatial-audio.mjs");

function makeSound(nativeEffect = {name: "native"}) {
  const listeners = new Map();

  return {
    context: {currentTime: 0},
    effects: [nativeEffect],
    playing: true,
    applyEffects(effects) { this.effects = effects; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) {
      if (listeners.get(type) === callback) {
        listeners.delete(type);
      }
    },
    emit(type) { listeners.get(type)?.(); }
  };
}

function makeAmbient(sound, {enabled} = {}) {
  return {
    sound,
    document: {
      x: 100,
      y: 150,
      getFlag: () => enabled
    }
  };
}

test.afterEach(() => {
  settingEnabled = true;
  controlled.splice(0, controlled.length, {
    document: {rotation: 0, getCenterPoint: () => ({x: 100, y: 100})}
  });
  canvas.sounds.placeables = [];
  removeAllSpatializers();
});

test("appends exactly one direction-only HRTF node after native effects", () => {
  const nativeEffect = {name: "native"};
  const sound = makeSound(nativeEffect);
  const ambient = makeAmbient(sound);

  spatializeAmbientSound(ambient);
  spatializeAmbientSound(ambient);

  assert.equal(sound.effects.length, 2);
  assert.equal(sound.effects[0], nativeEffect);
  const panner = sound.effects[1];
  assert.ok(panner instanceof FakePannerNode);
  assert.equal(panner.panningModel, "HRTF");
  assert.equal(panner.rolloffFactor, 0);
  assert.equal(panner.coneInnerAngle, 360);
  assert.ok(Math.abs(panner.positionX.value) < 1e-9);
  assert.equal(panner.positionZ.value, -50);
});

test("token rotation updates the existing node without accumulation", () => {
  const sound = makeSound();
  const ambient = makeAmbient(sound);
  spatializeAmbientSound(ambient);
  const panner = sound.effects[1];

  controlled[0].document.rotation = 90;
  updateSpatialPositions();

  assert.equal(sound.effects.length, 2);
  assert.equal(sound.effects[1], panner);
  assert.equal(panner.positionX.value, -50);
  assert.ok(Math.abs(panner.positionZ.value) < 1e-9);
});

test("per-sound, world, and no-token fallbacks restore native effects", () => {
  const nativeEffect = {name: "native"};
  const sound = makeSound(nativeEffect);
  const ambient = makeAmbient(sound);
  spatializeAmbientSound(ambient);

  ambient.document.getFlag = () => false;
  spatializeAmbientSound(ambient);
  assert.deepEqual(sound.effects, [nativeEffect]);

  ambient.document.getFlag = () => undefined;
  spatializeAmbientSound(ambient);
  settingEnabled = false;
  reconcileActiveAmbientSounds();
  assert.deepEqual(sound.effects, [nativeEffect]);

  settingEnabled = true;
  spatializeAmbientSound(ambient);
  controlled.length = 0;
  updateSpatialPositions();
  assert.deepEqual(sound.effects, [nativeEffect]);
});

test("a stopped Sound releases its PannerNode", () => {
  const sound = makeSound();
  const ambient = makeAmbient(sound);
  spatializeAmbientSound(ambient);
  const panner = sound.effects[1];

  sound.playing = false;
  sound.emit("stop");

  assert.equal(panner.disconnected, true);
  assert.equal(sound.effects.length, 1);
});
