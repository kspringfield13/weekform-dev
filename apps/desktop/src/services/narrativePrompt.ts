import type {
  ActivitySession,
  OutlookCalendarEvent,
  UserCorrection,
  VisualContextInsight,
  WeeklyCapacitySnapshot,
  WorkBlock
} from "../../../../packages/domain/src/models";
import {
  externalSafeCorrections,
  externalSafeWorkBlock,
} from "../../../../packages/inference/src/externalWorkBlock";
import { summarizeSessionForPrompt, summarizeVisualInsightForPrompt } from "./promptSummaries";

export const NARRATIVE_PROMPT_VERSION = "weekform-weekly-narrative-v7";

/**
 * Compact AI-usage digest for the narrative prompt. Supplied ONLY when the
 * user's "include AI usage in manager summaries" toggle is on — the generated
 * narrative is manager-facing, so the toggle gates the prompt itself and token
 * totals never reach the provider otherwise.
 */
export interface NarrativePromptUsageContext {
  measured_tokens: number;
  measured_prompts: number;
  /** Observed assistant-session minutes — an on-device estimate, never a measurement. */
  observed_session_minutes: number;
  estimated_cost_usd: number | null;
  top_models: string[];
}

function sortByStartTime<T extends { start_time: string }>(items: T[]) {
  return [...items].sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime());
}

function summarizeBlock(block: WorkBlock) {
  return {
    id: block.work_block_id,
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
    evidence: block.evidence
  };
}

function summarizeCalendarEvent(event: OutlookCalendarEvent) {
  return {
    id: event.calendar_event_id,
    title: event.title,
    start_time: event.start_time,
    end_time: event.end_time,
    organizer: event.organizer,
    attendee_count: event.attendee_count
  };
}

function summarizeCorrection(correction: UserCorrection) {
  return {
    field: correction.field,
    work_block_id: correction.work_block_id,
    old_value: correction.old_value,
    new_value: correction.new_value,
    timestamp: correction.timestamp,
    reason: correction.reason
  };
}

