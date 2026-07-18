import type { ActivitySession, VisualContextInsight } from "../../../../packages/domain/src/models";

/**
 * Shared, privacy-preserving summarizers for the four generation prompts
 * (forecast agent / weekly narrative / review copilot / work-block classifier).
 *
 * PRIVACY CONTRACT (hard rule, mirrors `accelerationPrompt.ts#summarizeSignal`):
 * raw window titles are sensitive and must never leave the device in an AI
 * payload — the hooks that make these calls stamp the transfer
 * `privacy_level: "derived_only"` in the audit trail, so that claim is only
 * truthful if the payload carries derived fields only.
 *
 * These helpers WHITELIST derived fields explicitly (rather than spreading the
 * domain object) so a future field addition can't silently widen what is sent.
 *
 * - `summarizeSessionForPrompt` emits app name, timing, and counts only. It
 *   deliberately drops BOTH `window_title` (raw) AND `evidence`: the sessionizer
 *   embeds the raw front-window title inside `evidence`
 *   ("Front window title: …", see `packages/inference/src/sessionizer/activeWindow.ts`),
 *   and its remaining lines only restate `app_name` + `sample_count`, which are
 *   already sent as structured fields.
 * - `summarizeVisualInsightForPrompt` keeps the model-derived `activity_summary`
 *   (and the other derived, non-raw fields) but drops the raw `window_title`.
 */
export function summarizeSessionForPrompt(session: ActivitySession) {
  return {
    session_id: session.session_id,
    start_time: session.start_time,
    end_time: session.end_time,
    app_name: session.app_name,
    duration_minutes: session.duration_minutes,
    sample_count: session.sample_count
  };
}

export function summarizeVisualInsightForPrompt(insight: VisualContextInsight) {
  return {
    insight_id: insight.insight_id,
    captured_at: insight.captured_at,
    session_id: insight.session_id,
    app_name: insight.app_name,
    activity_summary: insight.activity_summary,
    visible_tool: insight.visible_tool,
    likely_work_category: insight.likely_work_category,
    likely_mode: insight.likely_mode,
    project_hint: insight.project_hint,
    sensitive_content_detected: insight.sensitive_content_detected,
    confidence: insight.confidence,
    evidence: insight.evidence
  };
}
