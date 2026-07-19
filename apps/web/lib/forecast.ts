/**
 * Pure, deterministic next-week team capacity forecast for the manager team
 * view (roadmap §A7): "Given this team's own shared history, what does next
 * week look like — and how often have such forecasts actually landed?" No
 * Supabase imports, no network, no Date.now() — callers pass `now` explicitly
 * so every result is reproducible and testable.
 *
 * Honesty rules encoded here (blueprint §14, AGENTS.md invariants):
 * - A metric a member did not share is `null` and is EXCLUDED from every
 *   aggregate. It is never coerced to zero — unknown is not zero, and it is
 *   not capacity either.
 * - Forecasts are medians and ranges of the team's own weekly medians — never
 *   sums of percentages, never per-member forecasts, never ranks or scores.
 * - Coverage is explicit: the result carries n-shared / n-members, and when
 *   coverage falls below the SAME prototype thresholds the planning-scenario
 *   module uses ({@link MIN_SCENARIO_SHARED_COUNT},
 *   {@link MIN_SCENARIO_SHARED_RATIO}), every numeric forecast is withheld
 *   (`forecast: null`) so the UI can only render "insufficient shared data".
 * - Staleness reuses {@link classifyFreshness} and gates the CURRENT side
 *   only: coverage counts members whose latest-week snapshot is fresh/aging.
 *   Historical weeks are old by definition and still feed the basis, exactly
 *   like trends.ts.
 * - Calibration replays the same forecast rule against each past week that
 *   later received an actual, so the track record ("how often did the actual
 *   land inside the stated range?") is derived, never asserted. Accuracy
 *   scoring mirrors the desktop scorer `scoreForecastAccuracy`
 *   (packages/inference/src/capacity.ts) EXACTLY — same rounding, same 5/12
 *   point thresholds — because that package cannot be imported into this
 *   workspace (its compiler settings differ); a shared fixture in
 *   forecast.test.ts and capacity.forecastScorer.test.ts pins both to the
 *   same outputs.
 */

import { classifyFreshness, median } from "./workload";
import { MIN_SCENARIO_SHARED_COUNT, MIN_SCENARIO_SHARED_RATIO } from "./scenario";
import { TREND_METRIC_KEYS, type TrendMetricKey } from "./trends";
import type { LatestSnapshot } from "./snapshots";

/** The shared metrics forecast; identical to the trend metrics on purpose. */
export const FORECAST_METRIC_KEYS = TREND_METRIC_KEYS;

export type ForecastMetricKey = TrendMetricKey;

/**
 * Rolling window of recent weeks feeding each forecast. Mirrors the desktop
 * personal-baseline window (BASELINE_WINDOW_WEEKS in
 * packages/inference/src/capacity.ts) — no new threshold is invented.
 */
export const FORECAST_WINDOW_WEEKS = 6;

/** Provenance wording the UI must carry with every forecast. */
export const FORECAST_BASIS_LABEL =
  "Derived from teammates' approved snapshots only — never from raw activity, and only from members who chose to share.";

export type TeamForecastVerdict =
  | "forecast"
  | "insufficient-shared-data"
  | "no-history";

/** A forecast value with its stated range (spread of the basis weekly medians). */
export interface ForecastRange {
  median: number;
  min: number;
  max: number;
}

/**
 * Mirror of the desktop `ForecastAccuracy` (camelCased): rounding and the
 * 5/12-point rating thresholds must match `scoreForecastAccuracy` exactly.
 */
export type ForecastAccuracyRating = "on_target" | "close" | "off";

export interface MirroredForecastAccuracy {
  predictedPct: number;
  actualPct: number;
  errorPts: number;
  signedErrorPts: number;
  rating: ForecastAccuracyRating;
}

/**
 * EXACT mirror of `scoreForecastAccuracy` in
 * packages/inference/src/capacity.ts. Do not "improve" this independently —
 * the cross-check fixture in forecast.test.ts /
 * capacity.forecastScorer.test.ts pins both implementations to the same
 * outputs, and any drift is a bug in whichever side changed alone.
 */
