import assert from "node:assert/strict";
import test from "node:test";

import {
  GETTING_STARTED_STEPS,
  GETTING_STARTED_STEP_IDS,
  resolveGettingStartedDemoExit,
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

test("setup steps expose plain-language progress labels and distinct decisions", () => {
  assert.deepEqual(GETTING_STARTED_STEPS, [
    { id: "intro", label: "Welcome", title: "Know what fits before you commit." },
    { id: "privacy", label: "Your data", title: "Your activity stays under your control." },
    { id: "tracking", label: "Activity", title: "Build your week from real activity." },
    { id: "retention", label: "Retention", title: "Choose how long raw samples stay." },
    {
      id: "ai",
      label: "AI assistance",
      title: "Connect ChatGPT / Codex for the best experience.",
    },
    { id: "start", label: "Finish", title: "Your setup is ready to review." },
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

test("the simulated-week handoff completes setup and opens the synthetic weekly view", () => {
  assert.deepEqual(resolveGettingStartedDemoExit(false), {
    auditOutcome: "enabled",
    status: "complete",
    destination: "simulated_demo",
    href: "?demo=1&screen=weekly",
  });
});

test("the simulated-week handoff preserves a deferred tracking choice", () => {
  assert.deepEqual(resolveGettingStartedDemoExit(true), {
    auditOutcome: "skipped",
    status: "skipped",
    destination: "simulated_demo",
    href: "?demo=1&screen=weekly",
  });
});
