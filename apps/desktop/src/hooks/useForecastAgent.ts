import { invoke } from "@tauri-apps/api/core";
import type {
  ActivitySession,
  AuditEvent,
  ForecastAgentResult,
  OutlookCalendarEvent,
  UserCorrection,
  WeeklyCapacitySnapshot,
  WorkBlock,
  AIConfig,
} from "../../../../packages/domain/src/models";
import { normalizeWeekId } from "../../../../packages/inference/src/capacity";
import {
  isResetInProgress,
  RESET_IN_PROGRESS_AI_MESSAGE,
  useAsyncStatus,
  type ResetInProgressRef,
} from "./useAsyncStatus";
import { buildForecastAgentPrompt, FORECAST_AGENT_PROMPT_VERSION } from "../services/forecastAgentPrompt";
import { createAuditEvent } from "../lib/audit";
import { aiAuditSource, generationProviderUnsupportedMessage, providerSupportsGeneration } from "../services/aiProviders";
import { withAiTimeout } from "../lib/aiTimeout";
import { pct } from "../lib/format";
import type { PersistedForecastRecord } from "../services/localStore";
import type { AppActionResult } from "../lib/types";

interface NativeForecastAgentResponse {
  forecast: ForecastAgentResult;
  model: string;
}

// Mirrors the guard in `parseForecastRecord` (services/localStore.ts). Used to coerce the AI-authored
// forecast narrative arrays on the LIVE generation path so a malformed/omitted array degrades to `[]`
// (ForecastList's "None identified" empty state) instead of crash-rendering the Forecast screen.
const isStringArray = (candidate: unknown): candidate is string[] =>
  Array.isArray(candidate) && candidate.every((entry) => typeof entry === "string");

interface UseForecastAgentParams {
  isDemoMode: boolean;
  resetInProgressRef: ResetInProgressRef;
  blocks: WorkBlock[];
  setGeneratedForecast: React.Dispatch<React.SetStateAction<PersistedForecastRecord | null>>;
  setForecastHistory: React.Dispatch<React.SetStateAction<PersistedForecastRecord[]>>;
  snapshot: WeeklyCapacitySnapshot;
  activeWindowSessions: ActivitySession[];
  currentWeekId: string;
  currentWeekRangeLabel: string;
  nextWeekId: string;
  nextWeekRangeLabel: string;
  calendarEvents: OutlookCalendarEvent[];
  corrections: UserCorrection[];
  aiConfig: AIConfig | null;
  setAuditEvents: React.Dispatch<React.SetStateAction<AuditEvent[]>>;
}

