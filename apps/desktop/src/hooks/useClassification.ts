import type {
  ActivitySession,
  AuditEvent,
  OutlookCalendarEvent,
  PlannedStatus,
  UserCorrection,
  VisualContextInsight,
  WorkBlock,
  WorkCategory,
  WorkMode,
  AIConfig,
} from "../../../../packages/domain/src/models";
import { useEffect } from "react";
import { plannedStatuses, workCategories, workModes } from "../../../../packages/domain/src/taxonomy";
import { useAsyncStatus } from "./useAsyncStatus";
import { buildWorkBlockClassifierPrompt, WORK_BLOCK_CLASSIFIER_PROMPT_VERSION } from "../services/workBlockClassifierPrompt";
import { aiCompleteJson, jsonSchemaFormat } from "../services/aiComplete";
import { WORK_BLOCK_CLASSIFIER_INSTRUCTIONS, workBlockClassifierSchema } from "../services/workBlockClassifierSchema";
import { createAuditEvent } from "../lib/audit";
import { stableHash, capacityPctFromMinutes } from "../lib/blocks";
import { aiAuditSource, aiProviderLabel, generationProviderUnsupportedMessage, providerSupportsGeneration } from "../services/aiProviders";

interface NativeClassifiedWorkBlock {
  session_ids: string[];
  start_time: string;
  end_time: string;
  category: WorkCategory;
  mode: WorkMode;
  planned_status: PlannedStatus;
  project_name: string;
  stakeholder_group: string;
  evidence: string[];
  confidence: number;
  blocker_flag: boolean;
  notes: string | null;
}

interface UseClassificationParams {
  isDemoMode: boolean;
  blocks: WorkBlock[];
  setBlocks: React.Dispatch<React.SetStateAction<WorkBlock[]>>;
  activeWindowSessions: ActivitySession[];
  currentWeekId: string;
  currentWeekRangeLabel: string;
  visualContextInsights: VisualContextInsight[];
  calendarEvents: OutlookCalendarEvent[];
  corrections: UserCorrection[];
  aiConfig: AIConfig | null;
  setAuditEvents: React.Dispatch<React.SetStateAction<AuditEvent[]>>;
}

// Conservative fallbacks for when a non-strict provider returns a value outside
// the taxonomy (schema enums are advisory, not runtime-enforced). These mirror
// the `window` SOURCE_DEFAULTS in `integrations/import/rawEvents.ts` — the same
// foreground-activity origin these draft blocks come from — so an off-taxonomy
// label can't poison capacity math with an unrecognized category/mode/status.
const FALLBACK_CATEGORY: WorkCategory = "Planned analysis / project work";
const FALLBACK_MODE: WorkMode = "Deep work";
const FALLBACK_PLANNED_STATUS: PlannedStatus = "planned";

