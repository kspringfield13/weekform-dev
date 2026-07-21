import test from "node:test";
import assert from "node:assert/strict";

import type {
  PersonalReplicaSyncQueueItemV1,
  ReviewCommandApplicationV1,
  ReviewCommandV1,
} from "../../../../packages/domain/src/personalCloud";
import {
  applyApprovedReviewCommand,
  applyReviewCommandToCurrentBlocks,
  createDefaultPersonalSyncState,
  currentBlockRevision,
  enqueueReviewCommandApplication,
  enqueueReplicaBatch,
  enqueueReplicaBatchWithClock,
  findLocalBlockForReviewCommand,
  markReplicaBatchAttempt,
  markReviewCommandApplicationAttempt,
  markReviewCommandApplicationPhase,
  nextReviewCommandApplication,
  parsePersonalSyncState,
  personalSyncDisconnectBlockReason,
  rekeyLegacyReplicaBatch,
  removeReviewCommandApplication,
  reviewCommandApplicationDecision,
  reviewCommandApplicationRetryDelayMs,
  reviewCommandClaimIsRecoverable,
  shouldFlushPersonalQueue,
} from "./personalSync";
import { personalReplicaBlock } from "../../../../packages/inference/src/personalReplica";
import type { WorkBlock } from "../../../../packages/domain/src/models";

const block: WorkBlock = {
  work_block_id: "block-1",
  week_id: "2026-W29",
  start_time: "2026-07-14T13:00:00.000Z",
  end_time: "2026-07-14T14:00:00.000Z",
  estimated_capacity_pct: 3,
  category: "Admin / coordination",
  mode: "Reactive",
  planned_status: "unplanned",
  project_name: "Local only",
  stakeholder_group: "Local only",
  derived_from: ["sample-1"],
  evidence: ["sensitive"],
  confidence: 0.7,
  user_verified: false,
  blocker_flag: false,
  notes: null,
};

test("offline queue deduplicates identical replica content and keeps a stable batch id", () => {
  const makeId = () => "11111111-2222-4333-8444-555555555555";
  const queued = enqueueReplicaBatch([], {
    fingerprint: "replica-fp-1",
    payload: { schemaVersion: 1 } as PersonalReplicaSyncQueueItemV1["payload"],
    now: "2026-07-19T20:00:00.000Z",
    makeId,
  });
  const retry = enqueueReplicaBatch(queued, {
    fingerprint: "replica-fp-1",
    payload: { schemaVersion: 1 } as PersonalReplicaSyncQueueItemV1["payload"],
    now: "2026-07-19T20:01:00.000Z",
    makeId: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  });
  assert.equal(retry.length, 1);
  assert.equal(retry[0].batchId, queued[0].batchId);

  const attempted = markReplicaBatchAttempt(retry, retry[0].batchId, "offline");
  assert.equal(attempted[0].attempts, 1);
  assert.equal(attempted[0].lastError, "offline");
});

test("only the exact legacy-receipt failure rekeys a queued replica without changing its payload", () => {
  const original = enqueueReplicaBatch([], {
    fingerprint: "replica-fp-legacy",
    payload: { schemaVersion: 1 } as PersonalReplicaSyncQueueItemV1["payload"],
    now: "2026-07-20T12:00:00.000Z",
    makeId: () => "11111111-2222-4333-8444-555555555555",
  });
  const replacementId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const recovered = rekeyLegacyReplicaBatch(
    original,
    original[0].batchId,
    "legacy personal replica batch id requires a new batch id",
    () => replacementId,
  );

  assert.ok(recovered);
  assert.equal(recovered?.[0].batchId, replacementId);
  assert.equal(recovered?.[0].fingerprint, original[0].fingerprint);
  assert.equal(recovered?.[0].payload, original[0].payload);
  assert.equal(recovered?.[0].queuedAt, original[0].queuedAt);
  assert.equal(recovered?.[0].attempts, 0);
  assert.equal(recovered?.[0].lastError, null);
  assert.equal(original[0].batchId, "11111111-2222-4333-8444-555555555555");

  assert.equal(
    rekeyLegacyReplicaBatch(original, original[0].batchId, "conflicting personal replica batch id"),
    null,
  );
  assert.equal(
    rekeyLegacyReplicaBatch(original, "missing-batch", "legacy personal replica batch id requires a new batch id"),
    null,
  );
});

