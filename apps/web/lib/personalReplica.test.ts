import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { parsePersonalReplicaRow, reviewCommandInput } from "./personalReplica";

test("web parser rejects replicas containing non-allowlisted block keys", () => {
  const parsed = parsePersonalReplicaRow({
    replica_id: "replica-1",
    week_id: "2026-W29",
    revision: "rev-1",
    synced_at: "2026-07-19T20:00:00.000Z",
    payload: {
      schemaVersion: 1,
      replicaId: "replica-1",
      weekId: "2026-W29",
      generatedAt: "2026-07-19T20:00:00.000Z",
      sourceUpdatedAt: "2026-07-19T19:59:00.000Z",
      blocks: [{ blockId: "block-1", revision: "r1", evidence: ["secret"] }],
      capacity: null,
    },
  });
  assert.equal(parsed, null);
});

test("review command input allows only confirm, exclude, and bounded relabel fields", () => {
  assert.deepEqual(reviewCommandInput({
    blockId: "block-1",
    weekId: "2026-W29",
    expectedRevision: "rev-1",
    action: "confirm",
  }), {
    blockId: "block-1",
    weekId: "2026-W29",
    expectedRevision: "rev-1",
    action: "confirm",
    patch: null,
  });
  assert.equal(reviewCommandInput({
    blockId: "block-1",
    weekId: "2026-W29",
    expectedRevision: "rev-1",
    action: "relabel",
    patch: { notes: "exfiltrate" },
  }), null);
});

test("migration pins private realtime, idempotent batches, devices, cursors, and command RPCs", () => {
  const sql = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/202607190007_personal_replica_sync.sql"),
    "utf8",
  );
  for (const contract of [
    "weekform_devices",
    "personal_replica_batches",
    "personal_workload_replicas",
    "review_commands",
    "register_weekform_device",
    "sync_personal_replica_batch",
    "queue_review_command",
    "complete_review_command",
    "realtime.broadcast_changes",
    "realtime.messages",
  ]) assert.match(sql, new RegExp(contract.replaceAll(".", "\\.")));
  assert.doesNotMatch(
    sql,
    /for select to authenticated\s+for select to authenticated/,
    "the private Broadcast policy must be valid SQL, not a duplicated policy clause",
  );
});
