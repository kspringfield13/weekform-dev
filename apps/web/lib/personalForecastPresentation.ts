import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";

const HISTORY_WINDOW_WEEKS = 6;

export interface PersonalForecastRisk {
  key: "carryover" | "reactive" | "fragmented" | "blocked";
  label: string;
  detail: string;
}

export interface PersonalForecastTrajectoryPoint {
  weekId: string;
  allocatedPct: number;
  reactivePct: number;
  deepWorkPct: number;
  reliableCapacityPct: number;
  meetingPct: number;
  summaryConfidencePct: number;
}

export interface PersonalForecastPresentation {
  status: "unavailable" | "baseline" | "history";
  sourceWeekId: string | null;
  targetWeekId: string | null;
  historyWeekCount: number;
  confidencePct: number | null;
  scenarios: { conservative: number; likely: number; optimistic: number } | null;
  risks: PersonalForecastRisk[];
  recommendation: string;
  assumptions: string[];
  explanation: string;
  trajectory: PersonalForecastTrajectoryPoint[];
  trajectoryDeltaPts: number | null;
}

export interface PersonalForecastRangeGeometry {
  conservativePct: number;
  likelyPct: number;
  optimisticPct: number;
  leftPct: number;
  widthPct: number;
}

function safePercent(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(100, value)));
}

export function personalForecastRangeGeometry(scenarios: {
  conservative: number;
  likely: number;
  optimistic: number;
}): PersonalForecastRangeGeometry {
  const conservativePct = safePercent(scenarios.conservative) ?? 0;
  const optimisticPct = safePercent(scenarios.optimistic) ?? conservativePct;
  const leftPct = Math.min(conservativePct, optimisticPct);
  const rightPct = Math.max(conservativePct, optimisticPct);
  const likelyPct = Math.max(leftPct, Math.min(rightPct, safePercent(scenarios.likely) ?? leftPct));
  return {
    conservativePct,
    likelyPct,
    optimisticPct,
    leftPct,
    widthPct: rightPct - leftPct,
  };
}

function weeksInIsoYear(year: number): number {
  const date = new Date(Date.UTC(year, 11, 28));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

export function nextIsoWeekId(weekId: string): string | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const maximum = weeksInIsoYear(year);
  if (!Number.isInteger(year) || week < 1 || week > maximum) return null;
  return week === maximum
    ? `${year + 1}-W01`
    : `${year}-W${String(week + 1).padStart(2, "0")}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[midpoint - 1]! + sorted[midpoint]!) / 2)
    : sorted[midpoint]!;
}

function deriveRisks(capacity: PersonalWorkloadReplicaV1["capacity"]): PersonalForecastRisk[] {
  const candidates: Array<PersonalForecastRisk & { active: boolean }> = [
    {
      key: "carryover",
      label: "Carryover pressure",
      detail: `${safePercent(capacity.carryoverRiskPct) ?? 0}% carryover risk could consume next week’s headroom.`,
      active: capacity.carryoverRiskPct >= 25,
    },
    {
      key: "reactive",
      label: "Reactive load",
      detail: `${safePercent(capacity.reactivePct) ?? 0}% reactive work makes the optimistic case less dependable.`,
      active: capacity.reactivePct >= 30,
    },
    {
      key: "fragmented",
      label: "Fragmentation",
      detail: `${safePercent(capacity.fragmentedWorkPct) ?? 0}% fragmented work may reduce focus continuity.`,
      active: capacity.fragmentedWorkPct >= 25,
    },
    {
      key: "blocked",
      label: "Blocked work",
      detail: `${safePercent(capacity.blockedPct) ?? 0}% blocked load remains unresolved.`,
      active: capacity.blockedPct >= 15,
    },
  ];
  return candidates.filter(({ active }) => active).map(({ active: _active, ...risk }) => risk);
}

export function buildPersonalForecastPresentation(
  replicas: PersonalWorkloadReplicaV1[],
): PersonalForecastPresentation {
  const uniqueWeeks = new Map<string, PersonalWorkloadReplicaV1>();
  for (const replica of replicas) {
    if (!/^(\d{4})-W(\d{2})$/.test(replica.weekId)) continue;
    if (safePercent(replica.capacity.reliableNewWorkCapacityPct) === null) continue;
    const existing = uniqueWeeks.get(replica.weekId);
    if (!existing || replica.sourceUpdatedAt.localeCompare(existing.sourceUpdatedAt) > 0
      || (replica.sourceUpdatedAt === existing.sourceUpdatedAt
        && (replica.generatedAt.localeCompare(existing.generatedAt) > 0
          || (replica.generatedAt === existing.generatedAt
            && replica.replicaId.localeCompare(existing.replicaId) > 0)))) {
      uniqueWeeks.set(replica.weekId, replica);
    }
  }
  const history = [...uniqueWeeks.values()]
    .sort((left, right) => left.weekId.localeCompare(right.weekId))
    .slice(-HISTORY_WINDOW_WEEKS);

  if (history.length === 0) {
    return {
      status: "unavailable",
      sourceWeekId: null,
      targetWeekId: null,
      historyWeekCount: 0,
      confidencePct: null,
      scenarios: null,
      risks: [],
      recommendation: "Connect a review-safe workload replica from Weekform for Mac before planning against a forecast.",
      assumptions: [],
      explanation: "There is no review-safe workload replica to forecast from, so Weekform Web does not invent a number.",
      trajectory: [],
      trajectoryDeltaPts: null,
    };
  }

  const latest = history.at(-1)!;
  const values = history.map((row) => safePercent(row.capacity.reliableNewWorkCapacityPct)!);
  const scenarios = {
    conservative: Math.min(...values),
    likely: median(values),
    optimistic: Math.max(...values),
  };
  const status = history.length === 1 ? "baseline" : "history";
  const trajectory = history.map((row) => ({
    weekId: row.weekId,
    allocatedPct: safePercent(row.capacity.allocatedPct) ?? 0,
    reactivePct: safePercent(row.capacity.reactivePct) ?? 0,
    deepWorkPct: safePercent(row.capacity.deepWorkPct) ?? 0,
    reliableCapacityPct: safePercent(row.capacity.reliableNewWorkCapacityPct)!,
    meetingPct: safePercent(row.capacity.meetingPct) ?? 0,
    summaryConfidencePct: safePercent(row.capacity.summaryConfidence * 100) ?? 0,
  }));
  return {
    status,
    sourceWeekId: latest.weekId,
    targetWeekId: nextIsoWeekId(latest.weekId),
    historyWeekCount: history.length,
    confidencePct: safePercent(latest.capacity.summaryConfidence * 100),
    scenarios,
    risks: deriveRisks(latest.capacity),
    recommendation: `Plan new commitments against the ${scenarios.likely}% likely case; protect the ${scenarios.conservative}% conservative case when current risks persist.`,
    assumptions: [
      "Only review-safe derived workload replicas are included.",
      `The range uses up to ${HISTORY_WINDOW_WEEKS} recent synced weeks; it does not inspect raw activity.`,
      "Calendar changes, new commitments, and unresolved private evidence remain on the Mac until the next approved sync.",
    ],
    explanation: status === "baseline"
      ? "One synced week provides a deterministic baseline, not an AI-generated forecast or a calibrated trend."
      : `Derived from ${history.length} synced weekly capacity baselines. The likely case is their median; the range is the observed low-to-high span.`,
    trajectory,
    trajectoryDeltaPts: trajectory.length < 2
      ? null
      : trajectory.at(-1)!.reliableCapacityPct - trajectory[0]!.reliableCapacityPct,
  };
}
