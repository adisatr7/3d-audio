import assert from "node:assert/strict";
import test from "node:test";
import {getTokenDocumentListener} from "../scripts/coordinates.mjs";
import {
  getDoorAudioConfig,
  installDoorAudio,
  stopDoorSounds,
  updateDoorSpatialPositions
} from "../scripts/door-audio.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return {promise, resolve};
}

function createFixture(testContext) {
  const globalNames = ["game", "canvas", "CONFIG", "CONST", "PannerNode", "Hooks"];
  const previousGlobals = new Map(globalNames.map((name) => [name, globalThis[name]]));
  const settings = {enabled: true, doorsEnabled: true};
  const sounds = [];
  const panners = [];
  const nativeCalls = [];
  const errors = [];
  const previousError = console.error;
  console.error = (...args) => errors.push(args);
  let loadGate;
  let playGate;
  let audible = true;
  let failLoad = false;
  let rejectLoad = false;
  let incompleteLoad = false;

  class AudioParam {
    value = 0;
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
  }

  class Panner {
    constructor(context, options) {
      this.context = context;
      Object.assign(this, options);
      this.positionX = new AudioParam();
      this.positionY = new AudioParam();
      this.positionZ = new AudioParam();
      this.disconnected = false;
      panners.push(this);
    }
    disconnect() { this.disconnected = true; }
  }

  class Sound {
    effects = [];
    loaded = false;
    failed = false;
    playing = false;
    stopCalls = 0;
    listeners = new Map();
    playbackCalls = [];
    constructor(options) {
      Object.assign(this, options);
      sounds.push(this);
    }
    async load() {
      if (loadGate) {
        await loadGate.promise;
      }
      if (rejectLoad) {
        throw new Error("failed loading fixture");
      }
      if (failLoad) {
        // Foundry logs load errors and resolves with a failed Sound.
        console.error(new Error("failed loading fixture"));
        this.failed = true;
        return this;
      }
      this.loaded = !incompleteLoad;
      return this;
    }
    async playAtPosition(origin, radius, options) {
      this.playbackCalls.push({origin, radius, options});
      if (!audible) {
        return null;
      }
      this.nativeEffect = {type: "native muffling"};
      this.effects.push(this.nativeEffect);
      this.startEffects = [...this.effects];
      if (!this.loaded) {
        return this;
      }
      this.playing = true;
      if (playGate) {
        await playGate.promise;
      }
      return this;
    }
    applyEffects(effects) { this.effects = effects; }
    addEventListener(event, callback) {
      this.listeners.set(event, callback);
    }
    removeEventListener(event, callback) {
      if (this.listeners.get(event) === callback) {
        this.listeners.delete(event);
      }
    }
    emit(event) { this.listeners.get(event)?.(); }
    async stop() {
      this.stopCalls++;
      if (!this.playing) {
        return this;
      }
      this.playing = false;
      this.emit("stop");
      return this;
    }
  }

  class Wall {
    isDoor = true;
    soundRadius = 60;
    center = {x: 100, y: 150};
    constructor(flags = {}) {
      this.flags = flags;
      this.document = {
        door: 1,
        doorSound: "wood",
        getFlag: (module, name) => {
          assert.equal(module, "3d-audio");
          assert.equal(name, "door");
          return this.flags;
        }
      };
    }
    _playDoorSound(...args) {
      nativeCalls.push({wall: this, args});
      if (!CONST.WALL_DOOR_INTERACTIONS.includes(args[0])) {
        throw new Error("invalid native interaction");
      }
      return "native";
    }
  }

  const tokenDocument = {
    rotation: 0,
    getCenterPoint: (changes = {}) => ({x: changes.x ?? 100, y: changes.y ?? 100})
  };
  const token = {document: tokenDocument, controlled: true};
  tokenDocument.object = token;
  globalThis.PannerNode = Panner;
  globalThis.CONST = {
    WALL_DOOR_INTERACTIONS: ["open", "close", "lock", "unlock", "test"],
    WALL_DOOR_TYPES: {NONE: 0}
  };
  globalThis.CONFIG = {
    Wall: {
      objectClass: Wall,
      doorSounds: {wood: {
        open: ["open-1.ogg", "open-2.ogg"],
        close: "close.ogg", lock: "lock.ogg", unlock: "unlock.ogg", test: "test.ogg"
      }}
    }
  };
  CONFIG.sounds = {lock: "fallback-lock.ogg"};
  globalThis.game = {
    settings: {get: (module, key) => {
      assert.equal(module, "3d-audio");
      return settings[key];
    }},
    audio: {
      environment: {currentTime: 0},
      create: (options) => new Sound(options)
    }
  };
  globalThis.canvas = {
    ready: true,
    tokens: {controlled: [token]},
    sounds: {placeables: []},
    dimensions: {distance: 5}
  };
  installDoorAudio();

  testContext.after(() => {
    stopDoorSounds();
    console.error = previousError;
    for (const [name, value] of previousGlobals) {
      if (value === undefined) {
        delete globalThis[name];
      } else {
        globalThis[name] = value;
      }
    }
  });
  return {
    Wall, Sound, settings, sounds, panners, nativeCalls, errors, tokenDocument,
    setAudible: (value) => { audible = value; },
    setLoadGate: (value) => { loadGate = value; },
    setPlayGate: (value) => { playGate = value; },
    setFailLoad: () => { failLoad = true; },
    setRejectLoad: () => { rejectLoad = true; },
    setIncompleteLoad: () => { incompleteLoad = true; }
  };
}

