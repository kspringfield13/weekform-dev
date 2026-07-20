import assert from "node:assert/strict";
import test from "node:test";

import type { WeeklyCapacitySnapshot } from "../../../../packages/domain/src/models";
import {
  buildIndividualCapacityDetail,
  buildTeamCapacityDetail,
} from "./capacityDetail";

const snapshot: WeeklyCapacitySnapshot = {
  week_id: "2026-W30",
  allocated_pct: 74,
  deep_work_pct: 35,
  fragmented_work_pct: 18,
  meeting_pct: 22,
  reactive_pct: 24,
  planned_pct: 50,
  blocked_pct: 4,
  recurring_pct: 14,
  reliable_new_work_capacity_pct: 31,
  committed_utilization_pct: 69,
  carryover_risk_pct: 12,
  wip_load_score: 34,
  context_switch_score: 28,
  fragmentation_penalty_pct: 4,
  wip_penalty_pct: 3,
  summary_confidence: 0.86,
  category_allocation: [],
  work_mode_allocation: [],
};

test("individual capacity detail describes the current deterministic week", () => {
  const detail = buildIndividualCapacityDetail(snapshot, true);

  assert.equal(detail.scope, "individual");
  assert.equal(detail.capacity, 31);
  assert.equal(detail.caption, "Your week");
  assert.deepEqual(detail.bands.map(({ label, value }) => [label, value]), [
    ["Committed", 69],
    ["Reactive", 24],
    ["Fragmented", 18],
    ["Meetings", 22],
  ]);
});

test("individual capacity detail stays empty until the week has evidence", () => {
  const detail = buildIndividualCapacityDetail(snapshot, false);

  assert.equal(detail.capacity, null);
  assert.equal(detail.hasEvidence, false);
  assert.equal(detail.bands.length, 0);
});

test("team capacity detail uses approved values and excludes unknown capacity", () => {
  const detail = buildTeamCapacityDetail([
    { capacity: 12, risk: "attention", syncedAt: "2026-07-20T18:00:00Z" },
    { capacity: 42, risk: "stable", syncedAt: "2026-07-20T18:05:00Z" },
    { capacity: 30, risk: "watch", syncedAt: "2026-07-20T18:10:00Z" },
    { capacity: null, risk: "not-sharing", syncedAt: null },
  ]);

  assert.equal(detail.scope, "manager");
  assert.equal(detail.capacity, 30);
  assert.equal(detail.caption, "Team median");
  assert.deepEqual(detail.capacitySpread, [12, 30, 42]);
  assert.deepEqual(detail.stats.map(({ label, value }) => [label, value]), [
    ["Sharing", "3/4"],
    ["Headroom values", "3"],
    ["Attention", "1"],
  ]);
});

test("team capacity detail never turns an unshared value into zero", () => {
  const detail = buildTeamCapacityDetail([
    { capacity: null, risk: "not-sharing", syncedAt: null },
    { capacity: null, risk: "stale", syncedAt: "2026-07-10T18:00:00Z" },
  ]);

  assert.equal(detail.capacity, null);
  assert.equal(detail.hasEvidence, false);
  assert.deepEqual(detail.capacitySpread, []);
  assert.equal(detail.bands.find(({ key }) => key === "unknown")?.count, 2);
});
