// Focused tests for the pure next-week team capacity forecast module (no
// Supabase, no network, no wall clock). Run: npx tsx --test apps/web/lib/forecast.test.ts
// (root: npm run test:web)

import test from "node:test";
import assert from "node:assert/strict";

import type { LatestSnapshot } from "./snapshots";
import { MIN_SCENARIO_SHARED_COUNT, MIN_SCENARIO_SHARED_RATIO } from "./scenario";
import {
  FORECAST_BASIS_LABEL,
  FORECAST_METRIC_KEYS,
  forecastTeamCapacity,
  scoreForecastAccuracyMirror,
} from "./forecast";

const NOW = "2026-07-19T12:00:00.000Z";

function hoursBefore(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 60 * 60 * 1000).toISOString();
}

/** Current-week snapshot, observed 2h ago (fresh) unless overridden. */
function snapshot(
  overrides: Partial<LatestSnapshot> & { userId: string },
): LatestSnapshot {
  return {
    teamId: "team-1",
    weekId: "2026-W29",
    observedAt: hoursBefore(2),
    sourceUpdatedAt: hoursBefore(3),
    shareLevel: "summary",
    reliableCapacityPct: null,
    reactivePct: null,
    meetingPct: null,
    fragmentedPct: null,
    summaryConfidence: null,
    reviewedBlocks: 0,
    eligibleBlocks: 0,
    ...overrides,
  };
}

/** Snapshot for an earlier week; observedAt deliberately stale-aged, because
 * history is old by definition and must still feed the forecast basis. */
function weekSnapshot(
  weekId: string,
  ageDays: number,
  overrides: Partial<LatestSnapshot> & { userId: string },
): LatestSnapshot {
  return snapshot({ weekId, observedAt: hoursBefore(ageDays * 24), ...overrides });
}

/** The three-week reliable-capacity fixture used across calibration tests:
 * W27 medians 45, W28 median 50, W29 median 46 (members a and b). */
function threeWeekHistory(): LatestSnapshot[] {
  return [
    snapshot({ userId: "a", weekId: "2026-W29", reliableCapacityPct: 44 }),
    snapshot({ userId: "b", weekId: "2026-W29", reliableCapacityPct: 48 }),
    weekSnapshot("2026-W28", 9, { userId: "a", reliableCapacityPct: 48 }),
    weekSnapshot("2026-W28", 9, { userId: "b", reliableCapacityPct: 52 }),
    weekSnapshot("2026-W27", 16, { userId: "a", reliableCapacityPct: 40 }),
    weekSnapshot("2026-W27", 16, { userId: "b", reliableCapacityPct: 50 }),
  ];
}

test("empty history: no-history verdict, nothing fabricated, coverage 0 of roster", () => {
  const result = forecastTeamCapacity(3, [], NOW);
  assert.equal(result.verdict, "no-history");
  assert.equal(result.latestWeekId, null);
  assert.equal(result.memberCount, 3);
  assert.equal(result.sharedCount, 0);
  assert.equal(result.coverageRatio, 0);
  for (const key of FORECAST_METRIC_KEYS) {
    assert.equal(result.metrics[key].forecast, null);
    assert.equal(result.metrics[key].weekCount, 0);
    assert.deepEqual(result.metrics[key].calibration, []);
  }
  assert.equal(result.calibrationSummary.scoredCount, 0);
  assert.equal(result.calibrationSummary.hitCount, 0);
  assert.equal(result.calibrationSummary.hitRatePct, null);
  assert.equal(result.calibrationSummary.meanAbsErrorPts, null);
  assert.equal(result.basisLabel, FORECAST_BASIS_LABEL);
});

test("history with rows but no shared metric anywhere is no-history, not a zero forecast", () => {
  const result = forecastTeamCapacity(
    2,
    [snapshot({ userId: "a" }), snapshot({ userId: "b" })],
    NOW,
  );
  assert.equal(result.verdict, "no-history");
  for (const key of FORECAST_METRIC_KEYS) {
    assert.equal(result.metrics[key].forecast, null);
  }
});

test("single week: forecast equals that week's medians, range collapses, no calibration invented", () => {
  const result = forecastTeamCapacity(
    2,
    [
      snapshot({ userId: "a", reliableCapacityPct: 40, meetingPct: 30 }),
      snapshot({ userId: "b", reliableCapacityPct: 50, meetingPct: 34 }),
    ],
    NOW,
  );
  assert.equal(result.verdict, "forecast");
  assert.equal(result.latestWeekId, "2026-W29");
  assert.equal(result.sharedCount, 2);
  assert.equal(result.coverageRatio, 1);
  const capacity = result.metrics.reliableCapacityPct;
  assert.deepEqual(capacity.forecast, { median: 45, min: 45, max: 45 });
  assert.equal(capacity.weekCount, 1);
  assert.deepEqual(capacity.calibration, []);
  const meetings = result.metrics.meetingPct;
  assert.deepEqual(meetings.forecast, { median: 32, min: 32, max: 32 });
  // Metrics nobody shared stay null — never zero.
  assert.equal(result.metrics.reactivePct.forecast, null);
  assert.equal(result.metrics.reactivePct.weekCount, 0);
  assert.equal(result.calibrationSummary.scoredCount, 0);
});

