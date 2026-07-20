import type { WorkBlock } from "../../../../packages/domain/src/models";
import type {
  PersonalReplicaPolicyV1,
  PersonalReplicaSyncQueueItemV1,
  PersonalReplicaSyncStateV1,
  PersonalWorkloadReplicaV1,
  ReviewCommandApplicationPhase,
  ReviewCommandApplicationV1,
  ReviewCommandOutboxItemV1,
  ReviewCommandV1,
} from "../../../../packages/domain/src/personalCloud";
import { personalReplicaBlock } from "../../../../packages/inference/src/personalReplica";
import {
  externalWorkBlockId,
  findWorkBlockByExternalId,
} from "../../../../packages/inference/src/externalWorkBlock";

export function createDefaultPersonalReplicaPolicy(): PersonalReplicaPolicyV1 {
  return { version: 1, enabled: false, consentedAt: null };
}

export function parsePersonalReplicaPolicy(value: unknown): PersonalReplicaPolicyV1 {
  if (typeof value !== "object" || value === null) return createDefaultPersonalReplicaPolicy();
  const record = value as Record<string, unknown>;
  return {
    version: 1,
    enabled: record.enabled === true,
    consentedAt: typeof record.consentedAt === "string" && record.consentedAt.length > 0
      ? record.consentedAt
      : null,
  };
}

export function createDefaultPersonalSyncState(
  makeId: () => string = () => crypto.randomUUID(),
): PersonalReplicaSyncStateV1 {
  return {
    deviceId: makeId(),
    deviceName: "Weekform for Mac",
    cursor: 0,
    sourceClock: null,
    queue: [],
    reviewOutbox: [],
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
  };
}

const REVIEW_APPLICATION_KEYS = new Set([
  "schemaVersion", "protocolVersion", "commandId", "blockId", "weekId", "expectedRevision",
  "action", "patch", "createdAt",
]);
const LEGACY_REVIEW_APPLICATION_KEYS = new Set([
  "schemaVersion", "commandId", "blockId", "weekId", "expectedRevision",
  "action", "patch", "createdAt",
]);
const REVIEW_OUTBOX_KEYS = new Set([
  "schemaVersion", "command", "phase", "queuedAt", "updatedAt", "attempts", "lastError",
]);
const REVIEW_PATCH_KEYS = new Set(["category", "mode", "plannedStatus", "blockerFlag"]);
const REVIEW_CATEGORIES = new Set([
  "Planned analysis / project work", "Ad hoc stakeholder requests", "Recurring reporting",
  "Dashboard development / edits", "SQL / data modeling / query work", "QA / data validation",
  "Debugging / issue investigation", "Documentation / requirement clarification",
  "Meetings / stakeholder syncs", "Admin / coordination", "Blocked / waiting / dependency delay",
]);
const REVIEW_MODES = new Set(["Deep work", "Reactive", "Collaborative", "Fragmented", "Blocked"]);
const REVIEW_PLANNED_STATUSES = new Set(["planned", "unplanned", "fixed", "blocked"]);

function recordWithExactKeys(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  return actual.length === keys.size && actual.every((key) => keys.has(key)) ? record : null;
}

