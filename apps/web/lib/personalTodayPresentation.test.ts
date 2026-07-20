import assert from "node:assert/strict";
import test from "node:test";

import {
  presentPersonalToday,
  reviewProgressPercent,
} from "./personalTodayPresentation";

interface ReviewBlock {
  blockId: string;
  userVerified: boolean;
}

function block(blockId: string, userVerified: boolean): ReviewBlock {
  return { blockId, userVerified };
}

test("Today presentation filters the editable queue to unverified blocks", () => {
  const pendingOne = block("pending-one", false);
  const verified = block("verified", true);
  const pendingTwo = block("pending-two", false);

  const presentation = presentPersonalToday([
    pendingOne,
    verified,
    pendingTwo,
  ]);

  assert.deepEqual(presentation.reviewQueue, [pendingOne, pendingTwo]);
  assert.equal(presentation.verifiedCount, 1);
  assert.equal(presentation.totalCount, 3);
  assert.equal(presentation.progressPct, 33);
});

test("Today presentation uses the Desktop empty heading when no blocks exist", () => {
  const presentation = presentPersonalToday([]);

  assert.equal(presentation.heading, "No work tracked yet.");
  assert.equal(presentation.progressPct, 0);
});

test("Today presentation uses the Desktop singular pending heading", () => {
  const presentation = presentPersonalToday([block("pending", false)]);

  assert.equal(presentation.heading, "1 block needs a quick look.");
});

test("Today presentation uses the Desktop plural pending heading", () => {
  const presentation = presentPersonalToday([
    block("pending-one", false),
    block("pending-two", false),
    block("verified", true),
  ]);

  assert.equal(presentation.heading, "2 blocks need a quick look.");
});

test("Today presentation uses the Desktop completion heading when all blocks are verified", () => {
  const presentation = presentPersonalToday([
    block("verified-one", true),
    block("verified-two", true),
  ]);

  assert.equal(presentation.heading, "All blocks reviewed.");
  assert.equal(presentation.progressPct, 100);
});

test("review progress is rounded and clamped for defensive aria and geometry values", () => {
  assert.equal(reviewProgressPercent(1, 3), 33);
  assert.equal(reviewProgressPercent(-1, 3), 0);
  assert.equal(reviewProgressPercent(4, 3), 100);
  assert.equal(reviewProgressPercent(1, 0), 0);
  assert.equal(reviewProgressPercent(Number.NaN, 3), 0);
});
