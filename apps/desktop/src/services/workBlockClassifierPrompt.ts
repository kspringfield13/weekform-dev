import type {
  ActivitySession,
  OutlookCalendarEvent,
  UserCorrection,
  VisualContextInsight,
  WorkBlock
} from "../../../../packages/domain/src/models";
import { plannedStatuses, workCategories, workModes } from "../../../../packages/domain/src/taxonomy";
import { analyzeCorrections } from "../../../../packages/inference/src/capacity";
import { summarizeSessionForPrompt, summarizeVisualInsightForPrompt } from "./promptSummaries";

export const WORK_BLOCK_CLASSIFIER_PROMPT_VERSION = "clear-capacity-work-block-classifier-v4";

// How many systematic biases to surface as few-shot relabel hints. The analysis
// already sorts by frequency and applies a repeat threshold, so the top handful are
// the strongest, most reliable patterns.
const MAX_LEARNED_LABEL_HINTS = 8;

function sortByStartTime<T extends { start_time: string }>(items: T[]) {
  return [...items].sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime());
}

function summarizeExistingBlock(block: WorkBlock) {
  return {
    work_block_id: block.work_block_id,
    start_time: block.start_time,
    end_time: block.end_time,
    category: block.category,
    mode: block.mode,
    planned_status: block.planned_status,
    project_name: block.project_name,
    stakeholder_group: block.stakeholder_group,
    derived_from: block.derived_from,
    user_verified: block.user_verified
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
    field: correction.field,
    old_value: correction.old_value,
    new_value: correction.new_value,
    reason: correction.reason,
    timestamp: correction.timestamp
  };
}

export function buildWorkBlockClassifierPrompt({
  weekId,
  weekRangeLabel,
  sessions,
  visualContextInsights,
  existingBlocks,
  calendarEvents,
  corrections
}: {
  weekId: string;
  weekRangeLabel: string;
  sessions: ActivitySession[];
  visualContextInsights: VisualContextInsight[];
  existingBlocks: WorkBlock[];
  calendarEvents: OutlookCalendarEvent[];
  corrections: UserCorrection[];
}) {
  const recentCorrections = [...corrections]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 40);

  // Distill the user's correction history into the strongest systematic relabels and
  // present them as explicit pre-apply hints. These carry only taxonomy/label values
  // (category, mode, planned status, stakeholder, blocker) — never titles or app names.
  const learnedLabelCorrections = analyzeCorrections(corrections)
    .biases.slice(0, MAX_LEARNED_LABEL_HINTS)
    .map((bias) => ({
      field: bias.field,
      relabel_from: bias.from_value,
      relabel_to: bias.to_value,
      times_corrected: bias.count,
      instruction: `The user consistently relabels ${bias.field} "${bias.from_value}" as "${bias.to_value}" (${bias.count}×). When a session's evidence fits this pattern, assign "${bias.to_value}" directly and note the learned preference in the evidence.`,
    }));

  const context = {
    product: "ClearCapacity",
    prompt_version: WORK_BLOCK_CLASSIFIER_PROMPT_VERSION,
    objective:
      "Convert active-window sessions into explainable draft work blocks for an analyst workload ledger. Use evidence from app names, calendar, and derived visual context. Be precise with categories.",
    guardrails: [
      "Classify only the provided active-window sessions.",
      "Do not create blocks for Outlook meetings; those are imported separately.",
      "Merge adjacent or related sessions when they appear to represent one coherent task.",
      "Every provided session has already passed the product's readiness threshold and should normally be assigned to a work block.",
      "Short duration alone is not a reason to omit a session; merge short fragments with related work when possible.",
      "When evidence is ambiguous, create a conservative generic block with lower confidence instead of returning no block.",
      "If input_sessions is non-empty, return at least one work block.",
      "Keep blocks draft-quality: confidence should reflect uncertainty.",
      "Use generic labels when app/window evidence is ambiguous.",
      "Never infer sensitive content beyond the provided derived app metadata.",
      "Omit a session only when the metadata clearly represents non-work system noise such as a lock screen or blank desktop."
    ],
    taxonomy: {
      categories: workCategories,
      work_modes: workModes,
      planned_statuses: plannedStatuses
    },
    week: {
      week_id: weekId,
      display_range: weekRangeLabel,
      baseline: "100% = standard 40-hour work week"
    },
    input_sessions: sortByStartTime(sessions).map(summarizeSessionForPrompt),
    visual_context_insights: visualContextInsights
      .filter((insight) => insight.session_id && sessions.some((session) => session.session_id === insight.session_id))
      .map(summarizeVisualInsightForPrompt),
    existing_work_blocks: sortByStartTime(existingBlocks).map(summarizeExistingBlock),
    outlook_calendar_context: sortByStartTime(calendarEvents).map(summarizeCalendarEvent),
    recent_user_corrections: recentCorrections.map(summarizeCorrection),
    learned_label_corrections: learnedLabelCorrections,
    output_rules: {
      learned_label_corrections:
        "learned_label_corrections lists relabels the user makes repeatedly. When a session's evidence would otherwise yield a `relabel_from` value, prefer the matching `relabel_to` value for that field and cite the learned preference in evidence. Only apply when the evidence genuinely fits — never override clear contradicting evidence.",
      session_ids:
        "Every output work block must copy exact session_id values from input_sessions. Never invent or rewrite an ID. Use each session at most once.",
      title:
        "project_name should be a short human-readable task label, not merely the app name unless the evidence is ambiguous.",
      stakeholder:
        "stakeholder_group may be a team/function when visible, otherwise use Local activity, Personal workflow, or Unknown stakeholder.",
      evidence:
        "Provide 2 to 5 short evidence strings that explain the classification from visible metadata.",
      confidence:
        "Use 0.55 to 0.70 for ambiguous app-only evidence, 0.70 to 0.84 for plausible title/app matches, and 0.85+ only for very clear evidence."
    }
  };

  return [
    "Classify these ClearCapacity active-window sessions into draft work blocks.",
    "Return strict JSON only. Do not include markdown.",
    JSON.stringify(context, null, 2)
  ].join("\n\n");
}