function parseReviewApplication(value: unknown): ReviewCommandApplicationV1 | null {
  const record = recordWithExactKeys(value, REVIEW_APPLICATION_KEYS)
    ?? recordWithExactKeys(value, LEGACY_REVIEW_APPLICATION_KEYS);
  // The durable outbox predates protocol tagging only in the isolated-v2
  // implementation, so that one local migration defaults to v2. Every newly
  // persisted command carries an explicit immutable protocol.
  const protocolVersion = record?.protocolVersion === undefined
    ? 2
    : record.protocolVersion;
  if (!record
    || record.schemaVersion !== 1
    || (protocolVersion !== 1 && protocolVersion !== 2)
    || typeof record.commandId !== "string" || record.commandId.length === 0 || record.commandId.length > 80
    || typeof record.blockId !== "string" || record.blockId.length === 0 || record.blockId.length > 160
    || typeof record.weekId !== "string" || !/^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/.test(record.weekId)
    || typeof record.expectedRevision !== "string" || !/^[0-9a-f]{16}$/.test(record.expectedRevision)
    || (record.action !== "confirm" && record.action !== "exclude" && record.action !== "relabel")
    || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) return null;

  let patch: ReviewCommandApplicationV1["patch"] = null;
  if (record.action === "relabel") {
    if (typeof record.patch !== "object" || record.patch === null || Array.isArray(record.patch)) return null;
    const rawPatch = record.patch as Record<string, unknown>;
    const keys = Object.keys(rawPatch);
    if (keys.length === 0 || keys.some((key) => !REVIEW_PATCH_KEYS.has(key))
      || (rawPatch.category !== undefined && !REVIEW_CATEGORIES.has(rawPatch.category as string))
      || (rawPatch.mode !== undefined && !REVIEW_MODES.has(rawPatch.mode as string))
      || (rawPatch.plannedStatus !== undefined && !REVIEW_PLANNED_STATUSES.has(rawPatch.plannedStatus as string))
      || (rawPatch.blockerFlag !== undefined && typeof rawPatch.blockerFlag !== "boolean")) return null;
    patch = rawPatch as ReviewCommandApplicationV1["patch"];
  } else if (record.patch !== null) {
    return null;
  }
  return {
    schemaVersion: 1,
    protocolVersion,
    commandId: record.commandId,
    blockId: record.blockId,
    weekId: record.weekId,
    expectedRevision: record.expectedRevision,
    action: record.action,
    patch,
    createdAt: record.createdAt,
  };
}

function parseReviewOutbox(value: unknown): ReviewCommandOutboxItemV1[] {
  if (!Array.isArray(value)) return [];
  const result: ReviewCommandOutboxItemV1[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const record = recordWithExactKeys(candidate, REVIEW_OUTBOX_KEYS);
    const command = record ? parseReviewApplication(record.command) : null;
    if (!record || !command || seen.has(command.commandId)
      || record.schemaVersion !== 1
      || (record.phase !== "apply_pending" && record.phase !== "ack_pending")
      || typeof record.queuedAt !== "string" || !Number.isFinite(Date.parse(record.queuedAt))
      || typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))
      || typeof record.attempts !== "number" || !Number.isSafeInteger(record.attempts)
      || record.attempts < 0 || record.attempts > 1_000_000
      || (record.lastError !== null && typeof record.lastError !== "string")) continue;
    seen.add(command.commandId);
    result.push({
      schemaVersion: 1,
      command,
      phase: record.phase,
      queuedAt: record.queuedAt,
      updatedAt: record.updatedAt,
      attempts: record.attempts,
      lastError: typeof record.lastError === "string" ? record.lastError.slice(0, 200) : null,
    });
  }
  return result;
}

function queuedReplicaContainsLocalChatId(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const blocks = (payload as Record<string, unknown>).blocks;
  if (!Array.isArray(blocks)) return false;
  return blocks.some((block) => {
    if (typeof block !== "object" || block === null) return false;
    const blockId = (block as Record<string, unknown>).blockId;
    return typeof blockId === "string"
      && (
        blockId.startsWith("chat-")
        || blockId.startsWith("chat_review-")
        || blockId.startsWith("imported-chat-")
      );
  });
}

