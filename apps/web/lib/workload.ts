/**
 * Pure, deterministic workload aggregation for the team and member
 * dashboards. No Supabase imports, no network, no Date.now() — callers pass
 * `now` explicitly so every result is reproducible and testable.
 *
 * Honesty rules encoded here (blueprint §14, AGENTS.md invariants):
 * - A metric a member did not share is `null` and is EXCLUDED from every
 *   aggregate. It is never coerced to zero.
 * - Team aggregates are medians and ranges across members — never a sum of
 *   percentages, never a rank, never a composite "productivity score".
 * - Stale or missing snapshots are classified and labeled; they are excluded
 *   from the low-headroom count rather than counted as zero-capacity.
 * - Every threshold below is an explicitly labeled prototype heuristic, not
 *   an organizational benchmark.
 */

/** Prototype heuristic: shared reliable capacity below this is "low headroom". */
export const LOW_HEADROOM_THRESHOLD_PCT = 15;
/** Prototype heuristic: reactive load at/above this raises a flag. */
export const HIGH_REACTIVE_THRESHOLD_PCT = 40;
/** Prototype heuristic: meeting load at/above this raises a flag. */
export const HIGH_MEETING_THRESHOLD_PCT = 50;
/** Prototype heuristic: fragmented work at/above this raises a flag. */
export const HIGH_FRAGMENTATION_THRESHOLD_PCT = 35;
/** Prototype heuristic: review coverage below this lowers trust in metrics. */
export const LOW_REVIEW_COVERAGE_THRESHOLD_PCT = 50;

/** Hourly auto-sync plus slack: within this window a snapshot is "fresh". */
export const FRESH_MAX_HOURS = 26;
/** Older than this and a snapshot is "stale" (excluded from aggregates' trust). */
export const STALE_AFTER_HOURS = 7 * 24;

export type Freshness = "fresh" | "aging" | "stale" | "unknown";

/** Canonical provenance copy for every aggregate built from member-approved shares. */
export function approvedSnapshotProvenance(
  sharedCount: number,
  memberCount?: number,
): string {
  if (memberCount === undefined) {
    return sharedCount === 1
      ? "from 1 teammate's approved snapshot"
      : `from ${sharedCount} teammates' approved snapshots`;
  }
  return `from ${sharedCount} of ${memberCount} teammates' approved snapshots`;
}

export interface MemberWorkloadInput {
  /** Stable identifier for the member (never displayed as a rank). */
  userId: string;
  weekId: string;
  observedAt: string;
  shareLevel: string;
  /** null means "not shared" — never zero. */
  reliableCapacityPct: number | null;
  reactivePct: number | null;
  meetingPct: number | null;
  fragmentedPct: number | null;
  summaryConfidence: number | null;
  reviewedBlocks: number;
  eligibleBlocks: number;
}

export interface MetricSummary {
  median: number;
  min: number;
  max: number;
  /** How many members shared this metric (aggregate denominator). */
  sharedCount: number;
}

export interface LowHeadroomSummary {
  /** Members with a non-stale snapshot whose shared capacity is below threshold. */
  count: number;
  /** Members whose snapshots were current enough and shared the metric. */
  consideredCount: number;
  /** Members excluded because their snapshot is stale (not treated as zero). */
  excludedStaleCount: number;
  /** Members excluded because they did not share reliable capacity. */
  excludedNotSharedCount: number;
  thresholdPct: number;
}

export type RiskSeverity = "notice" | "warning";