test("replica source clock advances only for new content and survives same-millisecond changes", () => {
  const initial = createDefaultPersonalSyncState(() => "device-1");
  const payload = {
    schemaVersion: 1,
    replicaId: "personal-2026-W29",
    weekId: "2026-W29",
    generatedAt: "2026-07-20T12:00:00.000Z",
    sourceUpdatedAt: "2099-01-01T00:00:00.000Z",
    blocks: [],
    capacity: {},
  } as PersonalReplicaSyncQueueItemV1["payload"];
  const first = enqueueReplicaBatchWithClock(initial, {
    fingerprint: "fingerprint-one",
    payload,
    now: "2026-07-20T12:00:00.000Z",
    makeId: () => "batch-1",
  });
  assert.equal(first.sourceClock, "2026-07-20T12:00:00.000Z");
  assert.equal(first.queue[0].payload.sourceUpdatedAt, first.sourceClock);

  const exactRetry = enqueueReplicaBatchWithClock(first, {
    fingerprint: "fingerprint-one",
    payload: { ...payload, sourceUpdatedAt: "2026-07-20T12:05:00.000Z" },
    now: "2026-07-20T12:05:00.000Z",
    makeId: () => "batch-must-not-change",
  });
  assert.equal(exactRetry, first);
  assert.equal(exactRetry.queue[0].batchId, "batch-1");

  const sameMillisecondChange = enqueueReplicaBatchWithClock(first, {
    fingerprint: "fingerprint-two",
    payload,
    now: "2026-07-20T12:00:00.000Z",
    makeId: () => "batch-2",
  });
  assert.equal(sameMillisecondChange.sourceClock, "2026-07-20T12:00:00.001Z");
  assert.equal(sameMillisecondChange.queue[0].payload.sourceUpdatedAt, sameMillisecondChange.sourceClock);

  const restarted = parsePersonalSyncState({
    ...sameMillisecondChange,
    queue: [],
  }, () => "fallback-device");
  const afterClockRollback = enqueueReplicaBatchWithClock(restarted, {
    fingerprint: "fingerprint-three",
    payload,
    now: "2026-07-20T11:00:00.000Z",
    makeId: () => "batch-3",
  });
  assert.equal(afterClockRollback.sourceClock, "2026-07-20T12:00:00.002Z");
});

test("an enabled non-empty personal queue flushes immediately and nothing else does", () => {
  assert.equal(shouldFlushPersonalQueue(true, 1), true);
  assert.equal(shouldFlushPersonalQueue(true, 0), false);
  assert.equal(shouldFlushPersonalQueue(false, 1), false);
});

test("review command is conflict-visible and cannot apply against a stale block revision", () => {
  const command: ReviewCommandV1 = {
    schemaVersion: 1,
    protocolVersion: 1,
    commandId: "command-1",
    blockId: "block-1",
    weekId: "2026-W29",
    expectedRevision: "stale-revision",
    action: "confirm",
    patch: null,
    status: "pending",
    createdAt: "2026-07-19T20:00:00.000Z",
    decidedAt: null,
    decisionReason: null,
  };

  const result = applyApprovedReviewCommand(block, command);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "revision_conflict");
  assert.equal(block.user_verified, false);
});

test("approved confirm changes only the allowlisted review field", () => {
  const command: ReviewCommandV1 = {
    schemaVersion: 1,
    protocolVersion: 1,
    commandId: "command-2",
    blockId: "block-1",
    weekId: "2026-W29",
    expectedRevision: currentBlockRevision(block),
    action: "confirm",
    patch: null,
    status: "pending",
    createdAt: "2026-07-19T20:00:00.000Z",
    decidedAt: null,
    decisionReason: null,
  };
  const result = applyApprovedReviewCommand(block, command);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.block.user_verified, true);
    assert.equal(result.block.project_name, "Local only");
    assert.deepEqual(result.block.evidence, ["sensitive"]);
  }
});

