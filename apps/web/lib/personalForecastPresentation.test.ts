import assert from "node:assert/strict";
import test from "node:test";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";
import {
  buildPersonalForecastPresentation,
  nextIsoWeekId,
} from "./personalForecastPresentation";

function replica(weekId: string, reliable: number, overrides: Partial<PersonalWorkloadReplicaV1["capacity"]> = {}): PersonalWorkloadReplicaV1 {
  return {
    schemaVersion: 1,
    replicaId: `replica-${weekId}`,
    weekId,
    generatedAt: "2026-07-20T12:00:00.000Z",
    sourceUpdatedAt: "2026-07-20T11:58:00.000Z",
    blocks: [],
    capacity: {
      allocatedPct: 75,
      deepWorkPct: 31,
      fragmentedWorkPct: 20,
      meetingPct: 24,
      reactivePct: 22,
      plannedPct: 48,
      blockedPct: 4,
      reliableNewWorkCapacityPct: reliable,
      committedUtilizationPct: 75,
      carryoverRiskPct: 18,
      wipLoadScore: 42,
      contextSwitchScore: 38,
      summaryConfidence: 0.82,
      ...overrides,
    },
  };
}

test("nextIsoWeekId crosses the ISO week-year boundary correctly", () => {
  assert.equal(nextIsoWeekId("2026-W29"), "2026-W30");
  assert.equal(nextIsoWeekId("2026-W53"), "2027-W01");
  assert.equal(nextIsoWeekId("not-a-week"), null);
});

test("empty history produces an honest unavailable state with no invented number", () => {
  const result = buildPersonalForecastPresentation([]);
  assert.equal(result.status, "unavailable");
  assert.equal(result.targetWeekId, null);
  assert.equal(result.scenarios, null);
  assert.match(result.explanation, /no review-safe workload replica/i);
});

test("one synced week is labeled as a baseline rather than an AI forecast", () => {
  const result = buildPersonalForecastPresentation([replica("2026-W29", 34)]);
  assert.equal(result.status, "baseline");
  assert.equal(result.targetWeekId, "2026-W30");
  assert.deepEqual(result.scenarios, { conservative: 34, likely: 34, optimistic: 34 });
  assert.equal(result.historyWeekCount, 1);
  assert.match(result.explanation, /deterministic baseline/i);
  assert.doesNotMatch(result.explanation, /AI generated/i);
});

test("history produces desktop-style scenarios from bounded derived replica values", () => {
  const result = buildPersonalForecastPresentation([
    replica("2026-W27", 20),
    replica("2026-W28", 35),
    replica("2026-W29", 30, { reactivePct: 38, carryoverRiskPct: 31 }),
  ]);

  assert.equal(result.status, "history");
  assert.deepEqual(result.scenarios, { conservative: 20, likely: 30, optimistic: 35 });
  assert.deepEqual(result.risks.map((risk) => risk.key), ["carryover", "reactive"]);
  assert.match(result.recommendation, /30%/);
  assert.equal(result.confidencePct, 82);
});

test("invalid, duplicate, and excessive history are normalized without widening storage or data", () => {
  const rows = [
    replica("2026-W22", 99),
    replica("2026-W23", 80),
    replica("2026-W24", Number.NaN),
    replica("2026-W25", -10),
    replica("2026-W26", 15),
    replica("2026-W27", 25),
    replica("2026-W28", 35),
    replica("2026-W29", 45),
    replica("2026-W29", 90),
  ];
  const result = buildPersonalForecastPresentation(rows);

  assert.equal(result.historyWeekCount, 6);
  assert.deepEqual(result.scenarios, { conservative: 0, likely: 30, optimistic: 80 });
});