function classifiedBlockToWorkBlock(
  block: NativeClassifiedWorkBlock,
  sourceSessions: Map<string, ActivitySession>,
  currentWeekId: string,
  providerLabel: string
): WorkBlock | null {
  const sessions = block.session_ids
    .map((sessionId) => sourceSessions.get(sessionId))
    .filter((session): session is ActivitySession => Boolean(session));

  if (sessions.length === 0) return null;

  const parsedStart = new Date(block.start_time).getTime();
  const parsedEnd = new Date(block.end_time).getTime();
  // Drop unparseable timestamps (a corrupt/legacy persisted ISO yields NaN) BEFORE the
  // min/max — a single bad session time would otherwise poison Math.min/max to NaN and make
  // `new Date(startMs).toISOString()` below THROW, aborting the whole `data.work_blocks.map`
  // batch and discarding every well-formed draft block. Applies the same `!Number.isNaN` filter
  // the AI-returned times already get, now extended to the session-derived candidates.
  const startCandidates = sessions
    .map((session) => new Date(session.start_time).getTime())
    .filter((ms) => !Number.isNaN(ms));
  const endCandidates = sessions
    .map((session) => new Date(session.end_time).getTime())
    .filter((ms) => !Number.isNaN(ms));
  if (!Number.isNaN(parsedStart)) startCandidates.push(parsedStart);
  if (!Number.isNaN(parsedEnd)) endCandidates.push(parsedEnd);
  // No valid timestamp on either end ⇒ nothing to place the block on — skip it (like the
  // `sessions.length === 0` guard above) so the rest of the batch still classifies.
  if (startCandidates.length === 0 || endCandidates.length === 0) return null;
  const startMs = Math.min(...startCandidates);
  const endMs = Math.max(...endCandidates);
  const durationMinutes = sessions.reduce((total, session) => total + session.duration_minutes, 0);
  const sessionIds = sessions.map((session) => session.session_id);
  const id = `ai-session-${stableHash(sessionIds.sort().join("|"))}`;

  // Validate the three taxonomy-typed fields against the actual vocabularies —
  // the response is trusted TS but not runtime-checked, so a non-strict provider
  // can return an off-taxonomy label that would flow untouched into every
  // capacity computation. Coerce anything unrecognized to a conservative default.
  const category = workCategories.includes(block.category) ? block.category : FALLBACK_CATEGORY;
  const mode = workModes.includes(block.mode) ? block.mode : FALLBACK_MODE;
  const plannedStatus = plannedStatuses.includes(block.planned_status)
    ? block.planned_status
    : FALLBACK_PLANNED_STATUS;
  const coercedFields = [
    category !== block.category ? "category" : null,
    mode !== block.mode ? "mode" : null,
    plannedStatus !== block.planned_status ? "planned status" : null,
  ].filter((field): field is string => field !== null);

  return {
    work_block_id: id,
    week_id: currentWeekId,
    start_time: new Date(startMs).toISOString(),
    end_time: new Date(endMs).toISOString(),
    estimated_capacity_pct: capacityPctFromMinutes(durationMinutes),
    category,
    mode,
    planned_status: plannedStatus,
    project_name: block.project_name.trim() || "Local activity",
    stakeholder_group: block.stakeholder_group.trim() || "Unknown stakeholder",
    derived_from: sessionIds,
    evidence: [
      `Drafted by ${providerLabel} from local active-window sessions`,
      ...(coercedFields.length > 0
        ? [`Adjusted off-taxonomy ${coercedFields.join(", ")} to a conservative default`]
        : []),
      ...block.evidence,
    ],
    // Finite-guard BEFORE clamping: the schema enums are advisory (aiCompleteJson is
    // JSON.parse only), so a non-strict provider can return a missing/null/non-numeric
    // confidence. `Math.max/min` PROPAGATE NaN, so a range-only clamp would persist
    // `confidence: NaN` — and `isCarryoverRisk`'s `confidence < 0.75` is false for NaN,
    // silently dropping an unverified draft from carryover risk (under-counting committed
    // load, over-stating reliable capacity). Fall back to the clamp floor 0.45 (the lowest
    // classifier confidence) so a malformed value is treated as carryover-risk-eligible.
    // Mirrors the finite-then-clamp guard in useReviewCopilot/useForecastAgent/useAcceleration.
    confidence: Number.isFinite(block.confidence)
      ? Math.max(0.45, Math.min(0.9, block.confidence))
      : 0.45,
    user_verified: false,
    blocker_flag: block.blocker_flag,
    notes: block.notes,
  };
}

