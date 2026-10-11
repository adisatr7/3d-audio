import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {addDoorSoundConfig} from "../scripts/door-config.mjs";

const translations = JSON.parse(await readFile(new URL("../lang/en.json", import.meta.url), "utf8"));

class Element {
  children = [];
  dataset = {};
  events = new Map();
  constructor(tagName) { this.tagName = tagName; }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this[name] = String(value); }
  addEventListener(event, callback) { this.events.set(event, callback); }
  querySelectorAll(selector) {
    const tagNames = selector.split(",").map((tagName) => tagName.trim());
    const matches = [];
    for (const child of this.children) {
      if (tagNames.includes(child.tagName)) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}

function createConfigFixture(testContext, {door = 1, flags, nativeSoundField = true} = {}) {
  const globalNames = ["document", "game", "canvas", "CONST"];
  const previousGlobals = new Map(globalNames.map((name) => [name, globalThis[name]]));
  testContext.after(() => {
    for (const [name, value] of previousGlobals) {
      if (value === undefined) {
        delete globalThis[name];
      } else {
        globalThis[name] = value;
      }
    }
  });
  globalThis.document = {createElement: (tagName) => new Element(tagName)};
  globalThis.game = {i18n: {localize: (key) => {
    const value = key.split(".").reduce((object, part) => object?.[part], translations);
    assert.equal(typeof value, "string", `Missing translation: ${key}`);
    return value;
  }}};
  globalThis.canvas = {dimensions: {distance: 5}};
  globalThis.CONST = {WALL_DOOR_TYPES: {NONE: 0}};
  const nativeGroup = new Element("div");
  const root = new Element("form");
  root.append(nativeGroup);
  nativeGroup.insertAdjacentElement = (position, element) => {
    assert.equal(position, "afterend");
    root.append(element);
  };
  const doorType = new Element("select");
  doorType.value = String(door);
  root.querySelector = (selector) => {
    if (selector === '[name="doorSound"]') {
      if (nativeSoundField) {
        return {closest: () => nativeGroup};
      }
      return null;
    }
    if (selector === '[name="door"]') {
      return doorType;
    }
    return root.children.find((child) => "3dAudioDoor" in child.dataset);
  };
  const app = {
    id: "wall-sheet",
    document: {door, getFlag: (module, name) => {
      assert.equal(module, "3d-audio");
      assert.equal(name, "door");
      return flags;
    }}
  };
  return {app, root, doorType};
}

test("wall sheet adds localized flag controls after the native preset, enabled by default", (testContext) => {
  const {app, root} = createConfigFixture(testContext);
  addDoorSoundConfig(app, root);
  const fieldset = root.children[1];
  assert.equal(fieldset.tagName, "fieldset");
  assert.equal(fieldset.hidden, false);
  assert.equal(fieldset.children[0].textContent, "3D Door Sounds");
  const inputs = fieldset.querySelectorAll("input, file-picker");
  assert.deepEqual(inputs.map((input) => input.name), [
    "flags.3d-audio.door.enabled", "flags.3d-audio.door.radius",
    "flags.3d-audio.door.volume", "flags.3d-audio.door.easing", "flags.3d-audio.door.walls"
  ]);
  assert.equal(inputs[0].checked, true);
  assert.equal(inputs[1].value, 60);
  assert.equal(inputs[2].value, 1);
  assert.equal(inputs[3].checked, true);
  assert.equal(inputs[4].checked, false);
  assert.deepEqual(inputs.map((input) => input.dataset.dtype), ["Boolean", "Number", "Number", "Boolean", "Boolean"]);
  assert.equal(fieldset.querySelectorAll("file-picker").length, 0);
  assert.equal(new Set(inputs.map((input) => input.id)).size, 5);
  assert.ok(inputs.every((input) => !input.disabled));
  addDoorSoundConfig(app, root);
  assert.equal(root.children.length, 2);
});

test("saved per-door values remain editable without changing the native preset", (testContext) => {
  const flags = {
    enabled: false, radius: 15, volume: 0.3, easing: false, walls: true
  };
  const {app, root} = createConfigFixture(testContext, {flags});
  addDoorSoundConfig(app, root);
  const inputs = root.children[1].querySelectorAll("input, file-picker");
  assert.equal(inputs[0].checked, false);
  assert.equal(inputs[1].value, 15);
  assert.equal(inputs[2].value, 0.3);
  assert.equal(inputs[3].checked, false);
  assert.equal(inputs[4].checked, true);
  assert.equal(root.children[0].children.length, 0);
});

test("changing an ordinary wall into a door reveals controls; changing back excludes them from submission", (testContext) => {
  const {app, root, doorType} = createConfigFixture(testContext, {door: 0});
  addDoorSoundConfig(app, root);
  const fieldset = root.children[1];
  const inputs = fieldset.querySelectorAll("input, file-picker");
  assert.equal(fieldset.hidden, true);
  assert.ok(inputs.every((input) => input.disabled));
  doorType.value = "1";
  doorType.events.get("change")();
  assert.equal(fieldset.hidden, false);
  assert.ok(inputs.every((input) => !input.disabled));
  doorType.value = "0";
  doorType.events.get("change")();
  assert.equal(fieldset.hidden, true);
  assert.ok(inputs.every((input) => input.disabled));
});

test("unrecognized wall sheets are left unchanged", (testContext) => {
  const {app, root} = createConfigFixture(testContext, {nativeSoundField: false});
  addDoorSoundConfig(app, root);
  assert.equal(root.children.length, 1);
});
