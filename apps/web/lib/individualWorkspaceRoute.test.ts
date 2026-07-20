import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveIndividualWorkspaceRoute,
  screenForIndividualWorkspaceRoute,
} from "./individualWorkspaceRoute";

const desktopScreenMappings = [
  ["daily", { destination: "today", subview: "today" }],
  ["weekly", { destination: "week", subview: "capacity" }],
  ["forecast", { destination: "week", subview: "forecast" }],
  ["weekly-review", { destination: "week", subview: "review" }],
  ["usage", { destination: "week", subview: "usage" }],
  ["narrative", { destination: "week", subview: "summary" }],
  ["agent", { destination: "agent", subview: "agent" }],
  ["accelerate", { destination: "agent", subview: "accelerate" }],
  ["skills", { destination: "agent", subview: "skills" }],
  ["ledger", { destination: "history", subview: "activity" }],
  ["audit", { destination: "history", subview: "audit" }],
  ["sensitive", { destination: "history", subview: "sensitive" }],
  ["setup", { destination: "settings", subview: "settings" }],
] as const;

test("every review-safe Desktop screen resolves to its matching Individual Web surface", () => {
  for (const [screen, expected] of desktopScreenMappings) {
    assert.deepEqual(resolveIndividualWorkspaceRoute(screen), expected, screen);
  }
});

test("Individual Web routes serialize back to canonical Desktop screen names", () => {
  for (const [screen, route] of desktopScreenMappings) {
    assert.equal(screenForIndividualWorkspaceRoute(route), screen, screen);
  }
});

test("unknown screens fail closed to Week Capacity", () => {
  const fallback = { destination: "week", subview: "capacity" };

  for (const input of [undefined, null, "", "unknown", 42]) {
    assert.deepEqual(resolveIndividualWorkspaceRoute(input), fallback);
  }
});

test("cross-section navigation cannot create a silently blank workspace", () => {
  assert.deepEqual(
    resolveIndividualWorkspaceRoute({ destination: "week", subview: "audit" }),
    { destination: "week", subview: "capacity" },
  );
  assert.deepEqual(
    resolveIndividualWorkspaceRoute({ destination: "history", subview: "forecast" }),
    { destination: "history", subview: "activity" },
  );
  assert.deepEqual(
    resolveIndividualWorkspaceRoute({ destination: "agent", subview: "skills" }),
    { destination: "agent", subview: "skills" },
  );
});
