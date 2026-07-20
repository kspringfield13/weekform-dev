// Contract tests keeping review-only Chat evidence outside acceleration mining.
// Run: node --import tsx --test packages/inference/src/accelerate.chat.test.ts

import assert from "node:assert/strict";
import test from "node:test";

import type { WorkBlock } from "../../domain/src/models";
import { detectTimeSinks } from "./accelerate";

function coordinationBlock(id: string, capacityPct: number): WorkBlock {
  return {
    work_block_id: id,
    week_id: "2026-W30",
    start_time: "2026-07-20T14:00:00.000Z",
    end_time: "2026-07-20T14:30:00.000Z",
    estimated_capacity_pct: capacityPct,
    category: "Admin / coordination",
    mode: "Reactive",
    planned_status: "unplanned",
    project_name: "Directed chat request",
    stakeholder_group: "Workplace chat",
    derived_from: [`chat-review-${id}`],
    evidence: ["Content-free directed Chat evidence"],
    confidence: 0.45,
    user_verified: false,
    blocker_flag: false,
    notes: null,
  };
}

test("zero-capacity Chat review cards cannot satisfy time-sink recurrence", () => {
  const signals = detectTimeSinks(
    [
      coordinationBlock("measured", 2),
      coordinationBlock("review-only-1", 0),
      coordinationBlock("review-only-2", 0),
    ],
    [],
  );

  assert.deepEqual(
    signals,
    [],
    "one measured block plus two review-only cards is one occurrence, not a three-block pattern",
  );
});