export interface RiskFlag {
  id:
    | "low-headroom"
    | "high-reactive"
    | "high-meetings"
    | "high-fragmentation"
    | "low-review-coverage"
    | "stale-data";
  severity: RiskSeverity;
  title: string;
  /** Deterministic explanation naming the observed value and the threshold. */
  explanation: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Median of finite numbers; null for an empty list. Never fabricates zero. */
export function median(values: number[]): number | null {
  const usable = values.filter(isFiniteNumber).slice().sort((a, b) => a - b);
  if (usable.length === 0) {
    return null;
  }
  const mid = Math.floor(usable.length / 2);
  const upper = usable[mid] ?? 0;
  const lower = usable[mid - 1] ?? upper;
  return usable.length % 2 === 1 ? upper : (lower + upper) / 2;
}

/**
 * Summary (median + range) over ONLY the values members actually shared.
 * Returns null when nobody shared the metric, so the UI must render
 * "Not shared" instead of a fake zero.
 */
export function summarizeSharedMetric(
  values: Array<number | null | undefined>,
): MetricSummary | null {
  const shared = values.filter(isFiniteNumber);
  if (shared.length === 0) {
    return null;
  }
  return {
    median: median(shared) as number,
    min: Math.min(...shared),
    max: Math.max(...shared),
    sharedCount: shared.length,
  };
}

/**
 * Freshness of a snapshot relative to `now`. Unparseable timestamps are
 * "unknown" — labeled, not silently treated as current or as zero.
 */
export function classifyFreshness(observedAtIso: string, nowIso: string): Freshness {
  const observed = Date.parse(observedAtIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(observed) || Number.isNaN(now)) {
    return "unknown";
  }
  const ageHours = (now - observed) / (60 * 60 * 1000);
  if (ageHours <= FRESH_MAX_HOURS) {
    return "fresh";
  }
  if (ageHours <= STALE_AFTER_HOURS) {
    return "aging";
  }
  return "stale";
}

export function freshnessLabel(freshness: Freshness): string {
  switch (freshness) {
    case "fresh":
      return "Synced within the last day";
    case "aging":
      return "Synced within the last week";
    case "stale":
      return "Stale — older than 7 days";
    default:
      return "Sync time unknown";
  }
}

/**
 * Count members currently below the prototype low-headroom threshold.
 * Stale/unknown snapshots and members who did not share the metric are
 * excluded and reported separately — they are never counted as zero capacity.
 */
export function summarizeLowHeadroom(
  snapshots: MemberWorkloadInput[],
  nowIso: string,
): LowHeadroomSummary {
  let count = 0;
  let consideredCount = 0;
  let excludedStaleCount = 0;
  let excludedNotSharedCount = 0;

  for (const snapshot of snapshots) {
    const freshness = classifyFreshness(snapshot.observedAt, nowIso);
    if (freshness === "stale" || freshness === "unknown") {
      excludedStaleCount += 1;
      continue;
    }
    if (!isFiniteNumber(snapshot.reliableCapacityPct)) {
      excludedNotSharedCount += 1;
      continue;
    }
    consideredCount += 1;
    if (snapshot.reliableCapacityPct < LOW_HEADROOM_THRESHOLD_PCT) {
      count += 1;
    }
  }

  return {
    count,
    consideredCount,
    excludedStaleCount,
    excludedNotSharedCount,
    thresholdPct: LOW_HEADROOM_THRESHOLD_PCT,
  };
}

/** Review coverage percent, or null when there is nothing to review yet. */
export function reviewCoveragePct(
  reviewedBlocks: number,
  eligibleBlocks: number,
): number | null {
  if (
    !isFiniteNumber(reviewedBlocks) ||
    !isFiniteNumber(eligibleBlocks) ||
    eligibleBlocks <= 0 ||
    reviewedBlocks < 0
  ) {
    return null;
  }
  return Math.round(
    (Math.min(reviewedBlocks, eligibleBlocks) / eligibleBlocks) * 100,
  );
}

/** Buckets a 0–1 confidence for display; null when confidence is not shared. */
export function confidenceLabel(
  confidence: number | null | undefined,
): "low" | "medium" | "high" | null {
  if (!isFiniteNumber(confidence)) {
    return null;
  }
  if (confidence < 0.4) {
    return "low";
  }
  if (confidence < 0.7) {
    return "medium";
  }
  return "high";
}

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

/**
 * Deterministic per-member risk flags with explanations. Same inputs always
 * produce the same flags in the same order. Only shared, current metrics can
 * raise a workload flag; stale data produces exactly one "stale" notice and
 * suppresses workload flags (old numbers must not read as current risk).
 */
export function memberRiskFlags(
  snapshot: MemberWorkloadInput,
  nowIso: string,
): RiskFlag[] {
  const freshness = classifyFreshness(snapshot.observedAt, nowIso);
  if (freshness === "stale" || freshness === "unknown") {
    return [
      {
        id: "stale-data",
        severity: "notice",
        title: freshness === "stale" ? "Data is stale" : "Sync time unknown",
        explanation:
          freshness === "stale"
            ? `The latest shared snapshot is older than ${STALE_AFTER_HOURS / 24} days (week ${snapshot.weekId}). Its metrics are shown for context but are not treated as this member's current workload.`
            : "This snapshot's sync time could not be read, so its metrics are not treated as current.",
      },
    ];
  }

  const flags: RiskFlag[] = [];

  if (
    isFiniteNumber(snapshot.reliableCapacityPct) &&
    snapshot.reliableCapacityPct < LOW_HEADROOM_THRESHOLD_PCT
  ) {
    flags.push({
      id: "low-headroom",
      severity: "warning",
      title: "Low headroom",
      explanation: `Shared reliable capacity is ${pct(snapshot.reliableCapacityPct)}, below the ${LOW_HEADROOM_THRESHOLD_PCT}% prototype threshold. New commitments are unlikely to fit this week.`,
    });
  }

  if (
    isFiniteNumber(snapshot.reactivePct) &&
    snapshot.reactivePct >= HIGH_REACTIVE_THRESHOLD_PCT
  ) {
    flags.push({
      id: "high-reactive",
      severity: "warning",
      title: "High reactive load",
      explanation: `Shared reactive work is ${pct(snapshot.reactivePct)} of the week, at or above the ${HIGH_REACTIVE_THRESHOLD_PCT}% prototype threshold. Planned work is likely being displaced by interrupts.`,
    });
  }

  if (
    isFiniteNumber(snapshot.meetingPct) &&
    snapshot.meetingPct >= HIGH_MEETING_THRESHOLD_PCT
  ) {
    flags.push({
      id: "high-meetings",
      severity: "notice",
      title: "Meeting-heavy week",
      explanation: `Shared meeting load is ${pct(snapshot.meetingPct)} of the week, at or above the ${HIGH_MEETING_THRESHOLD_PCT}% prototype threshold.`,
    });
  }

  if (
    isFiniteNumber(snapshot.fragmentedPct) &&
    snapshot.fragmentedPct >= HIGH_FRAGMENTATION_THRESHOLD_PCT
  ) {
    flags.push({
      id: "high-fragmentation",
      severity: "notice",
      title: "Fragmented focus",
      explanation: `Shared fragmented work is ${pct(snapshot.fragmentedPct)} of the week, at or above the ${HIGH_FRAGMENTATION_THRESHOLD_PCT}% prototype threshold. Long focus blocks are scarce.`,
    });
  }

  const coverage = reviewCoveragePct(
    snapshot.reviewedBlocks,
    snapshot.eligibleBlocks,
  );
  if (coverage !== null && coverage < LOW_REVIEW_COVERAGE_THRESHOLD_PCT) {
    flags.push({
      id: "low-review-coverage",
      severity: "notice",
      title: "Low review coverage",
      explanation: `Only ${coverage}% of eligible work blocks were reviewed (${snapshot.reviewedBlocks} of ${snapshot.eligibleBlocks}), below the ${LOW_REVIEW_COVERAGE_THRESHOLD_PCT}% prototype threshold — treat the shared metrics as less certain.`,
    });
  }

  return flags;
}

export interface TeamWorkloadSummary {
  memberCount: number;
  /** Members with at least one shared snapshot, regardless of freshness. */
  sharingCount: number;
  /** Most recent observed_at across shared snapshots, or null when none. */
  lastUpdatedAt: string | null;
  reliableCapacity: MetricSummary | null;
  reactive: MetricSummary | null;
  meetings: MetricSummary | null;
  fragmentation: MetricSummary | null;
  lowHeadroom: LowHeadroomSummary;
}

/**
 * Team-level rollup. Aggregates use only non-stale snapshots so a member who
 * stopped syncing weeks ago cannot skew "current" team numbers; stale members
 * still count toward sharing coverage and are surfaced on their own cards.
 */
export function summarizeTeamWorkload(
  memberCount: number,
  snapshots: MemberWorkloadInput[],
  nowIso: string,
): TeamWorkloadSummary {
  const current = snapshots.filter((snapshot) => {
    const freshness = classifyFreshness(snapshot.observedAt, nowIso);
    return freshness === "fresh" || freshness === "aging";
  });

  let lastUpdatedAt: string | null = null;
  for (const snapshot of snapshots) {
    const observed = Date.parse(snapshot.observedAt);
    if (Number.isNaN(observed)) {
      continue;
    }
    if (lastUpdatedAt === null || observed > Date.parse(lastUpdatedAt)) {
      lastUpdatedAt = snapshot.observedAt;
    }
  }

  return {
    memberCount,
    sharingCount: snapshots.length,
    lastUpdatedAt,
    reliableCapacity: summarizeSharedMetric(
      current.map((snapshot) => snapshot.reliableCapacityPct),
    ),
    reactive: summarizeSharedMetric(current.map((s) => s.reactivePct)),
    meetings: summarizeSharedMetric(current.map((s) => s.meetingPct)),
    fragmentation: summarizeSharedMetric(current.map((s) => s.fragmentedPct)),
    lowHeadroom: summarizeLowHeadroom(snapshots, nowIso),
  };
}