export function scoreForecastAccuracyMirror(
  predictedPct: number,
  actualPct: number,
): MirroredForecastAccuracy {
  const signed = Math.round(predictedPct - actualPct);
  const error = Math.abs(signed);
  const rating: ForecastAccuracyRating =
    error <= 5 ? "on_target" : error <= 12 ? "close" : "off";
  return {
    predictedPct: Math.round(predictedPct),
    actualPct: Math.round(actualPct),
    errorPts: error,
    signedErrorPts: signed,
    rating,
  };
}

/**
 * One past forecast compared to the actual that later arrived: the forecast
 * the rule would have produced BEFORE `weekId` existed, versus that week's
 * actual team median. `insideRange` is the calibration question ("did the
 * actual land inside the stated range?"); `accuracy` is the desktop-mirrored
 * point-error score of the median itself.
 */
export interface CalibrationEntry {
  weekId: string;
  predicted: ForecastRange;
  actual: number;
  insideRange: boolean;
  accuracy: MirroredForecastAccuracy;
}

export interface MetricForecast {
  /** Next-week forecast, or null — below coverage or nothing shared. Null is
   * never rendered as a number, let alone zero. */
  forecast: ForecastRange | null;
  /** Weeks of shared data feeding the forecast (the honest basis size). */
  weekCount: number;
  /** Calibration track record for this metric, newest week first. */
  calibration: CalibrationEntry[];
  /** How many calibration entries landed inside their stated range. */
  hitCount: number;
  /** How many past forecasts could be scored at all. */
  scoredCount: number;
}

export interface CalibrationSummary {
  scoredCount: number;
  hitCount: number;
  /** Rounded percent of past forecasts inside their range; null when none. */
  hitRatePct: number | null;
  /** Mean absolute point error, desktop rounding; null when none scored. */
  meanAbsErrorPts: number | null;
}

