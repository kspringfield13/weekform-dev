import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  UserCorrection,
  WeeklyCapacitySnapshot,
  WorkBlock,
} from "../../../../packages/domain/src/models";
import type { ReviewCommandV1 } from "../../../../packages/domain/src/personalCloud";
import {
  buildPersonalWorkloadReplica,
  replicaContentFingerprint,
} from "../../../../packages/inference/src/personalReplica";
import {
  completeReviewCommand,
  fetchPendingReviewCommands,
  getCloudEnv,
  registerWeekformDevice,
  syncPersonalReplicaBatch,
} from "../services/cloudClient";
import {
  applyApprovedReviewCommand,
  enqueueReplicaBatch,
  markReplicaBatchAttempt,
  shouldFlushPersonalQueue,
} from "../services/personalSync";
import type { CloudAccountController } from "./useCloudAccount";

export interface PersonalCloudSyncController {
  enabled: boolean;
  syncBusy: boolean;
  lastError: string | null;
  queuedBatches: number;
  pendingCommands: ReviewCommandV1[];
  syncNow: () => Promise<boolean>;
  refreshCommands: () => Promise<void>;
  approveCommand: (commandId: string) => Promise<boolean>;
  rejectCommand: (commandId: string) => Promise<boolean>;
}

export function usePersonalCloudSync(input: {
  account: CloudAccountController;
  snapshot: WeeklyCapacitySnapshot;
  workBlocks: WorkBlock[];
  setBlocks: React.Dispatch<React.SetStateAction<WorkBlock[]>>;
  addCorrection: (correction: Omit<UserCorrection, "correction_id" | "timestamp">) => void;
}): PersonalCloudSyncController {
  const { account, snapshot, workBlocks, setBlocks, addCorrection } = input;
  const [syncBusy, setSyncBusy] = useState(false);
  const [pendingCommands, setPendingCommands] = useState<ReviewCommandV1[]>([]);
  const inFlight = useRef(false);
  const accountRef = useRef(account);
  accountRef.current = account;
  const enabled = account.personalReplicaPolicy.enabled
    && account.personalReplicaPolicy.consentedAt !== null
    && account.account !== null
    && !account.isDemoMode;

  const replica = useMemo(() => buildPersonalWorkloadReplica({
    weekId: snapshot.week_id,
    blocks: workBlocks,
    snapshot,
    now: new Date().toISOString(),
  }), [snapshot, workBlocks]);
  const fingerprint = useMemo(() => replicaContentFingerprint(replica), [replica]);

  // Durable offline queue: a newer version supersedes an unsent version of the
  // same week, while other weeks remain queued. Nothing queues before explicit consent.
  useEffect(() => {
    if (!enabled) return;
    account.setPersonalSyncState((current) => ({
      ...current,
      queue: enqueueReplicaBatch(current.queue, {
        fingerprint,
        payload: replica,
        now: new Date().toISOString(),
      }),
    }));
  }, [enabled, fingerprint, replica, account.setPersonalSyncState]);

  const ensureDevice = useCallback(async () => {
    const current = accountRef.current;
    const env = getCloudEnv();
    const session = await current.getFreshSession();
    if (!env || !session) return { ok: false as const, message: "Sign in to sync your Web workspace." };
    const result = await registerWeekformDevice(
      env,
      session,
      current.personalSyncState.deviceId,
      current.personalSyncState.deviceName,
    );
    if (!result.ok) return result;
    return { ok: true as const, env, session };
  }, []);

  const syncNow = useCallback(async (): Promise<boolean> => {
    if (!enabled || inFlight.current) return false;
    const currentAccount = accountRef.current;
    inFlight.current = true;
    setSyncBusy(true);
    const attemptedAt = new Date().toISOString();
    currentAccount.setPersonalSyncState((current) => ({ ...current, lastAttemptAt: attemptedAt, lastError: null }));
    try {
      const ready = await ensureDevice();
      if (!ready.ok) {
        currentAccount.setPersonalSyncState((current) => ({ ...current, lastError: ready.message }));
        return false;
      }
      let queue = currentAccount.personalSyncState.queue;
      let cursor = currentAccount.personalSyncState.cursor;
      let lastSuccessAt = currentAccount.personalSyncState.lastSuccessAt;
      for (const item of queue) {
        const result = await syncPersonalReplicaBatch(
          ready.env,
          ready.session,
          currentAccount.personalSyncState.deviceId,
          item,
        );
        if (!result.ok) {
          queue = markReplicaBatchAttempt(queue, item.batchId, result.message);
          currentAccount.setPersonalSyncState((current) => ({
            ...current,
            queue: markReplicaBatchAttempt(current.queue, item.batchId, result.message),
            lastError: result.message,
            lastAttemptAt: attemptedAt,
          }));
          currentAccount.emitAudit("personal_sync_failure", "Private Web workspace sync failed; the review-safe batch remains queued", {
            batch_id: item.batchId,
            queued_batches: queue.length,
          });
          return false;
        }
        cursor = Math.max(cursor, result.value.cursor);
        lastSuccessAt = result.value.syncedAt;
        queue = queue.filter((queued) => queued.batchId !== item.batchId);
        currentAccount.setPersonalSyncState((current) => ({
          ...current,
          cursor: Math.max(current.cursor, cursor),
          queue: current.queue.filter((queued) => queued.batchId !== item.batchId),
          lastSuccessAt,
          lastAttemptAt: attemptedAt,
          lastError: null,
        }));
      }
      if (lastSuccessAt) {
        currentAccount.emitAudit("personal_sync_success", "Updated the private Weekform Web workspace with reviewed, derived fields", {
          week_id: replica.weekId,
          block_count: replica.blocks.length,
          cursor,
        });
      }
      return true;
    } finally {
      inFlight.current = false;
      setSyncBusy(false);
    }
  }, [enabled, ensureDevice, replica]);

  const refreshCommands = useCallback(async () => {
    if (!enabled) {
      setPendingCommands([]);
      return;
    }
    const ready = await ensureDevice();
    if (!ready.ok) return;
    const result = await fetchPendingReviewCommands(ready.env, ready.session);
    if (result.ok) setPendingCommands(result.value);
  }, [enabled, ensureDevice]);

  const finishCommand = useCallback(async (
    command: ReviewCommandV1,
    status: "applied" | "rejected" | "conflict",
    reason: string | null,
  ) => {
    const ready = await ensureDevice();
    if (!ready.ok) return false;
    const result = await completeReviewCommand(
      ready.env,
      ready.session,
      accountRef.current.personalSyncState.deviceId,
      command.commandId,
      status,
      reason,
    );
    if (!result.ok || !result.value) return false;
    setPendingCommands((current) => current.filter((entry) => entry.commandId !== command.commandId));
    return true;
  }, [ensureDevice]);

  const approveCommand = useCallback(async (commandId: string): Promise<boolean> => {
    const command = pendingCommands.find((entry) => entry.commandId === commandId);
    if (!command) return false;
    const block = workBlocks.find((entry) => entry.work_block_id === command.blockId);
    if (!block) return finishCommand(command, "conflict", "The local block no longer exists.");
    const applied = applyApprovedReviewCommand(block, command);
    if (!applied.ok) return finishCommand(command, "conflict", "The local block changed after this request was created.");
    if (applied.block === null) {
      setBlocks((current) => current.filter((entry) => entry.work_block_id !== block.work_block_id));
      addCorrection({
        work_block_id: block.work_block_id,
        field: "exclude",
        old_value: block.project_name,
        new_value: "excluded",
        reason: "User approved a Weekform Web review request on this Mac",
      });
    } else {
      setBlocks((current) => current.map((entry) => entry.work_block_id === block.work_block_id ? applied.block! : entry));
      for (const field of applied.changedFields) {
        if (field === "verification") {
          addCorrection({ work_block_id: block.work_block_id, field: "verification", old_value: "unverified", new_value: "verified", reason: "User approved a Weekform Web review request on this Mac" });
          continue;
        }
        const modelField = field === "planned_status" ? "planned_status" : field as keyof WorkBlock;
        addCorrection({
          work_block_id: block.work_block_id,
          field: field as UserCorrection["field"],
          old_value: String(block[modelField]),
          new_value: String(applied.block[modelField]),
          reason: "User approved a Weekform Web review request on this Mac",
        });
      }
    }
    return finishCommand(command, "applied", "Approved on this Mac.");
  }, [addCorrection, finishCommand, pendingCommands, setBlocks, workBlocks]);

  const rejectCommand = useCallback(async (commandId: string): Promise<boolean> => {
    const command = pendingCommands.find((entry) => entry.commandId === commandId);
    return command ? finishCommand(command, "rejected", "Rejected on this Mac.") : false;
  }, [finishCommand, pendingCommands]);

  // Flush as soon as the durable queue receives a new batch. The in-flight
  // guard prevents this from competing with the polling/reconnect paths.
  useEffect(() => {
    if (!shouldFlushPersonalQueue(enabled, account.personalSyncState.queue.length)) return;
    void syncNow();
  }, [account.personalSyncState.queue.length, enabled, syncNow]);

  // Near-real-time while the app is open; offline batches persist and flush on reconnect.
  useEffect(() => {
    if (!enabled) return;
    void syncNow();
    void refreshCommands();
    const timer = window.setInterval(() => {
      void syncNow();
      void refreshCommands();
    }, 15_000);
    const online = () => { void syncNow(); void refreshCommands(); };
    window.addEventListener("online", online);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", online);
    };
  }, [enabled, refreshCommands, syncNow]);

  return useMemo(() => ({
    enabled,
    syncBusy,
    lastError: account.personalSyncState.lastError,
    queuedBatches: account.personalSyncState.queue.length,
    pendingCommands,
    syncNow,
    refreshCommands,
    approveCommand,
    rejectCommand,
  }), [account.personalSyncState, approveCommand, enabled, pendingCommands, refreshCommands, rejectCommand, syncBusy, syncNow]);
}
