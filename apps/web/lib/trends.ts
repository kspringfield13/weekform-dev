/**
 * Pure, deterministic week-over-week trend explanation for the manager team
 * view (roadmap §A2): "How did this week's shared workload shift against this
 * team's OWN prior week?" No Supabase imports, no network, no Date.now() —
 * callers pass `now` explicitly so every result is reproducible and testable.
 *
 * Honesty rules encoded here (blueprint §14, AGENTS.md invariants):
 * - The baseline is always the team's own history — never a benchmark, never
 *   another team. {@link TREND_BASELINE_LABEL} carries that wording to the UI.
 * - A member with no prior-week snapshot gets status "no-history" and null
 *   deltas. A missing week is never rendered as a zero delta.
 * - A metric null (not shared) in either week yields a null delta with reason
 *   "not-shared". Null is never coerced to 0.
 * - A share-level change between the two weeks flags every delta of that
 *   member with `shareLevelChanged: true`, and the member is EXCLUDED from
 *   team median drift for all metrics — the stricter honest choice, since a
 *   policy change makes the two weeks' numbers non-comparable as a pair.
 * - Staleness reuses {@link classifyFreshness} (STALE_AFTER_HOURS from
 *   workload.ts, no new threshold) and gates the ANCHOR week only: a member
 *   whose current-week snapshot is stale/unknown is excluded and counted.
 *   Prior-week baselines are exempt — history is old by definition, and
 *   applying the current-data rule to it would make trends structurally
 *   impossible. The anchor week itself must contain fresh (non-stale) shared
 *   data or the only honest verdict is "no-history".
 * - Fewer than two distinct comparable weeks → verdict "no-history" with no
 *   numeric drift fabricated.
 * - Team drift is a MEDIAN of per-member deltas — never a sum of
 *   percentages, never a rank. Member arrays are id-keyed and sorted by
 *   userId, never by delta magnitude.
 */

import { classifyFreshness, median } from "./workload";
import type { LatestSnapshot } from "./snapshots";

/** UI wording for the comparison baseline; the trend never claims a benchmark. */
export const TREND_BASELINE_LABEL =
  "Compared to this team's own history, not a benchmark.";

/** The shared metrics trends compare; percentages of a member's week. */
export const TREND_METRIC_KEYS = [
  "reliableCapacityPct",
  "reactivePct",
  "meetingPct",
  "fragmentedPct",
] as const;

export type TrendMetricKey = (typeof TREND_METRIC_KEYS)[number];

/** Display labels for the trend metrics, keyed for deterministic UI copy. */
export const TREND_METRIC_LABELS: Record<TrendMetricKey, string> = {
  reliableCapacityPct: "reliable capacity",
  reactivePct: "reactive load",
  meetingPct: "meeting load",
  fragmentedPct: "fragmented work",
};

export type TeamTrendVerdict = "computed" | "no-history";

export type MemberTrendStatus = "compared" | "no-history";

/**
 * One member's week-over-week change for one metric. `value` is
 * current − prior in percentage points, or null with a reason:
 * - "not-shared": the metric was null in at least one of the two weeks.
 * - "no-history": the member has no prior-week snapshot at all.
 */
export interface MetricDelta {
  value: number | null;
  reason: "not-shared" | "no-history" | null;
}

export interface MemberTrend {
  /** Stable identifier (never displayed as a rank). */
  userId: string;
  status: MemberTrendStatus;
  /** True when share level differs between the two weeks; such members are
   * excluded from every team median (non-comparable pair, labeled here). */
  shareLevelChanged: boolean;
  deltas: Record<TrendMetricKey, MetricDelta>;
}

/** Team-level drift for one metric: median of comparable member deltas. */
export interface MetricDrift {
  /** Median week-over-week change in points; null when nobody is comparable. */
  value: number | null;
  /** Members whose deltas fed this median (the honest denominator). */
  comparedCount: number;
}

