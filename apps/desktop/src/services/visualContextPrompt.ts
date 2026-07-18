import type { ActivitySession } from "../../../../packages/domain/src/models";
import { workCategories, workModes } from "../../../../packages/domain/src/taxonomy";

export const VISUAL_CONTEXT_PROMPT_VERSION = "clear-capacity-visual-context-v1";

export function buildVisualContextPrompt({
  session,
  captureCountToday,
  maxDailyCaptures
}: {
  session: ActivitySession;
  captureCountToday: number;
  maxDailyCaptures: number;
}) {
  const context = {
    product: "ClearCapacity",
    prompt_version: VISUAL_CONTEXT_PROMPT_VERSION,
    objective:
      "Analyze a consented screenshot to derive a privacy-conscious visual context insight for analyst workload classification.",
    capture_policy: {
      mode: "Smart Occasional Capture",
      raw_screenshot_retention: "deleted immediately after derived insight",
      capture_count_today: captureCountToday,
      max_daily_captures: maxDailyCaptures
    },
    active_window_session: {
      session_id: session.session_id,
      start_time: session.start_time,
      end_time: session.end_time,
      app_name: session.app_name,
      window_title: session.window_title,
      duration_minutes: session.duration_minutes,
      sample_count: session.sample_count,
      evidence: session.evidence
    },
    taxonomy: {
      categories: workCategories,
      modes: workModes
    },
    guardrails: [
      "Summarize what work appears to be happening without transcribing sensitive details.",
      "Do not extract secrets, personal messages, credentials, medical, financial, or HR details.",
      "If sensitive content appears visible, set sensitive_content_detected to true and keep the summary generic.",
      "Use null for category, mode, project, or tool when the screenshot is ambiguous.",
      "Prefer concise evidence based on visual structure and app UI, not private content."
    ],
    output_rules: {
      activity_summary: "One sentence about the likely work activity.",
      visible_tool: "A product/app/tool name if visually apparent, otherwise null.",
      confidence: "0 to 1 based on visual clarity and match with active-window metadata.",
      evidence: "2 to 5 short strings explaining the insight."
    }
  };

  return [
    "Generate a ClearCapacity Visual Context insight from the screenshot and metadata.",
    "Return strict JSON only. Do not include markdown.",
    JSON.stringify(context, null, 2)
  ].join("\n\n");
}