export function useClassification({
  isDemoMode,
  blocks,
  setBlocks,
  activeWindowSessions,
  currentWeekId,
  currentWeekRangeLabel,
  visualContextInsights,
  calendarEvents,
  corrections,
  aiConfig,
  setAuditEvents,
}: UseClassificationParams) {
  const [classificationStatus, classificationError, classificationAsync] =
    useAsyncStatus<"idle" | "classifying">("idle");

  useEffect(() => {
    if (classificationStatus !== "classifying") {
      classificationAsync.reset();
    }
  }, [aiConfig]);

  async function classifyActiveWindowSessions() {
    if (isDemoMode) return;
    if (classificationStatus === "classifying") return;

    const alreadyClassified = new Set(blocks.flatMap((block) => block.derived_from));
    const candidateSessions = activeWindowSessions
      .filter((session) => !alreadyClassified.has(session.session_id) && session.sample_count >= 2)
      .sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime());

    if (candidateSessions.length === 0) {
      classificationAsync.fail("No unclassified active-window sessions are ready yet.");
      return;
    }

    const provider = aiConfig?.provider ?? "openai";
    // Fail fast (before the Rust round-trip 404s or times out) when the configured provider
    // can't run the Rust generation path — it only powers the Agent chat today.
    if (!providerSupportsGeneration(provider)) {
      classificationAsync.fail(generationProviderUnsupportedMessage(provider));
      return;
    }
    const auditSource = aiAuditSource(provider);
    const startedAt = new Date().toISOString();
    const prompt = buildWorkBlockClassifierPrompt({
      weekId: currentWeekId,
      weekRangeLabel: currentWeekRangeLabel,
      sessions: candidateSessions,
      visualContextInsights,
      existingBlocks: blocks,
      calendarEvents,
      corrections,
    });

    classificationAsync.start("classifying");

    try {
      const { data, model } = await aiCompleteJson<{ work_blocks: NativeClassifiedWorkBlock[] }>({
        prompt,
        instructions: WORK_BLOCK_CLASSIFIER_INSTRUCTIONS,
        responseFormat: jsonSchemaFormat("clear_capacity_work_block_classification", workBlockClassifierSchema),
        aiConfig,
      });
      const sessionMap = new Map(candidateSessions.map((session) => [session.session_id, session]));
      const draftBlocks = data.work_blocks
        .map((block) => classifiedBlockToWorkBlock(block, sessionMap, currentWeekId, aiProviderLabel(provider)))
        .filter((block): block is WorkBlock => Boolean(block));

      if (data.work_blocks.length === 0) {
        const message =
          `The ${aiConfig?.provider ?? "AI"} provider completed the request but returned no work blocks. ` +
          "Try again; ready sessions should now be grouped conservatively when their context is ambiguous.";
        classificationAsync.fail(message);
        setAuditEvents((current) => [
          ...current,
          createAuditEvent({
            type: "work_block_classification",
            source: auditSource,
            title: "Classification returned no work blocks",
            summary: message,
            privacy_level: "derived_only",
            timestamp: startedAt,
            details: {
              week_id: currentWeekId,
              week_range: currentWeekRangeLabel,
              model,
              prompt_version: WORK_BLOCK_CLASSIFIER_PROMPT_VERSION,
              input_session_count: candidateSessions.length,
              output_work_block_count: 0,
              sent_to_provider: true,
              store: false,
            },
          }),
        ].slice(-1000));
        return;
      }

      if (draftBlocks.length === 0) {
        const message =
          `The ${aiConfig?.provider ?? "AI"} provider returned work blocks, but none referenced valid session IDs. Please try again.`;
        classificationAsync.fail(message);
        setAuditEvents((current) => [
          ...current,
          createAuditEvent({
            type: "work_block_classification",
            source: auditSource,
            title: "Classification returned invalid session references",
            summary: message,
            privacy_level: "derived_only",
            timestamp: startedAt,
            details: {
              week_id: currentWeekId,
              week_range: currentWeekRangeLabel,
              model,
              prompt_version: WORK_BLOCK_CLASSIFIER_PROMPT_VERSION,
              input_session_count: candidateSessions.length,
              provider_work_block_count: data.work_blocks.length,
              output_work_block_count: 0,
              sent_to_provider: true,
              store: false,
            },
          }),
        ].slice(-1000));
        return;
      }

      setBlocks((current) => {
        const existingIds = new Set(current.map((block) => block.work_block_id));
        return [
          ...current,
          ...draftBlocks.filter((block) => !existingIds.has(block.work_block_id)),
        ].sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime());
      });
      classificationAsync.setStatus("idle");
      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "work_block_classification",
          source: auditSource,
          title: "Active-window sessions classified",
          summary: `${draftBlocks.length} draft work block${draftBlocks.length === 1 ? "" : "s"} created from ${candidateSessions.length} session${candidateSessions.length === 1 ? "" : "s"}`,
          privacy_level: "derived_only",
          timestamp: startedAt,
          details: {
            week_id: currentWeekId,
            week_range: currentWeekRangeLabel,
            model,
            prompt_version: WORK_BLOCK_CLASSIFIER_PROMPT_VERSION,
            input_session_count: candidateSessions.length,
            output_work_block_count: draftBlocks.length,
            work_block_ids: draftBlocks.map((block) => block.work_block_id),
            sent_to_provider: true,
            store: false,
          },
        }),
      ].slice(-1000));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      classificationAsync.fail(message);
      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "work_block_classification",
          source: auditSource,
          title: "Active-window classification failed",
          summary: message,
          privacy_level: "derived_only",
          timestamp: startedAt,
          details: {
            week_id: currentWeekId,
            week_range: currentWeekRangeLabel,
            prompt_version: WORK_BLOCK_CLASSIFIER_PROMPT_VERSION,
            input_session_count: candidateSessions.length,
            sent_to_provider: true,
          },
        }),
      ].slice(-1000));
    }
  }

  return {
    classificationStatus,
    classificationError,
    classifyActiveWindowSessions,
    resetClassification: classificationAsync.reset,
  };
}
