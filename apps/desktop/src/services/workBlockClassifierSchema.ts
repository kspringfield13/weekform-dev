import { plannedStatuses, workCategories, workModes } from "../../../../packages/domain/src/taxonomy";

/**
 * Strict JSON schema for work-block classification, plus the system
 * instructions. Previously hardcoded (and the taxonomy enums duplicated) in the
 * Rust `classify_active_window_sessions_with_openai` command; now sourced from
 * the single taxonomy definition so adding a category is a TypeScript-only edit.
 */

export const WORK_BLOCK_CLASSIFIER_INSTRUCTIONS =
  "You classify local macOS active-window sessions into ClearCapacity draft work blocks. Be conservative, evidence-based, prefer high-confidence only when signals are clear. Return only JSON matching the requested schema.";

export const workBlockClassifierSchema = {
  type: "object",
  additionalProperties: false,
  required: ["work_blocks"],
  properties: {
    work_blocks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "session_ids",
          "start_time",
          "end_time",
          "category",
          "mode",
          "planned_status",
          "project_name",
          "stakeholder_group",
          "evidence",
          "confidence",
          "blocker_flag",
          "notes"
        ],
        properties: {
          session_ids: {
            type: "array",
            minItems: 1,
            items: { type: "string" }
          },
          start_time: { type: "string" },
          end_time: { type: "string" },
          category: { type: "string", enum: workCategories },
          mode: { type: "string", enum: workModes },
          planned_status: { type: "string", enum: plannedStatuses },
          project_name: { type: "string" },
          stakeholder_group: { type: "string" },
          evidence: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: { type: "string" }
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          blocker_flag: { type: "boolean" },
          notes: { type: ["string", "null"] }
        }
      }
    }
  }
} as const;
