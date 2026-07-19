import type {
  PersonalReplicaBlockV1,
  PersonalWorkloadReplicaV1,
  ReviewCommandAction,
  ReviewCommandPatchV1,
} from "../../../packages/domain/src/personalCloud";

const CATEGORIES = new Set([
  "Planned analysis / project work",
  "Ad hoc stakeholder requests",
  "Recurring reporting",
  "Dashboard development / edits",
  "SQL / data modeling / query work",
  "QA / data validation",
  "Debugging / issue investigation",
  "Documentation / requirement clarification",
  "Meetings / stakeholder syncs",
  "Admin / coordination",
  "Blocked / waiting / dependency delay",
]);
const MODES = new Set(["Deep work", "Reactive", "Collaborative", "Fragmented", "Blocked"]);
const PLANNED = new Set(["planned", "unplanned", "fixed", "blocked"]);
const BLOCK_KEYS = new Set([
  "blockId", "weekId", "startTime", "endTime", "estimatedCapacityPct", "category",
  "mode", "plannedStatus", "confidence", "userVerified", "blockerFlag", "revision",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBlock(value: unknown): PersonalReplicaBlockV1 | null {
  const row = record(value);
  if (!row || Object.keys(row).some((key) => !BLOCK_KEYS.has(key))) return null;
  if (
    typeof row.blockId !== "string" || typeof row.weekId !== "string"
    || typeof row.startTime !== "string" || typeof row.endTime !== "string"
    || !finite(row.estimatedCapacityPct) || !CATEGORIES.has(row.category as string)
    || !MODES.has(row.mode as string) || !PLANNED.has(row.plannedStatus as string)
    || !finite(row.confidence) || typeof row.userVerified !== "boolean"
    || typeof row.blockerFlag !== "boolean" || typeof row.revision !== "string"
  ) return null;
  return row as unknown as PersonalReplicaBlockV1;
}

export interface PersonalReplicaView {
  replicaId: string;
  weekId: string;
  revision: string;
  syncedAt: string;
  payload: PersonalWorkloadReplicaV1;
}

export function parsePersonalReplicaRow(value: unknown): PersonalReplicaView | null {
  const row = record(value);
  const payload = record(row?.payload);
  if (!row || !payload || payload.schemaVersion !== 1 || !Array.isArray(payload.blocks)) return null;
  const blocks = payload.blocks.map(parseBlock);
  if (blocks.some((block) => block === null)) return null;
  const capacity = record(payload.capacity);
  const capacityKeys = [
    "allocatedPct", "deepWorkPct", "fragmentedWorkPct", "meetingPct", "reactivePct",
    "plannedPct", "blockedPct", "reliableNewWorkCapacityPct", "committedUtilizationPct",
    "carryoverRiskPct", "wipLoadScore", "contextSwitchScore", "summaryConfidence",
  ];
  if (!capacity || capacityKeys.some((key) => !finite(capacity[key]))) return null;
  if (
    typeof row.replica_id !== "string" || typeof row.week_id !== "string"
    || typeof row.revision !== "string" || typeof row.synced_at !== "string"
    || typeof payload.replicaId !== "string" || typeof payload.weekId !== "string"
    || typeof payload.generatedAt !== "string" || typeof payload.sourceUpdatedAt !== "string"
  ) return null;
  return {
    replicaId: row.replica_id,
    weekId: row.week_id,
    revision: row.revision,
    syncedAt: row.synced_at,
    payload: { ...payload, blocks: blocks as PersonalReplicaBlockV1[], capacity } as unknown as PersonalWorkloadReplicaV1,
  };
}

export interface ReviewCommandInput {
  blockId: string;
  weekId: string;
  expectedRevision: string;
  action: ReviewCommandAction;
  patch: ReviewCommandPatchV1 | null;
}

export function reviewCommandInput(value: unknown): ReviewCommandInput | null {
  const input = record(value);
  if (!input || typeof input.blockId !== "string" || typeof input.weekId !== "string"
    || typeof input.expectedRevision !== "string") return null;
  if (input.action !== "confirm" && input.action !== "exclude" && input.action !== "relabel") return null;
  if (input.action !== "relabel") {
    return { blockId: input.blockId, weekId: input.weekId, expectedRevision: input.expectedRevision, action: input.action, patch: null };
  }
  const patch = record(input.patch);
  if (!patch || Object.keys(patch).length === 0
    || Object.keys(patch).some((key) => !["category", "mode", "plannedStatus", "blockerFlag"].includes(key))) return null;
  if (patch.category !== undefined && !CATEGORIES.has(patch.category as string)) return null;
  if (patch.mode !== undefined && !MODES.has(patch.mode as string)) return null;
  if (patch.plannedStatus !== undefined && !PLANNED.has(patch.plannedStatus as string)) return null;
  if (patch.blockerFlag !== undefined && typeof patch.blockerFlag !== "boolean") return null;
  return {
    blockId: input.blockId,
    weekId: input.weekId,
    expectedRevision: input.expectedRevision,
    action: "relabel",
    patch: patch as ReviewCommandPatchV1,
  };
}

interface SupabaseLike {
  from(table: string): {
    select(columns: string): {
      order(column: string, options: { ascending: boolean }): {
        limit(count: number): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  };
}

export async function listOwnPersonalReplicas(client: SupabaseLike): Promise<{
  replicas: PersonalReplicaView[];
  error: string | null;
}> {
  const { data, error } = await client
    .from("personal_workload_replicas")
    .select("replica_id,week_id,revision,synced_at,payload")
    .order("week_id", { ascending: false })
    .limit(12);
  if (error) return { replicas: [], error: error.message ?? "Could not load your Web workspace" };
  const replicas = (Array.isArray(data) ? data : [])
    .map(parsePersonalReplicaRow)
    .filter((value): value is PersonalReplicaView => value !== null);
  return { replicas, error: null };
}
