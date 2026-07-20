import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  listOwnPersonalReplicas,
  parsePersonalReplicaRow,
  reviewCommandInput,
} from "./personalReplica";

function validReplicaRow() {
  return {
    replica_id: "personal-2026-W30",
    week_id: "2026-W30",
    revision: "0123456789abcdef",
    synced_at: "2026-07-20T12:01:00.000Z",
    payload: {
      schemaVersion: 1,
      replicaId: "personal-2026-W30",
      weekId: "2026-W30",
      generatedAt: "2026-07-20T12:00:00.000Z",
      sourceUpdatedAt: "2026-07-20T11:59:00.000Z",
      blocks: [{
        blockId: "block-1",
        weekId: "2026-W30",
        startTime: "2026-07-20T10:00:00.000Z",
        endTime: "2026-07-20T11:00:00.000Z",
        estimatedCapacityPct: 3,
        category: "Admin / coordination",
        mode: "Reactive",
        plannedStatus: "unplanned",
        confidence: 0.8,
        userVerified: false,
        blockerFlag: false,
        revision: "fedcba9876543210",
      }],
      capacity: {
        allocatedPct: 72,
        deepWorkPct: 31,
        fragmentedWorkPct: 18,
        meetingPct: 24,
        reactivePct: 27,
        plannedPct: 45,
        blockedPct: 4,
        reliableNewWorkCapacityPct: 28,
        committedUtilizationPct: 72,
        carryoverRiskPct: 12,
        wipLoadScore: 0.42,
        contextSwitchScore: 0.37,
        summaryConfidence: 0.81,
      },
    },
  };
}

function personalReplicaClient(
  data: unknown,
  error: { message?: string } | null = null,
) {
  return {
    from() {
      return {
        select() {
          return {
            order() {
              return {
                limit: async () => ({ data, error }),
              };
            },
          };
        },
      };
    },
  };
}

test("web parser accepts a canonical review-safe replica fixture", () => {
  const parsed = parsePersonalReplicaRow(validReplicaRow());

  assert.ok(parsed);
  assert.equal(parsed.replicaId, "personal-2026-W30");
  assert.equal(parsed.payload.blocks[0]?.blockId, "block-1");
  assert.equal(parsed.payload.capacity.reliableNewWorkCapacityPct, 28);
});

test("web parser rejects non-canonical or impossible replica timestamps", () => {
  for (const mutate of [
    (row: ReturnType<typeof validReplicaRow>) => { row.synced_at = "not-a-date"; },
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.generatedAt = "2026-07-20T08:00:00-04:00"; },
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.sourceUpdatedAt = "2026-02-30T11:59:00.000Z"; },
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.blocks[0]!.startTime = "2026-07-20"; },
  ]) {
    const row = validReplicaRow();
    mutate(row);
    assert.equal(parsePersonalReplicaRow(row), null);
  }
});

test("web parser accepts future calendar blocks and independent clock skew", () => {
  const row = validReplicaRow();
  row.payload.generatedAt = "2026-07-20T12:10:00.000Z";
  row.payload.sourceUpdatedAt = "2026-07-20T12:15:00.000Z";
  row.payload.blocks[0]!.startTime = "2026-07-20T13:00:00.000Z";
  row.payload.blocks[0]!.endTime = "2026-07-20T14:00:00.000Z";
  row.synced_at = "2026-07-20T12:05:00.000Z";

  assert.ok(parsePersonalReplicaRow(row));
});

test("web parser rejects conflicting identity, invalid weeks, and invalid block chronology", () => {
  for (const mutate of [
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.replicaId = "different-replica"; },
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.weekId = "2026-W29"; },
    (row: ReturnType<typeof validReplicaRow>) => { row.week_id = "2026-W54"; row.payload.weekId = "2026-W54"; row.payload.blocks[0]!.weekId = "2026-W54"; },
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.blocks[0]!.weekId = "2026-W29"; },
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.blocks[0]!.endTime = row.payload.blocks[0]!.startTime; },
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.blocks[0]!.endTime = "2026-07-20T09:59:59.000Z"; },
  ]) {
    const row = validReplicaRow();
    mutate(row);
    assert.equal(parsePersonalReplicaRow(row), null);
  }
});

test("synced blocks and review commands share the 160-character block ID boundary", () => {
  const maximumId = "b".repeat(160);
  const overlongId = "b".repeat(161);
  const row = validReplicaRow();
  row.payload.blocks[0]!.blockId = maximumId;
  assert.ok(parsePersonalReplicaRow(row));

  const overlongRow = validReplicaRow();
  overlongRow.payload.blocks[0]!.blockId = overlongId;
  assert.equal(parsePersonalReplicaRow(overlongRow), null);

  const canonical = {
    weekId: "2026-W29",
    expectedRevision: "0123456789abcdef",
    action: "confirm",
  } as const;
  assert.equal(reviewCommandInput({ ...canonical, blockId: maximumId })?.blockId, maximumId);
  assert.equal(reviewCommandInput({ ...canonical, blockId: overlongId }), null);
});

