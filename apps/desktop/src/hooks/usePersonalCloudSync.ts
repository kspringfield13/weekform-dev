import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  UserCorrection,
  WeeklyCapacitySnapshot,
  WorkBlock,
} from "../../../../packages/domain/src/models";
import type { ReviewCommandV1 } from "../../../../packages/domain/src/personalCloud";
import {
  buildPersonalWorkloadReplicas,
  replicaContentFingerprint,
} from "../../../../packages/inference/src/personalReplica";
import {
  claimReviewCommandV2,
  completeReviewCommandV1,
  completeReviewCommandV2,
  fetchPendingReviewCommandsV1,
  fetchPendingReviewCommandsV2,
  getCloudEnv,
  markReviewCommandAppliedLocallyV2,
  registerWeekformDeviceV2,
  reviewCommandExistsV2,
  syncPersonalReplicaBatch,
} from "../services/cloudClient";
import {
  applyReviewCommandToCurrentBlocks,
  enqueueReviewCommandApplication,
  enqueueReplicaBatchWithClock,
  markReviewCommandApplicationAttempt,
  markReviewCommandApplicationPhase,
  markReplicaBatchAttempt,
  nextReviewCommandApplication,
  removeReviewCommandApplication,
  reviewCommandClaimIsRecoverable,
  shouldFlushPersonalQueue,
} from "../services/personalSync";
import type { CloudAccountController } from "./useCloudAccount";

export interface PersonalCloudSyncController {
  enabled: boolean;
  syncBusy: boolean;
  lastError: string | null;
  lastNotice: string | null;
  queuedBatches: number;
  pendingCommands: ReviewCommandV1[];
  syncNow: () => Promise<boolean>;
  refreshCommands: () => Promise<void>;
  approveCommand: (commandId: string) => Promise<boolean>;
  rejectCommand: (commandId: string) => Promise<boolean>;
  /** Invalidate new work and await every active network/persistence edge before Reset. */
  quiesceForReset: () => Promise<void>;
}