export function parsePersonalSyncState(
  value: unknown,
  makeId: () => string = () => crypto.randomUUID(),
): PersonalReplicaSyncStateV1 {
  const fallback = createDefaultPersonalSyncState(makeId);
  if (typeof value !== "object" || value === null) return fallback;
  const record = value as Record<string, unknown>;
  const queue = Array.isArray(record.queue)
    ? record.queue.filter((item): item is PersonalReplicaSyncQueueItemV1 => {
        if (typeof item !== "object" || item === null) return false;
        const entry = item as Record<string, unknown>;
        return typeof entry.batchId === "string"
          && typeof entry.fingerprint === "string"
          && typeof entry.queuedAt === "string"
          && typeof entry.payload === "object"
          && entry.payload !== null
          // Pre-boundary batches can contain a local provider-bearing Chat id.
          // Drop the unsent batch fail-closed; enabled sync immediately rebuilds
          // the current week from local truth using the opaque external mapping.
          && !queuedReplicaContainsLocalChatId(entry.payload);
      }).slice(-20)
    : [];
  return {
    deviceId: typeof record.deviceId === "string" && record.deviceId.length > 0
      ? record.deviceId
      : fallback.deviceId,
    deviceName: typeof record.deviceName === "string" && record.deviceName.trim().length > 0
      ? record.deviceName.trim().slice(0, 80)
      : fallback.deviceName,
    cursor: typeof record.cursor === "number" && Number.isSafeInteger(record.cursor) && record.cursor >= 0
      ? record.cursor
      : 0,
    sourceClock: typeof record.sourceClock === "string" && Number.isFinite(Date.parse(record.sourceClock))
      ? new Date(record.sourceClock).toISOString()
      : null,
    queue,
    reviewOutbox: parseReviewOutbox(record.reviewOutbox),
    lastAttemptAt: typeof record.lastAttemptAt === "string" ? record.lastAttemptAt : null,
    lastSuccessAt: typeof record.lastSuccessAt === "string" ? record.lastSuccessAt : null,
    lastError: typeof record.lastError === "string" ? record.lastError.slice(0, 200) : null,
  };
}

function persistedReviewApplication(command: ReviewCommandApplicationV1): ReviewCommandApplicationV1 {
  return {
    schemaVersion: 1,
    protocolVersion: command.protocolVersion,
    commandId: command.commandId,
    blockId: command.blockId,
    weekId: command.weekId,
    expectedRevision: command.expectedRevision,
    action: command.action,
    patch: command.patch ? { ...command.patch } : null,
    createdAt: command.createdAt,
  };
}

/** Add or resume a protocol-tagged command without ever regressing ack_pending. */
export function enqueueReviewCommandApplication(
  outbox: readonly ReviewCommandOutboxItemV1[],
  input: { command: ReviewCommandApplicationV1; phase: ReviewCommandApplicationPhase; now: string },
): ReviewCommandOutboxItemV1[] {
  const existing = outbox.find((item) => item.command.commandId === input.command.commandId);
  if (existing) {
    if (existing.phase === "ack_pending" || input.phase === existing.phase) return [...outbox];
    return outbox.map((item) => item.command.commandId === input.command.commandId
      ? { ...item, phase: "ack_pending", updatedAt: input.now, lastError: null }
      : item);
  }
  const item: ReviewCommandOutboxItemV1 = {
    schemaVersion: 1,
    command: persistedReviewApplication(input.command),
    phase: input.phase,
    queuedAt: input.now,
    updatedAt: input.now,
    attempts: 0,
    lastError: null,
  };
  // Claimed commands are consequential receipts: never evict one merely
  // because more commands arrived. Each item leaves only after a terminal
  // server acknowledgement or a confirmed server-side deletion.
  return [...outbox, item];
}

export function markReviewCommandApplicationPhase(
  outbox: readonly ReviewCommandOutboxItemV1[],
  commandId: string,
  phase: ReviewCommandApplicationPhase,
  now: string,
): ReviewCommandOutboxItemV1[] {
  return outbox.map((item) => item.command.commandId !== commandId ? item : {
    ...item,
    phase: item.phase === "ack_pending" ? "ack_pending" : phase,
    updatedAt: now,
    lastError: null,
  });
}

export function markReviewCommandApplicationAttempt(
  outbox: readonly ReviewCommandOutboxItemV1[],
  commandId: string,
  error: string,
  now: string,
): ReviewCommandOutboxItemV1[] {
  return outbox.map((item) => item.command.commandId !== commandId ? item : {
    ...item,
    attempts: item.attempts + 1,
    updatedAt: now,
    lastError: error.slice(0, 200),
  });
}

