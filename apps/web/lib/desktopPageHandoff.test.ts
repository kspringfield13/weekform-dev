import assert from "node:assert/strict";
import test from "node:test";

import type { IndividualWorkspaceRoute } from "./individualWorkspaceRoute";
import { desktopPageHandoffUrl } from "./desktopPageHandoff";

const individualRoutes: Array<[IndividualWorkspaceRoute, string]> = [
  [{ destination: "today", subview: "today" }, "daily"],
  [{ destination: "week", subview: "capacity" }, "weekly"],
  [{ destination: "week", subview: "forecast" }, "forecast"],
  [{ destination: "week", subview: "review" }, "weekly-review"],
  [{ destination: "week", subview: "usage" }, "usage"],
  [{ destination: "week", subview: "summary" }, "narrative"],
  [{ destination: "agent", subview: "agent" }, "agent"],
  [{ destination: "agent", subview: "accelerate" }, "accelerate"],
  [{ destination: "agent", subview: "skills" }, "skills"],
  [{ destination: "history", subview: "activity" }, "ledger"],
  [{ destination: "history", subview: "audit" }, "audit"],
  [{ destination: "history", subview: "sensitive" }, "sensitive"],
  [{ destination: "settings", subview: "settings" }, "setup"],
];

test("each Individual Web page opens the matching allowlisted Desktop screen", () => {
  for (const [route, screen] of individualRoutes) {
    assert.equal(
      desktopPageHandoffUrl(route, "individual"),
      `weekform://open?source=weekform.dev&view=large&screen=${screen}`,
    );
  }
});

test("Manager and member Team pages open the Desktop Team workspace", () => {
  for (const mode of ["manager", "team"] as const) {
    for (const [route] of individualRoutes) {
      assert.equal(
        desktopPageHandoffUrl(route, mode),
        "weekform://open?source=weekform.dev&view=large&screen=team",
      );
    }
  }
});

test("an invalid Web route fails closed to Desktop Week", () => {
  assert.equal(
    desktopPageHandoffUrl(
      { destination: "unknown", subview: "unknown" } as unknown as IndividualWorkspaceRoute,
      "individual",
    ),
    "weekform://open?source=weekform.dev&view=large&screen=weekly",
  );
});