export function usePersonalCloudSync(input: {
  account: CloudAccountController;
  snapshot: WeeklyCapacitySnapshot;
  workBlocks: WorkBlock[];
  mutateBlocksAtomically: <Result>(
    mutation: (current: WorkBlock[]) => { blocks: WorkBlock[]; result: Result },
  ) => Result;
  addCorrection: (correction: Omit<UserCorrection, "correction_id" | "timestamp">) => void;
  persistLatestLocalState: () => Promise<void>;
}): PersonalCloudSyncController {
  const {
    account,
    snapshot,
    workBlocks,
    mutateBlocksAtomically,
    addCorrection,
    persistLatestLocalState,
  } = input;
  const [syncBusy, setSyncBusy] = useState(false);
  const [lastNotice, setLastNotice] = useState<string | null>(null);
  const [pendingCommands, setPendingCommands] = useState<ReviewCommandV1[]>([]);
  const inFlight = useRef(false);
  const commandInFlight = useRef(false);
  const operationEpochRef = useRef(0);
  const quiescingRef = useRef(false);
  const activeOperationCompletionsRef = useRef(new Set<Promise<void>>());
  const accountRef = useRef(account);
  accountRef.current = account;
  const enabled = account.personalReplicaPolicy.enabled
    && account.personalReplicaPolicy.consentedAt !== null
    && account.account !== null
    && !account.isDemoMode;

  const beginOperation = useCallback(() => {
    if (quiescingRef.current) return null;
    const epoch = operationEpochRef.current;
    let resolve!: () => void;
    const completion = new Promise<void>((next) => { resolve = next; });
    activeOperationCompletionsRef.current.add(completion);
    let finished = false;
    return {
      epoch,
      isCurrent: () => !quiescingRef.current && operationEpochRef.current === epoch,
      finish: () => {
        if (finished) return;
        finished = true;
        activeOperationCompletionsRef.current.delete(completion);
        resolve();
      },
    };
  }, []);

  const quiesceForReset = useCallback(async (): Promise<void> => {
    quiescingRef.current = true;
    operationEpochRef.current += 1;
    await Promise.allSettled([...activeOperationCompletionsRef.current]);
  }, []);

  // Reset leaves the account disabled. Reopen the operation lane only after
  // that disabled state has rendered, so a later explicit reconnect can work.
  useEffect(() => {
    if (!enabled) quiescingRef.current = false;
  }, [enabled]);

  const replicas = useMemo(() => buildPersonalWorkloadReplicas({
    currentSnapshot: snapshot,
    blocks: workBlocks,
    now: new Date().toISOString(),
  }), [snapshot, workBlocks]);
  const fingerprintedReplicas = useMemo(() => replicas.map((payload) => ({
    fingerprint: replicaContentFingerprint(payload),
    payload,
  })), [replicas]);

  // Durable offline queue: a newer version supersedes an unsent version of the
  // same week, while other weeks remain queued. Nothing queues before explicit consent.
  useEffect(() => {
    if (!enabled) return;
    setLastNotice(null);
    const now = new Date().toISOString();
    account.setPersonalSyncState((current) => fingerprintedReplicas.reduce(
      (state, replica) => enqueueReplicaBatchWithClock(state, { ...replica, now }),
      current,
    ));
  }, [enabled, fingerprintedReplicas, account.setPersonalSyncState]);

  const ensureDevice = useCallback(async () => {
    const current = accountRef.current;
    const env = getCloudEnv();
    const session = await current.getFreshSession();
    if (!env || !session) return { ok: false as const, message: "Sign in to sync your Web workspace." };
    const result = await registerWeekformDeviceV2(
      env,
      session,
      current.personalSyncState.deviceId,
      current.personalSyncState.deviceName,
    );
    if (!result.ok) return result;
    return { ok: true as const, env, session };
  }, []);

  const syncNow = useCallback(async (materializeCurrentReplica = true): Promise<boolean> => {
    const operation = beginOperation();
    if (!operation) return false;
    if (!enabled || inFlight.current) {
      operation.finish();
      return false;
    }
    const currentAccount = accountRef.current;
    inFlight.current = true;
    setSyncBusy(true);
    if (materializeCurrentReplica) setLastNotice(null);
    const attemptedAt = new Date().toISOString();
    try {
      // Queue payload + hybrid logical clock must be durable before the server
      // can accept the batch. A crash after acceptance therefore cannot restart
      // from an older clock or forget the accepted batch identity.
      let durableState;
      try {
        durableState = await currentAccount.setPersonalSyncStateDurably((current) => {
          const materialized = materializeCurrentReplica
            ? fingerprintedReplicas.reduce(
                (state, replica) => enqueueReplicaBatchWithClock(
                  state,
                  { ...replica, now: attemptedAt },
                ),
                current,
              )
            : current;
          return { ...materialized, lastAttemptAt: attemptedAt, lastError: null };
        });
        await currentAccount.flushPersonalSyncState();
      } catch {
        currentAccount.setPersonalSyncState((current) => ({
          ...current,
          lastError: "Weekform could not save the Web sync queue. Keep Weekform open and try again.",
        }));
        return false;
      }
      if (!operation.isCurrent()) return false;
      const ready = await ensureDevice();
      if (!operation.isCurrent()) return false;
      if (!ready.ok) {
        setLastNotice(null);
        currentAccount.setPersonalSyncState((current) => ({ ...current, lastError: ready.message }));
        return false;
      }
      let queue = durableState.queue;
      let cursor = durableState.cursor;
      let lastSuccessAt = durableState.lastSuccessAt;
      const syncedWeekIds: string[] = [];
      let syncedBlockCount = 0;
      for (const item of queue) {
        const result = await syncPersonalReplicaBatch(
          ready.env,
          ready.session,
          durableState.deviceId,
          item,
        );
        if (!operation.isCurrent()) return false;
        if (!result.ok) {
          setLastNotice(null);
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
        syncedWeekIds.push(item.payload.weekId);
        syncedBlockCount += item.payload.blocks.length;
        queue = queue.filter((queued) => queued.batchId !== item.batchId);
        try {
          await currentAccount.setPersonalSyncStateDurably((current) => ({
            ...current,
            cursor: Math.max(current.cursor, cursor),
            queue: current.queue.filter((queued) => queued.batchId !== item.batchId),
            lastSuccessAt,
            lastAttemptAt: attemptedAt,
            lastError: null,
          }));
        } catch {
          setLastNotice(null);
          currentAccount.setPersonalSyncState((current) => ({
            ...current,
            lastError: "Web accepted the update, but Weekform could not save its receipt. Keep Weekform open and retry Sync Web.",
          }));
          return false;
        }
      }
      if (lastSuccessAt && syncedWeekIds.length > 0) {
        currentAccount.emitAudit("personal_sync_success", "Updated the private Weekform Web workspace with reviewed, derived fields", {
          week_ids: syncedWeekIds,
          block_count: syncedBlockCount,
          cursor,
        });
        setLastNotice(
          `Web updated successfully for ${syncedWeekIds.length} week${syncedWeekIds.length === 1 ? "" : "s"}.`,
        );
        return true;
      }
      return !materializeCurrentReplica;
    } finally {
      inFlight.current = false;
      setSyncBusy(false);
      operation.finish();
    }
  }, [beginOperation, enabled, ensureDevice, fingerprintedReplicas]);

  const refreshCommands = useCallback(async () => {
    const operation = beginOperation();
    if (!operation) return;
    try {
      if (!enabled) {
        setPendingCommands([]);
        return;
      }
      const ready = await ensureDevice();
      if (!operation.isCurrent() || !ready.ok) return;
      // Legacy rows are immutable and must be drained through v1. Poll both
      // isolated queues until the server's compatibility gate naturally stops
      // producing v1 work.
      const legacyResult = await fetchPendingReviewCommandsV1(ready.env, ready.session);
      if (!operation.isCurrent() || !legacyResult.ok) return;
      const v2Result = await fetchPendingReviewCommandsV2(ready.env, ready.session);
      if (!operation.isCurrent() || !v2Result.ok) return;
      const current = accountRef.current;
      const foreignAckReceipts = v2Result.value.filter((command) => (
        command.applicationPhase === "ack_pending"
        && command.claimedByDevice !== null
        && command.claimedByDevice !== current.personalSyncState.deviceId
      ));
      const recoveredIds = new Set<string>();
      for (const command of foreignAckReceipts) {
        const recovered = await claimReviewCommandV2(
          ready.env,
          ready.session,
          current.personalSyncState.deviceId,
          command.commandId,
        );
        if (!operation.isCurrent()) return;
        if (recovered.ok && recovered.value === "applied") {
          recoveredIds.add(command.commandId);
          current.emitAudit(
            "personal_sync_success",
            "Recovered a durable review receipt from another Mac without reapplying its local change",
            { command_id: command.commandId, recovered_receipt: true },
          );
        }
      }
      const ownedClaims = v2Result.value.filter((command) => command.applicationPhase
        && command.claimedByDevice === current.personalSyncState.deviceId);
      if (ownedClaims.length > 0) {
        const now = new Date().toISOString();
        await current.setPersonalSyncStateDurably((state) => ({
          ...state,
          reviewOutbox: ownedClaims.reduce(
            (outbox, command) => enqueueReviewCommandApplication(outbox, {
              command,
              phase: command.applicationPhase!,
              now,
            }),
            state.reviewOutbox ?? [],
          ),
        }));
        if (!operation.isCurrent()) return;
      }
      const nowMs = Date.now();
      setPendingCommands([
        ...legacyResult.value,
        ...v2Result.value.filter((command) => !recoveredIds.has(command.commandId) && ((
          command.applicationPhase === null && command.claimedByDevice === null
        ) || reviewCommandClaimIsRecoverable(command, nowMs))),
      ]);
    } catch {
      // Strict cloud persistence exposes its actionable error on the account.
    } finally {
      operation.finish();
    }
  }, [beginOperation, enabled, ensureDevice]);

  const finishCommand = useCallback(async (
    command: ReviewCommandV1,
    status: "applied" | "rejected" | "conflict",
    reason: string | null,
  ) => {
    const operation = beginOperation();
    if (!operation) return false;
    try {
      const ready = await ensureDevice();
      if (!operation.isCurrent() || !ready.ok) return false;
      const result = command.protocolVersion === 1
        ? await completeReviewCommandV1(
            ready.env,
            ready.session,
            accountRef.current.personalSyncState.deviceId,
            command.commandId,
            status,
            reason,
          )
        : await completeReviewCommandV2(
            ready.env,
            ready.session,
            accountRef.current.personalSyncState.deviceId,
            command.commandId,
            status,
            reason,
          );
      if (!operation.isCurrent() || !result.ok || !result.value) return false;
      setPendingCommands((current) => current.filter((entry) => entry.commandId !== command.commandId));
      return true;
    } finally {
      operation.finish();
    }
  }, [beginOperation, ensureDevice]);

  const approveCommand = useCallback(async (commandId: string): Promise<boolean> => {
    const operation = beginOperation();
    if (!operation) return false;
    try {
      const command = pendingCommands.find((entry) => entry.commandId === commandId);
      if (!command) return false;
      const ready = await ensureDevice();
      if (!operation.isCurrent() || !ready.ok) return false;
      if (command.protocolVersion === 1) {
        // v1 has no claim RPC. Persist protocol-owned work before the local CAS;
        // resumeReviewApplications will use only the released completion RPC.
        const now = new Date().toISOString();
        await accountRef.current.setPersonalSyncStateDurably((state) => ({
          ...state,
          reviewOutbox: enqueueReviewCommandApplication(state.reviewOutbox ?? [], {
            command,
            phase: "apply_pending",
            now,
          }),
        }));
        if (!operation.isCurrent()) return false;
        setPendingCommands((current) => current.filter((entry) => entry.commandId !== command.commandId));
        return true;
      }
      // This durable server claim is the acknowledgement boundary. Local reviewed
      // truth is not touched in this callback; the persisted outbox resumes it.
      const claimed = await claimReviewCommandV2(
        ready.env,
        ready.session,
        accountRef.current.personalSyncState.deviceId,
        command.commandId,
      );
      if (!operation.isCurrent() || !claimed.ok) return false;
      if (claimed.value === "applied" || claimed.value === "rejected" || claimed.value === "conflict") {
        setPendingCommands((current) => current.filter((entry) => entry.commandId !== command.commandId));
        return true;
      }
      const claimedPhase = claimed.value;
      const now = new Date().toISOString();
      await accountRef.current.setPersonalSyncStateDurably((state) => ({
        ...state,
        reviewOutbox: enqueueReviewCommandApplication(state.reviewOutbox ?? [], {
          command,
          phase: claimedPhase,
          now,
        }),
      }));
      if (!operation.isCurrent()) return false;
      setPendingCommands((current) => current.filter((entry) => entry.commandId !== command.commandId));
      return true;
    } catch {
      return false;
    } finally {
      operation.finish();
    }
  }, [beginOperation, ensureDevice, pendingCommands]);

  const rejectCommand = useCallback(async (commandId: string): Promise<boolean> => {
    const command = pendingCommands.find((entry) => entry.commandId === commandId);
    return command ? finishCommand(command, "rejected", "Rejected on this Mac.") : false;
  }, [finishCommand, pendingCommands]);

  const resumeReviewApplications = useCallback(async (): Promise<void> => {
    const operation = beginOperation();
    if (!operation) return;
    const currentAccount = accountRef.current;
    const item = nextReviewCommandApplication(
      currentAccount.personalSyncState.reviewOutbox ?? [],
      Date.now(),
    )?.item;
    if (!enabled || !item || commandInFlight.current) {
      operation.finish();
      return;
    }
    commandInFlight.current = true;
    try {
      const ready = await ensureDevice();
      if (!operation.isCurrent()) return;
      if (!ready.ok) {
        await currentAccount.setPersonalSyncStateDurably((state) => ({
          ...state,
          reviewOutbox: markReviewCommandApplicationAttempt(
            state.reviewOutbox ?? [], item.command.commandId, ready.message, new Date().toISOString(),
          ),
        }));
        return;
      }

      if (item.command.protocolVersion === 2) {
        // Reconfirm/renew apply_pending ownership before every v2 retry. Legacy
        // rows have no claim protocol and never enter this branch.
        const confirmedClaim = await claimReviewCommandV2(
          ready.env,
          ready.session,
          currentAccount.personalSyncState.deviceId,
          item.command.commandId,
        );
        if (!operation.isCurrent()) return;
        if (!confirmedClaim.ok) {
          const exists = await reviewCommandExistsV2(
            ready.env,
            ready.session,
            item.command.commandId,
          );
          if (!operation.isCurrent()) return;
          if (exists.ok && !exists.value) {
            await currentAccount.setPersonalSyncStateDurably((state) => ({
              ...state,
              reviewOutbox: removeReviewCommandApplication(
                state.reviewOutbox ?? [], item.command.commandId,
              ),
              lastError: "A pending Web review request was deleted before this Mac could finish it.",
            }));
            currentAccount.emitAudit(
              "personal_sync_failure",
              "A deleted Web review request was removed from the Mac retry outbox",
              { command_id: item.command.commandId, terminally_deleted: true },
            );
            return;
          }
          await currentAccount.setPersonalSyncStateDurably((state) => ({
            ...state,
            reviewOutbox: markReviewCommandApplicationAttempt(
              state.reviewOutbox ?? [], item.command.commandId,
              confirmedClaim.message, new Date().toISOString(),
            ),
          }));
          return;
        }
        if (confirmedClaim.value === "applied"
          || confirmedClaim.value === "rejected"
          || confirmedClaim.value === "conflict") {
          await currentAccount.setPersonalSyncStateDurably((state) => ({
            ...state,
            reviewOutbox: removeReviewCommandApplication(
              state.reviewOutbox ?? [], item.command.commandId,
            ),
          }));
          return;
        }
        if (confirmedClaim.value === "ack_pending" && item.phase === "apply_pending") {
          await currentAccount.setPersonalSyncStateDurably((state) => ({
            ...state,
            reviewOutbox: markReviewCommandApplicationPhase(
              state.reviewOutbox ?? [], item.command.commandId, "ack_pending", new Date().toISOString(),
            ),
          }));
          return;
        }
      }

      // The network wait above may span a local edit. Re-read and compare the
      // expected revision inside the ledger's synchronous CAS edge; only that
      // edge may produce a local mutation result and subsequent corrections.
      const application = mutateBlocksAtomically((currentBlocks) =>
        applyReviewCommandToCurrentBlocks(currentBlocks, item.command));
      if (application.kind === "conflict") {
        const completed = item.command.protocolVersion === 1
          ? await completeReviewCommandV1(
              ready.env,
              ready.session,
              currentAccount.personalSyncState.deviceId,
              item.command.commandId,
              "conflict",
              "The local block changed before the legacy review request could be applied.",
            )
          : await completeReviewCommandV2(
              ready.env,
              ready.session,
              currentAccount.personalSyncState.deviceId,
              item.command.commandId,
              "conflict",
              "The local block changed before the claimed review request could be applied.",
            );
        if (!operation.isCurrent()) return;
        await currentAccount.setPersonalSyncStateDurably((state) => ({
          ...state,
          reviewOutbox: completed.ok && (completed.value || item.command.protocolVersion === 1)
            ? removeReviewCommandApplication(state.reviewOutbox ?? [], item.command.commandId)
            : markReviewCommandApplicationAttempt(
                state.reviewOutbox ?? [], item.command.commandId,
                completed.ok ? "The review conflict acknowledgement was not accepted." : completed.message,
                new Date().toISOString(),
              ),
        }));
        return;
      }

      if (application.kind === "applied") {
        const block = application.before;
        const correctionReason = item.command.protocolVersion === 1
          ? "User approved an immutable legacy Weekform Web review request on this Mac"
          : "User approved a server-claimed Weekform Web review request on this Mac";
        if (application.block === null) {
          addCorrection({
            work_block_id: block.work_block_id,
            field: "exclude",
            old_value: block.project_name,
            new_value: "excluded",
            reason: correctionReason,
          });
        } else {
          for (const field of application.changedFields) {
            if (field === "verification") {
              addCorrection({
                work_block_id: block.work_block_id,
                field: "verification",
                old_value: "unverified",
                new_value: "verified",
                reason: correctionReason,
              });
              continue;
            }
            const modelField = field === "planned_status" ? "planned_status" : field as keyof WorkBlock;
            addCorrection({
              work_block_id: block.work_block_id,
              field: field as UserCorrection["field"],
              old_value: String(block[modelField]),
              new_value: String(application.block[modelField]),
              reason: correctionReason,
            });
          }
        }
        // A separate render/effect performs the network acknowledgements. This
        // makes retries observe the applied local outcome instead of applying twice.
        await currentAccount.setPersonalSyncStateDurably((state) => ({
          ...state,
          reviewOutbox: markReviewCommandApplicationPhase(
            state.reviewOutbox ?? [], item.command.commandId, "ack_pending", new Date().toISOString(),
          ),
        }));
        return;
      }

      if (item.phase === "apply_pending") {
        await currentAccount.setPersonalSyncStateDurably((state) => ({
          ...state,
          reviewOutbox: markReviewCommandApplicationPhase(
            state.reviewOutbox ?? [], item.command.commandId, "ack_pending", new Date().toISOString(),
          ),
        }));
        return;
      }

      try {
        await persistLatestLocalState();
        if (!operation.isCurrent()) return;
        await currentAccount.flushPersonalSyncState();
        if (!operation.isCurrent()) return;
      } catch {
        if (!operation.isCurrent()) return;
        await currentAccount.setPersonalSyncStateDurably((state) => ({
          ...state,
          reviewOutbox: markReviewCommandApplicationAttempt(
            state.reviewOutbox ?? [], item.command.commandId,
            "The local review result could not be confirmed on disk.", new Date().toISOString(),
          ),
        })).catch(() => undefined);
        return;
      }

      if (item.command.protocolVersion === 2) {
        const marked = await markReviewCommandAppliedLocallyV2(
          ready.env,
          ready.session,
          currentAccount.personalSyncState.deviceId,
          item.command.commandId,
        );
        if (!operation.isCurrent()) return;
        if (!marked.ok || !marked.value) {
          if (marked.ok) {
            const exists = await reviewCommandExistsV2(
              ready.env,
              ready.session,
              item.command.commandId,
            );
            if (!operation.isCurrent()) return;
            if (exists.ok && !exists.value) {
              await currentAccount.setPersonalSyncStateDurably((state) => ({
                ...state,
                reviewOutbox: removeReviewCommandApplication(
                  state.reviewOutbox ?? [], item.command.commandId,
                ),
                lastError: "A Web review request was deleted after local approval; the local reviewed change was retained.",
              }));
              currentAccount.emitAudit(
                "personal_sync_failure",
                "A deleted Web review request could not receive its local application receipt; the reviewed Mac change was retained",
                { command_id: item.command.commandId, terminally_deleted: true },
              );
              return;
            }
          }
          const message = marked.ok ? "The review application receipt was not accepted." : marked.message;
          await currentAccount.setPersonalSyncStateDurably((state) => ({
            ...state,
            reviewOutbox: markReviewCommandApplicationAttempt(
              state.reviewOutbox ?? [], item.command.commandId, message, new Date().toISOString(),
            ),
          }));
          return;
        }
      }
      const completed = item.command.protocolVersion === 1
        ? await completeReviewCommandV1(
            ready.env,
            ready.session,
            currentAccount.personalSyncState.deviceId,
            item.command.commandId,
            "applied",
            "Approved on this Mac through the legacy review protocol.",
          )
        : await completeReviewCommandV2(
            ready.env,
            ready.session,
            currentAccount.personalSyncState.deviceId,
            item.command.commandId,
            "applied",
            "Approved on this Mac.",
          );
      if (!operation.isCurrent()) return;
      if (completed.ok && !completed.value && item.command.protocolVersion === 1) {
        await currentAccount.setPersonalSyncStateDurably((state) => ({
          ...state,
          reviewOutbox: removeReviewCommandApplication(
            state.reviewOutbox ?? [], item.command.commandId,
          ),
          lastError: "A legacy Web review request was already terminal or deleted; the local reviewed change was retained.",
        }));
        currentAccount.emitAudit(
          "personal_sync_failure",
          "A legacy review completion lost its server race; the idempotent local result was retained",
          { command_id: item.command.commandId, protocol_version: 1 },
        );
        return;
      }
      if (completed.ok && !completed.value && item.command.protocolVersion === 2) {
        const exists = await reviewCommandExistsV2(
          ready.env,
          ready.session,
          item.command.commandId,
        );
        if (!operation.isCurrent()) return;
        if (exists.ok && !exists.value) {
          await currentAccount.setPersonalSyncStateDurably((state) => ({
            ...state,
            reviewOutbox: removeReviewCommandApplication(
              state.reviewOutbox ?? [], item.command.commandId,
            ),
            lastError: "A Web review request was deleted after local approval; the local reviewed change was retained.",
          }));
          currentAccount.emitAudit(
            "personal_sync_failure",
            "A deleted Web review request could not receive its terminal acknowledgement; the reviewed Mac change was retained",
            { command_id: item.command.commandId, terminally_deleted: true },
          );
          return;
        }
      }
      await currentAccount.setPersonalSyncStateDurably((state) => ({
        ...state,
        reviewOutbox: completed.ok && completed.value
          ? removeReviewCommandApplication(state.reviewOutbox ?? [], item.command.commandId)
          : markReviewCommandApplicationAttempt(
              state.reviewOutbox ?? [], item.command.commandId,
              completed.ok ? "The review completion acknowledgement was not accepted." : completed.message,
              new Date().toISOString(),
            ),
      }));
    } catch {
      // Strict persistence helpers retain the outbox in memory and expose the
      // storage failure through Account & Sharing. No server edge runs afterward.
    } finally {
      commandInFlight.current = false;
      operation.finish();
    }
  }, [addCorrection, beginOperation, enabled, ensureDevice, mutateBlocksAtomically, persistLatestLocalState]);

  useEffect(() => {
    const scheduled = nextReviewCommandApplication(
      account.personalSyncState.reviewOutbox ?? [],
      Date.now(),
    );
    if (!enabled || !scheduled) return;
    const timer = window.setTimeout(() => { void resumeReviewApplications(); }, scheduled.delayMs);
    return () => window.clearTimeout(timer);
  }, [account.personalSyncState.reviewOutbox, enabled, resumeReviewApplications]);

  // Flush as soon as the durable queue receives a new batch. The in-flight
  // guard prevents this from competing with the polling/reconnect paths.
  useEffect(() => {
    if (!shouldFlushPersonalQueue(enabled, account.personalSyncState.queue.length)) return;
    void syncNow(false);
  }, [account.personalSyncState.queue.length, enabled, syncNow]);

  // Near-real-time while the app is open; offline batches persist and flush on reconnect.
  useEffect(() => {
    if (!enabled) return;
    void syncNow(false);
    void refreshCommands();
    const timer = window.setInterval(() => {
      void syncNow(false);
      void refreshCommands();
    }, 15_000);
    const online = () => { void syncNow(false); void refreshCommands(); };
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
    lastNotice,
    queuedBatches: account.personalSyncState.queue.length,
    pendingCommands,
    syncNow,
    refreshCommands,
    approveCommand,
    rejectCommand,
    quiesceForReset,
  }), [account.personalSyncState, approveCommand, enabled, lastNotice, pendingCommands, quiesceForReset, refreshCommands, rejectCommand, syncBusy, syncNow]);
}
