import { invoke } from "@tauri-apps/api/core";
import type {
  ActivitySession,
  AuditEvent,
  OutlookCalendarEvent,
  UserCorrection,
  VisualContextInsight,
  WeeklyAIUsageSummary,
  WorkBlock,
  WeeklyCapacitySnapshot,
  AIConfig,
} from "../../../../packages/domain/src/models";
import {
  isResetInProgress,
  RESET_IN_PROGRESS_AI_MESSAGE,
  useAsyncStatus,
  type ResetInProgressRef,
} from "./useAsyncStatus";
import { buildWeeklyNarrativePrompt, NARRATIVE_PROMPT_VERSION } from "../services/narrativePrompt";
import type { generateWeeklyNarrative } from "../../../../packages/inference/src/capacity";
import { createAuditEvent } from "../lib/audit";
import { aiAuditSource, generationProviderUnsupportedMessage, providerSupportsGeneration } from "../services/aiProviders";
import { withAiTimeout } from "../lib/aiTimeout";
import { displaySafeNarrative, getLocalDateKey } from "../lib/date";
import type { PersistedNarrativeRecord } from "../services/localStore";
import type { AppActionResult } from "../lib/types";

interface NativeNarrativeGenerationResponse {
  narrative: ReturnType<typeof generateWeeklyNarrative>;
  model: string;
}

interface UseNarrativeGenerationParams {
  isDemoMode: boolean;
  resetInProgressRef: ResetInProgressRef;
  hasNarrativeEvidence: boolean;
  snapshot: WeeklyCapacitySnapshot;
  blocks: WorkBlock[];
  activeWindowSessions: ActivitySession[];
  calendarEvents: OutlookCalendarEvent[];
  visualContextInsights: VisualContextInsight[];
  corrections: UserCorrection[];
  aiUsageSummary: WeeklyAIUsageSummary;
  /** Gates whether the usage digest enters the (manager-facing) prompt at all. */
  includeUsageInManagerSummary: boolean;
  currentWeekId: string;
  currentWeekRangeLabel: string;
  aiConfig: AIConfig | null;
  setGeneratedNarrative: React.Dispatch<React.SetStateAction<PersistedNarrativeRecord | null>>;
  setManagerSummaryText: React.Dispatch<React.SetStateAction<string | null>>;
  setAuditEvents: React.Dispatch<React.SetStateAction<AuditEvent[]>>;
}

