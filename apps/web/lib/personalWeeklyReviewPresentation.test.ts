import assert from "node:assert/strict";
import test from "node:test";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";
import type { PersonalReplicaView } from "./personalReplica";
import { buildPersonalWeeklyReviewPresentation } from "./personalWeeklyReviewPresentation";

function replica(
  blocks: PersonalWorkloadReplicaV1["blocks"],
  weekId = "2026-W30",
): PersonalReplicaView {
  const payload: PersonalWorkloadReplicaV1 = {
    schemaVersion: 1,
    replicaId: `replica-${weekId}`,
    weekId,
    generatedAt: "2026-07-20T12:00:00.000Z",
    sourceUpdatedAt: "2026-07-20T11:58:00.000Z",
    blocks,
    capacity: {
      allocatedPct: 72,
      deepWorkPct: 30,
      fragmentedWorkPct: 18,
      meetingPct: 24,
      reactivePct: 20,
      plannedPct: 48,
      blockedPct: 4,
      reliableNewWorkCapacityPct: 28,
      committedUtilizationPct: 72,
      carryoverRiskPct: 17,
      wipLoadScore: 40,
      contextSwitchScore: 36,
      summaryConfidence: 0.84,
    },
  };
  return {
    replicaId: payload.replicaId,
    weekId,
    revision: `replica-revision-${weekId}`,
    syncedAt: "2026-07-20T12:01:00.000Z",
    payload,
  };
}

function block(blockId: string, userVerified: boolean): PersonalWorkloadReplicaV1["blocks"][number] {
  return {
    blockId,
    weekId: "2026-W30",
    startTime: "2026-07-20T13:00:00.000Z",
    endTime: "2026-07-20T14:00:00.000Z",
    estimatedCapacityPct: 10,
    category: "Planned analysis / project work",
    mode: "Deep work",
    plannedStatus: "planned",
    confidence: 0.9,
    userVerified,
    blockerFlag: false,
    revision: `revision-${blockId}`,
  };
}

test("Weekly Review derives verified and unverified counts from the latest review-safe replica", () => {
  const presentation = buildPersonalWeeklyReviewPresentation([
    replica([block("verified-a", true), block("pending", false), block("verified-b", true)]),
  ]);

  assert.equal(presentation.status, "connected");
  assert.equal(presentation.weekId, "2026-W30");
  assert.equal(presentation.items[0]?.id, "work_blocks");
  assert.equal(presentation.items[0]?.status, "needs_attention");
  assert.equal(presentation.items[0]?.count, 1);
  assert.equal(presentation.doneCount, 0);
  assert.equal(presentation.pendingCount, 4);
});

test("Weekly Review has deterministic Desktop order and never invents omitted local checks", () => {
  const presentation = buildPersonalWeeklyReviewPresentation([
    replica([block("verified", true)]),
  ]);

  assert.deepEqual(
    presentation.items.map((item) => item.id),
    ["work_blocks", "forecast_accuracy", "narrative", "completion"],
  );
  assert.equal(presentation.items[0]?.status, "ready");
  for (const item of presentation.items.slice(1)) {
    assert.equal(
      item.status,
      "mac_only",
      `${item.id} cannot be Ready because the positive-allowlist replica omits its evidence`,
    );
  }
  assert.equal(presentation.doneCount, 1);
  assert.equal(presentation.pendingCount, 3);
  assert.deepEqual(
    presentation.items.map((item) => item.target),
    ["today", "forecast", "summary", "mac"],
  );
});

test("zero-block and missing-replica states never turn absent review truth into Ready", () => {
  const zeroBlocks = buildPersonalWeeklyReviewPresentation([replica([])]);
  assert.equal(zeroBlocks.status, "connected");
  assert.notEqual(zeroBlocks.items[0]?.status, "ready");
  assert.equal(zeroBlocks.doneCount, 0);
  assert.equal(zeroBlocks.pendingCount, 4);

  const empty = buildPersonalWeeklyReviewPresentation([]);
  assert.equal(empty.status, "waiting");
  assert.equal(empty.weekId, null);
  assert.equal(empty.doneCount, 0);
  assert.equal(empty.pendingCount, 4);
  assert.ok(empty.items.every((item) => item.status === "mac_only"));
});

test("every Weekly Review Mac target truthfully describes the download acquisition", () => {
  for (const presentation of [
    buildPersonalWeeklyReviewPresentation([]),
    buildPersonalWeeklyReviewPresentation([replica([block("pending", false)])]),
  ]) {
    const macTargets = presentation.items.filter((item) => item.target === "mac");
    assert.ok(macTargets.length > 0);
    assert.ok(
      macTargets.every((item) => item.actionLabel === "Get Weekform for Mac"),
      "ReviewAction routes Mac targets to /download, so their labels must describe acquisition rather than execution",
    );
  }
});
