import test from "node:test";
import assert from "node:assert/strict";

import {
  REQUEST_FRESH_INTERVAL_MS,
  REQUEST_FRESH_MIN_GAP_MS,
  shouldRequestFreshData,
  type RefreshReason,
} from "./requestFreshness";

const NOW = Date.parse("2026-07-19T18:00:00.000Z");

function decision(
  reason: RefreshReason,
  elapsedMs: number,
  overrides: Partial<{ visible: boolean; online: boolean }> = {},
) {
  return shouldRequestFreshData({
    reason,
    nowMs: NOW,
    lastRequestedAtMs: NOW - elapsedMs,
    visible: overrides.visible ?? true,
    online: overrides.online ?? true,
  });
}

test("interval refresh is bounded to one request per 15-second cadence", () => {
  assert.equal(decision("interval", REQUEST_FRESH_INTERVAL_MS - 1), false);
  assert.equal(decision("interval", REQUEST_FRESH_INTERVAL_MS), true);
  assert.equal(decision("interval", REQUEST_FRESH_INTERVAL_MS * 2), true);
});

test("hidden or offline pages never request fresh server data", () => {
  assert.equal(decision("interval", REQUEST_FRESH_INTERVAL_MS, { visible: false }), false);
  assert.equal(decision("interval", REQUEST_FRESH_INTERVAL_MS, { online: false }), false);
  assert.equal(decision("visible", REQUEST_FRESH_INTERVAL_MS, { visible: false }), false);
  assert.equal(decision("online", REQUEST_FRESH_INTERVAL_MS, { online: false }), false);
});

test("online and visibility resume events refresh promptly but remain throttled", () => {
  assert.equal(decision("visible", REQUEST_FRESH_MIN_GAP_MS - 1), false);
  assert.equal(decision("visible", REQUEST_FRESH_MIN_GAP_MS), true);
  assert.equal(decision("online", REQUEST_FRESH_MIN_GAP_MS), true);
});

test("clock rollback or malformed timestamps fail closed", () => {
  assert.equal(decision("interval", -1), false);
  assert.equal(
    shouldRequestFreshData({
      reason: "interval",
      nowMs: Number.NaN,
      lastRequestedAtMs: NOW,
      visible: true,
      online: true,
    }),
    false,
  );
});