test("door defaults retain native gain, radius, easing, and muffling behavior", (testContext) => {
  const {Wall} = createFixture(testContext);
  assert.deepEqual(getDoorAudioConfig(new Wall().document, 60), {
    enabled: true, radius: 60, volume: 1, easing: true, walls: false
  });
  assert.deepEqual(getDoorAudioConfig(new Wall({radius: NaN, volume: 2}).document, 60), {
    enabled: true, radius: 60, volume: 1, easing: true, walls: false
  });
});

test("registered custom presets supply every action through the same playback path", async (testContext) => {
  const fixture = createFixture(testContext);
  const customSounds = {
    open: "custom-open.ogg", close: "custom-close.ogg", lock: "custom-lock.ogg",
    unlock: "custom-unlock.ogg", test: "custom-attempt.ogg"
  };
  CONFIG.Wall.doorSounds.custom = {label: "Custom Door", ...customSounds};
  const wall = new fixture.Wall();
  wall.document.doorSound = "custom";
  for (const interaction of CONST.WALL_DOOR_INTERACTIONS) {
    await wall._playDoorSound(interaction);
    const sound = fixture.sounds.at(-1);
    assert.equal(sound.src, customSounds[interaction]);
    assert.equal(sound.playbackCalls.length, 1);
    assert.equal(sound.startEffects[0].panningModel, "HRTF");
  }
  assert.equal(fixture.sounds.length, 5);
  assert.equal(fixture.nativeCalls.length, 0);
});

test("changing the selected preset changes the next interaction sound", async (testContext) => {
  const fixture = createFixture(testContext);
  CONFIG.Wall.doorSounds.custom = {label: "Custom Door", close: "custom-close.ogg"};
  const wall = new fixture.Wall();
  wall.document.doorSound = "custom";
  await wall._playDoorSound("close");
  wall.document.doorSound = "wood";
  await wall._playDoorSound("close");
  assert.deepEqual(fixture.sounds.map((sound) => sound.src), ["custom-close.ogg", "close.ogg"]);
});

