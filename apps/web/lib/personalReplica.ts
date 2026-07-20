import type {
  PersonalReplicaBlockV1,
  PersonalWorkloadReplicaV1,
  ReviewCommandAction,
  ReviewCommandPatchV1,
  ReviewCommandStatus,
} from "../../../packages/domain/src/personalCloud";
import {
  reviewCategories,
  reviewPlannedStatuses,
  reviewWorkModes,
} from "./personalReviewTaxonomy";

const CATEGORIES = new Set<string>(reviewCategories);
const MODES = new Set<string>(reviewWorkModes);
const PLANNED = new Set<string>(reviewPlannedStatuses);
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
const REVIEW_COMMAND_KEYS = new Set([
  "command_id", "block_id", "week_id", "expected_revision", "action", "status", "created_at", "decided_at",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW_COMMAND_LOAD_ERROR = "Weekform Web could not load review-request status. Reload this page or check your connection.";
const REVIEW_COMMAND_INTEGRITY_ERROR = "Weekform Web received invalid review-request status data. Reload after your Mac syncs again.";
const REVIEW_COMMAND_OVERFLOW_ERROR = "Weekform Web received too many review-request statuses to validate safely. Resolve pending requests on your Mac, then reload.";

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
    || !databaseTimestamp(row.synced_at) || !canonicalTimestamp(payload.generatedAt)
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

export interface ConfirmReviewCommandInput {
  blockId: string;
  weekId: string;
  expectedRevision: string;
}

const MAX_CONFIRM_REVIEW_COMMANDS = 50;

export interface ReviewCommandView {
  commandId: string;
  blockId: string;
  weekId: string;
  expectedRevision: string;
  action: ReviewCommandAction;
  status: ReviewCommandStatus;
  createdAt: string;
  decidedAt: string | null;
}

export function parseReviewCommandRow(value: unknown): ReviewCommandView | null {
  const row = record(value);
  if (!row || Object.keys(row).length !== REVIEW_COMMAND_KEYS.size
    || Object.keys(row).some((key) => !REVIEW_COMMAND_KEYS.has(key))) return null;
  if (typeof row.command_id !== "string" || !UUID_PATTERN.test(row.command_id)
    || typeof row.block_id !== "string" || row.block_id.trim() !== row.block_id
    || row.block_id.length === 0 || row.block_id.length > MAX_BLOCK_ID_LENGTH
    || !validWeekId(row.week_id) || typeof row.expected_revision !== "string"
    || !REVISION_PATTERN.test(row.expected_revision)
    || (row.action !== "confirm" && row.action !== "exclude" && row.action !== "relabel")
    || (row.status !== "pending" && row.status !== "applied" && row.status !== "rejected" && row.status !== "conflict")
    || !databaseTimestamp(row.created_at)
    || (row.decided_at !== null && !databaseTimestamp(row.decided_at))) return null;
  if ((row.status === "pending") !== (row.decided_at === null)) return null;
  if (row.decided_at !== null
    && new Date(row.decided_at).getTime() < new Date(row.created_at).getTime()) return null;
  return {
    commandId: row.command_id,
    blockId: row.block_id,
    weekId: row.week_id,
    expectedRevision: row.expected_revision,
    action: row.action,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function databaseTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day) return false;
  return Number.isFinite(new Date(value).getTime());
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

/**
 * Positive-allowlist parser for Today’s Confirm all boundary. The client may
 * identify block revisions, but action, patch, ownership, status, and all
 * chronology are deliberately absent and are derived by the database RPC.
 */
export function reviewConfirmBatchInput(
  value: unknown,
): ConfirmReviewCommandInput[] | null {
  if (!Array.isArray(value) || value.length === 0
    || value.length > MAX_CONFIRM_REVIEW_COMMANDS) return null;
  const commands: ConfirmReviewCommandInput[] = [];
  const targets = new Set<string>();
  for (const candidate of value) {
    const input = record(candidate);
    if (!input || Object.keys(input).length !== 3
      || Object.keys(input).some((key) => !["blockId", "weekId", "expectedRevision"].includes(key))) {
      return null;
    }
    const parsed = reviewCommandInput({
      blockId: input.blockId,
      weekId: input.weekId,
      expectedRevision: input.expectedRevision,
      action: "confirm",
    });
    if (!parsed) return null;
    const target = `${parsed.blockId}\u0000${parsed.weekId}\u0000${parsed.expectedRevision}`;
    if (targets.has(target)) return null;
    targets.add(target);
    commands.push({
      blockId: parsed.blockId,
      weekId: parsed.weekId,
      expectedRevision: parsed.expectedRevision,
    });
  }
  return commands;
}

function reviewConfirmCandidates(
  blocks: Array<Pick<PersonalReplicaBlockV1, "blockId" | "weekId" | "revision" | "userVerified">>,
  commands: ReviewCommandView[],
): ConfirmReviewCommandInput[] {
  const lockedTargets = new Set(commands
    .filter((command) => command.status !== "rejected")
    .map((command) => (
      `${command.blockId}\u0000${command.weekId}\u0000${command.expectedRevision}`
    )));
  const eligible = blocks
    .filter((block) => !block.userVerified && !lockedTargets.has(
      `${block.blockId}\u0000${block.weekId}\u0000${block.revision}`,
    ))
    .map((block) => ({
      blockId: block.blockId,
      weekId: block.weekId,
      expectedRevision: block.revision,
    }));
  return eligible;
}

export interface ReviewConfirmEligibility {
  targets: ConfirmReviewCommandInput[];
  totalCount: number;
}

export function reviewConfirmEligibility(
  blocks: Array<Pick<PersonalReplicaBlockV1, "blockId" | "weekId" | "revision" | "userVerified">>,
  commands: ReviewCommandView[],
): ReviewConfirmEligibility {
  const candidates = reviewConfirmCandidates(blocks, commands);
  return {
    targets: candidates.slice(0, MAX_CONFIRM_REVIEW_COMMANDS),
    totalCount: candidates.length,
  };
}

export function eligibleReviewConfirmTargets(
  blocks: Array<Pick<PersonalReplicaBlockV1, "blockId" | "weekId" | "revision" | "userVerified">>,
  commands: ReviewCommandView[],
): ConfirmReviewCommandInput[] {
  return reviewConfirmEligibility(blocks, commands).targets;
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

export interface ReviewCommandsClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        order(column: string, options: { ascending: boolean }): {
          limit(count: number): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
        };
      };
    };
  };
}

