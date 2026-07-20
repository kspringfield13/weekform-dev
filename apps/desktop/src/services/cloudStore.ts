// Local prototype persistence for the Account & Sharing state (session, share policy,
// sync bookkeeping, reserved clientSnapshotId). A sibling of `localStore.ts` with the
// same conventions: Tauri Store in the desktop app, localStorage fallback in web/demo
// builds, defensive parsing on every read, and best-effort clears.
//
// The session (auth tokens) lives ONLY here. It is excluded from `PersistedAppState`,
// from every export in `dataExport.ts`, and from audit event details. "Reset all local
// data" calls `clearPersistedCloudState()` so no upload path survives a reset.
//
// The storage backend sits behind `SessionStorageAdapter` (sessionStorage.ts,
// roadmap A4): native Tauri builds route the session envelope through macOS
// Keychain commands; browser/demo builds retain the documented localStorage
// fallback. The same three functions preserve one caller contract.

import type { PersistedCloudStateV1 } from "./cloudPolicy";
import {
  deleteCloudStateThrough,
  readCloudStateThrough,
  resolveSessionStorageAdapter,
  writeCloudStateStrictThrough
} from "./sessionStorage";
import { createPersistenceCoordinator } from "./persistenceCoordinator";

async function persistCloudStateSnapshot(state: PersistedCloudStateV1): Promise<void> {
  await writeCloudStateStrictThrough(resolveSessionStorageAdapter(), state);
}

const cloudPersistenceCoordinator = createPersistenceCoordinator(persistCloudStateSnapshot);

/** Read + validate the persisted cloud state; null when nothing has ever been stored. */
export async function readPersistedCloudState(): Promise<PersistedCloudStateV1 | null> {
  return readCloudStateThrough(resolveSessionStorageAdapter());
}

export async function writePersistedCloudState(state: PersistedCloudStateV1): Promise<void> {
  try {
    await cloudPersistenceCoordinator.schedule(state);
  } catch {
    // Cloud preferences remain usable in memory when storage is unavailable.
  }
}

/** Reject unless the complete cloud/session envelope reaches its selected backend. */
export async function writePersistedCloudStateStrict(state: PersistedCloudStateV1): Promise<void> {
  await cloudPersistenceCoordinator.schedule(state);
}

export async function clearPersistedCloudState(): Promise<boolean> {
  try {
    await cloudPersistenceCoordinator.clear(async () => {
      const deleted = await deleteCloudStateThrough(resolveSessionStorageAdapter());
      if (!deleted) {
        throw new Error("Weekform could not verify durable cloud credential removal.");
      }
    });
    return true;
  } catch {
    return false;
  }
}