test("each native door interaction plays once through an independent environmental Sound", async (testContext) => {
  const fixture = createFixture(testContext);
  const wall = new fixture.Wall({radius: 20, volume: 0.4, easing: false, walls: true});
  for (const interaction of CONST.WALL_DOOR_INTERACTIONS) {
    await wall._playDoorSound(interaction);
  }
  assert.equal(fixture.nativeCalls.length, 0);
  assert.equal(fixture.sounds.length, 5);
  assert.equal(new Set(fixture.sounds).size, 5);
  for (const sound of fixture.sounds) {
    assert.equal(sound.context, game.audio.environment);
    assert.equal(sound.singleton, false);
    assert.equal(sound.playbackCalls.length, 1);
    assert.deepEqual(sound.playbackCalls[0], {
      origin: wall.center, radius: 20,
      options: {
        volume: 0.4, easing: false, walls: true,
        gmAlways: false, muffledEffect: {type: "lowpass", intensity: 5}
      }
    });
    assert.equal(sound.startEffects.length, 2);
    assert.equal(sound.startEffects[0].panningModel, "HRTF");
    assert.equal(sound.startEffects[0].rolloffFactor, 0);
    assert.equal(sound.startEffects[1], sound.nativeEffect);
    assert.equal(sound.startEffects[0].positionZ.value, -50);
  }
});

test("world and per-door disable, no token, and ordinary walls delegate exactly to core", (testContext) => {
  const fixture = createFixture(testContext);
  const wall = new fixture.Wall();
  fixture.settings.doorsEnabled = false;
  assert.equal(wall._playDoorSound("open", {extra: true}), "native");
  fixture.settings.doorsEnabled = true;
  fixture.settings.enabled = false;
  assert.equal(wall._playDoorSound("open"), "native");
  fixture.settings.enabled = true;
  wall.flags.enabled = false;
  assert.equal(wall._playDoorSound("open"), "native");
  delete wall.flags.enabled;
  canvas.tokens.controlled.length = 0;
  assert.equal(wall._playDoorSound("open"), "native");
  wall.isDoor = false;
  assert.equal(wall._playDoorSound("open"), "native");
  assert.equal(fixture.sounds.length, 0);
  assert.equal(fixture.panners.length, 0);
  assert.equal(fixture.nativeCalls.length, 5);
  assert.deepEqual(fixture.nativeCalls[0].args, ["open", {extra: true}]);
});

test("native missing-preset and locked-attempt fallback rules are preserved", async (testContext) => {
  const fixture = createFixture(testContext);
  const wall = new fixture.Wall();
  wall.document.doorSound = "";
  await wall._playDoorSound("open");
  assert.equal(fixture.sounds.length, 0);
  await wall._playDoorSound("test");
  assert.equal(fixture.sounds[0].src, "fallback-lock.ogg");
  CONFIG.Wall.doorSounds.wood.test = [];
  wall.document.doorSound = "wood";
  await wall._playDoorSound("test");
  assert.equal(fixture.sounds[1].src, "fallback-lock.ogg");
  assert.throws(() => wall._playDoorSound("invalid"), /invalid native interaction/);
});

test("rotation uses the first pending token update and moving the wall updates the same panner", async (testContext) => {
  const fixture = createFixture(testContext);
  const wall = new fixture.Wall();
  await wall._playDoorSound("open");
  const panner = fixture.panners[0];
  updateDoorSpatialPositions(getTokenDocumentListener(fixture.tokenDocument, {rotation: 90}));
  assert.equal(fixture.tokenDocument.rotation, 0);
  assert.equal(panner.positionX.value, -50);
  assert.ok(Math.abs(panner.positionZ.value) < 1e-9);
  wall.center = {x: 150, y: 100};
  updateDoorSpatialPositions();
  assert.equal(panner.positionX.value, -50);
  assert.equal(fixture.panners.length, 1);
});

test("live toggles remove only HRTF, preserve native effects, and can re-enable without a replay", async (testContext) => {
  const fixture = createFixture(testContext);
  const wall = new fixture.Wall();
  await wall._playDoorSound("open");
  const sound = fixture.sounds[0];
  fixture.settings.doorsEnabled = false;
  updateDoorSpatialPositions();
  assert.deepEqual(sound.effects, [sound.nativeEffect]);
  assert.equal(fixture.panners[0].disconnected, true);
  fixture.settings.doorsEnabled = true;
  updateDoorSpatialPositions();
  assert.equal(sound.effects.length, 2);
  assert.equal(fixture.panners.length, 2);
  assert.equal(sound.playbackCalls.length, 1);
  wall.flags.enabled = false;
  updateDoorSpatialPositions();
  assert.deepEqual(sound.effects, [sound.nativeEffect]);
  delete wall.flags.enabled;
  updateDoorSpatialPositions();
  canvas.tokens.controlled.length = 0;
  updateDoorSpatialPositions();
  assert.deepEqual(sound.effects, [sound.nativeEffect]);
});