export function useForecastAgent({
  isDemoMode,
  resetInProgressRef,
  blocks,
  setGeneratedForecast,
  setForecastHistory,
  snapshot,
  activeWindowSessions,
  currentWeekId,
  currentWeekRangeLabel,
  nextWeekId,
  nextWeekRangeLabel,
  calendarEvents,
  corrections,
  aiConfig,
  setAuditEvents,
}: UseForecastAgentParams) {
  const [forecastStatus, forecastError, forecastAsync] = useAsyncStatus<"idle" | "generating">("idle");

  async function generateForecastAgent(): Promise<AppActionResult> {
    if (isResetInProgress(resetInProgressRef)) {
      return { ok: false, message: RESET_IN_PROGRESS_AI_MESSAGE };
    }
    if (isDemoMode) return { ok: false, message: "Forecast generation is unavailable in demo mode." };
    if (forecastStatus === "generating") return { ok: false, message: "A forecast is already being generated." };

    if (blocks.length === 0) {
      const message = "The Forecast Agent needs at least one work block before it can estimate next-week capacity.";
      forecastAsync.fail(message);
      return { ok: false, message };
    }

    const provider = aiConfig?.provider ?? "openai";
    // Fail fast (before the Rust round-trip 404s or times out) when the configured provider
    // can't run the Rust generation path — it only powers the Agent chat today.
    if (!providerSupportsGeneration(provider)) {
      const message = generationProviderUnsupportedMessage(provider);
      forecastAsync.fail(message);
      return { ok: false, message };
    }
    const auditSource = aiAuditSource(provider, "responses", aiConfig?.connectionMode);
    const startedAt = new Date().toISOString();
    const prompt = buildForecastAgentPrompt({
      currentWeekId,
      currentWeekRangeLabel,
      nextWeekId,
      nextWeekRangeLabel,
      snapshot,
      blocks,
      activeWindowSessions,
      calendarEvents,
      corrections,
    });

    const operationEpoch = forecastAsync.start("generating");

    try {
      const response = await withAiTimeout(
        invoke<NativeForecastAgentResponse>("generate_forecast_agent_with_openai", {
          request: { prompt, ai_config: aiConfig },
        })
      );
      if (!forecastAsync.isCurrent(operationEpoch)) {
        return { ok: false, message: "Forecast generation was cancelled by a local-data reset." };
      }
      // Enforce the prompt's output rules at the parse layer — the native AI response is
      // trusted TS but never runtime-checked, so a malformed/non-clamping provider could
      // render "NaN%", a >40% "reliable" headline, or an inverted scenario band. Normalizing
      // here (not the view) protects the persisted record AND the audit trail too; the derived
      // values feed both so they agree (matches useClassification/useAcceleration).
      const normalizedConfidence = Number.isFinite(response.forecast.confidence)
        ? Math.max(0, Math.min(1, response.forecast.confidence))
        : 0;
      // Primary planning estimate — the prompt instructs "Clamp to 0-40%"; enforce it.
      const reliableNewWorkCapacityPct = Number.isFinite(response.forecast.reliable_new_work_capacity_pct)
        ? Math.max(0, Math.min(40, response.forecast.reliable_new_work_capacity_pct))
        : 0;
      // Clamp AND repair scenario ordering. Each scenario is a variant of the SAME reliable-new-work
      // capacity metric as the headline above (the panel renders all four in one grid, "refined from
      // the deterministic reliable-capacity baseline"), so clamp all three to the identical [0,40]
      // band — otherwise a non-clamping provider's out-of-range value would render an impossible
      // "Optimistic 300%" / "Conservative -10%" in the scenario cards, which display them verbatim
      // via pct() (the panel's likelyLeft view-clamp only bounds the marker POSITION, never the shown
      // text). Then sort ascending so the prompt's conservative <= likely <= optimistic invariant
      // holds (an inverted or NaN band would push the range fill/marker off the track). Clamping at
      // the parse layer (not the view) protects the persisted record too; in-range values pass
      // through both steps unchanged — only out-of-range magnitudes are normalized, never the labels.
      const [conservativeCapacityPct, likelyCapacityPct, optimisticCapacityPct] = [
        response.forecast.conservative_capacity_pct,
        response.forecast.likely_capacity_pct,
        response.forecast.optimistic_capacity_pct,
      ]
        .map((value) => (Number.isFinite(value) ? Math.max(0, Math.min(40, value)) : 0))
        .sort((a, b) => a - b);
      // Coerce the four narrative string-arrays here too — the spread above trusts them verbatim,
      // but ForecastAgentPanel renders each through ForecastList (`items.length`/`items.map`, no
      // internal guard), so a non-strict provider returning a non-array/omitted field would throw a
      // hard render crash and white-screen the Forecast screen (no ErrorBoundary in apps/desktop/src).
      // This is the exact vector `parseForecastRecord` guards on RELOAD; the live post-generation
      // record never passes through that guard, so enforce the same invariant here. A well-formed
      // response (and every demo seed) is already `string[]`, so this passes through value-identical;
      // only a malformed array degrades to `[]`, ForecastList's intended "None identified" state.
      const record: PersistedForecastRecord = {
        forecast: {
          ...response.forecast,
          confidence: normalizedConfidence,
          reliable_new_work_capacity_pct: reliableNewWorkCapacityPct,
          conservative_capacity_pct: conservativeCapacityPct,
          likely_capacity_pct: likelyCapacityPct,
          optimistic_capacity_pct: optimisticCapacityPct,
          key_constraints: isStringArray(response.forecast.key_constraints)
            ? response.forecast.key_constraints
            : [],
          risk_flags: isStringArray(response.forecast.risk_flags) ? response.forecast.risk_flags : [],
          recommended_actions: isStringArray(response.forecast.recommended_actions)
            ? response.forecast.recommended_actions
            : [],
          assumptions: isStringArray(response.forecast.assumptions) ? response.forecast.assumptions : [],
        },
        generated_at: startedAt,
        generated_for_week: nextWeekId,
        trigger: "manual",
        model: response.model,
        prompt_version: FORECAST_AGENT_PROMPT_VERSION,
      };

      setGeneratedForecast(record);
      // Append to history so the forecast can be scored against actuals once its
      // target week arrives. Keep one record per target week (latest wins) and cap
      // the trail to the most recent 24 weeks. Normalize both sides of the de-dup so a
      // legacy non-padded twin (`2026-W5` vs `2026-W05`) collapses instead of leaving two
      // records for one week (matches the normalized scoring read path in useDerived).
      const normalizedNextWeek = normalizeWeekId(nextWeekId);
      setForecastHistory((current) =>
        [...current.filter((entry) => normalizeWeekId(entry.generated_for_week) !== normalizedNextWeek), record].slice(-24)
      );
      forecastAsync.setStatus("idle");
      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "forecast_agent",
          source: auditSource,
          title: "Next-week forecast generated",
          summary: `${pct(reliableNewWorkCapacityPct)} reliable new-work capacity forecast for ${nextWeekRangeLabel}`,
          privacy_level: "derived_only",
          timestamp: startedAt,
          details: {
            current_week_id: currentWeekId,
            current_week_range: currentWeekRangeLabel,
            forecast_week_id: nextWeekId,
            forecast_week_range: nextWeekRangeLabel,
            model: response.model,
            prompt_version: FORECAST_AGENT_PROMPT_VERSION,
            work_block_count: blocks.length,
            active_window_session_count: activeWindowSessions.length,
            calendar_event_count: calendarEvents.length,
            correction_count: corrections.length,
            reliable_new_work_capacity_pct: reliableNewWorkCapacityPct,
            confidence: normalizedConfidence,
            sent_to_provider: true,
            ...(aiConfig?.connectionMode === "codex"
              ? { codex_thread_ephemeral: true }
              : { store: false }),
          },
        }),
      ].slice(-1000));
      return {
        ok: true,
        message: `Generated a forecast with ${pct(reliableNewWorkCapacityPct)} reliable new-work capacity for ${nextWeekRangeLabel}.`,
      };
    } catch (error) {
      if (!forecastAsync.isCurrent(operationEpoch)) {
        return { ok: false, message: "Forecast generation was cancelled by a local-data reset." };
      }
      const message = error instanceof Error ? error.message : String(error);
      forecastAsync.fail(message);
      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "forecast_agent",
          source: auditSource,
          title: "Forecast Agent failed",
          summary: message,
          privacy_level: "derived_only",
          timestamp: startedAt,
          details: {
            current_week_id: currentWeekId,
            forecast_week_id: nextWeekId,
            prompt_version: FORECAST_AGENT_PROMPT_VERSION,
            work_block_count: blocks.length,
            sent_to_provider: true,
          },
        }),
      ].slice(-1000));
      return { ok: false, message };
    }
  }

  return {
    forecastStatus,
    forecastError,
    generateForecastAgent,
    resetForecast: () => forecastAsync.reset(),
  };
}