test("Web relabel recomputes the deterministic blocker flag in both directions", () => {
  const intoBlocked: ReviewCommandApplicationV1 = {
    ...reviewApplication,
    commandId: "command-blocked-in",
    action: "relabel",
    patch: { category: "Blocked / waiting / dependency delay" },
  };
  const appliedInto = applyApprovedReviewCommand(block, intoBlocked);
  assert.equal(appliedInto.ok, true);
  if (appliedInto.ok && appliedInto.block) {
    assert.equal(appliedInto.block.blocker_flag, true);
    assert.deepEqual(appliedInto.changedFields, ["category", "blocker_flag"]);
  }

  const blockedBlock: WorkBlock = {
    ...block,
    category: "Blocked / waiting / dependency delay",
    blocker_flag: true,
  };
  const outOfBlocked: ReviewCommandApplicationV1 = {
    ...reviewApplication,
    commandId: "command-blocked-out",
    expectedRevision: currentBlockRevision(blockedBlock),
    action: "relabel",
    patch: { category: "Admin / coordination" },
  };
  const appliedOut = applyApprovedReviewCommand(blockedBlock, outOfBlocked);
  assert.equal(appliedOut.ok, true);
  if (appliedOut.ok && appliedOut.block) {
    assert.equal(appliedOut.block.blocker_flag, false);
    assert.deepEqual(appliedOut.changedFields, ["category", "blocker_flag"]);
  }
});

test("a contradictory explicit blocker flag is rejected instead of corrupting the invariant", () => {
  const contradictory: ReviewCommandApplicationV1 = {
    ...reviewApplication,
    commandId: "command-contradictory-blocker",
    action: "relabel",
    patch: { category: "Blocked / waiting / dependency delay", blockerFlag: false },
  };
  assert.deepEqual(applyApprovedReviewCommand(block, contradictory), {
    ok: false,
    reason: "invalid_patch",
  });
  assert.equal(reviewCommandApplicationDecision([block], contradictory).kind, "conflict");
});

test("atomic review CAS preserves a local edit made while the claim request is in flight", async () => {
  let release!: () => void;
  const network = new Promise<void>((resolve) => { release = resolve; });
  let ledger = [block];
  const command: ReviewCommandApplicationV1 = {
    ...reviewApplication,
    commandId: "command-deferred-cas",
    action: "relabel",
    patch: { category: "QA / data validation" },
  };

  const applyAfterClaim = (async () => {
    await network;
    const outcome = applyReviewCommandToCurrentBlocks(ledger, command);
    ledger = outcome.blocks;
    return outcome.result;
  })();
  ledger = [{ ...block, mode: "Deep work" }];
  release();
  const result = await applyAfterClaim;

  assert.equal(result.kind, "conflict");
  assert.equal(ledger[0].mode, "Deep work");
  assert.equal(ledger[0].category, block.category);
});

test("provider-free Chat review commands resolve to the local block and preserve local ids", () => {
  const chatBlock: WorkBlock = {
    ...block,
    work_block_id: "chat-review-slack-canonical-chat-hash",
    derived_from: ["chat-slack-review-canonical-chat-hash"],
  };
  const externalBlock = personalReplicaBlock(chatBlock);
  assert.match(externalBlock.blockId, /^wfb-[a-f0-9]{64}$/);
  assert.equal(externalBlock.blockId.includes("slack"), false);

  const command: ReviewCommandV1 = {
    schemaVersion: 1,
    commandId: "command-chat",
    blockId: externalBlock.blockId,
    weekId: chatBlock.week_id,
    expectedRevision: externalBlock.revision,
    action: "confirm",
    patch: null,
    status: "pending",
    createdAt: "2026-07-19T20:00:00.000Z",
    decidedAt: null,
    decisionReason: null,
  };

  assert.equal(findLocalBlockForReviewCommand([block, chatBlock], command), chatBlock);
  const result = applyApprovedReviewCommand(chatBlock, command);
  assert.equal(result.ok, true);
  if (result.ok && result.block) {
    assert.equal(result.block.work_block_id, chatBlock.work_block_id);
    assert.equal(result.block.user_verified, true);
  }
});