test("inaudible clips and stopped or ended clips release their nodes and listeners", async (testContext) => {
  const fixture = createFixture(testContext);
  const wall = new fixture.Wall();
  fixture.setAudible(false);
  await wall._playDoorSound("open");
  assert.equal(fixture.panners[0].disconnected, true);
  assert.equal(fixture.sounds[0].listeners.size, 0);
  fixture.setAudible(true);
  for (const event of ["stop", "end"]) {
    await wall._playDoorSound("open");
    const sound = fixture.sounds.at(-1);
    const panner = fixture.panners.at(-1);
    sound.playing = false;
    sound.emit(event);
    assert.equal(panner.disconnected, true);
    assert.equal(sound.listeners.size, 0);
    assert.deepEqual(sound.effects, [sound.nativeEffect]);
  }
  updateDoorSpatialPositions();
  assert.equal(fixture.panners.length, 3);
});

test("deleting a door stops only its voices, while scene teardown stops every voice", async (testContext) => {
  const fixture = createFixture(testContext);
  const firstWall = new fixture.Wall();
  const secondWall = new fixture.Wall();
  await firstWall._playDoorSound("open");
  await secondWall._playDoorSound("open");
  stopDoorSounds(firstWall.document);
  assert.equal(fixture.sounds[0].playing, false);
  assert.equal(fixture.sounds[1].playing, true);
  stopDoorSounds();
  assert.equal(fixture.sounds[1].playing, false);
  assert.ok(fixture.panners.every((panner) => panner.disconnected));
});

test("teardown during loading cancels playback rather than letting it leak into the next scene", async (testContext) => {
  const fixture = createFixture(testContext);
  const gate = deferred();
  fixture.setLoadGate(gate);
  const pending = new fixture.Wall()._playDoorSound("open");
  stopDoorSounds();
  gate.resolve();
  await pending;
  assert.equal(fixture.sounds[0].playbackCalls.length, 0);
  assert.equal(fixture.sounds[0].listeners.size, 0);
  assert.equal(fixture.panners.length, 0);
  assert.equal(fixture.nativeCalls.length, 0);
});

test("disabling during a pending load falls back once to native door playback", async (testContext) => {
  const fixture = createFixture(testContext);
  const gate = deferred();
  fixture.setLoadGate(gate);
  const wall = new fixture.Wall();
  const pending = wall._playDoorSound("open");
  fixture.settings.doorsEnabled = false;
  gate.resolve();
  assert.equal(await pending, "native");
  assert.equal(fixture.nativeCalls.length, 1);
  assert.equal(fixture.sounds[0].playbackCalls.length, 0);
  assert.equal(fixture.sounds[0].listeners.size, 0);
});

test("teardown racing playback startup cannot leave an orphaned voice", async (testContext) => {
  const fixture = createFixture(testContext);
  const gate = deferred();
  fixture.setPlayGate(gate);
  const wall = new fixture.Wall();
  const pending = wall._playDoorSound("open");
  await Promise.resolve();
  assert.equal(fixture.sounds[0].playing, true);
  stopDoorSounds();
  gate.resolve();
  await pending;
  assert.equal(fixture.sounds[0].playing, false);
  assert.equal(fixture.panners[0].disconnected, true);
});

test("resolved failed loads leave no callbacks, panners, or tracked states after repeated attempts", async (testContext) => {
  const fixture = createFixture(testContext);
  fixture.setFailLoad();
  const wall = new fixture.Wall();
  for (let attempt = 0; attempt < 3; attempt++) {
    await wall._playDoorSound("open");
    const sound = fixture.sounds.at(-1);
    assert.equal(sound.failed, true);
    assert.equal(sound.loaded, false);
    assert.equal(sound.listeners.size, 0);
    assert.equal(sound.effects.length, 0);
    assert.equal(sound.playbackCalls.length, 0);
  }
  assert.equal(fixture.errors.length, 3);
  assert.equal(fixture.panners.length, 0);
  assert.equal(fixture.nativeCalls.length, 0);
  const stopCalls = fixture.sounds.map((sound) => sound.stopCalls);
  stopDoorSounds();
  assert.deepEqual(fixture.sounds.map((sound) => sound.stopCalls), stopCalls);
});

