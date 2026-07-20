import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";
import { buildPersonalForecastPresentation } from "./personalForecastPresentation";

function replica(
  weekId: string,
  reliable: number,
  sourceUpdatedAt: string,
  summaryConfidence = 0.8,
  overrides: Partial<PersonalWorkloadReplicaV1["capacity"]> = {},
): PersonalWorkloadReplicaV1 {
  return {
    schemaVersion: 1,
    replicaId: `replica-${weekId}-${sourceUpdatedAt}`,
    weekId,
    generatedAt: sourceUpdatedAt,
    sourceUpdatedAt,
    blocks: [],
    capacity: {
      allocatedPct: 70,
      deepWorkPct: 30,
      fragmentedWorkPct: 20,
      meetingPct: 25,
      reactivePct: 20,
      plannedPct: 50,
      blockedPct: 5,
      reliableNewWorkCapacityPct: reliable,
      committedUtilizationPct: 70,
      carryoverRiskPct: 18,
      wipLoadScore: 40,
      contextSwitchScore: 35,
      summaryConfidence,
      ...overrides,
    },
  };
}

test("one review-safe week remains a baseline point, not an invented trend delta", () => {
  const result = buildPersonalForecastPresentation([
    replica("2026-W29", 32, "2026-07-19T10:00:00.000Z", 0.84),
  ]);

  assert.deepEqual(result.trajectory, [
    {
      weekId: "2026-W29",
      allocatedPct: 70,
      reactivePct: 20,
      deepWorkPct: 30,
      reliableCapacityPct: 32,
      meetingPct: 25,
      summaryConfidencePct: 84,
    },
  ]);
  assert.equal(result.trajectoryDeltaPts, null);
});

test("Forecast exposes a chronological review-safe trajectory and latest-versus-earliest delta", () => {
  const result = buildPersonalForecastPresentation([
    replica("2026-W29", 34, "2026-07-19T10:00:00.000Z", 0.86, { allocatedPct: 66, reactivePct: 18, deepWorkPct: 36, meetingPct: 20 }),
    replica("2026-W27", 20, "2026-07-05T10:00:00.000Z", 0.72, { allocatedPct: 82, reactivePct: 36, deepWorkPct: 21, meetingPct: 34 }),
    replica("2026-W28", 25, "2026-07-12T10:00:00.000Z", 0.79, { allocatedPct: 74, reactivePct: 27, deepWorkPct: 28, meetingPct: 26 }),
  ]);

  assert.deepEqual(result.trajectory, [
    { weekId: "2026-W27", allocatedPct: 82, reactivePct: 36, deepWorkPct: 21, reliableCapacityPct: 20, meetingPct: 34, summaryConfidencePct: 72 },
    { weekId: "2026-W28", allocatedPct: 74, reactivePct: 27, deepWorkPct: 28, reliableCapacityPct: 25, meetingPct: 26, summaryConfidencePct: 79 },
    { weekId: "2026-W29", allocatedPct: 66, reactivePct: 18, deepWorkPct: 36, reliableCapacityPct: 34, meetingPct: 20, summaryConfidencePct: 86 },
  ]);
  assert.equal(result.trajectoryDeltaPts, 14);
});

test("duplicate-week forecast and trajectory use the freshest replica independent of response order", () => {
  const freshest = replica("2026-W29", 38, "2026-07-20T12:00:00.000Z", 0.91, { reactivePct: 18 });
  const stale = replica("2026-W29", 12, "2026-07-19T12:00:00.000Z", 0.41, { reactivePct: 52 });
  const prior = replica("2026-W28", 24, "2026-07-13T12:00:00.000Z", 0.76);

  for (const rows of [[stale, prior, freshest], [freshest, prior, stale]]) {
    const result = buildPersonalForecastPresentation(rows);

    assert.deepEqual(result.scenarios, {
      conservative: 24,
      likely: 31,
      optimistic: 38,
    });
    assert.deepEqual(result.trajectory.at(-1), {
      weekId: "2026-W29",
      allocatedPct: 70,
      reactivePct: 18,
      deepWorkPct: 30,
      reliableCapacityPct: 38,
      meetingPct: 25,
      summaryConfidencePct: 91,
    });
    assert.equal(result.trajectoryDeltaPts, 14);
  }
});

test("Web Forecast renders an accessible observed-baseline track record with an explicit accuracy boundary", () => {
  const source = readFileSync(
    new URL("../components/PersonalForecastScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /Weekly capacity trajectory/);
  assert.match(source, /Synced baseline track record/);
  assert.match(source, /aria-label=(?:["'][^"']*(?:trajectory|track record|baselines)[^"']*["']|\{`Reliable new-work capacity)/i);
  assert.match(source, /not forecast accuracy/i);
  assert.match(source, /cannot claim predicted-versus-actual accuracy/i);
  for (const label of ["Allocated", "Reactive", "Deep work", "Reliable capacity", "Meeting density"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /<table\b/);
  assert.match(source, /aria-describedby=["']personal-forecast-trajectory-table["']/);
  assert.match(source, /id=["']personal-forecast-trajectory-table["']/);
  assert.doesNotMatch(
    source,
    /<span[^>]*>\s*(?:predicted|forecast)\s*<\/span>[\s\S]{0,300}<span[^>]*>\s*actual\s*<\/span>/i,
    "Web must not render a predicted-versus-actual metric pair that the replica schema cannot support",
  );
});
