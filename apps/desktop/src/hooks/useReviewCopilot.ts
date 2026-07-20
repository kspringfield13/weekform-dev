import { invoke } from "@tauri-apps/api/core";
import type {
  ActivitySession,
  AuditEvent,
  OutlookCalendarEvent,
  PlannedStatus,
  ReviewCopilotAction,
  ReviewCopilotSuggestion,
  UserCorrection,
  WeeklyCapacitySnapshot,
  WorkBlock,
  WorkCategory,
  WorkMode,
  AIConfig,
} from "../../../../packages/domain/src/models";
import { useAsyncStatus } from "./useAsyncStatus";
import { buildReviewCopilotPrompt, REVIEW_COPILOT_PROMPT_VERSION } from "../services/reviewCopilotPrompt";
import { createAuditEvent } from "../lib/audit";
import { aiAuditSource, generationProviderUnsupportedMessage, providerSupportsGeneration } from "../services/aiProviders";
import { withAiTimeout } from "../lib/aiTimeout";
import { stableHash } from "../lib/blocks";
import { resolveExternalWorkBlockIds } from "../../../../packages/inference/src/externalWorkBlock";

interface NativeReviewCopilotSuggestion {
  action: ReviewCopilotAction;
  work_block_ids: string[];
  title: string;
  rationale: string;
  confidence: number;
  proposed_category: WorkCategory | null;
  proposed_mode: WorkMode | null;
  proposed_planned_status: PlannedStatus | null;
  proposed_project_name: string | null;
  proposed_stakeholder_group: string | null;
  proposed_blocker_flag: boolean | null;
  proposed_notes: string | null;
}

interface NativeReviewCopilotResponse {
  result: {
    suggestions: NativeReviewCopilotSuggestion[];
  };
  model: string;
}

interface UseReviewCopilotParams {
  isDemoMode: boolean;
  blocks: WorkBlock[];
  setReviewSuggestions: React.Dispatch<React.SetStateAction<ReviewCopilotSuggestion[]>>;
  snapshot: WeeklyCapacitySnapshot;
  activeWindowSessions: ActivitySession[];
  currentWeekId: string;
  currentWeekRangeLabel: string;
  calendarEvents: OutlookCalendarEvent[];
  corrections: UserCorrection[];
  aiConfig: AIConfig | null;
  setAuditEvents: React.Dispatch<React.SetStateAction<AuditEvent[]>>;
}

export function useReviewCopilot({
  isDemoMode,
  blocks,
  setReviewSuggestions,
  snapshot,
  activeWindowSessions,
  currentWeekId,
  currentWeekRangeLabel,
  calendarEvents,
  corrections,
  aiConfig,
  setAuditEvents,
}: UseReviewCopilotParams) {
  const [reviewCopilotStatus, reviewCopilotError, reviewCopilotAsync] =
    useAsyncStatus<"idle" | "generating">("idle");

  async function generateReviewCopilotSuggestions() {
    if (isDemoMode) return;
    if (reviewCopilotStatus === "generating") return;

    const unverifiedBlocks = blocks.filter((block) => !block.user_verified);
    if (unverifiedBlocks.length === 0) {
      reviewCopilotAsync.fail("There are no unverified blocks for the Review Copilot to inspect.");
      return;
    }

    const provider = aiConfig?.provider ?? "openai";
    // Fail fast (before the Rust round-trip 404s or times out) when the configured provider
    // can't run the Rust generation path — it only powers the Agent chat today.
    if (!providerSupportsGeneration(provider)) {
      reviewCopilotAsync.fail(generationProviderUnsupportedMessage(provider));
      return;
    }
    const auditSource = aiAuditSource(provider, "responses", aiConfig?.connectionMode);
    const startedAt = new Date().toISOString();
    const prompt = buildReviewCopilotPrompt({
      weekId: currentWeekId,
      weekRangeLabel: currentWeekRangeLabel,
      snapshot,
      reviewQueue: unverifiedBlocks,
      allBlocks: blocks,
      activeWindowSessions,
      calendarEvents,
      corrections,
    });

    reviewCopilotAsync.start("generating");

    try {
      const response = await withAiTimeout(
        invoke<NativeReviewCopilotResponse>(
          "generate_review_copilot_suggestions_with_openai",
          { request: { prompt, ai_config: aiConfig } }
        )
      );
      // The native response is JSON.parse-only (the strict schema is server-side and
      // unenforceable for a custom provider), so `suggestions` and each `work_block_ids`
      // are trusted-TS-but-not-runtime-checked arrays. A non-array would throw in the
      // `.map`/`.filter`/`.join` below, get caught, and misreport a paid, successful
      // generation as "failed" — coerce both to `[]` so a malformed payload degrades
      // (drops the bad suggestion, keeps well-formed siblings) instead (matches the
      // confidence guard below and the array coercion in useNarrativeGeneration/useForecastAgent).
      const rawSuggestions = Array.isArray(response.result?.suggestions)
        ? response.result.suggestions
        : [];
      const suggestions = rawSuggestions
        .map<ReviewCopilotSuggestion>((suggestion) => {
          // Coerce once and reuse for both the filter and the suggestion_id hash so the
          // hash input stays byte-identical to the raw array on well-formed data.
          const rawBlockIds = Array.isArray(suggestion.work_block_ids)
            ? suggestion.work_block_ids
            : [];
          return {
            ...suggestion,
            // Normalize the AI-returned confidence to a finite [0,1] value so a malformed
            // response can't render "NaN%" or an out-of-range percentage in the suggestion row
            // (matches the parse-layer normalization in useClassification/useAcceleration).
            confidence: Number.isFinite(suggestion.confidence)
              ? Math.max(0, Math.min(1, suggestion.confidence))
              : 0,
            work_block_ids: resolveExternalWorkBlockIds(blocks, rawBlockIds),
            suggestion_id: `review-${stableHash(
              `${startedAt}-${suggestion.action}-${rawBlockIds.join("|")}-${suggestion.title}`
            )}`,
          };
        })
        .filter((suggestion) => suggestion.work_block_ids.length > 0);

      setReviewSuggestions(suggestions);
      reviewCopilotAsync.setStatus("idle");
      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "review_copilot",
          source: auditSource,
          title: "Review Copilot suggestions generated",
          summary: `${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"} generated for ${unverifiedBlocks.length} unverified block${unverifiedBlocks.length === 1 ? "" : "s"}`,
          privacy_level: "derived_only",
          timestamp: startedAt,
          details: {
            week_id: currentWeekId,
            week_range: currentWeekRangeLabel,
            model: response.model,
            prompt_version: REVIEW_COPILOT_PROMPT_VERSION,
            review_queue_count: unverifiedBlocks.length,
            suggestion_count: suggestions.length,
            sent_to_provider: true,
            ...(aiConfig?.connectionMode === "codex"
              ? { codex_thread_ephemeral: true }
              : { store: false }),
          },
        }),
      ].slice(-1000));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reviewCopilotAsync.fail(message);
      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "review_copilot",
          source: auditSource,
          title: "Review Copilot failed",
          summary: message,
          privacy_level: "derived_only",
          timestamp: startedAt,
          details: {
            week_id: currentWeekId,
            week_range: currentWeekRangeLabel,
            prompt_version: REVIEW_COPILOT_PROMPT_VERSION,
            review_queue_count: unverifiedBlocks.length,
            sent_to_provider: true,
          },
        }),
      ].slice(-1000));
    }
  }

  return {
    reviewCopilotStatus,
    reviewCopilotError,
    generateReviewCopilotSuggestions,
    resetReviewCopilot: reviewCopilotAsync.reset,
  };
}
