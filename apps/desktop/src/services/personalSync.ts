import type { WorkBlock } from "../../../../packages/domain/src/models";
import type {
  PersonalReplicaPolicyV1,
  PersonalReplicaSyncQueueItemV1,
  PersonalReplicaSyncStateV1,
  PersonalWorkloadReplicaV1,
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
    queue: [],
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
  };
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
    queue,
    lastAttemptAt: typeof record.lastAttemptAt === "string" ? record.lastAttemptAt : null,
    lastSuccessAt: typeof record.lastSuccessAt === "string" ? record.lastSuccessAt : null,
    lastError: typeof record.lastError === "string" ? record.lastError.slice(0, 200) : null,
  };
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

export function findLocalBlockForReviewCommand(
  blocks: readonly WorkBlock[],
  command: Pick<ReviewCommandV1, "blockId" | "weekId">,
): WorkBlock | null {
  const block = findWorkBlockByExternalId(blocks, command.blockId);
  return block?.week_id === command.weekId ? block : null;
}

/** Pure approval application. Calling this function represents the Mac-side approval edge. */
export function applyApprovedReviewCommand(
  block: WorkBlock,
  command: ReviewCommandV1,
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
  if (command.patch.blockerFlag !== undefined && command.patch.blockerFlag !== block.blocker_flag) {
    next.blocker_flag = command.patch.blockerFlag;
    changedFields.push("blocker_flag");
  }
  if (changedFields.length === 0) return { ok: false, reason: "invalid_patch" };
  next.user_verified = false;
  return { ok: true, block: next, changedFields };
}
