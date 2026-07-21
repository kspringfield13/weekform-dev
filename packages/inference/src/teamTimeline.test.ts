import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTeamCalendar,
  buildTeamCalendarEvidence,
  defaultTeamCalendarEvidenceDate,
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

test("Team calendar evidence blends private Calendar, content-free Chat, and reviewed facts by day", () => {
  const evidence = buildTeamCalendarEvidence({
    calendarEvents: [
      { start_time: "2026-07-20T09:00:00.000Z", end_time: "2026-07-20T11:00:00.000Z", all_day: false },
      { start_time: "2026-07-20T10:30:00.000Z", end_time: "2026-07-20T12:00:00.000Z", all_day: false },
      { start_time: "2026-07-21T00:00:00.000Z", end_time: "2026-07-22T00:00:00.000Z", all_day: true },
    ],
    chatEvents: [
      { timestamp_start: "2026-07-20T12:10:00.000Z", timestamp_end: "2026-07-20T12:16:00.000Z", source_type: "chat", metadata: { directed_trigger: "true" } },
      { timestamp_start: "2026-07-20T14:00:00.000Z", timestamp_end: "2026-07-20T14:05:00.000Z", source_type: "chat", metadata: { directed_trigger: "false" } },
      { timestamp_start: "2026-07-20T15:00:00.000Z", timestamp_end: "2026-07-20T15:04:00.000Z", source_type: "window", metadata: {} },
    ],
    workBlocks: [
      { start_time: "2026-07-20T13:00:00.000Z", user_verified: true },
      { start_time: "2026-07-20T16:00:00.000Z", user_verified: false },
    ],
    timeZone: "UTC",
  });

  assert.deepEqual(evidence, [{
    dateId: "2026-07-20",
    calendarEventCount: 2,
    calendarMinutes: 180,
    chatEpisodeCount: 2,
    directedChatCount: 1,
    reviewedBlockCount: 1,
    insight: "meeting-dense",
  }]);
});

test("Team calendar evidence labels combined meeting and communication pressure without inventing missing sources", () => {
  const evidence = buildTeamCalendarEvidence({
    calendarEvents: [
      { start_time: "2026-07-20T09:00:00.000Z", end_time: "2026-07-20T12:00:00.000Z", all_day: false },
    ],
    chatEvents: Array.from({ length: 4 }, (_, index) => ({
      timestamp_start: `2026-07-20T${String(13 + index).padStart(2, "0")}:00:00.000Z`,
      timestamp_end: `2026-07-20T${String(13 + index).padStart(2, "0")}:05:00.000Z`,
      source_type: "chat" as const,
      metadata: { directed_trigger: index < 3 ? "true" : "false" },
    })),
    workBlocks: [],
    timeZone: "UTC",
  });

  assert.equal(evidence[0]?.insight, "blended-pressure");
  assert.equal(evidence[0]?.directedChatCount, 3);
  assert.equal(evidence.length, 1);
});

test("Team calendar opens on today's evidence, then falls back to the nearest useful day", () => {
  const evidence = [
    { dateId: "2026-07-18" },
    { dateId: "2026-07-20" },
    { dateId: "2026-07-22" },
  ];

  assert.equal(defaultTeamCalendarEvidenceDate(evidence, "2026-07-20T16:00:00.000Z", "UTC"), "2026-07-20");
  assert.equal(defaultTeamCalendarEvidenceDate(evidence, "2026-07-21T16:00:00.000Z", "UTC"), "2026-07-20");
  assert.equal(defaultTeamCalendarEvidenceDate([{ dateId: "2026-07-22" }], "2026-07-21T16:00:00.000Z", "UTC"), "2026-07-22");
  assert.equal(defaultTeamCalendarEvidenceDate([], "2026-07-21T16:00:00.000Z", "UTC"), null);
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
