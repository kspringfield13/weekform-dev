/**
 * Pure, deterministic planning-scenario assessment for the manager team view:
 * "If we take on X% additional planned load next week, what does the team's
 * shared headroom say?" (blueprint §17, Horizon 1 — "Manager planning
 * scenarios: What can the team absorb?").
 *
 * No Supabase imports, no network, no Date.now() — callers pass `now`
 * explicitly so every result is reproducible and testable.
 *
 * Honesty rules encoded here (blueprint §14, AGENTS.md invariants):
 * - A metric a member did not share is `null` and is EXCLUDED from the
 *   assessment. It is never coerced to zero. Unknown ≠ zero ≠ fine.
 * - The verdict is built from medians and ranges of shared headroom — never a
 *   sum of percentages, never a rank, never a composite score.
 * - Stale/unknown snapshots are excluded and counted separately — never
 *   treated as zero capacity.
 * - When too few members share current capacity data, the only honest verdict
 *   is "insufficient shared data". No numeric absorbability claim is made
 *   from partial data (the headroom summary is null in that case).
 * - Every threshold below is an explicitly labeled prototype heuristic, not
 *   an organizational benchmark.
 */

import {
  LOW_HEADROOM_THRESHOLD_PCT,
  classifyFreshness,
  summarizeSharedMetric,
  type MemberWorkloadInput,
  type MetricSummary,
} from "./workload";

/**
 * Prototype heuristic: a scenario verdict needs at least this many members
 * with a current (fresh or aging, non-stale) shared reliable-capacity value.
 * Below this the assessment would just re-expose one individual's data as a
 * "team" answer, so we refuse and say so.
 */
export const MIN_SCENARIO_SHARED_COUNT = 2;

/**
 * Prototype heuristic: at least this fraction of the roster must have current
 * shared capacity data before a team-level verdict is honest. Below it, the
 * unknown majority could hide any amount of overload.
 */
export const MIN_SCENARIO_SHARED_RATIO = 0.5;

/** The question a manager asks: additional planned load, as % of a member-week. */
export interface AbsorptionAsk {
  /** Additional planned load, in percent of one member's week (e.g. 10 = +10%). */
  additionalLoadPct: number;
}

export type AbsorptionVerdict =
  | "absorbable-within-shared-data"
  | "at-risk"
  | "insufficient-shared-data";

/**
 * Per-member classification of the ask against that member's OWN shared,
 * current headroom. Id-keyed and non-ranked; never compared across members.
 * - "fits": shared headroom covers the ask and still leaves at least the
 *   prototype low-headroom threshold ({@link LOW_HEADROOM_THRESHOLD_PCT}%).
 * - "tight": shared headroom covers the ask, but the remainder would fall
 *   below the prototype low-headroom threshold.
 * - "exceeds": the ask is larger than this member's shared headroom.
 * - "not-shared": the member did not share reliable capacity — unknown, not
 *   zero, and never counted against (or for) the team verdict.
 * - "stale-excluded": the member's snapshot is stale or has an unreadable
 *   timestamp — excluded, not treated as zero capacity.
 */
export type MemberAbsorptionStatus =
  | "fits"
  | "tight"
  | "exceeds"
  | "not-shared"
  | "stale-excluded";

