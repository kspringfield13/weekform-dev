import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  buildSyncAuditEntries,
  filterSyncAuditEntries,
} from "./individualHistoryPresentation";

const componentUrl = new URL(
  "../components/IndividualHistorySettings.tsx",
  import.meta.url,
);

const replicas = [
  {
    replicaId: "replica-new",
    weekId: "2026-W30",
    revision: "rev-2",
    syncedAt: "2026-07-20T13:00:00.000Z",
  },
  {
    replicaId: "replica-old",
    weekId: "2026-W29",
    revision: "rev-1",
    syncedAt: "2026-07-13T13:00:00.000Z",
  },
];

test("Web Audit can search its review-safe receipt fields like the Desktop audit stream", () => {
  const entries = buildSyncAuditEntries(replicas);

  assert.deepEqual(
    filterSyncAuditEntries(entries, "2026-w29").map((entry) => entry.replicaId),
    ["replica-old"],
  );
  assert.deepEqual(
    filterSyncAuditEntries(entries, "REV-2").map((entry) => entry.replicaId),
    ["replica-new"],
  );
  assert.deepEqual(filterSyncAuditEntries(entries, "review-safe week").length, 2);
  assert.deepEqual(filterSyncAuditEntries(entries, "no such receipt"), []);
});

test("Web Audit exposes the Desktop-shaped search, no-match, and clear-search states", () => {
  assert.equal(existsSync(componentUrl), true);
  const source = existsSync(componentUrl) ? readFileSync(componentUrl, "utf8") : "";

  assert.match(source, /aria-label="Search sync receipts"/);
  assert.match(source, /placeholder="Search sync receipts"/);
  assert.match(source, /No receipts match/);
  assert.match(source, /Clear search/);
  assert.match(source, /filterSyncAuditEntries/);

  // Search must stay entirely on the already-parsed replica projection.
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(|createClient\(/);
});
