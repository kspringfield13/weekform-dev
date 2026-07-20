import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewSafeActivity,
  buildSyncAuditEntries,
  filterReviewSafeActivity,
} from "./individualHistoryPresentation";

const replicas = [
  {
    replicaId: "replica-new",
    weekId: "2026-W30",
    revision: "rev-2",
    syncedAt: "2026-07-20T13:00:00.000Z",
    payload: {
      blocks: [
        {
          blockId: "block-late",
          weekId: "2026-W30",
          startTime: "2026-07-20T15:00:00.000Z",
          endTime: "2026-07-20T16:30:00.000Z",
          estimatedCapacityPct: 8.4,
          category: "QA / data validation",
          mode: "Deep work",
          plannedStatus: "planned",
          confidence: 0.86,
          userVerified: true,
          blockerFlag: false,
          revision: "block-rev-2",
        },
        {
          blockId: "block-early",
          weekId: "2026-W30",
          startTime: "2026-07-20T12:00:00.000Z",
          endTime: "2026-07-20T12:30:00.000Z",
          estimatedCapacityPct: 2.1,
          category: "Meetings / stakeholder syncs",
          mode: "Collaborative",
          plannedStatus: "fixed",
          confidence: 0.74,
          userVerified: false,
          blockerFlag: false,
          revision: "block-rev-1",
        },
      ],
    },
  },
  {
    replicaId: "replica-old",
    weekId: "2026-W29",
    revision: "rev-1",
    syncedAt: "2026-07-13T13:00:00.000Z",
    payload: { blocks: [] },
  },
];

test("review-safe activity is sorted newest first and retains correction state", () => {
  const activity = buildReviewSafeActivity(replicas as never);

  assert.deepEqual(activity.map((row) => row.blockId), ["block-late", "block-early"]);
  assert.equal(activity[0]?.durationMinutes, 90);
  assert.equal(activity[0]?.reviewStatus, "Reviewed");
  assert.equal(activity[1]?.reviewStatus, "Needs review");
});

test("activity search is case-insensitive across category, mode, week, and status", () => {
  const activity = buildReviewSafeActivity(replicas as never);

  assert.deepEqual(filterReviewSafeActivity(activity, "deep WORK").map((row) => row.blockId), ["block-late"]);
  assert.deepEqual(filterReviewSafeActivity(activity, "needs review").map((row) => row.blockId), ["block-early"]);
  assert.deepEqual(filterReviewSafeActivity(activity, "2026-w30").length, 2);
});

test("audit entries describe only completed review-safe replica syncs", () => {
  const entries = buildSyncAuditEntries(replicas as never);

  assert.deepEqual(entries.map((entry) => entry.replicaId), ["replica-new", "replica-old"]);
  assert.equal(entries[0]?.title, "Review-safe week synced");
  assert.match(entries[0]?.summary ?? "", /derived workload fields/i);
  assert.doesNotMatch(JSON.stringify(entries), /raw activity|window title|screenshot/i);
});

test("invalid block time ranges fail loudly instead of producing a misleading duration", () => {
  const invalid = structuredClone(replicas);
  invalid[0]!.payload.blocks[0]!.endTime = "2026-07-20T14:00:00.000Z";

  assert.throws(
    () => buildReviewSafeActivity(invalid as never),
    /invalid review-safe block time range/i,
  );
});
