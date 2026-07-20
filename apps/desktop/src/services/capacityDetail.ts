import type { WeeklyCapacitySnapshot } from "../../../../packages/domain/src/models";

export type CapacityDetailScope = "individual" | "manager";

export interface CapacityDetailBand {
  key: string;
  label: string;
  value: number;
  count?: number;
}

export interface CapacityDetailStat {
  label: string;
  value: string;
}

export interface CapacityDetailModel {
  scope: CapacityDetailScope;
  eyebrow: string;
  title: string;
  description: string;
  capacity: number | null;
  caption: string;
  hasEvidence: boolean;
  bands: CapacityDetailBand[];
  stats: CapacityDetailStat[];
  capacitySpread: number[];
  evidenceNote: string;
}

export interface TeamCapacityMember {
  capacity: number | null;
  risk: "stable" | "watch" | "attention" | "stale" | "not-sharing";
  syncedAt: string | null;
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function percent(value: number) {
  return `${Math.round(clampPercent(value))}%`;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2
    : (sorted[midpoint] ?? 0);
}

export function buildIndividualCapacityDetail(
  snapshot: WeeklyCapacitySnapshot,
  hasEvidence: boolean,
): CapacityDetailModel {
  return {
    scope: "individual",
    eyebrow: "Individual mode · this week",
    title: "Capacity for your week",
    description: hasEvidence
      ? "See what is already committed and which workload pressures shape the headroom that remains."
      : "Weekform needs reviewed work evidence before it can estimate reliable capacity.",
    capacity: hasEvidence ? Math.round(clampPercent(snapshot.reliable_new_work_capacity_pct)) : null,
    caption: "Your week",
    hasEvidence,
    bands: hasEvidence ? [
      { key: "committed", label: "Committed", value: clampPercent(snapshot.committed_utilization_pct) },
      { key: "reactive", label: "Reactive", value: clampPercent(snapshot.reactive_pct) },
      { key: "fragmented", label: "Fragmented", value: clampPercent(snapshot.fragmented_work_pct) },
      { key: "meetings", label: "Meetings", value: clampPercent(snapshot.meeting_pct) },
    ] : [],
    stats: hasEvidence ? [
      { label: "Planned", value: percent(snapshot.planned_pct) },
      { label: "Carryover risk", value: percent(snapshot.carryover_risk_pct) },
      { label: "Model confidence", value: percent(snapshot.summary_confidence * 100) },
    ] : [],
    capacitySpread: [],
    evidenceNote: "Calculated locally from your reviewed weekly evidence. No team data is used.",
  };
}

export function buildTeamCapacityDetail(
  members: TeamCapacityMember[],
): CapacityDetailModel {
  const capacitySpread = members
    .flatMap(({ capacity }) => capacity === null || !Number.isFinite(capacity) ? [] : [clampPercent(capacity)])
    .sort((left, right) => left - right);
  const total = members.length;
  const denominator = Math.max(total, 1);
  const sharing = members.filter(({ syncedAt }) => Boolean(syncedAt)).length;
  const stable = members.filter(({ risk }) => risk === "stable").length;
  const watch = members.filter(({ risk }) => risk === "watch").length;
  const attention = members.filter(({ risk }) => risk === "attention").length;
  const unknown = members.filter(({ risk }) => risk === "stale" || risk === "not-sharing").length;

  return {
    scope: "manager",
    eyebrow: "Manager mode · approved summaries",
    title: "Capacity across the team",
    description: capacitySpread.length
      ? "Read the team median alongside the spread and signal coverage, without ranking individual contributors."
      : "No approved reliable-capacity values are available for this team yet.",
    capacity: capacitySpread.length ? Math.round(median(capacitySpread)) : null,
    caption: "Team median",
    hasEvidence: capacitySpread.length > 0,
    bands: [
      { key: "stable", label: "Stable", value: stable / denominator * 100, count: stable },
      { key: "watch", label: "Watch", value: watch / denominator * 100, count: watch },
      { key: "attention", label: "Needs attention", value: attention / denominator * 100, count: attention },
      { key: "unknown", label: "Stale or unknown", value: unknown / denominator * 100, count: unknown },
    ],
    stats: [
      { label: "Sharing", value: `${sharing}/${total}` },
      { label: "Headroom values", value: String(capacitySpread.length) },
      { label: "Attention", value: String(attention) },
    ],
    capacitySpread,
    evidenceNote: "Approved summary snapshots only. Missing values stay unknown and never enter the team median.",
  };
}
