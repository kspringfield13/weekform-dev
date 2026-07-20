import assert from "node:assert/strict";
import test from "node:test";
import { buildSmoothTrendPath } from "../lib/trendPath";

test("capacity trend paths curve through every observed weekly value", () => {
  const path = buildSmoothTrendPath([
    { x: 0, y: 60 },
    { x: 40, y: 30 },
    { x: 80, y: 70 },
    { x: 120, y: 45 },
  ]);

  assert.match(path, /^M 0 60 C /);
  assert.match(path, /40 30 C /);
  assert.match(path, /80 70 C /);
  assert.match(path, /120 45$/);
  assert.doesNotMatch(path, /\bL\b|\bQ\b/);
});

test("capacity trend paths keep a single observation stationary", () => {
  assert.equal(buildSmoothTrendPath([{ x: 34, y: 120 }]), "M 34 120");
});
