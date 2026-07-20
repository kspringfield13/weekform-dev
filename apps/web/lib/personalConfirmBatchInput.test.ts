import assert from "node:assert/strict";
import test from "node:test";

import {
  eligibleReviewConfirmTargets,
  reviewConfirmEligibility,
  reviewConfirmBatchInput,
} from "./personalReplica";

const target = (blockId: string, weekId = "2026-W30", expectedRevision = "0123456789abcdef") => ({
  blockId,
  weekId,
  expectedRevision,
});

test("confirm-all input accepts one through fifty canonical targets without adding client-controlled behavior", () => {
  const one = [target("block-1")];
  assert.deepEqual(reviewConfirmBatchInput(one), one);

  const fifty = Array.from({ length: 50 }, (_, index) => target(`block-${index + 1}`));
  assert.deepEqual(reviewConfirmBatchInput(fifty), fifty);
});

test("confirm-all input rejects empty, oversized, duplicate, and non-array batches", () => {
  assert.equal(reviewConfirmBatchInput([]), null);
  assert.equal(reviewConfirmBatchInput(Array.from({ length: 51 }, (_, index) => target(`block-${index}`))), null);
  assert.equal(reviewConfirmBatchInput([target("block-1"), target("block-1")]), null);
  assert.equal(reviewConfirmBatchInput(null), null);
  assert.equal(reviewConfirmBatchInput({ targets: [target("block-1")] }), null);
});

test("confirm-all input requires the exact review-safe target shape", () => {
  for (const invalid of [
    [{ ...target("block-1"), action: "exclude" }],
    [{ ...target("block-1"), patch: { category: "Admin / coordination" } }],
    [{ ...target("block-1"), privateTitle: "Secret project" }],
    [{ blockId: "block-1", weekId: "2026-W30" }],
    [{ blockId: "block-1", expectedRevision: "0123456789abcdef" }],
  ]) {
    assert.equal(reviewConfirmBatchInput(invalid), null);
  }
});

test("confirm-all input rejects non-canonical identifiers, impossible weeks, and malformed revisions", () => {
  for (const invalid of [
    [target("")],
    [target(" block-1")],
    [target("x".repeat(161))],
    [target("block-1", "2026-W00")],
    [target("block-1", "2026-W54")],
    [target("block-1", "not-a-week")],
    [target("block-1", "2026-W30", "not-a-revision")],
    [target("block-1", "2026-W30", "0123456789ABCDEZ")],
  ]) {
    assert.equal(reviewConfirmBatchInput(invalid), null);
  }
});

test("confirm-all eligibility includes only unverified blocks without a locked current-revision request", () => {
  const blocks = [
    { blockId: "available", weekId: "2026-W30", revision: "0000000000000001", userVerified: false },
    { blockId: "rejected", weekId: "2026-W30", revision: "0000000000000002", userVerified: false },
    { blockId: "pending", weekId: "2026-W30", revision: "0000000000000003", userVerified: false },
    { blockId: "applied", weekId: "2026-W30", revision: "0000000000000004", userVerified: false },
    { blockId: "conflict", weekId: "2026-W30", revision: "0000000000000005", userVerified: false },
    { blockId: "verified", weekId: "2026-W30", revision: "0000000000000006", userVerified: true },
  ];
  const command = (blockId: string, status: "pending" | "applied" | "rejected" | "conflict") => ({
    commandId: `00000000-0000-4000-8000-0000000000${blockId.length}`,
    blockId,
    weekId: "2026-W30",
    expectedRevision: blocks.find((block) => block.blockId === blockId)!.revision,
    action: "confirm" as const,
    status,
    createdAt: "2026-07-20T12:00:00.000Z",
    decidedAt: status === "pending" ? null : "2026-07-20T12:01:00.000Z",
  });

  assert.deepEqual(
    eligibleReviewConfirmTargets(blocks, [
      command("rejected", "rejected"),
      command("pending", "pending"),
      command("applied", "applied"),
      command("conflict", "conflict"),
    ]),
    [
      target("available", "2026-W30", "0000000000000001"),
      target("rejected", "2026-W30", "0000000000000002"),
    ],
  );
});

test("confirm-all eligibility is revision-specific and capped at the server boundary", () => {
  const blocks = Array.from({ length: 52 }, (_, index) => ({
    blockId: `block-${index + 1}`,
    weekId: "2026-W30",
    revision: index.toString(16).padStart(16, "0"),
    userVerified: false,
  }));
  const stalePending = {
    commandId: "00000000-0000-4000-8000-000000000001",
    blockId: "block-1",
    weekId: "2026-W30",
    expectedRevision: "ffffffffffffffff",
    action: "confirm" as const,
    status: "pending" as const,
    createdAt: "2026-07-20T12:00:00.000Z",
    decidedAt: null,
  };

  const eligible = eligibleReviewConfirmTargets(blocks, [stalePending]);
  assert.equal(eligible.length, 50);
  assert.deepEqual(eligible[0], target("block-1", "2026-W30", "0000000000000000"));
});

test("confirm-all eligibility reports the uncapped total so a partial batch is never called all", () => {
  const blocks = Array.from({ length: 53 }, (_, index) => ({
    blockId: `block-${index + 1}`,
    weekId: "2026-W30",
    revision: index.toString(16).padStart(16, "0"),
    userVerified: false,
  }));
  const pending = {
    commandId: "00000000-0000-4000-8000-000000000001",
    blockId: "block-53",
    weekId: "2026-W30",
    expectedRevision: blocks[52]!.revision,
    action: "confirm" as const,
    status: "pending" as const,
    createdAt: "2026-07-20T12:00:00.000Z",
    decidedAt: null,
  };

  const eligibility = reviewConfirmEligibility(blocks, [pending]);
  assert.equal(eligibility.totalCount, 52);
  assert.equal(eligibility.targets.length, 50);
  assert.equal(eligibleReviewConfirmTargets(blocks, [pending]).length, 50);
});