test("web parser rejects values outside the Desktop replica contract", () => {
  for (const mutate of [
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.blocks[0]!.estimatedCapacityPct = 101; },
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.blocks[0]!.confidence = 1.01; },
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.capacity.reactivePct = -1; },
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.capacity.committedUtilizationPct = 201; },
    (row: ReturnType<typeof validReplicaRow>) => { row.payload.capacity.summaryConfidence = 1.01; },
  ]) {
    const row = validReplicaRow();
    mutate(row);
    assert.equal(parsePersonalReplicaRow(row), null);
  }
});

test("replica loading fails closed with a stable error when any API row is invalid", async () => {
  const invalid = validReplicaRow();
  invalid.payload.weekId = "2026-W29";

  const partial = await listOwnPersonalReplicas(personalReplicaClient([
    validReplicaRow(),
    invalid,
  ]));
  assert.deepEqual(partial, {
    replicas: [],
    error: "Weekform Web received invalid review-safe replica data. Resync from Weekform for Mac.",
    errorKind: "integrity",
  });

  const failed = await listOwnPersonalReplicas(personalReplicaClient([invalid]));
  assert.deepEqual(failed, partial);
});

test("replica loading distinguishes sanitized load failures from integrity failures", async () => {
  const loadFailure = await listOwnPersonalReplicas(personalReplicaClient(
    null,
    { message: "postgres host and private diagnostic details" },
  ));
  assert.deepEqual(loadFailure, {
    replicas: [],
    error: "Weekform Web could not load review-safe replica data. Reload this page or check your connection.",
    errorKind: "load",
  });
  assert.doesNotMatch(loadFailure.error ?? "", /postgres|host|private diagnostic/i);

  const integrityFailure = await listOwnPersonalReplicas(personalReplicaClient({ malformed: true }));
  assert.deepEqual(integrityFailure, {
    replicas: [],
    error: "Weekform Web received invalid review-safe replica data. Resync from Weekform for Mac.",
    errorKind: "integrity",
  });

  const success = await listOwnPersonalReplicas(personalReplicaClient([validReplicaRow()]));
  assert.equal(success.error, null);
  assert.equal(success.errorKind, null);
  assert.equal(success.replicas.length, 1);
});

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

test("web parser rejects non-allowlisted payload and capacity keys", () => {
  const payloadExtra = validReplicaRow();
  (payloadExtra.payload as Record<string, unknown>).privateNotes = "must stay local";
  assert.equal(parsePersonalReplicaRow(payloadExtra), null);

  const capacityExtra = validReplicaRow();
  (capacityExtra.payload.capacity as Record<string, unknown>).unreviewedScore = 99;
  assert.equal(parsePersonalReplicaRow(capacityExtra), null);
});

test("review command input allows only confirm, exclude, and bounded relabel fields", () => {
  assert.deepEqual(reviewCommandInput({
    blockId: "block-1",
    weekId: "2026-W29",
    expectedRevision: "0123456789abcdef",
    action: "confirm",
  }), {
    blockId: "block-1",
    weekId: "2026-W29",
    expectedRevision: "0123456789abcdef",
    action: "confirm",
    patch: null,
  });
  assert.equal(reviewCommandInput({
    blockId: "block-1",
    weekId: "2026-W29",
    expectedRevision: "0123456789abcdef",
    action: "relabel",
    patch: { notes: "exfiltrate" },
  }), null);
});

test("review command input rejects malformed identifiers before the RPC boundary", () => {
  const canonical = {
    blockId: "block-1",
    weekId: "2026-W29",
    expectedRevision: "0123456789abcdef",
    action: "confirm",
  } as const;

  for (const input of [
    { ...canonical, blockId: "" },
    { ...canonical, blockId: "   " },
    { ...canonical, blockId: "b".repeat(161) },
    { ...canonical, weekId: "2026-W00" },
    { ...canonical, weekId: "2026-W54" },
    { ...canonical, weekId: "not-a-week" },
    { ...canonical, expectedRevision: "rev-1" },
    { ...canonical, expectedRevision: "0123456789ABCDEZ" },
    { ...canonical, expectedRevision: "0123456789abcdef00" },
  ]) {
    assert.equal(reviewCommandInput(input), null);
  }
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