export interface AbsorptionAssessment {
  verdict: AbsorptionVerdict;
  /** The ask being assessed, echoed for display. */
  askPct: number;
  /** Total roster size (the honest denominator for coverage). */
  memberCount: number;
  /** Members with any shared snapshot, regardless of freshness. */
  sharingCount: number;
  /** Members whose CURRENT (fresh/aging) snapshot shares reliable capacity —
   * the denominator every number below is computed over. */
  currentSharedCount: number;
  /** Members excluded because their snapshot is stale or unreadable. */
  excludedStaleCount: number;
  /** Members excluded because they did not share reliable capacity (or share
   * no snapshot at all). Unknown, never zero. */
  excludedUnknownCount: number;
  /** currentSharedCount / memberCount; 0 for an empty roster. How much of the
   * team the shared data actually covers — the rest of the ask lands on
   * members whose capacity is unknown. */
  coverageRatio: number;
  /** Median/min/max of shared current headroom. null when the verdict is
   * "insufficient-shared-data" — no numeric claim is made from partial data. */
  headroom: MetricSummary | null;
  /** Per-member, id-keyed (never ranked) classification of the ask. */
  memberStatus: Record<string, MemberAbsorptionStatus>;
  /** Deterministic explanation naming the numbers and heuristics used. */
  explanation: string;
  /** The prototype coverage heuristics used, echoed for labeling. */
  minSharedCount: number;
  minSharedRatio: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Human label for a verdict; keeps UI copy deterministic and honest. */
export function absorptionVerdictLabel(verdict: AbsorptionVerdict): string {
  switch (verdict) {
    case "absorbable-within-shared-data":
      return "Absorbable within shared data";
    case "at-risk":
      return "At risk within shared data";
    default:
      return "Insufficient shared data";
  }
}

/**
 * Assess whether the team can absorb `ask.additionalLoadPct` percentage
 * points of additional planned load, using ONLY current (fresh or aging,
 * per {@link classifyFreshness}) snapshots whose owners shared reliable
 * capacity.
 *
 * Verdict rules (all prototype heuristics, all labeled in the output):
 * - "insufficient-shared-data" when fewer than {@link MIN_SCENARIO_SHARED_COUNT}
 *   members, or less than {@link MIN_SCENARIO_SHARED_RATIO} of the roster,
 *   have current shared capacity. `headroom` is null — no numeric claim.
 * - "absorbable-within-shared-data" when the ask is at or below the MEDIAN of
 *   shared current headroom (medians, never sums — one member's headroom is
 *   never pooled into another's).
 * - "at-risk" when the ask exceeds that median.
 *
 * Confidence degrades explicitly: staleness and non-sharing shrink
 * `currentSharedCount` and `coverageRatio`, and past the minimums the verdict
 * itself refuses to answer.
 *
 * Pure and deterministic: same inputs always produce the same output.
 * Throws RangeError for a non-finite or non-positive ask (a scenario of
 * "+0% or less" is not a planning question this module answers).
 */
export function assessAbsorption(
  memberCount: number,
  snapshots: MemberWorkloadInput[],
  ask: AbsorptionAsk,
  nowIso: string,
): AbsorptionAssessment {
  const askPct = ask.additionalLoadPct;
  if (!isFiniteNumber(askPct) || askPct <= 0) {
    throw new RangeError(
      `assessAbsorption requires a finite additionalLoadPct > 0; got ${String(askPct)}`,
    );
  }

  const memberStatus: Record<string, MemberAbsorptionStatus> = {};
  const currentHeadroom: number[] = [];
  let excludedStaleCount = 0;
  let excludedNotSharedCount = 0;

  for (const snapshot of snapshots) {
    const freshness = classifyFreshness(snapshot.observedAt, nowIso);
    if (freshness === "stale" || freshness === "unknown") {
      memberStatus[snapshot.userId] = "stale-excluded";
      excludedStaleCount += 1;
      continue;
    }
    if (!isFiniteNumber(snapshot.reliableCapacityPct)) {
      memberStatus[snapshot.userId] = "not-shared";
      excludedNotSharedCount += 1;
      continue;
    }
    const headroomPct = snapshot.reliableCapacityPct;
    currentHeadroom.push(headroomPct);
    if (askPct > headroomPct) {
      memberStatus[snapshot.userId] = "exceeds";
    } else if (headroomPct - askPct < LOW_HEADROOM_THRESHOLD_PCT) {
      memberStatus[snapshot.userId] = "tight";
    } else {
      memberStatus[snapshot.userId] = "fits";
    }
  }

  const currentSharedCount = currentHeadroom.length;
  const safeMemberCount = Math.max(memberCount, 0);
  // Members with no snapshot at all are unknown too, never zero.
  const excludedUnknownCount =
    excludedNotSharedCount + Math.max(safeMemberCount - snapshots.length, 0);
  const coverageRatio =
    safeMemberCount > 0 ? currentSharedCount / safeMemberCount : 0;

  const base = {
    askPct,
    memberCount: safeMemberCount,
    sharingCount: snapshots.length,
    currentSharedCount,
    excludedStaleCount,
    excludedUnknownCount,
    coverageRatio,
    memberStatus,
    minSharedCount: MIN_SCENARIO_SHARED_COUNT,
    minSharedRatio: MIN_SCENARIO_SHARED_RATIO,
  };

  if (
    currentSharedCount < MIN_SCENARIO_SHARED_COUNT ||
    coverageRatio < MIN_SCENARIO_SHARED_RATIO
  ) {
    return {
      ...base,
      verdict: "insufficient-shared-data",
      headroom: null,
      explanation:
        `Only ${currentSharedCount} of ${safeMemberCount} members have current shared capacity data, ` +
        `below the prototype minimum of ${MIN_SCENARIO_SHARED_COUNT} members and ` +
        `${Math.round(MIN_SCENARIO_SHARED_RATIO * 100)}% of the roster. ` +
        `No absorbability estimate is honest from this coverage — unknown is not zero, and it is not headroom either.`,
    };
  }

  const headroom = summarizeSharedMetric(currentHeadroom) as MetricSummary;
  const verdict: AbsorptionVerdict =
    askPct <= headroom.median ? "absorbable-within-shared-data" : "at-risk";

  const explanation =
    verdict === "absorbable-within-shared-data"
      ? `A +${Math.round(askPct)}% ask is at or below the ${Math.round(headroom.median)}% median shared headroom of ` +
        `${currentSharedCount} of ${safeMemberCount} members with current shared data (range ${Math.round(headroom.min)}–${Math.round(headroom.max)}%). ` +
        `This says nothing about the ${safeMemberCount - currentSharedCount} members whose capacity is unknown or stale.`
      : `A +${Math.round(askPct)}% ask exceeds the ${Math.round(headroom.median)}% median shared headroom of ` +
        `${currentSharedCount} of ${safeMemberCount} members with current shared data (range ${Math.round(headroom.min)}–${Math.round(headroom.max)}%). ` +
        `Most sharing members could not take this on without dropping planned work.`;

  return { ...base, verdict, headroom, explanation };
}
