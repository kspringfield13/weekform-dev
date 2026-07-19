import type { BriefingFallbackReason, BriefingMode, TeamBriefingResult } from "@/lib/briefing";

/**
 * Shared shape for the briefing-generation action state. Lives outside the
 * "use server" module because server-action files may only export async
 * functions (same pattern as app/teams/inviteState.ts).
 *
 * `AI_DISCLOSURE` is duplicated (not imported) from lib/briefing.ts so the
 * client component (BriefingPanel.tsx) never needs to import that module —
 * it also contains the server-only OpenAI call and prompt-building logic,
 * which has no reason to ship into a client bundle. A test in
 * lib/briefing.test.ts pins the canonical string; keep both in sync.
 */
export const AI_DISCLOSURE =
  "AI-generated from shared workload signals. This is a planning aid, not a performance score — treat it as a starting point for a conversation, not a conclusion.";

export interface BriefingActionState {
  status: "idle" | "success" | "error";
  message: string | null;
  result: TeamBriefingResult | null;
  mode: BriefingMode | null;
  fallbackReason: BriefingFallbackReason | null;
  model: string | null;
  generatedAt: string | null;
}

export const INITIAL_BRIEFING_STATE: BriefingActionState = {
  status: "idle",
  message: null,
  result: null,
  mode: null,
  fallbackReason: null,
  model: null,
  generatedAt: null,
};

export function fallbackReasonLabel(reason: BriefingFallbackReason | null): string {
  switch (reason) {
    case "not_configured":
      return "No AI model is configured for this deployment, so this is a deterministic summary of risk flags.";
    case "no_data":
      return "No member has shared a workload snapshot yet, so there is nothing to summarize.";
    case "model_error":
      return "The AI model request failed, so this is a deterministic summary of risk flags instead.";
    case "schema_error":
      return "The AI model's response could not be validated, so this is a deterministic summary of risk flags instead.";
    case "timeout":
      return "The AI model request timed out, so this is a deterministic summary of risk flags instead.";
    default:
      return "This is a deterministic summary of risk flags.";
  }
}
