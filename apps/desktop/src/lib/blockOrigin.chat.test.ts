import assert from "node:assert/strict";
import test from "node:test";

import type { WorkBlock } from "../../../../packages/domain/src/models";
import { blockOrigin } from "./blockOrigin";

function block(overrides: Partial<WorkBlock>): WorkBlock {
  return {
    work_block_id: "synthetic",
    week_id: "2026-W30",
    start_time: "2026-07-20T12:00:00.000Z",
    end_time: "2026-07-20T12:01:00.000Z",
    estimated_capacity_pct: 0,
    category: "Ad hoc stakeholder requests",
    mode: "Reactive",
    planned_status: "unplanned",
    project_name: "Directed chat request",
    stakeholder_group: "Workplace chat",
    derived_from: [],
    evidence: [],
    confidence: 0.45,
    user_verified: false,
    blocker_flag: false,
    notes: null,
    ...overrides,
  };
}

test("live and review-only Chat blocks are labeled Chat evidence", () => {
  assert.equal(blockOrigin(block({ work_block_id: "chat-review-slack-1" })).label, "Chat");
  assert.equal(
    blockOrigin(block({ derived_from: ["chat-google_chat-review-opaque"] })).label,
    "Chat",
  );
});

test("a generic imported block is not mislabeled as Chat without Chat provenance", () => {
  assert.equal(
    blockOrigin(block({
      work_block_id: "imported-git-log-entry",
      derived_from: ["git-commit-synthetic"],
    })).label,
    "Activity capture",
  );
});