export function removeReviewCommandApplication(
  outbox: readonly ReviewCommandOutboxItemV1[],
  commandId: string,
): ReviewCommandOutboxItemV1[] {
  return outbox.filter((item) => item.command.commandId !== commandId);
}

const REVIEW_APPLICATION_RETRY_MS = [0, 5_000, 15_000, 60_000, 300_000] as const;
export const REVIEW_COMMAND_CLAIM_LEASE_MS = 24 * 60 * 60 * 1000;

/** Only a never-recorded application may move to another registered device. */
export function reviewCommandClaimIsRecoverable(
  command: ReviewCommandV1,
  nowMs: number = Date.now(),
): boolean {
  if (command.applicationPhase !== "apply_pending" || command.claimedByDevice === null) return false;
  if (command.claimOwnerRevoked === true) return true;
  const claimedAt = command.claimedAt === null || command.claimedAt === undefined
    ? Number.NaN
    : Date.parse(command.claimedAt);
  return Number.isFinite(claimedAt) && claimedAt <= nowMs - REVIEW_COMMAND_CLAIM_LEASE_MS;
}

/** Remaining delay before a durable outbox item may retry after a failure. */
export function reviewCommandApplicationRetryDelayMs(
  item: ReviewCommandOutboxItemV1,
  nowMs: number,
): number {
  if (item.attempts <= 0 || item.lastError === null) return 0;
  const tier = REVIEW_APPLICATION_RETRY_MS[Math.min(item.attempts, REVIEW_APPLICATION_RETRY_MS.length - 1)];
  const updatedAt = Date.parse(item.updatedAt);
  if (!Number.isFinite(updatedAt)) return tier;
  return Math.max(0, updatedAt + tier - nowMs);
}

export function nextReviewCommandApplication(
  outbox: readonly ReviewCommandOutboxItemV1[],
  nowMs: number,
): { item: ReviewCommandOutboxItemV1; delayMs: number } | null {
  let selected: { item: ReviewCommandOutboxItemV1; delayMs: number } | null = null;
  for (const item of outbox) {
    const delayMs = reviewCommandApplicationRetryDelayMs(item, nowMs);
    if (selected === null || delayMs < selected.delayMs) selected = { item, delayMs };
  }
  return selected;
}

export function personalSyncDisconnectBlockReason(
  state: PersonalReplicaSyncStateV1,
): string | null {
  const count = state.reviewOutbox?.length ?? 0;
  if (count === 0) return null;
  return `Finish syncing ${count} approved Web review request${count === 1 ? "" : "s"} before disconnecting. Keep Weekform open and online, then try Disconnect again.`;
}

export function enqueueReplicaBatch(
  queue: PersonalReplicaSyncQueueItemV1[],
  input: {
    fingerprint: string;
    payload: PersonalWorkloadReplicaV1;
    now: string;
    makeId?: () => string;
  },
): PersonalReplicaSyncQueueItemV1[] {
  const existing = queue.find((item) => item.fingerprint === input.fingerprint);
  if (existing) return queue;
  const item: PersonalReplicaSyncQueueItemV1 = {
    batchId: (input.makeId ?? (() => crypto.randomUUID()))(),
    fingerprint: input.fingerprint,
    payload: input.payload,
    queuedAt: input.now,
    attempts: 0,
    lastError: null,
  };
  // Latest replica supersedes older unsent replicas for the same week. Keep other
  // weeks so reconnecting after a longer offline period can fill history.
  return [
    ...queue.filter((queued) => queued.payload.weekId !== input.payload.weekId),
    item,
  ].slice(-20);
}

function nextReplicaSourceClock(now: string, previous: string | null): string {
  const nowMs = Date.parse(now);
  const previousMs = previous === null ? Number.NEGATIVE_INFINITY : Date.parse(previous);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const safePreviousMs = Number.isFinite(previousMs) ? previousMs : Number.NEGATIVE_INFINITY;
  return new Date(Math.max(safeNowMs, safePreviousMs + 1)).toISOString();
}

