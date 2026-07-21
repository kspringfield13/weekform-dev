import test from "node:test";
import assert from "node:assert/strict";

import {
  REMOTE_SNAPSHOT_MISSING_MESSAGE,
  isManualResyncRequired,
  preserveManualResyncRequirement,
  reconcileRemoteSnapshot
} from "./cloudReconciliation";

test("remote reconciliation distinguishes an explicit missing row from a read failure", async () => {
  const missing = await reconcileRemoteSnapshot(async () => ({ ok: true, value: false }));
  assert.deepEqual(missing, { ok: true, exists: false });

  const unavailable = await reconcileRemoteSnapshot(async () => ({ ok: false, message: "offline" }));
  assert.deepEqual(unavailable, { ok: false, message: "offline" });
});

test("manual-resync marker is durable in sync-state error text without matching unrelated failures", () => {
  assert.equal(isManualResyncRequired(REMOTE_SNAPSHOT_MISSING_MESSAGE), true);
  assert.equal(
    isManualResyncRequired(
      `${REMOTE_SNAPSHOT_MISSING_MESSAGE} Latest retry attempt failed: offline`
    ),
    true
  );
  assert.equal(isManualResyncRequired("Could not reach the sync service"), false);
  assert.equal(isManualResyncRequired(null), false);
});

test("a failed manual retry cannot erase the deletion guard that blocks automatic re-upload", () => {
  assert.equal(
    preserveManualResyncRequirement(REMOTE_SNAPSHOT_MISSING_MESSAGE, "offline"),
    `${REMOTE_SNAPSHOT_MISSING_MESSAGE} Latest retry attempt failed: offline`
  );
  assert.equal(
    preserveManualResyncRequirement("older transient failure", "offline"),
    "offline"
  );
});

test("remote reconciliation confirms an unchanged snapshot only from an authenticated positive read", async () => {
  let reads = 0;
  const present = await reconcileRemoteSnapshot(async () => {
    reads += 1;
    return { ok: true, value: true };
  });
  assert.deepEqual(present, { ok: true, exists: true });
  assert.equal(reads, 1);
});
