import type {
  ActivitySession,
  OutlookCalendarEvent,
  UserCorrection,
  WeeklyCapacitySnapshot,
  WorkBlock
} from "../../../../packages/domain/src/models";
import { summarizeSessionForPrompt } from "./promptSummaries";

export const FORECAST_AGENT_PROMPT_VERSION = "clear-capacity-forecast-agent-v2";

function sortByStartTime<T extends { start_time: string }>(items: T[]) {
  return [...items].sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime());
}

function summarizeBlock(block: WorkBlock) {
  return {
    work_block_id: block.work_block_id,
    start_time: block.start_time,
    end_time: block.end_time,
    capacity_pct: Math.round(block.estimated_capacity_pct),
    category: block.category,
    mode: block.mode,
    planned_status: block.planned_status,
    project_name: block.project_name,
    stakeholder_group: block.stakeholder_group,
    confidence: block.confidence,
    user_verified: block.user_verified,
    blocker_flag: block.blocker_flag,
    notes: block.notes
  };
}

function summarizeCalendarEvent(event: OutlookCalendarEvent) {
  return {
    calendar_event_id: event.calendar_event_id,
    title: event.title,
    start_time: event.start_time,
    end_time: event.end_time,
    organizer: event.organizer,
    attendee_count: event.attendee_count,
    location: event.location
  };
}

function summarizeCorrection(correction: UserCorrection) {
  return {
    work_block_id: correction.work_block_id,
    field: correction.field,
    old_value: correction.old_value,
    new_value: correction.new_value,
    reason: correction.reason,
    timestamp: correction.timestamp
  };
}

export function buildForecastAgentPrompt({
  currentWeekId,
  currentWeekRangeLabel,
  nextWeekId,
  nextWeekRangeLabel,
  snapshot,
  blocks,
  activeWindowSessions,
  calendarEvents,
  corrections
}: {
  currentWeekId: string;
  currentWeekRangeLabel: string;
  nextWeekId: string;
  nextWeekRangeLabel: string;
  snapshot: WeeklyCapacitySnapshot;
  blocks: WorkBlock[];
  activeWindowSessions: ActivitySession[];
  calendarEvents: OutlookCalendarEvent[];
  corrections: UserCorrection[];
}) {
  const recentCorrections = [...corrections]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 50);
  const context = {
    product: "ClearCapacity",
    prompt_version: FORECAST_AGENT_PROMPT_VERSION,
    objective:
      "Forecast next week's reliable new-work capacity for an analyst using current-week capacity, local work evidence, review status, and calendar context.",
    guardrails: [
      "This is a planning estimate, not a productivity score or time-tracking claim.",
      "Use percentages of a standard 40-hour week.",
      "Do not present remaining capacity as 100% minus visible allocations.",
      "Explain constraints and assumptions clearly.",
      "Be conservative when blocks are unverified, confidence is low, meetings are dense, or reactive work is elevated.",
      "Return practical planning guidance the analyst can use in a 1:1 or weekly planning conversation."
    ],
    current_week: {
      week_id: currentWeekId,
      display_range: currentWeekRangeLabel
    },
    forecast_week: {
      week_id: nextWeekId,
      display_range: nextWeekRangeLabel
    },
    weekly_capacity_snapshot: snapshot,
    current_work_blocks: sortByStartTime(blocks).map(summarizeBlock),
    active_window_sessions: sortByStartTime(activeWindowSessions).map(summarizeSessionForPrompt),
    outlook_calendar_events: sortByStartTime(calendarEvents).map(summarizeCalendarEvent),
    recent_user_corrections: recentCorrections.map(summarizeCorrection),
    output_rules: {
      reliable_new_work_capacity_pct:
        "Primary planning estimate for the forecast week. Clamp to 0-40%. Do not treat it as free time.",
      scenarios:
        "Provide conservative, likely, and optimistic percentages. Keep conservative <= likely <= optimistic.",
      recommendations:
        "Recommend concrete planning actions such as protecting deep work, limiting new intake, clarifying carryover, or shifting meetings."
    }
  };

  return [
    "Generate the ClearCapacity Forecast Agent result from this structured context.",
    "Return strict JSON only. Do not include markdown.",
    JSON.stringify(context, null, 2)
  ].join("\n\n");
}