/**
 * Atomically advances the persisted replica clock only for new deterministic
 * content. An exact queued retry reuses the original payload, clock, and batch.
 */
export function enqueueReplicaBatchWithClock(
  state: PersonalReplicaSyncStateV1,
  input: {
    fingerprint: string;
    payload: PersonalWorkloadReplicaV1;
    now: string;
    makeId?: () => string;
  },
): PersonalReplicaSyncStateV1 {
  if (state.queue.some((item) => item.fingerprint === input.fingerprint)) return state;
  const sourceClock = nextReplicaSourceClock(input.now, state.sourceClock);
  const payload: PersonalWorkloadReplicaV1 = {
    ...input.payload,
    sourceUpdatedAt: sourceClock,
  };
  return {
    ...state,
    sourceClock,
    queue: enqueueReplicaBatch(state.queue, { ...input, payload }),
  };
}

export function markReplicaBatchAttempt(
  queue: PersonalReplicaSyncQueueItemV1[],
  batchId: string,
  error: string,
): PersonalReplicaSyncQueueItemV1[] {
  return queue.map((item) => item.batchId === batchId
    ? { ...item, attempts: item.attempts + 1, lastError: error.slice(0, 200) }
    : item);
}

export function shouldFlushPersonalQueue(enabled: boolean, queuedBatches: number): boolean {
  return enabled && Number.isSafeInteger(queuedBatches) && queuedBatches > 0;
}

export function currentBlockRevision(block: WorkBlock): string {
  return personalReplicaBlock(block).revision;
}

export type ApplyReviewCommandResult =
  | { ok: true; block: WorkBlock | null; changedFields: string[] }
  | { ok: false; reason: "wrong_target" | "revision_conflict" | "invalid_patch" };

function deterministicBlockerFlag(block: Pick<WorkBlock, "category" | "planned_status">): boolean {
  return block.category === "Blocked / waiting / dependency delay"
    || block.planned_status === "blocked";
}

function reviewRelabelHasConsistentBlockerFlag(
  block: WorkBlock,
  command: ReviewCommandApplicationV1,
): boolean {
  if (command.action !== "relabel" || !command.patch) return true;
  if (command.patch.blockerFlag === undefined) return true;
  return command.patch.blockerFlag === deterministicBlockerFlag({
    category: command.patch.category ?? block.category,
    planned_status: command.patch.plannedStatus ?? block.planned_status,
  });
}

export function findLocalBlockForReviewCommand(
  blocks: readonly WorkBlock[],
  command: Pick<ReviewCommandV1, "blockId" | "weekId">,
): WorkBlock | null {
  const block = findWorkBlockByExternalId(blocks, command.blockId);
  return block?.week_id === command.weekId ? block : null;
}

export type ReviewCommandApplicationDecision =
  | { kind: "apply"; block: WorkBlock }
  | { kind: "already_applied"; block: WorkBlock | null }
  | { kind: "conflict"; block: WorkBlock | null };

function requestedReviewOutcomeIsPresent(block: WorkBlock | null, command: ReviewCommandApplicationV1): boolean {
  if (command.action === "exclude") return block === null;
  if (!block) return false;
  if (command.action === "confirm") return block.user_verified;
  const patch = command.patch;
  if (!reviewRelabelHasConsistentBlockerFlag(block, command)) return false;
  const expectedBlockerFlag = deterministicBlockerFlag({
    category: patch?.category ?? block.category,
    planned_status: patch?.plannedStatus ?? block.planned_status,
  });
  return patch !== null
    && (patch.category === undefined || block.category === patch.category)
    && (patch.mode === undefined || block.mode === patch.mode)
    && (patch.plannedStatus === undefined || block.planned_status === patch.plannedStatus)
    && block.blocker_flag === expectedBlockerFlag;
}

