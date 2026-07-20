import assert from "node:assert/strict";
import test from "node:test";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";
import { buildPersonalSummaryReadout } from "./personalSummaryPresentation";

const replica: PersonalWorkloadReplicaV1 = {
  schemaVersion: 1,
  replicaId: "replica-1",
  weekId: "2026-W30",
  generatedAt: "2026-07-20T12:00:00.000Z",
  sourceUpdatedAt: "2026-07-20T11:59:00.000Z",
  blocks: [],
  capacity: {
    allocatedPct: 74,
    deepWorkPct: 28,
    fragmentedWorkPct: 12,
    meetingPct: 18,
    reactivePct: 21.6,
    plannedPct: 52.4,
    blockedPct: 6.4,
    reliableNewWorkCapacityPct: 17.6,
    committedUtilizationPct: 76.4,
    carryoverRiskPct: 31.5,
    wipLoadScore: 0.44,
    contextSwitchScore: 0.38,
    summaryConfidence: 0.84,
  },
};

test("personal Summary readout uses positive-allowlist capacity fields only", () => {
  assert.deepEqual(buildPersonalSummaryReadout(replica), {
    headline: "You have 18% dependable capacity for new planned work.",
    assessment:
      "This deterministic readout reflects the newest review-safe allocation received from your Mac. It is not an AI-generated narrative.",
    signals: [
      "76% committed · 18% available",
      "52% planned · 22% reactive",
      "32% carryover risk · 6% blocked",
    ],
    weekLabel: "2026-W30",
  });
});

test("personal Summary fails closed when no replica is available", () => {
  assert.equal(buildPersonalSummaryReadout(null), null);
});
