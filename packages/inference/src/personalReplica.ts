import type { WeeklyCapacitySnapshot, WorkBlock } from "../../domain/src/models";
import type {
  PersonalReplicaBlockV1,
  PersonalWorkloadReplicaV1,
} from "../../domain/src/personalCloud";
import { externalWorkBlockId } from "./externalWorkBlock";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hash ^= BigInt(code & 0xff);
    hash = (hash * prime) & mask;
    hash ^= BigInt(code >> 8);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function finite(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0;
}

export function personalReplicaBlock(block: WorkBlock): PersonalReplicaBlockV1 {
  const content = {
    blockId: externalWorkBlockId(block),
    weekId: block.week_id,
    startTime: block.start_time,
    endTime: block.end_time,
    estimatedCapacityPct: finite(block.estimated_capacity_pct, 0, 100),
    category: block.category,
    mode: block.mode,
    plannedStatus: block.planned_status,
    confidence: finite(block.confidence, 0, 1),
    userVerified: block.user_verified === true,
    blockerFlag: block.blocker_flag === true,
  };
  return { ...content, revision: fnv1a64Hex(stableStringify(content)) };
}

export function buildPersonalWorkloadReplica(input: {
  weekId: string;
  blocks: WorkBlock[];
  snapshot: WeeklyCapacitySnapshot;
  now: string;
}): PersonalWorkloadReplicaV1 {
  const blocks = input.blocks
    .filter((block) => block.week_id === input.weekId)
    .map(personalReplicaBlock)
    .sort((left, right) => left.startTime.localeCompare(right.startTime) || left.blockId.localeCompare(right.blockId));
  // Freshness is the time this exact allowlisted replica was derived, not the
  // end time of its newest work block. Review, relabel, capacity-only, and
  // deletion changes can all leave block end times unchanged (or move them
  // backward); using the derivation clock lets the server reject genuinely
  // delayed batches without rejecting those legitimate local edits.
  const sourceUpdatedAt = input.now;
  return {
    schemaVersion: 1,
    replicaId: `personal-${input.weekId}`,
    weekId: input.weekId,
    generatedAt: input.now,
    sourceUpdatedAt,
    blocks,
    capacity: {
      allocatedPct: finite(input.snapshot.allocated_pct, 0, 100),
      deepWorkPct: finite(input.snapshot.deep_work_pct, 0, 100),
      fragmentedWorkPct: finite(input.snapshot.fragmented_work_pct, 0, 100),
      meetingPct: finite(input.snapshot.meeting_pct, 0, 100),
      reactivePct: finite(input.snapshot.reactive_pct, 0, 100),
      plannedPct: finite(input.snapshot.planned_pct, 0, 100),
      blockedPct: finite(input.snapshot.blocked_pct, 0, 100),
      reliableNewWorkCapacityPct: finite(input.snapshot.reliable_new_work_capacity_pct, 0, 100),
      committedUtilizationPct: finite(input.snapshot.committed_utilization_pct, 0, 200),
      carryoverRiskPct: finite(input.snapshot.carryover_risk_pct, 0, 100),
      wipLoadScore: finite(input.snapshot.wip_load_score, 0, 100),
      contextSwitchScore: finite(input.snapshot.context_switch_score, 0, 100),
      summaryConfidence: finite(input.snapshot.summary_confidence, 0, 1),
    },
  };
}

export function replicaContentFingerprint(replica: PersonalWorkloadReplicaV1): string {
  return fnv1a64Hex(stableStringify({
    schemaVersion: replica.schemaVersion,
    replicaId: replica.replicaId,
    weekId: replica.weekId,
    blocks: replica.blocks,
    capacity: replica.capacity,
  }));
}
