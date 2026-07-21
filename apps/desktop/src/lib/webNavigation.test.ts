import assert from "node:assert/strict";
import test from "node:test";

import { shouldConsumePendingWebNavigation } from "./webNavigation";

test("a pending Web page handoff waits until local Desktop hydration has settled", () => {
  assert.equal(shouldConsumePendingWebNavigation(true, false), false);
  assert.equal(shouldConsumePendingWebNavigation(true, true), true);
});

test("browser renders never consume the native handoff queue", () => {
  assert.equal(shouldConsumePendingWebNavigation(false, false), false);
  assert.equal(shouldConsumePendingWebNavigation(false, true), false);
});