test("upgrade drops unsent legacy replica batches with provider-bearing Chat ids", () => {
  const state = parsePersonalSyncState({
    deviceId: "device-1",
    deviceName: "Weekform for Mac",
    cursor: 0,
    queue: [{
      batchId: "batch-legacy-chat",
      fingerprint: "legacy-fingerprint",
      queuedAt: "2026-07-19T20:00:00.000Z",
      attempts: 0,
      lastError: null,
      payload: {
        schemaVersion: 1,
        weekId: "2026-W29",
        blocks: [{ blockId: "chat-review-slack-canonical-chat-hash" }],
      },
    }, {
      batchId: "batch-legacy-imported-chat",
      fingerprint: "legacy-imported-fingerprint",
      queuedAt: "2026-07-19T21:00:00.000Z",
      attempts: 0,
      lastError: null,
      payload: {
        schemaVersion: 1,
        weekId: "2026-W30",
        blocks: [{ blockId: "imported-chat-google-chat-provider-source-id" }],
      },
    }],
  }, () => "fallback-device");

  assert.deepEqual(state.queue, []);
  assert.deepEqual(state.reviewOutbox, []);
});

const reviewApplication: ReviewCommandApplicationV1 = {
  schemaVersion: 1,
  protocolVersion: 2,
  commandId: "81000000-0000-4000-8000-000000000001",
  blockId: "block-1",
  weekId: "2026-W29",
  expectedRevision: currentBlockRevision(block),
  action: "confirm",
  patch: null,
  createdAt: "2026-07-20T12:00:00.000Z",
};

test("review application outbox migrates safely and rejects non-allowlisted payloads", () => {
  const migrated = parsePersonalSyncState({
    deviceId: "device-1",
    deviceName: "Weekform for Mac",
    cursor: 0,
    queue: [],
  }, () => "fallback-device");
  assert.deepEqual(migrated.reviewOutbox, []);

  const valid = {
    schemaVersion: 1,
    command: reviewApplication,
    phase: "apply_pending",
    queuedAt: "2026-07-20T12:01:00.000Z",
    updatedAt: "2026-07-20T12:01:00.000Z",
    attempts: 0,
    lastError: null,
  } as const;
  const parsed = parsePersonalSyncState({
    deviceId: "device-1",
    deviceName: "Weekform for Mac",
    cursor: 0,
    queue: [],
    reviewOutbox: [
      valid,
      { ...valid, command: { ...reviewApplication, evidence: ["must never persist"] } },
      { ...valid, phase: "unknown" },
    ],
  }, () => "fallback-device");
  assert.deepEqual(parsed.reviewOutbox, [valid]);

  const legacyCommand = { ...reviewApplication } as Record<string, unknown>;
  delete legacyCommand.protocolVersion;
  const legacy = parsePersonalSyncState({
    deviceId: "device-1",
    deviceName: "Weekform for Mac",
    cursor: 0,
    queue: [],
    reviewOutbox: [{ ...valid, command: legacyCommand }],
  }, () => "fallback-device");
  assert.equal(legacy.reviewOutbox?.[0]?.command.protocolVersion, 2,
    "pre-protocol outbox entries migrate only to the isolated v2 path they originally represented");
});

test("outbox persistence keeps legacy and v2 lifecycle protocols explicit", () => {
  const v1 = enqueueReviewCommandApplication([], {
    command: { ...reviewApplication, protocolVersion: 1 },
    phase: "apply_pending",
    now: "2026-07-20T12:01:00.000Z",
  });
  const v2 = enqueueReviewCommandApplication(v1, {
    command: { ...reviewApplication, commandId: "81000000-0000-4000-8000-000000000002", protocolVersion: 2 },
    phase: "apply_pending",
    now: "2026-07-20T12:01:00.000Z",
  });
  assert.deepEqual(v2.map((item) => item.command.protocolVersion), [1, 2]);
});

test("review application outbox advances monotonically and retry metadata is durable", () => {
  const applyPending = enqueueReviewCommandApplication([], {
    command: reviewApplication,
    phase: "apply_pending",
    now: "2026-07-20T12:01:00.000Z",
  });
  assert.equal(applyPending.length, 1);
  assert.equal(applyPending[0].phase, "apply_pending");

  const ackPending = markReviewCommandApplicationPhase(
    applyPending,
    reviewApplication.commandId,
    "ack_pending",
    "2026-07-20T12:02:00.000Z",
  );
  assert.equal(ackPending[0].phase, "ack_pending");
  const cannotRegress = enqueueReviewCommandApplication(ackPending, {
    command: reviewApplication,
    phase: "apply_pending",
    now: "2026-07-20T12:03:00.000Z",
  });
  assert.equal(cannotRegress[0].phase, "ack_pending");

  const attempted = markReviewCommandApplicationAttempt(
    cannotRegress,
    reviewApplication.commandId,
    "network failed with private body that must be capped".repeat(20),
    "2026-07-20T12:04:00.000Z",
  );
  assert.equal(attempted[0].attempts, 1);
  assert.equal(attempted[0].lastError?.length, 200);
  assert.deepEqual(removeReviewCommandApplication(attempted, reviewApplication.commandId), []);
});