export interface TeamTrend {
  verdict: TeamTrendVerdict;
  /** The anchor week (most recent week with fresh shared data); null when
   * there is no such week. */
  currentWeekId: string | null;
  /** The team's own baseline week; null when no prior week has shared data. */
  priorWeekId: string | null;
  /** Always {@link TREND_BASELINE_LABEL}; echoed so the UI cannot drop it. */
  baselineLabel: string;
  /** Distinct week ids seen in the input (any freshness), for context. */
  distinctWeekCount: number;
  medianDrift: Record<TrendMetricKey, MetricDrift>;
  /** Sorted by userId — id-keyed, never ranked by delta magnitude. */
  members: MemberTrend[];
  /** Anchor-week members excluded because their snapshot is stale/unknown. */
  excludedStaleCount: number;
  /** Members in the anchor week with no prior-week snapshot. */
  noHistoryCount: number;
  /** Members flagged (and median-excluded) for a share-level change. */
  shareLevelChangedCount: number;
  /** Deterministic explanation of what was (or was not) compared. */
  explanation: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** True when the snapshot shares at least one trend metric (non-null). */
function sharesAnyMetric(snapshot: LatestSnapshot): boolean {
  return TREND_METRIC_KEYS.some((key) => isFiniteNumber(snapshot[key]));
}

/**
 * Human wording for one metric's median drift, e.g. "median meeting load up
 * 4 pts vs last week". Rounding happens here so UI copy stays deterministic.
 */
export function driftWording(key: TrendMetricKey, value: number): string {
  const rounded = Math.round(value);
  const label = TREND_METRIC_LABELS[key];
  if (rounded === 0) {
    return `median ${label} unchanged vs last week`;
  }
  const direction = rounded > 0 ? "up" : "down";
  const magnitude = Math.abs(rounded);
  return `median ${label} ${direction} ${magnitude} ${magnitude === 1 ? "pt" : "pts"} vs last week`;
}

/** ISO week ids ("2026-W29") sort correctly as strings; newest first. */
function byWeekIdDesc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

/**
 * Deduplicate to one snapshot per (userId, weekId): the newest observed_at
 * wins; ties keep the earlier array entry so output never depends on
 * anything but the input.
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

function emptyDeltas(reason: "not-shared" | "no-history"): Record<
  TrendMetricKey,
  MetricDelta
> {
  return {
    reliableCapacityPct: { value: null, reason },
    reactivePct: { value: null, reason },
    meetingPct: { value: null, reason },
    fragmentedPct: { value: null, reason },
  };
}

function noHistoryResult(
  distinctWeekCount: number,
  excludedStaleCount: number,
  explanation: string,
  currentWeekId: string | null = null,
): TeamTrend {
  return {
    verdict: "no-history",
    currentWeekId,
    priorWeekId: null,
    baselineLabel: TREND_BASELINE_LABEL,
    distinctWeekCount,
    medianDrift: {
      reliableCapacityPct: { value: null, comparedCount: 0 },
      reactivePct: { value: null, comparedCount: 0 },
      meetingPct: { value: null, comparedCount: 0 },
      fragmentedPct: { value: null, comparedCount: 0 },
    },
    members: [],
    excludedStaleCount,
    noHistoryCount: 0,
    shareLevelChangedCount: 0,
    explanation,
  };
}

/**
 * Compute the team's week-over-week trend from a bounded history of shared
 * snapshots (all one team; multiple week_ids; possibly multiple rows per
 * member-week — the newest per pair wins).
 *
 * Anchor selection: the most recent week containing at least one fresh
 * (non-stale per {@link classifyFreshness}) snapshot that shares at least one
 * metric. Baseline: the most recent EARLIER week where any member shared any
 * metric. Without both, the verdict is "no-history" — no drift is invented.
 *
 * Pure and deterministic: same inputs always produce the same output.
 */
export function summarizeTeamTrend(
  snapshots: LatestSnapshot[],
  nowIso: string,
): TeamTrend {
  const byWeek = dedupePerMemberWeek(snapshots);
  const weekIds = [...byWeek.keys()].sort(byWeekIdDesc);
  const distinctWeekCount = weekIds.length;

  // Anchor week: newest week with current (fresh/aging) shared data. Weeks
  // where everything is stale cannot anchor a "this week vs last" claim.
  const currentWeekId =
    weekIds.find((weekId) => {
      const rows = [...(byWeek.get(weekId)?.values() ?? [])];
      return rows.some((row) => {
        const freshness = classifyFreshness(row.observedAt, nowIso);
        return (
          (freshness === "fresh" || freshness === "aging") &&
          sharesAnyMetric(row)
        );
      });
    }) ?? null;

  if (currentWeekId === null) {
    // Count what was excluded so "no data" is never silent about staleness.
    const staleCount = snapshots.filter((row) => {
      const freshness = classifyFreshness(row.observedAt, nowIso);
      return freshness === "stale" || freshness === "unknown";
    }).length;
    return noHistoryResult(
      distinctWeekCount,
      staleCount,
      staleCount > 0
        ? `No week has fresh shared data (${staleCount} stale or unreadable snapshots were excluded, not treated as current). No trend is computed.`
        : "No member has shared any workload metric yet, so there is no history to compare.",
    );
  }

  // Baseline: newest earlier week with any shared metric, any freshness —
  // history is old by definition; staleness only gates the anchor side.
  const priorWeekId =
    weekIds.find(
      (weekId) =>
        weekId < currentWeekId &&
        [...(byWeek.get(weekId)?.values() ?? [])].some(sharesAnyMetric),
    ) ?? null;

  if (priorWeekId === null) {
    return noHistoryResult(
      distinctWeekCount,
      0,
      `Only one week (${currentWeekId}) has shared data so far. Week-over-week trends start once a second week is shared — no drift is invented from a single week.`,
      currentWeekId,
    );
  }

  const currentRows = byWeek.get(currentWeekId) ?? new Map();
  const priorRows = byWeek.get(priorWeekId) ?? new Map();

  const members: MemberTrend[] = [];
  let excludedStaleCount = 0;
  let noHistoryCount = 0;
  let shareLevelChangedCount = 0;
  const comparableDeltas: Record<TrendMetricKey, number[]> = {
    reliableCapacityPct: [],
    reactivePct: [],
    meetingPct: [],
    fragmentedPct: [],
  };

  const userIds = [...currentRows.keys()].sort();
  for (const userId of userIds) {
    const current = currentRows.get(userId) as LatestSnapshot;
    const freshness = classifyFreshness(current.observedAt, nowIso);
    if (freshness === "stale" || freshness === "unknown") {
      // Same rule and constant as workload.ts — excluded and counted, never
      // silently included as if current.
      excludedStaleCount += 1;
      continue;
    }

    const prior = priorRows.get(userId) as LatestSnapshot | undefined;
    if (!prior) {
      noHistoryCount += 1;
      members.push({
        userId,
        status: "no-history",
        shareLevelChanged: false,
        deltas: emptyDeltas("no-history"),
      });
      continue;
    }

    const shareLevelChanged = current.shareLevel !== prior.shareLevel;
    if (shareLevelChanged) {
      shareLevelChangedCount += 1;
    }
    const deltas = emptyDeltas("not-shared");
    for (const key of TREND_METRIC_KEYS) {
      const currentValue = current[key];
      const priorValue = prior[key];
      if (isFiniteNumber(currentValue) && isFiniteNumber(priorValue)) {
        deltas[key] = { value: currentValue - priorValue, reason: null };
        if (!shareLevelChanged) {
          comparableDeltas[key].push(currentValue - priorValue);
        }
      }
    }
    members.push({ userId, status: "compared", shareLevelChanged, deltas });
  }

  const medianDrift: Record<TrendMetricKey, MetricDrift> = {
    reliableCapacityPct: {
      value: median(comparableDeltas.reliableCapacityPct),
      comparedCount: comparableDeltas.reliableCapacityPct.length,
    },
    reactivePct: {
      value: median(comparableDeltas.reactivePct),
      comparedCount: comparableDeltas.reactivePct.length,
    },
    meetingPct: {
      value: median(comparableDeltas.meetingPct),
      comparedCount: comparableDeltas.meetingPct.length,
    },
    fragmentedPct: {
      value: median(comparableDeltas.fragmentedPct),
      comparedCount: comparableDeltas.fragmentedPct.length,
    },
  };

  const comparedCount = members.filter(
    (member) => member.status === "compared" && !member.shareLevelChanged,
  ).length;

  return {
    verdict: "computed",
    currentWeekId,
    priorWeekId,
    baselineLabel: TREND_BASELINE_LABEL,
    distinctWeekCount,
    medianDrift,
    members,
    excludedStaleCount,
    noHistoryCount,
    shareLevelChangedCount,
    explanation:
      `Week ${currentWeekId} vs ${priorWeekId}: ${comparedCount} members comparable. ` +
      `Excluded from medians: ${excludedStaleCount} stale, ${noHistoryCount} without prior-week data, ` +
      `${shareLevelChangedCount} whose share level changed between the weeks (their deltas are shown but labeled non-comparable). ` +
      TREND_BASELINE_LABEL,
  };
}
