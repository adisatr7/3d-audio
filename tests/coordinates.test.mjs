import assert from "node:assert/strict";
import test from "node:test";

import {toListenerSpace} from "../scripts/coordinates.mjs";

const listener = {x: 100, y: 100};

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not near ${expected}`);
}

test("0 degrees faces south", () => {
  const front = toListenerSpace({x: 100, y: 150}, listener, 0);
  near(front.x, 0);
  near(front.z, -50);

  const right = toListenerSpace({x: 50, y: 100}, listener, 0);
  near(right.x, 50);
  near(right.z, 0);
});

test("cardinal Foundry rotations map to Web Audio forward", () => {
  const cases = [
    [{x: 100, y: 150}, 0],
    [{x: 50, y: 100}, 90],
    [{x: 100, y: 50}, 180],
    [{x: 150, y: 100}, 270]
  ];

  for (const [emitter, rotation] of cases) {
    const result = toListenerSpace(emitter, listener, rotation);
    near(result.x, 0);
    near(result.z, -50);
  }
});

test("arbitrary rotation remains continuous and preserves planar distance", () => {
  const rotation = 37.25;
  const radians = rotation * (Math.PI / 180);
  const distance = 73;
  const emitter = {
    x: listener.x - (Math.sin(radians) * distance),
    y: listener.y + (Math.cos(radians) * distance)
  };
  const result = toListenerSpace(emitter, listener, rotation);

  near(result.x, 0);
  near(result.z, -distance);
  near(Math.hypot(result.x, result.z), distance);
});

test("diagonal right and rear directions are not quantized", () => {
  const right = toListenerSpace({x: 50, y: 50}, listener, 45);
  assert.ok(right.x > 0);
  near(right.z, 0);

  const rear = toListenerSpace({x: 150, y: 50}, listener, 45);
  near(rear.x, 0);
  assert.ok(rear.z > 0);
});
