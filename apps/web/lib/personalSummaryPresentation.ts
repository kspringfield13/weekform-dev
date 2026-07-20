import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";

export interface PersonalSummaryReadout {
  headline: string;
  assessment: string;
  signals: string[];
  weekLabel: string;
}

function percent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(Math.max(0, value))}%`;
}

/**
 * Builds a deterministic readout from the positive-allowlist replica only.
 * This is deliberately not a generated narrative: private evidence, prompts,
 * model output, and editable share copy never cross into this browser surface.
 */
export function buildPersonalSummaryReadout(
  replica: PersonalWorkloadReplicaV1 | null,
): PersonalSummaryReadout | null {
  if (!replica) return null;

  const capacity = replica.capacity;
  return {
    headline: `You have ${percent(capacity.reliableNewWorkCapacityPct)} dependable capacity for new planned work.`,
    assessment:
      "This deterministic readout reflects the newest review-safe allocation received from your Mac. It is not an AI-generated narrative.",
    signals: [
      `${percent(capacity.committedUtilizationPct)} committed · ${percent(capacity.reliableNewWorkCapacityPct)} available`,
      `${percent(capacity.plannedPct)} planned · ${percent(capacity.reactivePct)} reactive`,
      `${percent(capacity.carryoverRiskPct)} carryover risk · ${percent(capacity.blockedPct)} blocked`,
    ],
    weekLabel: replica.weekId,
  };
}
