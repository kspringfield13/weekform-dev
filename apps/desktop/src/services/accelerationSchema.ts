import type { AccelerationPlayType } from "../../../../packages/domain/src/models";

/**
 * Strict JSON schema + system instructions for the Acceleration synthesis step
 * (D2's `useAcceleration` hook, routed through the generic `ai_complete` Tauri
 * command). The model is handed the deterministic miner's derived
 * `AccelerationSignal[]` and authors a polished "Play" per signal:
 *   - AUTOMATE → a concrete, runnable skill `recipe` grounded in the cited apps.
 *   - TOOL     → specific `recommended_tools` matched to the observed time-sink.
 *   - TECHNIQUE→ a refined, actionable `detail` (no recipe / no tools).
 *
 * Each authored play echoes its source `signal_id` and `type` so the hook can
 * merge the AI payload back onto the deterministic signal it refines. The model
 * may sharpen `detail`, `estimated_minutes_saved_per_week`, and `confidence`
 * within the bounds of the cited evidence.
 *
 * Privacy: the schema never carries raw window titles — the prompt feeds derived
 * signals only (see `accelerationPrompt.ts`); this schema mirrors that contract.
 */

export const ACCELERATION_INSTRUCTIONS =
  "You are the Weekform Acceleration synthesizer. You receive derived signals mined from an analyst's observed work (app-name flows, category/time-of-day stats, counts) — never raw window titles. For each signal, author one practical, evidence-grounded Play: a concrete runnable skill recipe for AUTOMATE signals, specific named tools for TOOL signals, and an actionable trick for TECHNIQUE signals. For AUTOMATE signals, author the recipe as a reusable Agent Skill in SKILL.md format: propose a short hyphenated skill_name (lowercase, a-z/0-9/hyphens only) and a skill_description that states in the third person what the skill does AND when to use it (the triggering condition), then write the recipe body as clear imperative, numbered steps. Set skill_name/skill_description to null for TOOL and TECHNIQUE. Echo each signal's id and type unchanged. Keep time-saved estimates conservative and grounded in the cited evidence. Return only JSON matching the requested schema.";

// Mirror of `AccelerationPlayType` so the strict enum stays in sync with the domain union.
// Exported so the parse layer (`useAcceleration`) can validate a returned `play.type` against it.
export const accelerationPlayTypes: readonly AccelerationPlayType[] = ["automate", "tool", "technique"];

export const accelerationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["plays"],
  properties: {
    plays: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "signal_id",
          "type",
          "detail",
          "recipe",
          "skill_name",
          "skill_description",
          "recommended_tools",
          "estimated_minutes_saved_per_week",
          "confidence"
        ],
        properties: {
          signal_id: { type: "string" },
          type: { type: "string", enum: accelerationPlayTypes },
          detail: { type: "string" },
          // A runnable skill recipe for AUTOMATE plays; null for TOOL/TECHNIQUE.
          recipe: { type: ["string", "null"] },
          // Agent Skills (SKILL.md) authoring fields for AUTOMATE plays; null otherwise.
          // `skill_name` is a short hyphenated slug; `skill_description` states what the skill
          // does and WHEN to use it (the SKILL.md triggering description).
          skill_name: { type: ["string", "null"] },
          skill_description: { type: ["string", "null"] },
          // Specific tool names for TOOL plays; empty for AUTOMATE/TECHNIQUE.
          recommended_tools: {
            type: "array",
            items: { type: "string" }
          },
          estimated_minutes_saved_per_week: { type: "number", minimum: 0 },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    }
  }
} as const;

/**
 * Shape of one authored play returned by the model. Mirrors `accelerationSchema`
 * so D2 can parse the `ai_complete` output (`aiCompleteJson<AuthoredAccelerationPlays>`)
 * and merge each entry back onto its source `AccelerationSignal` by `signal_id`.
 */
export interface AuthoredAccelerationPlay {
  signal_id: string;
  type: AccelerationPlayType;
  detail: string;
  recipe: string | null;
  skill_name: string | null;
  skill_description: string | null;
  recommended_tools: string[];
  estimated_minutes_saved_per_week: number;
  confidence: number;
}

export interface AuthoredAccelerationPlays {
  plays: AuthoredAccelerationPlay[];
}
