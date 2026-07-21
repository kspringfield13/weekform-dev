import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTeamCalendar,
  buildTeamCalendarWeeks,
  buildTeamTimelineCapacityForecast,
  buildTeamTimeline,
  teamTimelineCalendarDays,
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

test("Team calendar keeps the existing zoom settings while adding daily history and a forecast week", () => {
  const week = teamTimelineCalendarDays("2026-07-20T12:00:00.000Z", "week");
  const month = teamTimelineCalendarDays("2026-07-20T12:00:00.000Z", "month");
  const quarter = teamTimelineCalendarDays("2026-07-20T12:00:00.000Z", "quarter");

  assert.equal(week.length, 14);
  assert.equal(month.length, 35);
  assert.equal(quarter.length, 98);
  assert.equal(week[0]?.dateId, "2026-07-14");
  assert.equal(week[6]?.kind, "today");
  assert.equal(week[7]?.kind, "forecast");
  assert.equal(week.at(-1)?.dateId, "2026-07-27");
  assert.equal(month.filter((day) => day.kind === "forecast").length, 7);
});

test("Team calendar turns weekly snapshots into honest week-span bars without extending history past today", () => {
  const calendar = buildTeamCalendar(
    points,
    "2026-07-20T12:00:00.000Z",
    "month",
    [
      { userId: "manager", displayName: "Morgan", isSelf: true },
      { userId: "member", displayName: "Ari", isSelf: false },
    ],
  );

  assert.equal(calendar.todayIndex, 27);
  assert.deepEqual(calendar.rows.map((row) => row.displayName), ["Morgan", "Ari"]);
  assert.equal(calendar.rows[0]?.bars[0]?.point.weekId, "2026-W30");
  assert.equal(calendar.rows[0]?.bars[0]?.spanDays, 1);
  assert.equal(calendar.rows[1]?.bars[0]?.point.weekId, "2026-W29");
  assert.equal(calendar.rows[1]?.bars[0]?.spanDays, 7);
  assert.equal(calendar.rows[1]?.bars[0]?.point.reviewedBlocks, 7);
});

test("Team calendar projects the rolling horizon into Monday-first visual week rows", () => {
  const weeks = buildTeamCalendarWeeks(buildTeamCalendar(
    points,
    "2026-07-20T12:00:00.000Z",
    "month",
    [
      { userId: "manager", displayName: "Morgan", isSelf: true },
      { userId: "member", displayName: "Ari", isSelf: false },
    ],
  ));

  assert.equal(weeks.length, 6);
  assert.equal(weeks[0]?.weekId, "2026-W26");
  assert.equal(weeks[0]?.days[0], null);
  assert.equal(weeks[0]?.days[1]?.dateId, "2026-06-23");
  assert.equal(weeks[4]?.days[0]?.kind, "today");
  assert.equal(weeks[4]?.hasToday, true);
  assert.equal(weeks[4]?.hasForecast, true);
  assert.equal(weeks[5]?.days[0]?.kind, "forecast");
});

test("Team calendar week analytics use medians, preserve unknowns, and expose review coverage", () => {
  const weeks = buildTeamCalendarWeeks(buildTeamCalendar(
    points,
    "2026-07-20T12:00:00.000Z",
    "month",
    [
      { userId: "manager", displayName: "Morgan", isSelf: true },
      { userId: "member", displayName: "Ari", isSelf: false },
    ],
  ));
  const week29 = weeks.find((week) => week.weekId === "2026-W29");
  const week28 = weeks.find((week) => week.weekId === "2026-W28");

  assert.equal(week29?.sharedCount, 1);
  assert.equal(week29?.reliableCapacityPct, 12);
  assert.equal(week29?.reactivePct, 33);
  assert.equal(week29?.fragmentedPct, null);
  assert.equal(week29?.reviewedBlocks, 7);
  assert.equal(week29?.eligibleBlocks, 8);
  assert.equal(week28?.reliableCapacityPct, null);
  assert.equal(week28?.sharedCount, 0);
});

test("Team calendar forecast uses team weekly medians and withholds low-coverage predictions", () => {
  const baseline = points[0];
  assert.ok(baseline);
  const current = points.concat([
    {
      ...baseline,
      userId: "member",
      displayName: "Ari",
      reliableCapacityPct: 42,
      syncedAt: "2026-07-20T19:00:00.000Z",
    },
    {
      ...baseline,
      weekId: "2026-W29",
      reliableCapacityPct: 32,
      syncedAt: "2026-07-13T19:00:00.000Z",
    },
  ]);
  const forecast = buildTeamTimelineCapacityForecast(current, 2, "2026-07-20T20:00:00.000Z");

  assert.equal(forecast.verdict, "forecast");
  assert.equal(forecast.sharedCount, 2);
  assert.equal(forecast.median, 28.5);
  assert.equal(forecast.min, 22);
  assert.equal(forecast.max, 35);
  assert.equal(forecast.weekCount, 2);

  const withheld = buildTeamTimelineCapacityForecast(current, 5, "2026-07-20T20:00:00.000Z");
  assert.equal(withheld.verdict, "insufficient-shared-data");
  assert.equal(withheld.median, null);
});
