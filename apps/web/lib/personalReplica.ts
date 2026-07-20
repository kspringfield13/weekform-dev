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
const ROW_KEYS = new Set(["replica_id", "week_id", "revision", "synced_at", "payload"]);
const PAYLOAD_KEYS = new Set([
  "schemaVersion", "replicaId", "weekId", "generatedAt", "sourceUpdatedAt", "blocks", "capacity",
]);
const BLOCK_KEYS = new Set([
  "blockId", "weekId", "startTime", "endTime", "estimatedCapacityPct", "category",
  "mode", "plannedStatus", "confidence", "userVerified", "blockerFlag", "revision",
]);
const CAPACITY_RANGES = {
  allocatedPct: [0, 100],
  deepWorkPct: [0, 100],
  fragmentedWorkPct: [0, 100],
  meetingPct: [0, 100],
  reactivePct: [0, 100],
  plannedPct: [0, 100],
  blockedPct: [0, 100],
  reliableNewWorkCapacityPct: [0, 100],
  committedUtilizationPct: [0, 200],
  carryoverRiskPct: [0, 100],
  wipLoadScore: [0, 100],
  contextSwitchScore: [0, 100],
  summaryConfidence: [0, 1],
} as const;
const CAPACITY_KEYS = new Set(Object.keys(CAPACITY_RANGES));
const REVISION_PATTERN = /^[0-9a-f]{16}$/;
const INVALID_REPLICA_ERROR = "Weekform Web received invalid review-safe replica data. Resync from Weekform for Mac.";
const LOAD_REPLICA_ERROR = "Weekform Web could not load review-safe replica data. Reload this page or check your connection.";
const MAX_BLOCK_ID_LENGTH = 160;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inRange(value: unknown, min: number, max: number): value is number {
  return finite(value) && value >= min && value <= max;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function weeksInIsoYear(year: number): number {
  const date = new Date(Date.UTC(year, 11, 28));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function validWeekId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  return week >= 1 && week <= weeksInIsoYear(year);
}

function parseBlock(value: unknown, weekId: string): PersonalReplicaBlockV1 | null {
  const row = record(value);
  if (!row || Object.keys(row).length !== BLOCK_KEYS.size
    || Object.keys(row).some((key) => !BLOCK_KEYS.has(key))) return null;
  if (
    typeof row.blockId !== "string" || row.blockId.trim() === ""
    || row.blockId.length > MAX_BLOCK_ID_LENGTH || row.weekId !== weekId
    || !canonicalTimestamp(row.startTime) || !canonicalTimestamp(row.endTime)
    || new Date(row.endTime).getTime() <= new Date(row.startTime).getTime()
    || !inRange(row.estimatedCapacityPct, 0, 100) || !CATEGORIES.has(row.category as string)
    || !MODES.has(row.mode as string) || !PLANNED.has(row.plannedStatus as string)
    || !inRange(row.confidence, 0, 1) || typeof row.userVerified !== "boolean"
    || typeof row.blockerFlag !== "boolean" || typeof row.revision !== "string"
    || !REVISION_PATTERN.test(row.revision)
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
  if (!row || Object.keys(row).length !== ROW_KEYS.size
    || Object.keys(row).some((key) => !ROW_KEYS.has(key))
    || !payload || Object.keys(payload).length !== PAYLOAD_KEYS.size
    || Object.keys(payload).some((key) => !PAYLOAD_KEYS.has(key))
    || payload.schemaVersion !== 1 || !Array.isArray(payload.blocks)) return null;
  const capacity = record(payload.capacity);
  if (
    !capacity || Object.keys(capacity).length !== CAPACITY_KEYS.size
    || Object.keys(capacity).some((key) => !CAPACITY_KEYS.has(key))
    || Object.entries(CAPACITY_RANGES).some(([key, [min, max]]) => !inRange(capacity[key], min, max))
    || typeof row.replica_id !== "string" || row.replica_id !== payload.replicaId
    || !validWeekId(row.week_id) || row.week_id !== payload.weekId
    || row.replica_id !== `personal-${row.week_id}`
    || typeof row.revision !== "string" || !REVISION_PATTERN.test(row.revision)
    || !canonicalTimestamp(row.synced_at) || !canonicalTimestamp(payload.generatedAt)
    || !canonicalTimestamp(payload.sourceUpdatedAt)
  ) return null;
  const blocks = payload.blocks.map((block) => parseBlock(block, row.week_id as string));
  if (blocks.some((block) => block === null)) return null;
  const parsedBlocks = blocks as PersonalReplicaBlockV1[];
  if (new Set(parsedBlocks.map((block) => block.blockId)).size !== parsedBlocks.length) return null;
  return {
    replicaId: row.replica_id,
    weekId: row.week_id,
    revision: row.revision,
    syncedAt: row.synced_at,
    payload: { ...payload, blocks: parsedBlocks, capacity } as unknown as PersonalWorkloadReplicaV1,
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
  const canonicalBlockId = input.blockId.trim();
  if (canonicalBlockId !== input.blockId || canonicalBlockId.length === 0
    || canonicalBlockId.length > MAX_BLOCK_ID_LENGTH
    || !validWeekId(input.weekId) || !REVISION_PATTERN.test(input.expectedRevision)) return null;
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
  errorKind: "integrity" | "load" | null;
}> {
  const { data, error } = await client
    .from("personal_workload_replicas")
    .select("replica_id,week_id,revision,synced_at,payload")
    .order("week_id", { ascending: false })
    .limit(12);
  if (error) return { replicas: [], error: LOAD_REPLICA_ERROR, errorKind: "load" };
  if (!Array.isArray(data)) {
    return { replicas: [], error: INVALID_REPLICA_ERROR, errorKind: "integrity" };
  }
  const replicas = data.map(parsePersonalReplicaRow);
  if (replicas.some((value) => value === null)) {
    return { replicas: [], error: INVALID_REPLICA_ERROR, errorKind: "integrity" };
  }
  return { replicas: replicas as PersonalReplicaView[], error: null, errorKind: null };
}