export function buildWeeklyNarrativePrompt({
  weekId,
  weekRangeLabel,
  snapshot,
  blocks,
  activeWindowSessions,
  calendarEvents,
  visualContextInsights,
  corrections,
  usageContext
}: {
  weekId: string;
  weekRangeLabel: string;
  snapshot: WeeklyCapacitySnapshot;
  blocks: WorkBlock[];
  activeWindowSessions: ActivitySession[];
  calendarEvents: OutlookCalendarEvent[];
  visualContextInsights: VisualContextInsight[];
  corrections: UserCorrection[];
  usageContext?: NarrativePromptUsageContext | null;
}) {
  const verifiedCount = blocks.filter((block) => block.user_verified).length;
  const unverifiedCount = blocks.length - verifiedCount;
  const safeCorrections = externalSafeCorrections(corrections, blocks);
  const recentCorrections = [...safeCorrections]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 30);
  const context = {
    product: "Weekform",
    prompt_version: NARRATIVE_PROMPT_VERSION,
    objective:
      "Generate a weekly workload narrative for an analyst using local ledger, daily review, and weekly capacity context.",
    audience: {
      analyst_view: "Helps the analyst prepare for planning and 1:1 conversations.",
      manager_ready_view:
        "A personal status update written in the user's own voice that can be shared directly with their manager."
    },
    guardrails: [
      "Do not imply surveillance, performance scoring, or perfect time tracking.",
      `Use "${weekRangeLabel}" when a date reference helps the body copy. Keep the headline date-free. The ISO week_id "${weekId}" is internal metadata only; never quote it in headline, summary_text, key_drivers, or manager_ready_summary.`,
      "Separate observed evidence from inference.",
      "Do not expose raw private data beyond what is needed to explain workload patterns.",
      "If visual context is sensitive or low-confidence, summarize the work pattern without exposing specific sensitive content.",
      "Keep confidence, missing-review, and classification caveats in summary_text or key_drivers only; never put them in manager_ready_summary."
    ],
    analyst_view_guidance: [
      "Use percentages of a standard 40-hour week when they help explain the internal workload assessment.",
      "Mention low confidence or missing review when it materially affects trust.",
      "If the week has sessions but no reviewed work blocks, say the model has signal but limited classification confidence."
    ],
    manager_ready_view_guidance: [
      "Write in first person as if the user wrote the update themselves. Use I, my, and me naturally.",
      "Do not refer to the writer as the user, analyst, employee, or they.",
      "Focus on concrete projects, tasks, deliverables, progress, interruptions, blockers, decisions, and next steps.",
      "Translate workload patterns into plain workplace language. For example, say an urgent request pulled time from a project instead of saying reactive load displaced planned capacity.",
      "Do not mention confidence, evidence, classification, tracking, captured activity, work blocks, sessions, the model, the app, estimates, utilization knees, review status, or data quality.",
      "Do not use internal product language such as reliable capacity, allocated capacity, fragmentation score, reactive load, or standard 40-hour baseline.",
      "Avoid percentages and productivity scoring. Describe remaining room or constraints conversationally and only when useful.",
      "Do not add a greeting, sign-off, label, or meta-commentary. Return only the update paragraph."
    ],
    reflection_questions_to_answer: [
      "What projects or workstreams did the analyst appear focused on this week?",
      "What made the week productive, difficult, or unusual?",
      "What displaced planned work, if anything?",
      "Was the analyst busy or near full capacity based on the available evidence?",
      "Is there reliable capacity for additional planned projects next week?"
    ],
    required_output: {
      week_id: "string",
      headline: `One short, work-centered title sentence under 90 characters. Emphasize a project, task, accomplishment, interruption, or blocker. Avoid confidence, model, app, tracking, classification, and technical capacity terminology. Do not include dates, the display range "${weekRangeLabel}", or the ISO week id.`,
      summary_text:
        "Analyst-facing paragraph, 5 to 8 sentences. Describe what the analyst worked on, likely projects/workstreams, what went well or created friction, what displaced planned work, whether the week looked busy or under-classified, and whether additional project capacity looks realistic. Include planned vs reactive, meetings/recurring load, fragmented/deep work, and confidence caveats when relevant.",
      key_drivers:
        "4 to 7 concise bullets as strings. Make them descriptive enough for 1:1 prep, and do not include the ISO week id.",
      manager_ready_summary:
        "A polished first-person update, 4 to 6 sentences, written as if the user wrote it for their manager. Lead with the projects, tasks, or deliverables that moved forward; then cover meaningful interruptions or blockers and the next priority or realistic room for additional work. Use plain, personal workplace language and specific project names when supported. Never mention confidence, evidence, tracking, classification, sessions, work blocks, models, estimates, app mechanics, technical capacity terminology, review caveats, or the ISO week id."
    },
    week: {
      internal_week_id: weekId,
      display_range: weekRangeLabel,
      baseline: "100% = standard 40-hour work week"
    },
    weekly_capacity_snapshot: snapshot,
    daily_review_context: {
      total_blocks: blocks.length,
      verified_blocks: verifiedCount,
      unverified_blocks: unverifiedCount,
      correction_count: safeCorrections.length,
      recent_corrections: recentCorrections.map(summarizeCorrection)
    },
    ledger_context: {
      work_blocks: sortByStartTime(blocks).map(externalSafeWorkBlock).map(summarizeBlock),
      active_window_sessions: sortByStartTime(activeWindowSessions).map(summarizeSessionForPrompt),
      outlook_calendar_events: sortByStartTime(calendarEvents).map(summarizeCalendarEvent),
      // Flagged captures (sensitive_content_detected) await user review/purge in the
      // Flagged Captures queue and must never leave the device in an AI payload before
      // then — mirror the Agent tool's guard (agentTools.ts) so this path can't transmit
      // an unreviewed sensitive insight's derived summary/evidence/project hint. `.filter`
      // returns a fresh array, so the following `.sort` no longer needs a spread copy.
      visual_context_insights: visualContextInsights
        .filter((insight) => !insight.sensitive_content_detected)
        .sort((left, right) => new Date(left.captured_at).getTime() - new Date(right.captured_at).getTime())
        .map(summarizeVisualInsightForPrompt)
    },
    // Present only when the user opted AI usage into manager-facing output.
    ...(usageContext
      ? {
          ai_usage_context: usageContext,
          ai_usage_guidance: [
            "The user opted in to mentioning AI-assistance usage. Weave ONE brief sentence about it into manager_ready_summary, framed as leverage (what it helped accomplish), not as raw consumption.",
            "measured_tokens/measured_prompts are measured; observed_session_minutes is an on-device estimate — if mentioned, keep it clearly approximate.",
            "Do not quote token counts verbatim in manager_ready_summary; round or describe them naturally (e.g. 'used AI assistance heavily on the modeling work')."
          ]
        }
      : {})
  };

  return [
    "Generate the Weekform weekly narrative from this structured context.",
    "Return strict JSON only. Do not include markdown.",
    JSON.stringify(context, null, 2)
  ].join("\n\n");
}