export function useNarrativeGeneration({
  isDemoMode,
  resetInProgressRef,
  hasNarrativeEvidence,
  snapshot,
  blocks,
  activeWindowSessions,
  calendarEvents,
  visualContextInsights,
  corrections,
  aiUsageSummary,
  includeUsageInManagerSummary,
  currentWeekId,
  currentWeekRangeLabel,
  aiConfig,
  setGeneratedNarrative,
  setManagerSummaryText,
  setAuditEvents,
}: UseNarrativeGenerationParams) {
  const [narrativeGenerationStatus, narrativeGenerationError, narrativeAsync] =
    useAsyncStatus<"idle" | "generating">("idle");

  async function regenerateNarrative(trigger: "auto" | "manual"): Promise<AppActionResult> {
    if (isResetInProgress(resetInProgressRef)) {
      return { ok: false, message: RESET_IN_PROGRESS_AI_MESSAGE };
    }
    if (isDemoMode) return { ok: false, message: "Narrative generation is unavailable in demo mode." };
    if (!hasNarrativeEvidence) return { ok: false, message: "There is not enough reviewed evidence to generate a narrative yet." };
    if (narrativeGenerationStatus === "generating") return { ok: false, message: "A narrative is already being generated." };

    const provider = aiConfig?.provider ?? "openai";
    // Fail fast (before the Rust round-trip 404s or times out) when the configured provider
    // can't run the Rust generation path — it only powers the Agent chat today.
    if (!providerSupportsGeneration(provider)) {
      const message = generationProviderUnsupportedMessage(provider);
      narrativeAsync.fail(message);
      return { ok: false, message };
    }
    const auditSource = aiAuditSource(provider, "responses", aiConfig?.connectionMode);
    const generatedAt = new Date().toISOString();
    // Usage enters the prompt ONLY behind the manager-summary opt-in: the generated
    // narrative is manager-facing, so without the toggle token totals never leave
    // the machine on this path. Skipped entirely when the week has no usage.
    const measuredTokens =
      aiUsageSummary.exact.input_tokens +
      aiUsageSummary.exact.output_tokens +
      aiUsageSummary.exact.cache_creation_tokens;
    const usageContext =
      includeUsageInManagerSummary &&
      (aiUsageSummary.exact.prompt_count > 0 || aiUsageSummary.proxy.session_minutes > 0)
        ? {
            measured_tokens: measuredTokens,
            measured_prompts: aiUsageSummary.exact.prompt_count,
            observed_session_minutes: Math.round(aiUsageSummary.proxy.session_minutes),
            estimated_cost_usd: aiUsageSummary.cost.total_usd,
            top_models: aiUsageSummary.by_model
              .filter((row) => row.measurement === "exact")
              .slice(0, 3)
              .map((row) => row.model),
          }
        : null;
    const prompt = buildWeeklyNarrativePrompt({
      weekId: currentWeekId,
      weekRangeLabel: currentWeekRangeLabel,
      snapshot,
      blocks,
      activeWindowSessions,
      calendarEvents,
      visualContextInsights,
      corrections,
      usageContext,
    });

    const operationEpoch = narrativeAsync.start("generating");

    try {
      const response = await withAiTimeout(
        invoke<NativeNarrativeGenerationResponse>("generate_weekly_narrative_with_openai", {
          request: { prompt, ai_config: aiConfig },
        })
      );
      if (!narrativeAsync.isCurrent(operationEpoch)) {
        return { ok: false, message: "Narrative generation was cancelled by a local-data reset." };
      }
      // The native response is trusted TS but never runtime-checked (same posture the
      // forecast/classification/visual hooks guard against), so a non-strict/custom provider
      // can return a non-string headline/summary_text/manager_ready_summary or a non-array
      // key_drivers — on which `displaySafeNarrative` unconditionally runs `.replace`/`.map`
      // and THROWS. That throw is caught below and MISREPORTED as "Narrative generation failed",
      // silently discarding a successful, already-paid generation. Coerce the four rendered
      // fields first, mirroring `parseNarrativeRecord`'s reload-path guard (localStore.ts) and
      // `useForecastAgent`'s live-path array coercion. Byte-identical on every well-formed/demo
      // response (all four fields already satisfy the checks → pass through value-identical);
      // only a malformed field degrades — to the same empty shape the reload parser would keep.
      const rawNarrative = response.narrative;
      const safeNarrative = {
        ...rawNarrative,
        headline: typeof rawNarrative.headline === "string" ? rawNarrative.headline : "",
        summary_text: typeof rawNarrative.summary_text === "string" ? rawNarrative.summary_text : "",
        manager_ready_summary:
          typeof rawNarrative.manager_ready_summary === "string" ? rawNarrative.manager_ready_summary : "",
        key_drivers: Array.isArray(rawNarrative.key_drivers)
          ? rawNarrative.key_drivers.filter((driver): driver is string => typeof driver === "string")
          : [],
      };
      const sanitizedNarrative = displaySafeNarrative(safeNarrative, currentWeekRangeLabel);
      const record: PersistedNarrativeRecord = {
        narrative: sanitizedNarrative,
        generated_at: generatedAt,
        generated_for_date: getLocalDateKey(new Date(generatedAt)),
        trigger,
        model: response.model,
        prompt_version: NARRATIVE_PROMPT_VERSION,
      };

      setGeneratedNarrative(record);
      // Regeneration replaces both rendered variants. Persist the new shareable
      // copy explicitly so a previously edited draft cannot remain attached to
      // the newly generated analyst narrative.
      setManagerSummaryText(
        `${sanitizedNarrative.headline}\n\n${sanitizedNarrative.manager_ready_summary}`
      );
      narrativeAsync.setStatus("idle");
      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "narrative_generation",
          source: auditSource,
          title: trigger === "auto" ? "Daily narrative generated" : "Narrative regenerated manually",
          summary: `${response.model} generated a weekly narrative for ${currentWeekRangeLabel}`,
          privacy_level: "derived_only",
          timestamp: generatedAt,
          details: {
            week_id: currentWeekId,
            week_range: currentWeekRangeLabel,
            model: response.model,
            trigger,
            prompt_version: NARRATIVE_PROMPT_VERSION,
            work_block_count: blocks.length,
            active_window_session_count: activeWindowSessions.length,
            calendar_event_count: calendarEvents.length,
            correction_count: corrections.length,
            sent_to_provider: true,
            ...(aiConfig?.connectionMode === "codex"
              ? { codex_thread_ephemeral: true }
              : { store: false }),
          },
        }),
      ].slice(-1000));
      return {
        ok: true,
        message: `Generated a new weekly narrative and refreshed the manager-ready summary for ${currentWeekRangeLabel}.`,
      };
    } catch (error) {
      if (!narrativeAsync.isCurrent(operationEpoch)) {
        return { ok: false, message: "Narrative generation was cancelled by a local-data reset." };
      }
      const message = error instanceof Error ? error.message : String(error);
      narrativeAsync.fail(message);
      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "narrative_generation",
          source: auditSource,
          title: "Narrative generation failed",
          summary: message,
          privacy_level: "derived_only",
          timestamp: generatedAt,
          details: {
            week_id: currentWeekId,
            week_range: currentWeekRangeLabel,
            trigger,
            prompt_version: NARRATIVE_PROMPT_VERSION,
            sent_to_provider: true,
          },
        }),
      ].slice(-1000));
      return { ok: false, message };
    }
  }

  return {
    narrativeGenerationStatus,
    narrativeGenerationError,
    regenerateNarrative,
    resetNarrative: () => narrativeAsync.reset(),
  };
}
