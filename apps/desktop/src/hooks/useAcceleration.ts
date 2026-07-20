import type {
  AccelerationSignal,
  AIConfig,
  AuditEvent,
  WorkBlock,
} from "../../../../packages/domain/src/models";
import { useAsyncStatus } from "./useAsyncStatus";
import { aiCompleteJson, jsonSchemaFormat } from "../services/aiComplete";
import { buildAccelerationPrompt, ACCELERATION_PROMPT_VERSION } from "../services/accelerationPrompt";
import {
  ACCELERATION_INSTRUCTIONS,
  accelerationSchema,
  accelerationPlayTypes,
  type AuthoredAccelerationPlay,
  type AuthoredAccelerationPlays,
} from "../services/accelerationSchema";
import { createAuditEvent } from "../lib/audit";
import { aiAuditSource, generationProviderUnsupportedMessage, providerSupportsGeneration } from "../services/aiProviders";
import type { PersistedAccelerationRecord } from "../services/localStore";

interface UseAccelerationParams {
  isDemoMode: boolean;
  signals: AccelerationSignal[];
  blocks: WorkBlock[];
  currentWeekId: string;
  currentWeekRangeLabel: string;
  aiConfig: AIConfig | null;
  setGeneratedPlays: React.Dispatch<React.SetStateAction<PersistedAccelerationRecord | null>>;
  setAuditEvents: React.Dispatch<React.SetStateAction<AuditEvent[]>>;
}

/**
 * Optional, opt-in AI layer for the Acceleration Engine. Mirrors `useForecastAgent`:
 * it builds the derived-only prompt from the deterministic miner's signals, routes it
 * through the generic `ai_complete` Tauri command (no bespoke Rust command), parses the
 * strict-schema JSON, persists the authored Plays, and audits the run.
 *
 * Privacy: the prompt sends DERIVED signals only (app-name flows, counts, minutes) — the
 * schema/prompt carry no raw window titles. Authored plays are filtered to those that map
 * back to a currently-mined `signal_id`, and each field is re-whitelisted so a malformed
 * response can never widen what is stored.
 */
export function useAcceleration({
  isDemoMode,
  signals,
  blocks,
  currentWeekId,
  currentWeekRangeLabel,
  aiConfig,
  setGeneratedPlays,
  setAuditEvents,
}: UseAccelerationParams) {
  const [accelerationStatus, accelerationError, accelerationAsync] =
    useAsyncStatus<"idle" | "generating">("idle");

  async function generateAccelerationPlays() {
    if (isDemoMode) return;
    if (accelerationStatus === "generating") return;

    if (signals.length === 0) {
      accelerationAsync.fail(
        "The Acceleration engine needs at least one mined play before it can author skills — keep reviewing this week's work first."
      );
      return;
    }

    const provider = aiConfig?.provider ?? "openai";
    // Fail fast (before the Rust round-trip 404s or times out) when the configured provider
    // can't run the Rust generation path — it only powers the Agent chat today.
    if (!providerSupportsGeneration(provider)) {
      accelerationAsync.fail(generationProviderUnsupportedMessage(provider));
      return;
    }
    const auditSource = aiAuditSource(provider, "responses", aiConfig?.connectionMode);
    const startedAt = new Date().toISOString();
    const prompt = buildAccelerationPrompt({ weekRangeLabel: currentWeekRangeLabel, signals, blocks });

    accelerationAsync.start("generating");

    try {
      const { data, model } = await aiCompleteJson<AuthoredAccelerationPlays>({
        prompt,
        instructions: ACCELERATION_INSTRUCTIONS,
        responseFormat: jsonSchemaFormat("acceleration", accelerationSchema),
        aiConfig,
      });

      // Keep only authored plays that map back to a currently-mined signal, and rebuild each
      // from whitelisted fields so a malformed response can never widen what is persisted.
      // Map (not Set) so an off-enum/omitted `play.type` can fall back to the source signal's
      // deterministic, authoritative type — localStore trusts the hook to have validated it.
      const signalTypeById = new Map(signals.map((signal) => [signal.signal_id, signal.type]));
      const plays: AuthoredAccelerationPlay[] = (Array.isArray(data.plays) ? data.plays : [])
        .filter((play) => play && typeof play.signal_id === "string" && signalTypeById.has(play.signal_id))
        .map((play) => ({
          signal_id: play.signal_id,
          type: accelerationPlayTypes.includes(play.type)
            ? play.type
            : signalTypeById.get(play.signal_id) ?? "technique",
          detail: typeof play.detail === "string" ? play.detail : "",
          recipe: typeof play.recipe === "string" ? play.recipe : null,
          skill_name: typeof play.skill_name === "string" ? play.skill_name : null,
          skill_description: typeof play.skill_description === "string" ? play.skill_description : null,
          // Dedup so duplicate tool names can't produce duplicate React keys on render.
          recommended_tools: Array.isArray(play.recommended_tools)
            ? Array.from(new Set(play.recommended_tools.filter((tool): tool is string => typeof tool === "string")))
            : [],
          estimated_minutes_saved_per_week: Number.isFinite(play.estimated_minutes_saved_per_week)
            ? play.estimated_minutes_saved_per_week
            : 0,
          confidence: Number.isFinite(play.confidence) ? play.confidence : 0,
        }));

      const record: PersistedAccelerationRecord = {
        plays,
        generated_at: startedAt,
        generated_for_week: currentWeekId,
        model,
        prompt_version: ACCELERATION_PROMPT_VERSION,
      };
      setGeneratedPlays(record);
      accelerationAsync.setStatus("idle");
      setAuditEvents((current) =>
        [
          ...current,
          createAuditEvent({
            type: "acceleration_engine",
            source: auditSource,
            title: "Acceleration skills generated",
            summary: `${plays.length} acceleration ${plays.length === 1 ? "play" : "plays"} authored for ${currentWeekRangeLabel}`,
            privacy_level: "derived_only",
            timestamp: startedAt,
            details: {
              week_id: currentWeekId,
              week_range: currentWeekRangeLabel,
              model,
              prompt_version: ACCELERATION_PROMPT_VERSION,
              signal_count: signals.length,
              authored_play_count: plays.length,
              derived_only: true,
              window_titles: false,
              sent_to_provider: true,
            },
          }),
        ].slice(-1000)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      accelerationAsync.fail(message);
      setAuditEvents((current) =>
        [
          ...current,
          createAuditEvent({
            type: "acceleration_engine",
            source: auditSource,
            title: "Acceleration synthesis failed",
            summary: message,
            privacy_level: "derived_only",
            timestamp: startedAt,
            details: {
              week_id: currentWeekId,
              prompt_version: ACCELERATION_PROMPT_VERSION,
              signal_count: signals.length,
              derived_only: true,
              window_titles: false,
              sent_to_provider: true,
            },
          }),
        ].slice(-1000)
      );
    }
  }

  return {
    accelerationStatus,
    accelerationError,
    generateAccelerationPlays,
    resetAcceleration: accelerationAsync.reset,
  };
}
