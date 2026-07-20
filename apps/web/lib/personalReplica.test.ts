import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  listOwnReviewCommands,
  listOwnPersonalReplicas,
  parseReviewCommandRow,
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

test("web parser accepts PostgREST timestamp precision for the database-owned sync time", () => {
  for (const syncedAt of [
    "2026-07-20T12:01:00+00:00",
    "2026-07-20T12:01:00.123456+00:00",
  ]) {
    const row = validReplicaRow();
    row.synced_at = syncedAt;
    assert.ok(parsePersonalReplicaRow(row));
  }
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

test("Web accepts only the review-command lifecycle allowlist", () => {
  const row = {
    command_id: "019c6e27-e55b-73d1-87d8-4e01f1f75043",
    block_id: "block-1",
    week_id: "2026-W29",
    expected_revision: "0123456789abcdef",
    action: "confirm",
    status: "pending",
    created_at: "2026-07-20T12:00:00.000Z",
    decided_at: null,
  };
  assert.deepEqual(parseReviewCommandRow(row), {
    commandId: row.command_id,
    blockId: "block-1",
    weekId: "2026-W29",
    expectedRevision: "0123456789abcdef",
    action: "confirm",
    status: "pending",
    createdAt: row.created_at,
    decidedAt: null,
  });
  assert.equal(parseReviewCommandRow({ ...row, decision_reason: "private detail" }), null);
  assert.equal(parseReviewCommandRow({ ...row, status: "unknown" }), null);
  assert.equal(parseReviewCommandRow({ ...row, decided_at: "not-a-date" }), null);
  assert.equal(parseReviewCommandRow({ ...row, command_id: "not-a-uuid" }), null);
  assert.ok(parseReviewCommandRow({ ...row, created_at: "2026-07-20T12:00:00+00:00" }));
  assert.ok(parseReviewCommandRow({ ...row, created_at: "2026-07-20T12:00:00.123456+00:00" }));
  assert.equal(parseReviewCommandRow({ ...row, created_at: "2026-02-30T12:00:00.000Z" }), null);
  assert.equal(parseReviewCommandRow({
    ...row,
    status: "applied",
    decided_at: "2026-07-20T11:59:59.000Z",
  }), null);
});

test("review-command loading fails closed instead of hiding malformed lifecycle state", async () => {
  const canonical = {
    command_id: "019c6e27-e55b-73d1-87d8-4e01f1f75043",
    block_id: "block-1",
    week_id: "2026-W29",
    expected_revision: "0123456789abcdef",
    action: "confirm",
    status: "applied",
    created_at: "2026-07-20T12:00:00.000Z",
    decided_at: "2026-07-20T12:05:00.000Z",
  };
  const requestedTables: string[] = [];
  const client = (
    v1Data: unknown,
    v1Error: { message?: string } | null = null,
    v2Data: unknown = [],
    v2Error: { message?: string } | null = null,
  ) => ({
    from(table: string) {
      requestedTables.push(table);
      const data = table === "review_commands_v2" ? v2Data : v1Data;
      const error = table === "review_commands_v2" ? v2Error : v1Error;
      return { select() { return { eq() { return { order() { return { limit: async () => ({ data, error }) }; } }; } }; } };
    },
  });

  const success = await listOwnReviewCommands(client([canonical]), "2026-W29");
  assert.equal(success.error, null);
  assert.equal(success.commands[0]?.status, "applied");
  assert.deepEqual(requestedTables.slice(0, 2), ["review_commands", "review_commands_v2"]);

  const v2Pending = {
    ...canonical,
    command_id: "019c6e27-e55b-73d1-87d8-4e01f1f75044",
    status: "pending",
    created_at: "2026-07-20T12:06:00.000Z",
    decided_at: null,
  };
  const merged = await listOwnReviewCommands(client([canonical], null, [v2Pending]), "2026-W29");
  assert.equal(merged.error, null);
  assert.deepEqual(merged.commands.map((command) => command.commandId), [
    v2Pending.command_id,
    canonical.command_id,
  ]);

  const identicalCollision = await listOwnReviewCommands(client([v2Pending], null, [v2Pending]), "2026-W29");
  assert.equal(identicalCollision.error, null);
  assert.equal(identicalCollision.commands.length, 1, "an impossible identical cross-table UUID collision is deduplicated safely");

  const invalid = await listOwnReviewCommands(client([{ ...canonical, raw_evidence: "secret" }]), "2026-W29");
  assert.deepEqual(invalid, {
    commands: [],
    error: "Weekform Web received invalid review-request status data. Reload after your Mac syncs again.",
  });

  const wrongWeek = await listOwnReviewCommands(client([
    { ...canonical, week_id: "2026-W28" },
  ]), "2026-W29");
  assert.deepEqual(wrongWeek, invalid);

  const failed = await listOwnReviewCommands(client(null, { message: "private postgres diagnostic" }), "2026-W29");
  assert.deepEqual(failed, {
    commands: [],
    error: "Weekform Web could not load review-request status. Reload this page or check your connection.",
  });
  assert.doesNotMatch(failed.error ?? "", /postgres|private diagnostic/i);

  const overflow = await listOwnReviewCommands(client(Array.from({ length: 101 }, () => canonical)), "2026-W29");
  assert.deepEqual(overflow, {
    commands: [],
    error: "Weekform Web received too many review-request statuses to validate safely. Resolve pending requests on your Mac, then reload.",
  });

  const duplicateId = await listOwnReviewCommands(client([
    canonical,
    { ...canonical, status: "rejected", decided_at: "2026-07-20T12:06:00.000Z" },
  ]), "2026-W29");
  assert.deepEqual(duplicateId, {
    commands: [],
    error: "Weekform Web received invalid review-request status data. Reload after your Mac syncs again.",
  });

  const duplicatePending = await listOwnReviewCommands(client([
    { ...canonical, status: "pending", decided_at: null },
    {
      ...canonical,
      command_id: "019c6e27-e55b-73d1-87d8-4e01f1f75044",
      status: "pending",
      decided_at: null,
    },
  ]), "2026-W29");
  assert.deepEqual(duplicatePending, {
    commands: [],
    error: "Weekform Web received invalid review-request status data. Reload after your Mac syncs again.",
  });

  const failedV2 = await listOwnReviewCommands(client([], null, null, { message: "private v2 diagnostic" }), "2026-W29");
  assert.deepEqual(failedV2, failed);
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