test("coverage below member minimum: insufficient-shared-data and no numeric forecast", () => {
  // Roster of 5; only one member shares fresh data (below MIN_SCENARIO_SHARED_COUNT).
  assert.ok(MIN_SCENARIO_SHARED_COUNT >= 2);
  const result = forecastTeamCapacity(
    5,
    [
      snapshot({ userId: "a", reliableCapacityPct: 40 }),
      // Same week but stale — excluded and counted, never treated as current.
      snapshot({
        userId: "b",
        reliableCapacityPct: 10,
        observedAt: hoursBefore(10 * 24),
      }),
    ],
    NOW,
  );
  assert.equal(result.verdict, "insufficient-shared-data");
  assert.equal(result.sharedCount, 1);
  assert.equal(result.excludedStaleCount, 1);
  for (const key of FORECAST_METRIC_KEYS) {
    assert.equal(result.metrics[key].forecast, null);
  }
});

test("coverage below roster ratio: insufficient-shared-data even with two sharers", () => {
  // 2 of 5 sharing = 0.4 coverage, below MIN_SCENARIO_SHARED_RATIO (0.5).
  assert.ok(MIN_SCENARIO_SHARED_RATIO > 0.4);
  const result = forecastTeamCapacity(
    5,
    [
      snapshot({ userId: "a", reliableCapacityPct: 40 }),
      snapshot({ userId: "b", reliableCapacityPct: 50 }),
    ],
    NOW,
  );
  assert.equal(result.verdict, "insufficient-shared-data");
  assert.equal(result.sharedCount, 2);
  assert.equal(result.coverageRatio, 0.4);
  for (const key of FORECAST_METRIC_KEYS) {
    assert.equal(result.metrics[key].forecast, null);
  }
});

test("all history stale: insufficient-shared-data, stale rows counted, never treated as current", () => {
  const result = forecastTeamCapacity(
    2,
    [
      weekSnapshot("2026-W27", 16, { userId: "a", reliableCapacityPct: 40 }),
      weekSnapshot("2026-W27", 16, { userId: "b", reliableCapacityPct: 50 }),
    ],
    NOW,
  );
  assert.equal(result.verdict, "insufficient-shared-data");
  assert.equal(result.sharedCount, 0);
  assert.equal(result.excludedStaleCount, 2);
  for (const key of FORECAST_METRIC_KEYS) {
    assert.equal(result.metrics[key].forecast, null);
  }
});

test("calibration: hit/miss accounting against each past forecast's stated range", () => {
  const result = forecastTeamCapacity(2, threeWeekHistory(), NOW);
  assert.equal(result.verdict, "forecast");

  const capacity = result.metrics.reliableCapacityPct;
  // Current forecast: median of weekly medians [45, 50, 46] with their spread.
  assert.deepEqual(capacity.forecast, { median: 46, min: 45, max: 50 });
  assert.equal(capacity.weekCount, 3);

  // Two scorable past weeks (W28 forecast from W27; W29 from W27+W28).
  assert.equal(capacity.calibration.length, 2);
  const [w29, w28] = capacity.calibration; // newest first
  assert.ok(w28 && w29);

  // W28: predicted 45 (range 45–45), actual 50 → outside range (miss), but
  // the accuracy rating (desktop scorer semantics) is still "on_target".
  assert.equal(w28.weekId, "2026-W28");
  assert.deepEqual(w28.predicted, { median: 45, min: 45, max: 45 });
  assert.equal(w28.actual, 50);
  assert.equal(w28.insideRange, false);
  assert.equal(w28.accuracy.signedErrorPts, -5);
  assert.equal(w28.accuracy.errorPts, 5);
  assert.equal(w28.accuracy.rating, "on_target");

  // W29: predicted 47.5 (range 45–50), actual 46 → inside range (hit).
  assert.equal(w29.weekId, "2026-W29");
  assert.deepEqual(w29.predicted, { median: 47.5, min: 45, max: 50 });
  assert.equal(w29.actual, 46);
  assert.equal(w29.insideRange, true);
  assert.equal(w29.accuracy.signedErrorPts, 2);
  assert.equal(w29.accuracy.rating, "on_target");

  assert.equal(capacity.hitCount, 1);
  assert.equal(capacity.scoredCount, 2);

  // Summary rolls up across metrics; only reliable capacity was shared.
  assert.equal(result.calibrationSummary.scoredCount, 2);
  assert.equal(result.calibrationSummary.hitCount, 1);
  assert.equal(result.calibrationSummary.hitRatePct, 50);
  // Mean abs error mirrors the desktop rounding: round((5 + 2) / 2) = 4.
  assert.equal(result.calibrationSummary.meanAbsErrorPts, 4);
});