export interface TeamCapacityForecast {
  verdict: TeamForecastVerdict;
  /** Newest week with current (fresh/aging) shared data; the forecast targets
   * the week after it. Null when no such week exists. */
  latestWeekId: string | null;
  /** Total roster size — the honest coverage denominator. */
  memberCount: number;
  /** Members whose latest-week snapshot is current AND shares ≥1 metric. */
  sharedCount: number;
  /** sharedCount / memberCount; 0 for an empty roster. */
  coverageRatio: number;
  /** Latest-week members excluded because their snapshot is stale/unknown
   * (all-stale histories count every stale row). Excluded, never zero. */
  excludedStaleCount: number;
  /** The prototype coverage heuristics used, echoed for labeling. */
  minSharedCount: number;
  minSharedRatio: number;
  windowWeeks: number;
  metrics: Record<ForecastMetricKey, MetricForecast>;
  /** Roll-up of every metric's calibration entries. */
  calibrationSummary: CalibrationSummary;
  /** Always {@link FORECAST_BASIS_LABEL}; echoed so the UI cannot drop it. */
  basisLabel: string;
  /** Deterministic explanation naming what was (or was not) forecast. */
  explanation: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** True when the snapshot shares at least one forecast metric (non-null). */
function sharesAnyMetric(snapshot: LatestSnapshot): boolean {
  return FORECAST_METRIC_KEYS.some((key) => isFiniteNumber(snapshot[key]));
}

/** ISO week ids ("2026-W29") sort correctly as strings. */
function byWeekIdAsc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Deduplicate to one snapshot per (userId, weekId): the newest observed_at
 * wins; ties keep the earlier array entry so output never depends on
 * anything but the input. Same rule as trends.ts.
 */
function dedupePerMemberWeek(
  snapshots: LatestSnapshot[],
): Map<string, Map<string, LatestSnapshot>> {
  const byWeek = new Map<string, Map<string, LatestSnapshot>>();
  for (const snapshot of snapshots) {
    let byUser = byWeek.get(snapshot.weekId);
    if (!byUser) {
      byUser = new Map();
      byWeek.set(snapshot.weekId, byUser);
    }
    const existing = byUser.get(snapshot.userId);
    if (
      !existing ||
      Date.parse(snapshot.observedAt) > Date.parse(existing.observedAt)
    ) {
      byUser.set(snapshot.userId, snapshot);
    }
  }
  return byWeek;
}

/** Median of one metric across the members who shared it in one week. */
function weeklySharedMedian(
  rows: LatestSnapshot[],
  key: ForecastMetricKey,
): number | null {
  return median(
    rows.map((row) => row[key]).filter(isFiniteNumber),
  );
}

/** Forecast from a window of weekly medians: their median, min, and max. */
function forecastFromWeeklyMedians(weeklyMedians: number[]): ForecastRange | null {
  if (weeklyMedians.length === 0) {
    return null;
  }
  return {
    median: median(weeklyMedians) as number,
    min: Math.min(...weeklyMedians),
    max: Math.max(...weeklyMedians),
  };
}

function emptyMetricForecast(): MetricForecast {
  return { forecast: null, weekCount: 0, calibration: [], hitCount: 0, scoredCount: 0 };
}

function emptyMetrics(): Record<ForecastMetricKey, MetricForecast> {
  return {
    reliableCapacityPct: emptyMetricForecast(),
    reactivePct: emptyMetricForecast(),
    meetingPct: emptyMetricForecast(),
    fragmentedPct: emptyMetricForecast(),
  };
}

/**
 * Build one metric's forecast + calibration from the ascending list of
 * (weekId, weeklyMedian) pairs for weeks where anyone shared the metric.
 * `withheld` blanks the forward-looking number (coverage failed) while the
 * historical calibration record — history versus history — remains shown.
 */
function buildMetricForecast(
  weekly: Array<{ weekId: string; median: number }>,
  withheld: boolean,
): MetricForecast {
  if (weekly.length === 0) {
    return emptyMetricForecast();
  }

  const calibration: CalibrationEntry[] = [];
  for (let index = 1; index < weekly.length; index += 1) {
    const target = weekly[index];
    if (!target) {
      continue;
    }
    const basis = weekly
      .slice(Math.max(0, index - FORECAST_WINDOW_WEEKS), index)
      .map((entry) => entry.median);
    const predicted = forecastFromWeeklyMedians(basis);
    if (!predicted) {
      continue;
    }
    calibration.push({
      weekId: target.weekId,
      predicted,
      actual: target.median,
      insideRange:
        target.median >= predicted.min && target.median <= predicted.max,
      accuracy: scoreForecastAccuracyMirror(predicted.median, target.median),
    });
  }
  calibration.reverse(); // newest first for display

  const basis = weekly
    .slice(Math.max(0, weekly.length - FORECAST_WINDOW_WEEKS))
    .map((entry) => entry.median);

  return {
    forecast: withheld ? null : forecastFromWeeklyMedians(basis),
    weekCount: basis.length,
    calibration,
    hitCount: calibration.filter((entry) => entry.insideRange).length,
    scoredCount: calibration.length,
  };
}

/**
 * Forecast next week's team capacity from a bounded history of shared
 * snapshots (all one team; multiple week_ids; possibly multiple rows per
 * member-week — the newest per pair wins). Pure and deterministic: same
 * inputs always produce the same output.
 */
export function forecastTeamCapacity(
  memberCount: number,
  snapshots: LatestSnapshot[],
  nowIso: string,
): TeamCapacityForecast {
  const byWeek = dedupePerMemberWeek(snapshots);
  const weekIds = [...byWeek.keys()].sort(byWeekIdAsc);

  // Weeks with any shared metric, ascending; the forecast basis.
  const dataWeekIds = weekIds.filter((weekId) =>
    [...(byWeek.get(weekId)?.values() ?? [])].some(sharesAnyMetric),
  );

  if (dataWeekIds.length === 0) {
    return {
      verdict: "no-history",
      latestWeekId: null,
      memberCount,
      sharedCount: 0,
      coverageRatio: 0,
      excludedStaleCount: 0,
      minSharedCount: MIN_SCENARIO_SHARED_COUNT,
      minSharedRatio: MIN_SCENARIO_SHARED_RATIO,
      windowWeeks: FORECAST_WINDOW_WEEKS,
      metrics: emptyMetrics(),
      calibrationSummary: {
        scoredCount: 0,
        hitCount: 0,
        hitRatePct: null,
        meanAbsErrorPts: null,
      },
      basisLabel: FORECAST_BASIS_LABEL,
      explanation:
        "No member has shared any workload metric yet, so there is nothing to forecast — and no number is invented from nothing.",
    };
  }

  // Current side: the newest data week anchored by fresh/aging snapshots.
  // Coverage counts members whose row in that week is current AND shares a
  // metric; stale/unknown rows are excluded and counted, never zero.
  const latestWeekId =
    [...dataWeekIds].reverse().find((weekId) =>
      [...(byWeek.get(weekId)?.values() ?? [])].some((row) => {
        const freshness = classifyFreshness(row.observedAt, nowIso);
        return (
          (freshness === "fresh" || freshness === "aging") &&
          sharesAnyMetric(row)
        );
      }),
    ) ?? null;

  let sharedCount = 0;
  let excludedStaleCount = 0;
  if (latestWeekId !== null) {
    for (const row of byWeek.get(latestWeekId)?.values() ?? []) {
      const freshness = classifyFreshness(row.observedAt, nowIso);
      if (freshness === "stale" || freshness === "unknown") {
        excludedStaleCount += 1;
        continue;
      }
      if (sharesAnyMetric(row)) {
        sharedCount += 1;
      }
    }
  } else {
    // No current week at all: every stale/unknown row is what got excluded.
    excludedStaleCount = snapshots.filter((row) => {
      const freshness = classifyFreshness(row.observedAt, nowIso);
      return freshness === "stale" || freshness === "unknown";
    }).length;
  }

  const coverageRatio = memberCount > 0 ? sharedCount / memberCount : 0;
  const coverageOk =
    sharedCount >= MIN_SCENARIO_SHARED_COUNT &&
    coverageRatio >= MIN_SCENARIO_SHARED_RATIO;
  const verdict: TeamForecastVerdict = coverageOk
    ? "forecast"
    : "insufficient-shared-data";

  const metrics = emptyMetrics();
  for (const key of FORECAST_METRIC_KEYS) {
    const weekly: Array<{ weekId: string; median: number }> = [];
    for (const weekId of dataWeekIds) {
      const value = weeklySharedMedian(
        [...(byWeek.get(weekId)?.values() ?? [])],
        key,
      );
      if (value !== null) {
        weekly.push({ weekId, median: value });
      }
    }
    metrics[key] = buildMetricForecast(weekly, !coverageOk);
  }

  const allEntries = FORECAST_METRIC_KEYS.flatMap(
    (key) => metrics[key].calibration,
  );
  const scoredCount = allEntries.length;
  const hitCount = allEntries.filter((entry) => entry.insideRange).length;
  const calibrationSummary: CalibrationSummary = {
    scoredCount,
    hitCount,
    hitRatePct:
      scoredCount > 0 ? Math.round((hitCount / scoredCount) * 100) : null,
    meanAbsErrorPts:
      scoredCount > 0
        ? Math.round(
            allEntries.reduce((sum, entry) => sum + entry.accuracy.errorPts, 0) /
              scoredCount,
          )
        : null,
  };

  const explanation = coverageOk
    ? `Forecast for the week after ${latestWeekId}: median of up to ${FORECAST_WINDOW_WEEKS} recent weekly team medians per shared metric, with the range those weekly medians spanned. ` +
      `Coverage: ${sharedCount} of ${memberCount} members with current shared data (${excludedStaleCount} stale excluded, never counted as zero). ` +
      `Track record: ${hitCount} of ${scoredCount} past forecasts landed inside their stated range.`
    : `Only ${sharedCount} of ${memberCount} members have current shared data — below the prototype minimum (${MIN_SCENARIO_SHARED_COUNT} members and ${Math.round(
        MIN_SCENARIO_SHARED_RATIO * 100,
      )}% of the roster). No forecast number is shown from partial data; unknown is not zero, and it is not capacity either.`;

  return {
    verdict,
    latestWeekId,
    memberCount,
    sharedCount,
    coverageRatio,
    excludedStaleCount,
    minSharedCount: MIN_SCENARIO_SHARED_COUNT,
    minSharedRatio: MIN_SCENARIO_SHARED_RATIO,
    windowWeeks: FORECAST_WINDOW_WEEKS,
    metrics,
    calibrationSummary,
    basisLabel: FORECAST_BASIS_LABEL,
    explanation,
  };
}
