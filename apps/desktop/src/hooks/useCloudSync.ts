// Approval-triggered first sync, explicit retry, and bounded automatic sync for Account & Sharing.
//
// THE TEAM-SHARING RULE (cloud.ts): the only object this team path uploads is
// `SharedWorkloadSnapshotV1`, built by the shared allowlist builder in
// `packages/inference/src/sharedSnapshot.ts` — this hook never assembles a second
// payload, and the JSON preview the user consents to IS the uploaded object.
// User-private Web sync is a distinct positive-allowlist contract owned by
// `usePersonalCloudSync`; neither path can serialize desktop state directly.
// The clientSnapshotId is reserved per content fingerprint in local storage, so a
// retry of the same approved content reuses the same id and the server upserts
// instead of duplicating.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WeeklyCapacitySnapshot, WorkBlock } from "../../../../packages/domain/src/models";
import type { SharedSnapshotBuildResult } from "../../../../packages/inference/src/sharedSnapshot";
import {
  applyTeamSharePolicy,
  sharedSnapshotToRow
} from "../services/cloudPolicy";
import {
  buildReservedSharedSnapshot,
  isSharedSnapshotUploadAuthorized,
  runAfterDurableSharedSnapshotReservation,
} from "../services/sharedSnapshotReservation";
import {
  deleteMySnapshotsForTeam,
  getCloudEnv,
  upsertWorkloadSnapshot,
  workloadSnapshotExists
} from "../services/cloudClient";
import {
  armAutoSyncTimer,
  classifySyncFailure,
  describeRetriesExhausted,
  describeSchedulerFailure,
  nextRetryDelayMs,
  planNextAutoSyncAttempt,
  planToNextScheduledIso,
  shouldPerformSyncAttempt,
  shouldResetRetryLadder,
  type SchedulerEligibility
} from "../services/cloudScheduler";
import { buildConsentReceipt, type ConsentReceiptV1 } from "../services/consentReceipt";
import { runFreshGuardedUpload } from "../services/cloudSyncGuard";
import {
  REMOTE_SNAPSHOT_MISSING_MESSAGE,
  isManualResyncRequired,
  preserveManualResyncRequirement,
  reconcileRemoteSnapshot
} from "../services/cloudReconciliation";
import type { CloudAccountController } from "./useCloudAccount";
import type { PersonalCloudSyncController } from "./usePersonalCloudSync";

export interface CloudSyncOperation {
  isCurrent: () => boolean;
  finish: () => void;
}

export interface CloudSyncOperationBarrier {
  begin: () => CloudSyncOperation | null;
  /** Close synchronously, invalidate active operations, then await their async edges. */
  quiesce: () => Promise<void>;
  reopen: () => void;
}

/**
 * Aggregate sharing has several async boundaries (reservation persistence,
 * session refresh, policy refresh, reconciliation, and upload/delete). Reset
 * closes this lane before its first await, invalidates every captured epoch,
 * and waits until all already-started boundaries have settled.
 */
export function createCloudSyncOperationBarrier(): CloudSyncOperationBarrier {
  let epoch = 0;
  let quiescing = false;
  const activeCompletions = new Set<Promise<void>>();

  return {
    begin: () => {
      if (quiescing) return null;
      const operationEpoch = epoch;
      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
      activeCompletions.add(completion);
      let finished = false;
      return {
        isCurrent: () => !quiescing && epoch === operationEpoch,
        finish: () => {
          if (finished) return;
          finished = true;
          activeCompletions.delete(completion);
          resolveCompletion();
        },
      };
    },
    quiesce: async () => {
      quiescing = true;
      epoch += 1;
      await Promise.allSettled([...activeCompletions]);
    },
    reopen: () => {
      quiescing = false;
    },
  };
}

const RESET_INTERRUPTED_MESSAGE = "Aggregate sharing stopped because Reset Local Data started.";
const RESET_INTERRUPTED_UPLOAD = { ok: false, message: RESET_INTERRUPTED_MESSAGE } as const;
const RESET_INTERRUPTED_BOUNDARY = {
  ok: false,
  reason: "refresh_failed",
  message: RESET_INTERRUPTED_MESSAGE,
} as const;

