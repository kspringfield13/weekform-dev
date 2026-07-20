import assert from "node:assert/strict";
import test from "node:test";

import {
  GETTING_STARTED_STEP_IDS,
  resolveGettingStartedExit,
} from "./gettingStartedFlow";

test("the branded introduction is the first step of the setup wizard", () => {
  assert.deepEqual(GETTING_STARTED_STEP_IDS, [
    "intro",
    "privacy",
    "tracking",
    "retention",
    "ai",
    "start",
  ]);
});

test("completing setup with tracking enabled lands on Settings", () => {
  assert.deepEqual(resolveGettingStartedExit(false), {
    auditOutcome: "enabled",
    status: "complete",
    screen: "setup",
  });
});

test("deferring setup with tracking paused still lands on Settings", () => {
  assert.deepEqual(resolveGettingStartedExit(true), {
    auditOutcome: "skipped",
    status: "skipped",
    screen: "setup",
  });
});
