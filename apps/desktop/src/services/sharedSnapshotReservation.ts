import type { CloudSharePolicyV1 } from "../../../../packages/domain/src/cloud";
import type { WeeklyCapacitySnapshot, WorkBlock } from "../../../../packages/domain/src/models";
import {
  buildSharedWorkloadSnapshot,
  type SharedSnapshotBuildSuccess,
  type SharedSnapshotBuildResult
} from "../../../../packages/inference/src/sharedSnapshot";
import {
  resolveClientSnapshotId,
  type CloudPendingSnapshot
} from "./cloudPolicy";

export interface ReservedSharedSnapshotResult {
  buildResult: SharedSnapshotBuildResult;
  reservation: CloudPendingSnapshot | null;
}

/**
 * Preview construction and upload authorization are deliberately separate. A
 * person can inspect the exact candidate payload while sharing is off, but no
 * manual upload may cross this boundary without the current individual approval.
 */
export function isSharedSnapshotUploadAuthorized(
  policy: CloudSharePolicyV1,
  buildResult: SharedSnapshotBuildResult
): buildResult is SharedSnapshotBuildSuccess {
  return (
    policy.enabled === true
    && typeof policy.consentedAt === "string"
    && policy.consentedAt.trim().length > 0
    && typeof policy.teamId === "string"
    && policy.teamId.trim().length > 0
    && buildResult.ok
    && buildResult.snapshot.teamId === policy.teamId.trim()
  );
}

/**
 * Consequential uploads may start only after the exact retry/idempotency
 * reservation in their payload has reached durable cloud-state storage. The
 * operation remains inside this helper so a rejected write cannot accidentally
 * fall through to a request-body send at a call site.
 */
export async function runAfterDurableSharedSnapshotReservation<T>({
  reservation,
  persistReservation,
  operation,
}: {
  reservation: CloudPendingSnapshot;
  persistReservation: (reservation: CloudPendingSnapshot) => Promise<void>;
  operation: () => Promise<T>;
}): Promise<
  | { ok: true; value: T }
  | { ok: false; persistenceError: unknown }
> {
  try {
    await persistReservation(reservation);
  } catch (persistenceError) {
    return { ok: false, persistenceError };
  }
  return { ok: true, value: await operation() };
}

/**
 * Build the exact consent-preview/upload object with a valid, retry-stable UUID
 * already embedded. This is intentionally synchronous: a user can trigger a
 * manual sync immediately after the first committed render, before React runs
 * the effect that durably stores the reservation.
 */
export function buildReservedSharedSnapshot({
  snapshot,
  workBlocks,
  policy,
  pendingSnapshot,
  now,
  generateId
}: {
  snapshot: WeeklyCapacitySnapshot;
  workBlocks: WorkBlock[];
  policy: CloudSharePolicyV1;
  pendingSnapshot: CloudPendingSnapshot | null;
  now: string;
  generateId: () => string;
}): ReservedSharedSnapshotResult {
  const base = buildSharedWorkloadSnapshot({ snapshot, workBlocks, policy, now });
  if (!base.ok) return { buildResult: base, reservation: null };

  const reservation = resolveClientSnapshotId(pendingSnapshot, base.fingerprint, generateId);
  return {
    buildResult: buildSharedWorkloadSnapshot({
      snapshot,
      workBlocks,
      policy,
      now,
      clientSnapshotId: reservation.clientSnapshotId
    }),
    reservation
  };
}
