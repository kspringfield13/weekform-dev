import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTeamTimeline,
  teamTimelineWeeks,
  type TeamTimelinePoint,
} from "./teamTimeline";

const points: TeamTimelinePoint[] = [
  {
    userId: "manager",
    displayName: "Morgan",
    isSelf: true,
    weekId: "2026-W30",
    syncedAt: "2026-07-20T18:00:00.000Z",
    reliableCapacityPct: 28,
    reactivePct: 22,
    meetingPct: null,
    fragmentedPct: 17,
    reviewedBlocks: 8,
    eligibleBlocks: 10,
  },
  {
    userId: "member",
    displayName: "Ari",
    isSelf: false,
    weekId: "2026-W29",
    syncedAt: "2026-07-13T18:00:00.000Z",
    reliableCapacityPct: null,
    reactivePct: 31,
    meetingPct: 19,
    fragmentedPct: null,
    reviewedBlocks: 6,
    eligibleBlocks: 8,
  },
  // A later retry for the same member-week must win deterministically.
  {
    userId: "member",
    displayName: "Ari",
    isSelf: false,
    weekId: "2026-W29",
    syncedAt: "2026-07-13T20:00:00.000Z",
    reliableCapacityPct: 12,
    reactivePct: 33,
    meetingPct: 19,
    fragmentedPct: null,
    reviewedBlocks: 7,
    eligibleBlocks: 8,
  },
];

test("Team timeline zooms from one week to a bounded thirteen-week quarter", () => {
  assert.deepEqual(teamTimelineWeeks("2026-W30", "week"), ["2026-W30"]);
  assert.deepEqual(teamTimelineWeeks("2026-W30", "month"), [
    "2026-W27", "2026-W28", "2026-W29", "2026-W30",
  ]);
  assert.equal(teamTimelineWeeks("2026-W30", "quarter").length, 13);
  assert.equal(teamTimelineWeeks("2026-W30", "quarter").at(-1), "2026-W30");
});

test("Team timeline crosses ISO week-years without inventing calendar buckets", () => {
  assert.deepEqual(teamTimelineWeeks("2026-W02", "month"), [
    "2025-W51", "2025-W52", "2026-W01", "2026-W02",
  ]);
});

test("Team timeline keeps unknown cells empty, dedupes retries, and puts the viewer first", () => {
  const timeline = buildTeamTimeline(points, "2026-W30", "month", [
    { userId: "manager", displayName: "Morgan", isSelf: true },
    { userId: "member", displayName: "Ari", isSelf: false },
    { userId: "missing", displayName: "Sam", isSelf: false },
  ]);
  assert.deepEqual(timeline.rows.map((row) => row.displayName), ["Morgan", "Ari", "Sam"]);
  assert.equal(timeline.rows[0]?.cells[2], null);
  assert.equal(timeline.rows[0]?.cells[3]?.reliableCapacityPct, 28);
  assert.equal(timeline.rows[1]?.cells[2]?.reliableCapacityPct, 12);
  assert.equal(timeline.rows[1]?.cells[2]?.reviewedBlocks, 7);
  assert.equal(timeline.rows[1]?.cells[3], null);
  assert.deepEqual(timeline.rows[2]?.cells, [null, null, null, null]);
});
