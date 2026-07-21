import assert from "node:assert/strict";
import test from "node:test";

import { reduceAgentAnnouncement } from "./agentAnnouncement";

test("a failed follow-up does not remove and then reannounce the previous answer", () => {
  const settled = reduceAgentAnnouncement(null, {
    type: "answer_settled",
    requestId: "request-1",
    answer: "Your reviewed evidence supports one smaller commitment.",
  });
  const sending = reduceAgentAnnouncement(settled, { type: "request_started" });
  const failed = reduceAgentAnnouncement(sending, { type: "request_failed" });

  assert.equal(sending, settled);
  assert.equal(failed, settled);
});

test("a newly settled answer receives a distinct announcement identity", () => {
  const first = reduceAgentAnnouncement(null, {
    type: "answer_settled",
    requestId: "request-1",
    answer: "First answer",
  });
  const second = reduceAgentAnnouncement(first, {
    type: "answer_settled",
    requestId: "request-2",
    answer: "First answer",
  });

  assert.notEqual(second, first);
  assert.equal(second?.requestId, "request-2");
});
