import assert from "node:assert/strict";
import test from "node:test";

import { resolveWebTrackingHandoff } from "./webTrackingHandoff";

test("a signed-in desktop handoff opens compact view and starts tracking", () => {
  assert.deepEqual(resolveWebTrackingHandoff(true), {
    startTracking: true,
    windowMode: "compact",
    screen: null,
    settingsTab: null,
  });
});

test("a signed-out desktop handoff opens Account sign-in without changing tracking", () => {
  assert.deepEqual(resolveWebTrackingHandoff(false), {
    startTracking: false,
    windowMode: "large",
    screen: "setup",
    settingsTab: "account",
  });
});