export async function listOwnReviewCommands(client: ReviewCommandsClient, weekId: string | null): Promise<{
  commands: ReviewCommandView[];
  error: string | null;
}> {
  if (weekId === null) return { commands: [], error: null };
  // Protocol histories stay in isolated queues. Read both so Web preserves
  // released v1 history while showing the v2 lifecycle; identity dedupe is a
  // fail-safe for an impossible cross-table UUID collision, not row movement.
  const { data: v1Data, error: v1Error } = await client
    .from("review_commands")
    .select("command_id,block_id,week_id,expected_revision,action,status,created_at,decided_at")
    .eq("week_id", weekId)
    .order("created_at", { ascending: false })
    .limit(101);
  const { data: v2Data, error: v2Error } = await client
    .from("review_commands_v2")
    .select("command_id,block_id,week_id,expected_revision,action,status,created_at,decided_at")
    .eq("week_id", weekId)
    .order("created_at", { ascending: false })
    .limit(101);
  if (v1Error || v2Error) return { commands: [], error: REVIEW_COMMAND_LOAD_ERROR };
  if (!Array.isArray(v1Data) || !Array.isArray(v2Data)) {
    return { commands: [], error: REVIEW_COMMAND_INTEGRITY_ERROR };
  }
  if (v1Data.length > 100 || v2Data.length > 100) {
    return { commands: [], error: REVIEW_COMMAND_OVERFLOW_ERROR };
  }
  const commands = [...v1Data, ...v2Data].map(parseReviewCommandRow);
  if (commands.some((command) => command === null)) {
    return { commands: [], error: REVIEW_COMMAND_INTEGRITY_ERROR };
  }
  const byId = new Map<string, ReviewCommandView>();
  for (const command of commands as ReviewCommandView[]) {
    const existing = byId.get(command.commandId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(command)) {
      return { commands: [], error: REVIEW_COMMAND_INTEGRITY_ERROR };
    }
    byId.set(command.commandId, command);
  }
  if (byId.size > 100) return { commands: [], error: REVIEW_COMMAND_OVERFLOW_ERROR };
  const parsedCommands = [...byId.values()].sort((left, right) => (
    right.createdAt.localeCompare(left.createdAt)
      || right.commandId.localeCompare(left.commandId)
  ));
  if (parsedCommands.some((command) => command.weekId !== weekId)
    || new Set(parsedCommands.map((command) => command.commandId)).size !== parsedCommands.length) {
    return { commands: [], error: REVIEW_COMMAND_INTEGRITY_ERROR };
  }
  const pendingTargets = parsedCommands
    .filter((command) => command.status === "pending")
    .map((command) => `${command.blockId}\u0000${command.weekId}\u0000${command.expectedRevision}`);
  if (new Set(pendingTargets).size !== pendingTargets.length) {
    return { commands: [], error: REVIEW_COMMAND_INTEGRITY_ERROR };
  }
  return { commands: parsedCommands, error: null };
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