export interface CloudSyncController {
  /** The exact payload (or typed rejection) for the current policy + reviewed data. */
  buildResult: SharedSnapshotBuildResult;
  /** True when the current content already matches the last successful sync. */
  upToDate: boolean;
  syncBusy: boolean;
  deleteBusy: boolean;
  syncNow: () => Promise<boolean>;
  /** Delete every snapshot THIS user previously synced to the selected team. */
  deleteMySnapshots: () => Promise<boolean>;
  /** Invalidate new work and await every aggregate network/persistence edge before Reset. */
  quiesceForReset: () => Promise<void>;
}

export function useCloudSync({
  account,
  snapshot,
  workBlocks,
  onConsentReceipt
}: {
  account: CloudAccountController;
  snapshot: WeeklyCapacitySnapshot;
  workBlocks: WorkBlock[];
  /**
   * Durable consent receipt written at every approved share (roadmap A3). Built
   * FROM the exact uploaded payload — same reference as the consent preview —
   * immediately after a successful upsert, so a receipt exists iff data left
   * the device.
   */
  onConsentReceipt: (receipt: ConsentReceiptV1) => void;
}): CloudSyncController {
  const { policy, pendingSnapshot, persistPendingSnapshot, setSyncState, emitAudit } = account;
  const [syncBusy, setSyncBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const cloudOperationBarrierRef = useRef<CloudSyncOperationBarrier | null>(null);
  if (cloudOperationBarrierRef.current === null) {
    cloudOperationBarrierRef.current = createCloudSyncOperationBarrier();
  }
  const cloudOperationBarrier = cloudOperationBarrierRef.current;
  const quiesceForReset = useCallback(
    () => cloudOperationBarrier.quiesce(),
    [cloudOperationBarrier],
  );
  const remoteDeleteBlocked = isManualResyncRequired(account.syncState.lastError);

  // A6 clamp, applied BEFORE any payload is built: the effective allowlist is member
  // consent ∩ the selected team's share policy (`applyTeamSharePolicy` can only narrow,
  // never widen — a hostile server policy cannot add a metric, raise the share level, or
  // flip a consent switch). Because the consent preview below is built from this
  // effective policy, the preview and the upload both reflect the clamped payload.
  const effectivePolicy = useMemo(() => {
    const teamPolicy =
      policy.teamId !== null
        ? (account.teams.find((team) => team.teamId === policy.teamId)?.sharePolicy ?? null)
        : null;
    return applyTeamSharePolicy(policy, teamPolicy);
  }, [account.teams, policy]);

  // Build the payload from the shared builder ONLY. The UUID reservation is made
  // synchronously, before the first committed preview can be uploaded; the effect
  // below only makes that already-previewed reservation durable for relaunch/retry.
  const reservedBuild = useMemo(
    () =>
      buildReservedSharedSnapshot({
        snapshot,
        workBlocks,
        policy: effectivePolicy,
        pendingSnapshot,
        now: new Date().toISOString(),
        generateId: () => crypto.randomUUID()
      }),
    [snapshot, workBlocks, effectivePolicy, pendingSnapshot]
  );
  const buildResult: SharedSnapshotBuildResult = reservedBuild.buildResult;

  // Reserve a stable uuid clientSnapshotId for the current content. Persisted, so a
  // failed attempt retried after a relaunch still reuses the same id (idempotent upsert).
  useEffect(() => {
    if (!reservedBuild.reservation || reservedBuild.reservation === pendingSnapshot) return;
    const operation = cloudOperationBarrier.begin();
    if (!operation) return;
    void persistPendingSnapshot(reservedBuild.reservation)
      .catch(() => undefined)
      .finally(() => operation.finish());
  }, [cloudOperationBarrier, pendingSnapshot, persistPendingSnapshot, reservedBuild.reservation]);

  const upToDate =
    buildResult.ok && account.syncState.lastSyncedFingerprint === buildResult.fingerprint;

  const syncNow = useCallback(async (): Promise<boolean> => {
    const env = getCloudEnv();
    if (!env || !isSharedSnapshotUploadAuthorized(policy, buildResult) || syncBusy) return false;
    const operation = cloudOperationBarrier.begin();
    if (!operation) return false;
    const attemptedAt = new Date().toISOString();
    setSyncBusy(true);
    setSyncState((current) => ({ ...current, status: "syncing", lastAttemptAt: attemptedAt }));
    try {
      const session = await account.getFreshSession();
      if (!operation.isCurrent()) return false;
      if (!session) {
        setSyncState((current) => ({
          ...current,
          status: "error",
          lastError: preserveManualResyncRequirement(
            current.lastError,
            "Weekform could not confirm your Weekform Web session. Check your connection and try again, or sign in again."
          )
        }));
        return false;
      }
      const payload = buildResult.snapshot;
      const reservation = reservedBuild.reservation;
      if (!reservation) return false;
      const durableUpload = await runAfterDurableSharedSnapshotReservation({
        reservation,
        persistReservation: account.persistPendingSnapshot,
        operation: () => runFreshGuardedUpload(
          () => operation.isCurrent()
            ? account.checkFreshUpload(session, effectivePolicy)
            : Promise.resolve(RESET_INTERRUPTED_BOUNDARY),
          () => {
            if (!operation.isCurrent()) return Promise.resolve(RESET_INTERRUPTED_UPLOAD);
            const row = sharedSnapshotToRow(payload, buildResult.fingerprint, session.userId);
            return upsertWorkloadSnapshot(env, session, row);
          }
        )
      });
      if (!operation.isCurrent()) return false;
      if (!durableUpload.ok) {
        const message = "Sync stopped because Weekform could not durably reserve its retry-safe snapshot ID. No data was uploaded.";
        setSyncState((current) => ({
          ...current,
          status: "error",
          lastError: preserveManualResyncRequirement(current.lastError, message)
        }));
        emitAudit("sync_failure", message, {
          team_id: policy.teamId,
          failure_kind: "reservation_persistence",
          request_body_sent: false
        });
        return false;
      }
      const guardedUpload = durableUpload.value;
      if (!guardedUpload.ok) {
        const freshBoundary = guardedUpload.boundary;
        setSyncState((current) => ({
          ...current,
          status: "error",
          lastError: preserveManualResyncRequirement(current.lastError, freshBoundary.message)
        }));
        emitAudit("sync_failure", `Sync stopped before upload: ${freshBoundary.message}`, {
          team_id: policy.teamId,
          failure_kind: freshBoundary.reason,
          request_body_sent: false
        });
        return false;
      }
      const result = guardedUpload.value;
      if (!result.ok) {
        setSyncState((current) => ({
          ...current,
          status: "error",
          lastError: preserveManualResyncRequirement(current.lastError, result.message)
        }));
        emitAudit("sync_failure", `Sync to team ${payload.teamId} failed: ${result.message}`, {
          team_id: payload.teamId,
          week_id: payload.weekId,
          client_snapshot_id: payload.clientSnapshotId,
          error: result.message
        });
        return false;
      }
      const succeededAt = new Date().toISOString();
      setSyncState((current) => ({
        ...current,
        status: "success",
        lastSuccessAt: succeededAt,
        lastError: null,
        lastSyncedFingerprint: buildResult.fingerprint,
        lastSyncedClientSnapshotId: payload.clientSnapshotId
      }));
      const sharedMetricCount = Object.keys(payload.metrics).length;
      emitAudit(
        "sync_success",
        `Shared week ${payload.weekId} at the "${payload.shareLevel}" level (${sharedMetricCount} metric${sharedMetricCount === 1 ? "" : "s"}) with team ${payload.teamId}`,
        {
          team_id: payload.teamId,
          week_id: payload.weekId,
          share_level: payload.shareLevel,
          shared_metric_count: sharedMetricCount,
          client_snapshot_id: payload.clientSnapshotId,
          content_fingerprint: buildResult.fingerprint
        }
      );
      onConsentReceipt(
        buildConsentReceipt({
          payload,
          fingerprint: buildResult.fingerprint,
          trigger: "manual",
          receiptId: crypto.randomUUID(),
          recordedAt: succeededAt
        })
      );
      return true;
    } finally {
      if (operation.isCurrent()) setSyncBusy(false);
      operation.finish();
    }
  }, [account, buildResult, cloudOperationBarrier, effectivePolicy, emitAudit, onConsentReceipt, policy.teamId, setSyncState, syncBusy]);

  const deleteMySnapshots = useCallback(async (): Promise<boolean> => {
    const env = getCloudEnv();
    const teamId = policy.teamId;
    if (!env || !teamId || deleteBusy) return false;
    const operation = cloudOperationBarrier.begin();
    if (!operation) return false;
    setDeleteBusy(true);
    try {
      const session = await account.getFreshSession();
      if (!operation.isCurrent()) return false;
      if (!session) {
        setSyncState((current) => ({
          ...current,
          status: "error",
          lastError: "Weekform could not confirm your Weekform Web session. Check your connection and try again, or sign in again."
        }));
        return false;
      }
      const result = await deleteMySnapshotsForTeam(env, session, teamId);
      if (!operation.isCurrent()) return false;
      if (!result.ok) {
        setSyncState((current) => ({ ...current, status: "error", lastError: result.message }));
        return false;
      }
      // The team no longer holds this user's rows; forget the "already synced"
      // fingerprint so an explicit retry re-uploads the current approved content.
      setSyncState((current) => ({
        ...current,
        status: "error",
        lastError: REMOTE_SNAPSHOT_MISSING_MESSAGE,
        lastSyncedFingerprint: null,
        lastSyncedClientSnapshotId: null,
        nextScheduledAt: null
      }));
      emitAudit(
        "delete",
        `Deleted ${result.value} synced snapshot${result.value === 1 ? "" : "s"} from team ${teamId}`,
        { team_id: teamId, deleted_row_count: result.value }
      );
      return true;
    } finally {
      if (operation.isCurrent()) setDeleteBusy(false);
      operation.finish();
    }
  }, [account, cloudOperationBarrier, deleteBusy, emitAudit, policy.teamId, setSyncState]);

  // -------------------------------------------------------------------------
  // Bounded automatic sync (runbook Prompt 7).
  //
  // The decision logic lives entirely in `cloudScheduler.ts` (pure, tested); this
  // effect is the ONLY place a real timer is created. `retryFailureCount` and
  // `authBlocked` are plain component state on purpose — they reset on relaunch
  // (an interrupted retry ladder does not survive a quit, matching `syncState.status`
  // normalizing "syncing" → "idle" on hydration) and reset explicitly whenever
  // auto-sync is re-armed (toggled on, reconnected, or the recipient team changes).
  const [retryFailureCount, setRetryFailureCount] = useState(0);
  const [authBlocked, setAuthBlocked] = useState(false);
  const autoAttemptInFlightRef = useRef(false);
  const resetDisabled =
    account.account === null
    && policy.enabled === false
    && policy.autoSyncEnabled === false
    && policy.teamId === null
    && policy.consentedAt === null
    && pendingSnapshot === null;

  // Reset deliberately keeps this lane closed while old account/policy values
  // are still rendered. A transition into the fully cleared state reopens it.
  // When reset begins from an already-disabled state, the next explicit account
  // transition reopens it instead; the dependency does not rerun mid-reset.
  useEffect(() => {
    cloudOperationBarrier.reopen();
    if (!resetDisabled) return;
    setSyncBusy(false);
    setDeleteBusy(false);
    autoAttemptInFlightRef.current = false;
    setRetryFailureCount(0);
    setAuthBlocked(false);
  }, [cloudOperationBarrier, resetDisabled]);

  const currentFingerprint = buildResult.ok ? buildResult.fingerprint : null;
  const previousFingerprintRef = useRef<string | null>(currentFingerprint);

  useEffect(() => {
    if (currentFingerprint === null) return;
    if (shouldResetRetryLadder(previousFingerprintRef.current, currentFingerprint)) {
      setRetryFailureCount(0);
    }
    previousFingerprintRef.current = currentFingerprint;
  }, [currentFingerprint]);

  const hasTeamMembership = useMemo(
    () => policy.teamId !== null && account.teams.some((team) => team.teamId === policy.teamId),
    [account.teams, policy.teamId]
  );

  // A "fresh trigger" — re-enabling auto-sync, reconnecting as a different user, or
  // switching the recipient team — clears any exhausted/auth-blocked ladder so auto-sync
  // can resume instead of staying silently stopped forever.
  const autoSyncArmKey = `${policy.enabled && policy.autoSyncEnabled}|${account.account?.userId ?? ""}|${policy.teamId ?? ""}`;
  const previousArmKeyRef = useRef(autoSyncArmKey);
  useEffect(() => {
    if (previousArmKeyRef.current === autoSyncArmKey) return;
    previousArmKeyRef.current = autoSyncArmKey;
    setRetryFailureCount(0);
    setAuthBlocked(false);
  }, [autoSyncArmKey]);

  // A deletion guard belongs to its recipient. Switching accounts or teams starts a
  // different remote boundary, but merely toggling auto-sync must never erase the
  // requirement for a successful explicit retry on the same recipient.
  const recipientKey = `${account.account?.userId ?? ""}|${policy.teamId ?? ""}`;
  const previousRecipientKeyRef = useRef(recipientKey);
  useEffect(() => {
    if (previousRecipientKeyRef.current === recipientKey) return;
    previousRecipientKeyRef.current = recipientKey;
    if (remoteDeleteBlocked) {
      setSyncState((current) => ({ ...current, status: "idle", lastError: null }));
    }
  }, [recipientKey, remoteDeleteBlocked, setSyncState]);

  const runAutoAttempt = useCallback(async () => {
    if (autoAttemptInFlightRef.current) return;
    const env = getCloudEnv();
    if (!env || !buildResult.ok || account.isDemoMode) return;
    if (!(policy.enabled && policy.autoSyncEnabled)) return;
    const contentChanged = shouldPerformSyncAttempt(
      buildResult.fingerprint,
      account.syncState.lastSyncedFingerprint
    );
    const operation = cloudOperationBarrier.begin();
    if (!operation) return;
    autoAttemptInFlightRef.current = true;
    const attemptedAt = new Date().toISOString();
    setSyncState((current) => ({ ...current, status: "syncing", lastAttemptAt: attemptedAt }));
    try {
      const session = await account.getFreshSession();
      if (!operation.isCurrent()) return;
      if (!session) {
        setSyncState((current) => ({
          ...current,
          status: "error",
          lastError: "Auto-sync could not confirm your Weekform Web session. It will retry automatically; sign in again if this continues."
        }));
        return;
      }
      if (!contentChanged) {
        const freshBoundary = await account.checkFreshUpload(session, effectivePolicy);
        if (!operation.isCurrent()) return;
        if (!freshBoundary.ok) {
          const attemptNumber = retryFailureCount + 1;
          const retryDelayMs = nextRetryDelayMs(attemptNumber);
          setRetryFailureCount(attemptNumber);
          setSyncState((current) => ({
            ...current,
            status: "error",
            lastError:
              retryDelayMs === null
                ? describeRetriesExhausted(freshBoundary.message)
                : describeSchedulerFailure("transient", freshBoundary.message)
          }));
          return;
        }
        const clientSnapshotId = account.syncState.lastSyncedClientSnapshotId;
        const reconciliation = await reconcileRemoteSnapshot(() =>
          clientSnapshotId
            ? workloadSnapshotExists(env, session, clientSnapshotId)
            : Promise.resolve({ ok: true as const, value: false })
        );
        if (!operation.isCurrent()) return;
        if (!reconciliation.ok) {
          const attemptNumber = retryFailureCount + 1;
          const retryDelayMs = nextRetryDelayMs(attemptNumber);
          setRetryFailureCount(attemptNumber);
          setSyncState((current) => ({
            ...current,
            status: "error",
            lastError:
              retryDelayMs === null
                ? describeRetriesExhausted(reconciliation.message)
                : describeSchedulerFailure("transient", reconciliation.message)
          }));
          return;
        }
        if (!reconciliation.exists) {
          setSyncState((current) => ({
            ...current,
            status: "error",
            lastError: REMOTE_SNAPSHOT_MISSING_MESSAGE,
            lastSyncedFingerprint: null,
            lastSyncedClientSnapshotId: null,
            nextScheduledAt: null
          }));
          emitAudit("sync_failure", "Remote snapshot deletion detected; automatic re-upload stopped", {
            team_id: policy.teamId,
            trigger: "auto",
            failure_kind: "remote_snapshot_missing",
            automatic_reupload: false
          });
          return;
        }
        setRetryFailureCount(0);
        setSyncState((current) => ({ ...current, status: "success", lastError: null }));
        return;
      }
      const payload = buildResult.snapshot;
      const reservation = reservedBuild.reservation;
      if (!reservation) return;
      const durableUpload = await runAfterDurableSharedSnapshotReservation({
        reservation,
        persistReservation: account.persistPendingSnapshot,
        operation: () => runFreshGuardedUpload(
          () => operation.isCurrent()
            ? account.checkFreshUpload(session, effectivePolicy)
            : Promise.resolve(RESET_INTERRUPTED_BOUNDARY),
          () => {
            if (!operation.isCurrent()) return Promise.resolve(RESET_INTERRUPTED_UPLOAD);
            const row = sharedSnapshotToRow(payload, buildResult.fingerprint, session.userId);
            return upsertWorkloadSnapshot(env, session, row);
          }
        )
      });
      if (!operation.isCurrent()) return;
      if (!durableUpload.ok) {
        const attemptNumber = retryFailureCount + 1;
        const message = "Auto-sync stopped because Weekform could not durably reserve its retry-safe snapshot ID. No data was uploaded.";
        setRetryFailureCount(attemptNumber);
        setSyncState((current) => ({
          ...current,
          status: "error",
          lastError: describeSchedulerFailure("transient", message)
        }));
        emitAudit("sync_failure", message, {
          team_id: policy.teamId,
          trigger: "auto",
          failure_kind: "reservation_persistence",
          retry_attempt: attemptNumber,
          request_body_sent: false
        });
        return;
      }
      const guardedUpload = durableUpload.value;
      if (!guardedUpload.ok) {
        const freshBoundary = guardedUpload.boundary;
        const attemptNumber = retryFailureCount + 1;
        setRetryFailureCount(attemptNumber);
        setSyncState((current) => ({
          ...current,
          status: "error",
          lastError: describeSchedulerFailure("transient", freshBoundary.message)
        }));
        emitAudit("sync_failure", `Auto-sync stopped before upload: ${freshBoundary.message}`, {
          team_id: policy.teamId,
          trigger: "auto",
          failure_kind: freshBoundary.reason,
          retry_attempt: attemptNumber,
          request_body_sent: false
        });
        return;
      }
      const result = guardedUpload.value;
      if (!result.ok) {
        const kind = classifySyncFailure(result.status);
        if (kind === "auth") {
          setAuthBlocked(true);
          setSyncState((current) => ({
            ...current,
            status: "error",
            lastError: describeSchedulerFailure("auth", result.message)
          }));
          emitAudit(
            "sync_failure",
            `Auto-sync to team ${payload.teamId} stopped: authorization problem`,
            {
              team_id: payload.teamId,
              week_id: payload.weekId,
              client_snapshot_id: payload.clientSnapshotId,
              error: result.message,
              trigger: "auto",
              failure_kind: "auth"
            }
          );
          return;
        }
        const attemptNumber = retryFailureCount + 1;
        const retryDelayMs = nextRetryDelayMs(attemptNumber);
        setRetryFailureCount(attemptNumber);
        const lastError =
          retryDelayMs === null
            ? describeRetriesExhausted(result.message)
            : describeSchedulerFailure("transient", result.message);
        setSyncState((current) => ({ ...current, status: "error", lastError }));
        emitAudit("sync_failure", `Auto-sync to team ${payload.teamId} failed: ${result.message}`, {
          team_id: payload.teamId,
          week_id: payload.weekId,
          client_snapshot_id: payload.clientSnapshotId,
          error: result.message,
          trigger: "auto",
          failure_kind: "transient",
          retry_attempt: attemptNumber,
          retries_exhausted: retryDelayMs === null
        });
        return;
      }
      const succeededAt = new Date().toISOString();
      setRetryFailureCount(0);
      setAuthBlocked(false);
      setSyncState((current) => ({
        ...current,
        status: "success",
        lastSuccessAt: succeededAt,
        lastError: null,
        lastSyncedFingerprint: buildResult.fingerprint,
        lastSyncedClientSnapshotId: payload.clientSnapshotId
      }));
      const sharedMetricCount = Object.keys(payload.metrics).length;
      emitAudit(
        "sync_success",
        `Auto-synced week ${payload.weekId} at the "${payload.shareLevel}" level (${sharedMetricCount} metric${sharedMetricCount === 1 ? "" : "s"}) with team ${payload.teamId}`,
        {
          team_id: payload.teamId,
          week_id: payload.weekId,
          share_level: payload.shareLevel,
          shared_metric_count: sharedMetricCount,
          client_snapshot_id: payload.clientSnapshotId,
          content_fingerprint: buildResult.fingerprint,
          trigger: "auto"
        }
      );
      onConsentReceipt(
        buildConsentReceipt({
          payload,
          fingerprint: buildResult.fingerprint,
          trigger: "auto",
          receiptId: crypto.randomUUID(),
          recordedAt: succeededAt
        })
      );
    } finally {
      if (operation.isCurrent()) autoAttemptInFlightRef.current = false;
      operation.finish();
    }
  }, [account, buildResult, cloudOperationBarrier, effectivePolicy, emitAudit, onConsentReceipt, policy.autoSyncEnabled, policy.enabled, policy.teamId, retryFailureCount, setSyncState]);

  // Re-plan on every change that could affect eligibility or timing, and own the ONE
  // real timer for the whole controller. Any stop condition (sign-out, membership
  // loss, policy disable, disconnect, demo mode, an unresolved auth failure, or an
  // exhausted retry ladder) collapses to `NOT_SCHEDULED` in the pure planner, so this
  // effect only ever needs to clear its timer, never branch on the reason.
  useEffect(() => {
    if (!account.configured) return;
    const eligibility: SchedulerEligibility = {
      autoSyncEnabled: policy.enabled && policy.autoSyncEnabled,
      isDemoMode: account.isDemoMode,
      configured: account.configured,
      hasSession: account.account !== null,
      hasTeamMembership,
      hasBuildablePayload: buildResult.ok,
      hasConsent: policy.consentedAt !== null,
      hasEverSyncedSuccessfully: account.syncState.lastSuccessAt !== null
    };
    const plan = planNextAutoSyncAttempt({
      eligibility,
      now: Date.now(),
      lastSuccessAt: account.syncState.lastSuccessAt,
      lastSyncedFingerprint: account.syncState.lastSyncedFingerprint,
      currentFingerprint: buildResult.ok ? buildResult.fingerprint : null,
      transientFailureCount: retryFailureCount,
      authBlocked: authBlocked || remoteDeleteBlocked
    });

    const nextScheduledAt = planToNextScheduledIso(plan);
    if (account.syncState.nextScheduledAt !== nextScheduledAt) {
      setSyncState((current) => ({ ...current, nextScheduledAt }));
    }

    return armAutoSyncTimer(plan, () => void runAutoAttempt(), {
      setTimeout: (handler, delayMs) => window.setTimeout(handler, delayMs),
      clearTimeout: (id) => window.clearTimeout(id)
    });
  }, [
    account.configured,
    account.isDemoMode,
    account.account,
    account.syncState.lastSuccessAt,
    account.syncState.lastSyncedFingerprint,
    account.syncState.nextScheduledAt,
    hasTeamMembership,
    buildResult,
    policy.enabled,
    policy.autoSyncEnabled,
    policy.consentedAt,
    retryFailureCount,
    authBlocked,
    remoteDeleteBlocked,
    runAutoAttempt,
    setSyncState
  ]);

  // Stable controller reference so App's `cloud` memo (and anything memoized
  // on it downstream) only invalidates when a constituent changes.
  return useMemo(
    () => ({
      buildResult,
      upToDate,
      syncBusy,
      deleteBusy,
      syncNow,
      deleteMySnapshots,
      quiesceForReset,
    }),
    [buildResult, upToDate, syncBusy, deleteBusy, syncNow, deleteMySnapshots, quiesceForReset]
  );
}

/** The single prop threaded App → ScreenRouter → SetupScreen → CloudAccountPanel. */
export interface CloudController {
  account: CloudAccountController;
  sync: CloudSyncController;
  personal: PersonalCloudSyncController;
}
