import type { AccelerationSignal, WorkBlock } from "../../../../packages/domain/src/models";
import { externalSafeAccelerationSignal } from "../../../../packages/inference/src/externalWorkBlock";

export const ACCELERATION_PROMPT_VERSION = "weekform-acceleration-v2";

/**
 * Build the Acceleration synthesis prompt from the deterministic miner's output.
 *
 * PRIVACY CONTRACT (hard rule): the model is fed DERIVED signals only — app-name
 * flows, category/duration/time-of-day stats, counts, and opaque source ids that
 * the deterministic miner (`packages/inference/src/accelerate.ts`) already
 * produced. `AccelerationSignal` carries no `window_title` field, so no raw
 * window title can reach the model here. `summarizeSignal` whitelists fields
 * explicitly (rather than spreading the signal) so a future field addition to
 * `AccelerationSignal` can't silently widen what is sent.
 */
function summarizeSignal(signal: AccelerationSignal) {
  return {
    signal_id: signal.signal_id,
    type: signal.type,
    title: signal.title,
    detail: signal.detail,
    evidence: signal.evidence,
    estimated_minutes_saved_per_week: signal.estimated_minutes_saved_per_week,
    confidence: signal.confidence,
    derived_from_count: signal.derived_from.length
  };
}

export function buildAccelerationPrompt({
  weekRangeLabel,
  signals,
  blocks,
}: {
  weekRangeLabel: string;
  signals: AccelerationSignal[];
  blocks: WorkBlock[];
}) {
  const context = {
    product: "Weekform",
    prompt_version: ACCELERATION_PROMPT_VERSION,
    objective:
      "Author one practical, evidence-grounded acceleration Play for each derived signal mined from an analyst's observed work, so they can reclaim recurring time.",
    privacy:
      "These signals are derived locally (app-name flows, category/time-of-day stats, counts). They contain no raw window titles. Do not invent or infer specific document/file names.",
    guardrails: [
      "Ground every Play strictly in the cited evidence — do not fabricate apps, tools, or activities that are not in the signal.",
      "Keep estimated time saved conservative; never inflate it above what the evidence supports.",
      "Echo each signal's signal_id and type unchanged so the Play maps back to its source signal.",
      "This is a planning aid the analyst reviews before acting, not an automated action."
    ],
    observed_week: {
      display_range: weekRangeLabel
    },
    acceleration_signals: signals
      .map((signal) => externalSafeAccelerationSignal(signal, blocks))
      .map(summarizeSignal),
    output_rules: {
      automate:
        "For type 'automate', author a concrete, runnable skill recipe (clear ordered imperative steps grounded in the cited app flow) in the `recipe` field; leave `recommended_tools` empty. Also author it as a reusable Agent Skill in SKILL.md format: set `skill_name` to a short hyphenated slug (lowercase, only a-z, 0-9, and hyphens; e.g. 'weekly-revenue-report'), and `skill_description` to one or two sentences, in the third person, describing what the skill does AND when to use it (the triggering condition) so it can be matched later — keep it under ~300 characters.",
      tool:
        "For type 'tool', list specific named tools in `recommended_tools` matched to the observed time-sink; set `recipe`, `skill_name`, and `skill_description` to null.",
      technique:
        "For type 'technique', refine `detail` into one actionable trick tied to the observed anti-pattern; set `recipe`, `skill_name`, and `skill_description` to null and `recommended_tools` empty.",
      detail: "Sharpen `detail` to a concise, specific description the analyst can act on.",
      estimated_minutes_saved_per_week:
        "Keep within or below the signal's estimate unless the evidence clearly supports more.",
      confidence: "0-1, reflecting how strongly the evidence supports the Play."
    }
  };

  return [
    "Author the Weekform Acceleration Plays from this structured context.",
    "Return strict JSON only. Do not include markdown.",
    JSON.stringify(context, null, 2)
  ].join("\n\n");
}
