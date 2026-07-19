import test from "node:test";
import assert from "node:assert/strict";

import type { PersonalReplicaSyncQueueItemV1, ReviewCommandV1 } from "../../../../packages/domain/src/personalCloud";
import {
  applyApprovedReviewCommand,
  currentBlockRevision,
  enqueueReplicaBatch,
  markReplicaBatchAttempt,
  shouldFlushPersonalQueue,
} from "./personalSync";
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

test("an enabled non-empty personal queue flushes immediately and nothing else does", () => {
  assert.equal(shouldFlushPersonalQueue(true, 1), true);
  assert.equal(shouldFlushPersonalQueue(true, 0), false);
  assert.equal(shouldFlushPersonalQueue(false, 1), false);
});

test("review command is conflict-visible and cannot apply against a stale block revision", () => {
  const command: ReviewCommandV1 = {
    schemaVersion: 1,
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
