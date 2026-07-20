import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarEvent } from "../../../domain/src/models";
import {
  calendarEventsToWorkBlocks,
  createCalendarImport,
  filterCalendarEventsByRange,
  normalizeCalendarRange,
  reconcileCalendarEvents,
  mergeCalendarWorkBlocks,
} from "./calendarSync";

function event(
  id: string,
  source: CalendarEvent["source"],
  start: string,
  end: string,
  title = id,
): CalendarEvent {
  return {
    calendar_event_id: id,
    uid: id,
    title,
    start_time: start,
    end_time: end,
    location: null,
    organizer: null,
    attendee_count: 0,
    source,
    imported_at: "2026-07-20T12:00:00.000Z",
  };
}

test("normalizeCalendarRange makes the selected end date inclusive and rejects unbounded imports", () => {
  const range = normalizeCalendarRange({ start_date: "2026-07-14", end_date: "2026-07-20" });
  assert.equal(range.start_date, "2026-07-14");
  assert.equal(range.end_date, "2026-07-20");
  assert.equal(new Date(range.end_exclusive).getTime() - new Date(range.start).getTime(), 7 * 86_400_000);
  assert.throws(
    () => normalizeCalendarRange({ start_date: "2025-01-01", end_date: "2026-07-20" }),
    /366 days/,
  );
});

test("filterCalendarEventsByRange keeps events that overlap either edge of the selected dates", () => {
  const range = normalizeCalendarRange({ start_date: "2026-07-14", end_date: "2026-07-20" });
  const rangeStart = new Date(range.start).getTime();
  const rangeEnd = new Date(range.end_exclusive).getTime();
  const iso = (value: number) => new Date(value).toISOString();
  const events = [
    event("before", "google_calendar", iso(rangeStart - 7_200_000), iso(rangeStart - 3_600_000)),
    event("cross-start", "google_calendar", iso(rangeStart - 1_800_000), iso(rangeStart + 1_800_000)),
    event("cross-end", "google_calendar", iso(rangeEnd - 1_800_000), iso(rangeEnd + 1_800_000)),
    event("after", "google_calendar", iso(rangeEnd + 3_600_000), iso(rangeEnd + 7_200_000)),
  ];
  assert.deepEqual(filterCalendarEventsByRange(events, range).map((item) => item.calendar_event_id), [
    "cross-start",
    "cross-end",
  ]);
});

test("provider-labelled ICS imports cannot collide when the same UID appears in two calendars", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:shared-uid@example.test",
    "DTSTART:20260720T140000Z",
    "DTEND:20260720T150000Z",
    "SUMMARY:Synthetic planning review",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const range = normalizeCalendarRange({ start_date: "2026-07-20", end_date: "2026-07-20" });
  const google = createCalendarImport("google", ics, range, "2026-07-20T16:00:00.000Z");
  const apple = createCalendarImport("apple", ics, range, "2026-07-20T16:00:00.000Z");
  assert.equal(google.length, 1);
  assert.equal(apple.length, 1);
  assert.notEqual(google[0].calendar_event_id, apple[0].calendar_event_id);
  assert.equal(google[0].source, "google_calendar");
  assert.equal(apple[0].source, "apple_calendar");
});

test("live reconciliation removes stale events only for that provider and selected range", () => {
  const range = normalizeCalendarRange({ start_date: "2026-07-14", end_date: "2026-07-20" });
  const current = [
    event("google-stale", "google_calendar", "2026-07-15T14:00:00.000Z", "2026-07-15T15:00:00.000Z"),
    event("google-outside", "google_calendar", "2026-07-22T14:00:00.000Z", "2026-07-22T15:00:00.000Z"),
    event("apple-kept", "apple_calendar", "2026-07-15T14:00:00.000Z", "2026-07-15T15:00:00.000Z"),
  ];
  const incoming = [
    event("google-new", "google_calendar", "2026-07-16T14:00:00.000Z", "2026-07-16T15:00:00.000Z"),
  ];
  const result = reconcileCalendarEvents(current, incoming, {
    provider: "google",
    range,
    mode: "live_sync",
  });
  assert.deepEqual(result.events.map((item) => item.calendar_event_id), [
    "apple-kept",
    "google-new",
    "google-outside",
  ]);
  assert.deepEqual(result.delta, { added: 1, updated: 0, unchanged: 0, removed: 1 });
});

test("all providers feed the same workload model while retaining source truth in evidence", () => {
  const blocks = calendarEventsToWorkBlocks([
    event("outlook-live-1", "outlook_calendar", "2026-07-20T14:00:00.000Z", "2026-07-20T15:00:00.000Z"),
    event("google-live-1", "google_calendar", "2026-07-20T15:00:00.000Z", "2026-07-20T16:00:00.000Z"),
    event("apple-live-1", "apple_calendar", "2026-07-20T16:00:00.000Z", "2026-07-20T17:00:00.000Z"),
  ], "2026-W30");
  assert.deepEqual(blocks.map((block) => block.estimated_capacity_pct), [3, 3, 3]);
  assert.match(blocks[0].evidence[0], /Outlook Calendar/);
  assert.match(blocks[1].evidence[0], /Google Calendar/);
  assert.match(blocks[2].evidence[0], /Apple Calendar/);
});

test("calendar refresh preserves reviewed truth while updating provider-owned timing", () => {
  const original = event("google-live-2", "google_calendar", "2026-07-20T14:00:00.000Z", "2026-07-20T15:00:00.000Z", "Original title");
  const reviewed = calendarEventsToWorkBlocks([original], "2026-W30")[0];
  reviewed.work_block_id = "calendar-custom-legacy-id";
  reviewed.user_verified = true;
  reviewed.category = "Planned analysis / project work";
  reviewed.project_name = "My reviewed project";
  reviewed.notes = "Keep this correction";
  const moved = event("google-live-2", "google_calendar", "2026-07-20T16:00:00.000Z", "2026-07-20T17:30:00.000Z", "Provider changed title");
  const merged = mergeCalendarWorkBlocks([reviewed], [moved], "2026-W30");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].start_time, moved.start_time);
  assert.equal(merged[0].estimated_capacity_pct, 4);
  assert.equal(merged[0].category, "Planned analysis / project work");
  assert.equal(merged[0].project_name, "My reviewed project");
  assert.equal(merged[0].notes, "Keep this correction");
  assert.equal(merged[0].user_verified, true);
});