test("review application decision is idempotent after a crash between local apply and server ack", () => {
  assert.equal(reviewCommandApplicationDecision([block], reviewApplication).kind, "apply");
  assert.equal(
    reviewCommandApplicationDecision([{ ...block, user_verified: true, confidence: 0.9 }], reviewApplication).kind,
    "already_applied",
  );
  assert.equal(
    reviewCommandApplicationDecision([{ ...block, category: "QA / data validation" }], reviewApplication).kind,
    "conflict",
  );

  const exclude = { ...reviewApplication, commandId: "81000000-0000-4000-8000-000000000002", action: "exclude" as const };
  assert.equal(reviewCommandApplicationDecision([], exclude).kind, "already_applied");
});

test("review application retries back off instead of spinning while offline", () => {
  const queuedAt = "2026-07-20T12:00:00.000Z";
  const base = enqueueReviewCommandApplication([], {
    command: reviewApplication,
    phase: "apply_pending",
    now: queuedAt,
  })[0];
  assert.equal(reviewCommandApplicationRetryDelayMs(base, Date.parse(queuedAt)), 0);
  const failed = { ...base, attempts: 1, updatedAt: queuedAt, lastError: "offline" };
  assert.equal(reviewCommandApplicationRetryDelayMs(failed, Date.parse(queuedAt)), 5_000);
  assert.equal(reviewCommandApplicationRetryDelayMs(failed, Date.parse(queuedAt) + 2_000), 3_000);
  assert.equal(reviewCommandApplicationRetryDelayMs({ ...failed, attempts: 99 }, Date.parse(queuedAt)), 300_000);

  const readyLaterItem = {
    ...base,
    command: { ...base.command, commandId: "ready-later-item" },
  };
  const scheduled = nextReviewCommandApplication([failed, readyLaterItem], Date.parse(queuedAt));
  assert.equal(scheduled?.item.command.commandId, "ready-later-item");
  assert.equal(scheduled?.delayMs, 0);
});

test("only expired or revoked apply_pending claims are recoverable", () => {
  const now = Date.parse("2026-07-21T12:00:00.000Z");
  const claimed: ReviewCommandV1 = {
    ...reviewApplication,
    status: "pending",
    decidedAt: null,
    decisionReason: null,
    applicationPhase: "apply_pending",
    claimedByDevice: "device-old",
    claimedAt: "2026-07-20T11:59:59.999Z",
    claimOwnerRevoked: false,
  };
  assert.equal(reviewCommandClaimIsRecoverable(claimed, now), true);
  assert.equal(reviewCommandClaimIsRecoverable({
    ...claimed,
    claimedAt: "2026-07-21T11:59:59.999Z",
  }, now), false);
  assert.equal(reviewCommandClaimIsRecoverable({
    ...claimed,
    claimedAt: "2026-07-21T11:59:59.999Z",
    claimOwnerRevoked: true,
  }, now), true);
  assert.equal(reviewCommandClaimIsRecoverable({
    ...claimed,
    applicationPhase: "ack_pending",
    claimedAt: "2020-01-01T00:00:00.000Z",
    claimOwnerRevoked: true,
  }, now), false);
});

test("disconnect is blocked while a claimed review command remains in the durable outbox", () => {
  const state = createDefaultPersonalSyncState(() => "device-1");
  assert.equal(personalSyncDisconnectBlockReason(state), null);
  const pending = {
    ...state,
    reviewOutbox: enqueueReviewCommandApplication([], {
      command: reviewApplication,
      phase: "ack_pending",
      now: "2026-07-20T12:00:00.000Z",
    }),
  };
  assert.match(personalSyncDisconnectBlockReason(pending) ?? "", /Keep Weekform open/i);
});
