import type {
  ActivitySession,
  OutlookCalendarEvent,
  UserCorrection,
  WeeklyCapacitySnapshot,
  WorkBlock
} from "../../../../packages/domain/src/models";
import { plannedStatuses, workCategories, workModes } from "../../../../packages/domain/src/taxonomy";
import {
  externalSafeCorrections,
  externalSafeWorkBlock,
} from "../../../../packages/inference/src/externalWorkBlock";
import { summarizeSessionForPrompt } from "./promptSummaries";

export const REVIEW_COPILOT_PROMPT_VERSION = "weekform-review-copilot-v3";

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
    notes: block.notes,
    derived_from: block.derived_from,
    evidence: block.evidence
  };
}

function summarizeCalendarEvent(event: OutlookCalendarEvent) {
  return {
    calendar_event_id: event.calendar_event_id,
    title: event.title,
    start_time: event.start_time,
    end_time: event.end_time,
    organizer: event.organizer,
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

export function buildReviewCopilotPrompt({
  weekId,
  weekRangeLabel,
  snapshot,
  reviewQueue,
  allBlocks,
  activeWindowSessions,
  calendarEvents,
  corrections
}: {
  weekId: string;
  weekRangeLabel: string;
  snapshot: WeeklyCapacitySnapshot;
  reviewQueue: WorkBlock[];
  allBlocks: WorkBlock[];
  activeWindowSessions: ActivitySession[];
  calendarEvents: OutlookCalendarEvent[];
  corrections: UserCorrection[];
}) {
  const recentCorrections = externalSafeCorrections(corrections, allBlocks)
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 50);
  const context = {
    product: "Weekform",
    prompt_version: REVIEW_COPILOT_PROMPT_VERSION,
    objective:
      "Suggest safe, reviewable actions that help the analyst clean up today's unverified work blocks quickly.",
    guardrails: [
      "Do not silently modify data. Suggestions are user-approved.",
      "Use only the supplied local ledger, review, session, calendar, correction, and capacity context.",
      "Prefer high-signal suggestions over many weak suggestions.",
      "Use confirm only when the block looks coherent and confidence is already strong.",
      "Use relabel when taxonomy labels appear inconsistent with evidence.",
      "Use merge or split only as a recommendation; the app may keep it as a note.",
      "Use exclude only when evidence suggests private, irrelevant, or non-work activity.",
      "Do not invent stakeholders, projects, or sensitive details."
    ],
    taxonomy: {
      categories: workCategories,
      modes: workModes,
      planned_statuses: plannedStatuses
    },
    week: {
      week_id: weekId,
      display_range: weekRangeLabel
    },
    weekly_capacity_snapshot: snapshot,
    review_queue: sortByStartTime(reviewQueue).map(externalSafeWorkBlock).map(summarizeBlock),
    all_work_blocks: sortByStartTime(allBlocks).map(externalSafeWorkBlock).map(summarizeBlock),
    active_window_sessions: sortByStartTime(activeWindowSessions).map(summarizeSessionForPrompt),
    outlook_calendar_events: sortByStartTime(calendarEvents).map(summarizeCalendarEvent),
    recent_user_corrections: recentCorrections.map(summarizeCorrection),
    output_rules: {
      max_suggestions: 8,
      proposed_fields:
        "For confirm/exclude/merge/split/note, proposed taxonomy fields may be null. For relabel, include only fields that should change.",
      confidence:
        "Use 0.55 to 0.72 for weak suggestions, 0.73 to 0.86 for useful likely suggestions, and 0.87+ only for obvious cleanup."
    }
  };

  return [
    "Generate Weekform Daily Review Copilot suggestions from this structured context.",
    "Return strict JSON only. Do not include markdown.",
    JSON.stringify(context, null, 2)
  ].join("\n\n");
}