/**
 * Crash-safe application decision. A command whose requested effect is already
 * present is acknowledged without applying corrections twice.
 */
export function reviewCommandApplicationDecision(
  blocks: readonly WorkBlock[],
  command: ReviewCommandApplicationV1,
): ReviewCommandApplicationDecision {
  const block = findLocalBlockForReviewCommand(blocks, command);
  if (requestedReviewOutcomeIsPresent(block, command)) return { kind: "already_applied", block };
  if (!block || currentBlockRevision(block) !== command.expectedRevision) return { kind: "conflict", block };
  if (!reviewRelabelHasConsistentBlockerFlag(block, command)) return { kind: "conflict", block };
  return { kind: "apply", block };
}

/** Pure approval application. Calling this function represents the Mac-side approval edge. */
export function applyApprovedReviewCommand(
  block: WorkBlock,
  command: ReviewCommandApplicationV1,
): ApplyReviewCommandResult {
  if (command.blockId !== externalWorkBlockId(block) || command.weekId !== block.week_id) {
    return { ok: false, reason: "wrong_target" };
  }
  if (currentBlockRevision(block) !== command.expectedRevision) {
    return { ok: false, reason: "revision_conflict" };
  }
  if (command.action === "exclude") {
    return { ok: true, block: null, changedFields: ["exclude"] };
  }
  if (command.action === "confirm") {
    return {
      ok: true,
      block: { ...block, user_verified: true, confidence: Math.max(block.confidence, 0.9) },
      changedFields: ["verification"],
    };
  }
  if (command.action !== "relabel" || !command.patch) {
    return { ok: false, reason: "invalid_patch" };
  }
  if (!reviewRelabelHasConsistentBlockerFlag(block, command)) {
    return { ok: false, reason: "invalid_patch" };
  }
  const changedFields: string[] = [];
  const next = { ...block };
  if (command.patch.category !== undefined && command.patch.category !== block.category) {
    next.category = command.patch.category;
    changedFields.push("category");
  }
  if (command.patch.mode !== undefined && command.patch.mode !== block.mode) {
    next.mode = command.patch.mode;
    changedFields.push("mode");
  }
  if (command.patch.plannedStatus !== undefined && command.patch.plannedStatus !== block.planned_status) {
    next.planned_status = command.patch.plannedStatus;
    changedFields.push("planned_status");
  }
  const blockerFlag = deterministicBlockerFlag(next);
  if (blockerFlag !== block.blocker_flag) {
    next.blocker_flag = blockerFlag;
    changedFields.push("blocker_flag");
  }
  if (changedFields.length === 0) return { ok: false, reason: "invalid_patch" };
  next.user_verified = false;
  return { ok: true, block: next, changedFields };
}

export type AtomicReviewCommandResult =
  | { kind: "applied"; before: WorkBlock; block: WorkBlock | null; changedFields: string[] }
  | { kind: "already_applied"; block: WorkBlock | null }
  | { kind: "conflict"; block: WorkBlock | null };

/** Pure CAS projection used inside the ledger's single synchronous mutation edge. */
export function applyReviewCommandToCurrentBlocks(
  blocks: WorkBlock[],
  command: ReviewCommandApplicationV1,
): { blocks: WorkBlock[]; result: AtomicReviewCommandResult } {
  const decision = reviewCommandApplicationDecision(blocks, command);
  if (decision.kind !== "apply") return { blocks, result: decision };
  const applied = applyApprovedReviewCommand(decision.block, command);
  if (!applied.ok) return { blocks, result: { kind: "conflict", block: decision.block } };
  const nextBlocks = applied.block === null
    ? blocks.filter((entry) => entry.work_block_id !== decision.block.work_block_id)
    : blocks.map((entry) => entry.work_block_id === decision.block.work_block_id ? applied.block! : entry);
  return {
    blocks: nextBlocks,
    result: {
      kind: "applied",
      before: decision.block,
      block: applied.block,
      changedFields: applied.changedFields,
    },
  };
}