test("an unresolved loaded status is cleaned up before creating a panner or attempting playback", async (testContext) => {
  const fixture = createFixture(testContext);
  fixture.setIncompleteLoad();
  await new fixture.Wall()._playDoorSound("open");
  assert.equal(fixture.sounds[0].failed, false);
  assert.equal(fixture.sounds[0].loaded, false);
  assert.equal(fixture.sounds[0].listeners.size, 0);
  assert.equal(fixture.sounds[0].playbackCalls.length, 0);
  assert.equal(fixture.panners.length, 0);
});

test("rejected loads also leave no callbacks or nodes behind", async (testContext) => {
  const fixture = createFixture(testContext);
  fixture.setRejectLoad();
  await new fixture.Wall()._playDoorSound("open");
  assert.equal(fixture.errors.length, 1);
  assert.equal(fixture.sounds[0].listeners.size, 0);
  assert.equal(fixture.panners.length, 0);
});

test("installing twice is idempotent and never patches Sound or SoundsLayer", (testContext) => {
  const fixture = createFixture(testContext);
  const wrapped = fixture.Wall.prototype._playDoorSound;
  const playAtPosition = fixture.Sound.prototype.playAtPosition;
  const soundsLayer = canvas.sounds;
  installDoorAudio();
  assert.equal(fixture.Wall.prototype._playDoorSound, wrapped);
  assert.equal(fixture.Sound.prototype.playAtPosition, playAtPosition);
  assert.equal(canvas.sounds, soundsLayer);
});

test("a missing protected door API is left untouched with a compatibility warning", (testContext) => {
  createFixture(testContext);
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  testContext.after(() => { console.warn = previousWarn; });
  CONFIG.Wall.objectClass = undefined;
  assert.doesNotThrow(installDoorAudio);
  assert.equal(warnings.length, 1);
});

test("integration registers world toggles and routes token, wall, and scene events", async (testContext) => {
  const fixture = createFixture(testContext);
  class AmbientSound {
    applyEffects() {}
  }
  CONFIG.AmbientSound = {objectClass: AmbientSound};
  const hooks = new Map();
  const registered = new Map();
  globalThis.Hooks = {
    once: (event, callback) => hooks.set(event, callback),
    on: (event, callback) => hooks.set(event, callback)
  };
  game.settings.register = (module, name, config) => {
    assert.equal(module, "3d-audio");
    registered.set(name, config);
  };
  await import("../scripts/main.mjs");
  hooks.get("init")();
  for (const config of registered.values()) {
    assert.equal(config.default, true);
    assert.equal(config.scope, "world");
    assert.equal(config.type, Boolean);
  }
  assert.equal(registered.size, 2);
  assert.equal(typeof hooks.get("renderWallConfig"), "function");
  const wall = new fixture.Wall();
  await wall._playDoorSound("open");
  hooks.get("updateToken")(fixture.tokenDocument, {rotation: 90});
  assert.equal(fixture.panners[0].positionX.value, -50);
  const secondTokenDocument = {
    object: {controlled: true},
    getCenterPoint: () => ({x: 0, y: 0}),
    rotation: 180
  };
  hooks.get("updateToken")(secondTokenDocument, {rotation: 180});
  assert.equal(fixture.panners[0].positionX.value, -50);
  fixture.settings.doorsEnabled = false;
  registered.get("doorsEnabled").onChange();
  assert.deepEqual(fixture.sounds[0].effects, [fixture.sounds[0].nativeEffect]);
  fixture.settings.doorsEnabled = true;
  hooks.get("updateWall")();
  hooks.get("deleteWall")(wall.document);
  assert.equal(fixture.sounds[0].playing, false);
  await wall._playDoorSound("close");
  hooks.get("canvasTearDown")();
  assert.equal(fixture.sounds[1].playing, false);
});
