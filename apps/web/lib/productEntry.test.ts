import assert from "node:assert/strict";
import test from "node:test";

import { PRODUCT_ENTRIES } from "./productEntry";

test("Weekform exposes one stable web entry and one Mac download entry", () => {
  assert.deepEqual(
    PRODUCT_ENTRIES.map(({ id, href }) => ({ id, href })),
    [
      { id: "web", href: "/app" },
      { id: "mac", href: "/download" },
    ],
  );
});

test("entry copy keeps browser and native capabilities distinct", () => {
  const web = PRODUCT_ENTRIES.find(({ id }) => id === "web");
  const mac = PRODUCT_ENTRIES.find(({ id }) => id === "mac");

  assert.ok(web?.capabilities.includes("private review-safe workspace"));
  assert.ok(web?.capabilities.includes("shared workload snapshots"));
  assert.ok(web?.limitations.includes("does not capture Mac activity"));
  assert.ok(web?.limitations.includes("approval on your Mac"));
  assert.ok(mac?.capabilities.includes("local activity capture"));
  assert.ok(mac?.limitations.includes("macOS"));
});