test("widening guard: members who did not share never leak into aggregates", () => {
  const base = forecastTeamCapacity(2, threeWeekHistory(), NOW);

  // Member c is on the roster every week but shares nothing; member d shares
  // ONLY meetingPct. Neither may move the reliable-capacity numbers.
  const widened = forecastTeamCapacity(4, [
    ...threeWeekHistory(),
    snapshot({ userId: "c", weekId: "2026-W29" }),
    weekSnapshot("2026-W28", 9, { userId: "c" }),
    weekSnapshot("2026-W27", 16, { userId: "c" }),
    snapshot({ userId: "d", weekId: "2026-W29", meetingPct: 60 }),
    weekSnapshot("2026-W28", 9, { userId: "d", meetingPct: 55 }),
  ], NOW);

  // Not just unchanged medians: the entire per-metric record (forecast, week
  // count, every calibration entry) must be byte-identical for the metric the
  // extra members did not share.
  assert.deepEqual(
    widened.metrics.reliableCapacityPct,
    base.metrics.reliableCapacityPct,
  );

  // Coverage tells the truth about the bigger roster instead.
  assert.equal(widened.memberCount, 4);
  assert.equal(widened.sharedCount, 3); // a, b, d — c shares nothing
  assert.equal(widened.excludedStaleCount, 0);

  // d's meetings are its own metric — medians only, never a sum: W29 has only
  // d sharing meetings (median 60), W28 only d (median 55).
  assert.deepEqual(widened.metrics.meetingPct.forecast, {
    median: 57.5,
    min: 55,
    max: 60,
  });
});

test("duplicate member-week rows: newest observed_at wins, deterministically", () => {
  const history = [
    snapshot({ userId: "a", reliableCapacityPct: 40, observedAt: hoursBefore(20) }),
    snapshot({ userId: "a", reliableCapacityPct: 44, observedAt: hoursBefore(2) }),
    snapshot({ userId: "b", reliableCapacityPct: 48 }),
  ];
  const result = forecastTeamCapacity(2, history, NOW);
  assert.deepEqual(result.metrics.reliableCapacityPct.forecast, {
    median: 46,
    min: 46,
    max: 46,
  });
});

/**
 * Cross-check fixture shared verbatim with
 * packages/inference/src/capacity.forecastScorer.test.ts. The web scorer
 * mirror must produce EXACTLY these outputs, and the desktop
 * scoreForecastAccuracy is pinned to the same table (field names differ
 * snake/camel; values must not). Update both files together or not at all.
 */
const SCORER_CROSS_CHECK_FIXTURE = [
  { predicted: 42.4, actual: 40, predictedPct: 42, actualPct: 40, errorPts: 2, signedErrorPts: 2, rating: "on_target" },
  { predicted: 30, actual: 42.6, predictedPct: 30, actualPct: 43, errorPts: 13, signedErrorPts: -13, rating: "off" },
  { predicted: 55, actual: 43, predictedPct: 55, actualPct: 43, errorPts: 12, signedErrorPts: 12, rating: "close" },
  { predicted: 40.5, actual: 35.4, predictedPct: 41, actualPct: 35, errorPts: 5, signedErrorPts: 5, rating: "on_target" },
  { predicted: 20, actual: 20, predictedPct: 20, actualPct: 20, errorPts: 0, signedErrorPts: 0, rating: "on_target" },
  { predicted: 0, actual: 6, predictedPct: 0, actualPct: 6, errorPts: 6, signedErrorPts: -6, rating: "close" },
] as const;

test("scorer mirror matches the desktop scoreForecastAccuracy fixture outputs exactly", () => {
  for (const row of SCORER_CROSS_CHECK_FIXTURE) {
    assert.deepEqual(
      scoreForecastAccuracyMirror(row.predicted, row.actual),
      {
        predictedPct: row.predictedPct,
        actualPct: row.actualPct,
        errorPts: row.errorPts,
        signedErrorPts: row.signedErrorPts,
        rating: row.rating,
      },
      `fixture predicted=${row.predicted} actual=${row.actual}`,
    );
  }
});

test("determinism: same inputs always produce the same output", () => {
  const a = forecastTeamCapacity(2, threeWeekHistory(), NOW);
  const b = forecastTeamCapacity(2, threeWeekHistory(), NOW);
  assert.deepEqual(a, b);
});
