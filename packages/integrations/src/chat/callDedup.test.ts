import assert from "node:assert/strict";
import test from "node:test";

import type { WorkBlock } from "../../../domain/src/models";
import { calendarEventsToWorkBlocks } from "../calendar/calendarSync";
import { dedupeChatCallsAgainstCalendar } from "./callDedup";

function meetingBlock(
  id: string,
  start: string,
  end: string,
  derivedFrom: string,
  evidence: string,
): WorkBlock {
  return {
    work_block_id: id,
    week_id: "2026-W30",
    start_time: start,
    end_time: end,
    estimated_capacity_pct: 2,
    category: "Meetings / stakeholder syncs",
    mode: "Collaborative",
    planned_status: "fixed",
    project_name: "Synthetic meeting",
    stakeholder_group: "Synthetic collaborators",
    derived_from: [derivedFrom],
    evidence: [evidence],
    confidence: 0.8,
    user_verified: false,
    blocker_flag: false,
    notes: null,
  };
}

test("chat-call dedup ignores overlapping meeting blocks without calendar provenance", () => {
  const chatCall = meetingBlock(
    "imported-chat-call",
    "2026-07-20T14:00:00.000Z",
    "2026-07-20T15:00:00.000Z",
    "chat-call-slack-2026-07-20T14:00:00.000Z",
    "Imported from workplace chat source",
  );
  const manuallyEnteredMeeting = meetingBlock(
    "manual-meeting",
    "2026-07-20T14:00:00.000Z",
    "2026-07-20T15:00:00.000Z",
    "manual-meeting-source",
    "Entered manually",
  );

  const result = dedupeChatCallsAgainstCalendar([chatCall], [manuallyEnteredMeeting]);

  assert.deepEqual(result.kept.map((block) => block.work_block_id), ["imported-chat-call"]);
  assert.deepEqual(result.deduped, []);
});

test("chat-call dedup removes a call when a calendar-provenance meeting covers it", () => {
  const chatCall = meetingBlock(
    "imported-chat-call",
    "2026-07-20T14:00:00.000Z",
    "2026-07-20T15:00:00.000Z",
    "chat-call-slack-2026-07-20T14:00:00.000Z",
    "Imported from workplace chat source",
  );
  const calendarMeeting = calendarEventsToWorkBlocks([
    {
      calendar_event_id: "google_calendar-synthetic-event",
      uid: "synthetic-event",
      title: "Synthetic calendar meeting",
      start_time: "2026-07-20T13:55:00.000Z",
      end_time: "2026-07-20T15:05:00.000Z",
      location: null,
      organizer: null,
      attendee_count: 2,
      source: "google_calendar",
      imported_at: "2026-07-20T12:00:00.000Z",
    },
  ], "2026-W30")[0];

  const result = dedupeChatCallsAgainstCalendar([chatCall], [calendarMeeting]);

  assert.deepEqual(result.kept, []);
  assert.deepEqual(result.deduped.map((block) => block.work_block_id), ["imported-chat-call"]);
});
