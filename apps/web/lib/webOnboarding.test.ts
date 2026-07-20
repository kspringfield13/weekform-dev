import assert from "node:assert/strict";
import test from "node:test";

import {
  WEB_ONBOARDING_VERSION,
  webOnboardingStorageKey,
  webOnboardingSteps,
} from "./webOnboarding";

test("individual Web onboarding mirrors the Desktop welcome, tour, and finish arc", () => {
  const steps = webOnboardingSteps(false);

  assert.equal(steps[0]?.id, "tour");
  assert.equal(steps.at(-1)?.id, "ready");
  assert.ok(steps.some((step) => step.target === "#workspace-overview"));
  assert.ok(steps.some((step) => step.target === "#personal-workspace"));
  assert.ok(steps.some((step) => step.target === "#teams"));
  assert.ok(steps.some((step) => step.target === "#sharing"));
  assert.equal(steps.some((step) => step.id === "manager"), false);
});

test("authorized managers get the complete individual tour plus Manager Access", () => {
  const individual = webOnboardingSteps(false);
  const manager = webOnboardingSteps(true);

  assert.equal(manager.length, individual.length + 1);
  assert.deepEqual(
    manager.filter((step) => step.id === "manager").map((step) => step.target),
    ["#manager-entry"],
  );
  assert.equal(manager.at(-1)?.id, "ready");
});

test("Web onboarding completion is versioned and scoped to the signed-in user", () => {
  assert.match(WEB_ONBOARDING_VERSION, /^v\d+$/);
  assert.notEqual(webOnboardingStorageKey("user-a"), webOnboardingStorageKey("user-b"));
  assert.match(webOnboardingStorageKey("user-a"), new RegExp(WEB_ONBOARDING_VERSION));
});
