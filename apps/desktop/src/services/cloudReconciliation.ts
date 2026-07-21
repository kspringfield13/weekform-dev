import type { CloudResult } from "./cloudClient";

export type RemoteSnapshotReconciliation =
  | { ok: true; exists: boolean }
  | { ok: false; message: string };

export const REMOTE_SNAPSHOT_MISSING_MESSAGE =
  "The synced snapshot was deleted from the cloud. Review the current rules and use Retry sync to share it again.";

export function isManualResyncRequired(lastError: string | null): boolean {
  return lastError?.startsWith(REMOTE_SNAPSHOT_MISSING_MESSAGE) === true;
}

/** A failed explicit retry must not silently re-authorize automatic upload. */
export function preserveManualResyncRequirement(
  currentLastError: string | null,
  nextError: string
): string {
  return isManualResyncRequired(currentLastError)
    ? `${REMOTE_SNAPSHOT_MISSING_MESSAGE} Latest retry attempt failed: ${nextError}`
    : nextError;
}

/** Preserve the important distinction between an authoritative absence and an unavailable read. */
export async function reconcileRemoteSnapshot(
  readPresence: () => Promise<CloudResult<boolean>>
): Promise<RemoteSnapshotReconciliation> {
  const result = await readPresence();
  return result.ok
    ? { ok: true, exists: result.value }
    : { ok: false, message: result.message };
}
