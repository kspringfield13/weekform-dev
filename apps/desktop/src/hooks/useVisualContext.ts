import { invoke } from "@tauri-apps/api/core";
import type {
  ActivitySession,
  AuditEvent,
  VisualContextInsight,
  WorkCategory,
  WorkMode,
  AIConfig,
} from "../../../../packages/domain/src/models";
import { useAsyncStatus } from "./useAsyncStatus";
import { buildVisualContextPrompt, VISUAL_CONTEXT_PROMPT_VERSION } from "../services/visualContextPrompt";
import { createAuditEvent } from "../lib/audit";
import { aiAuditSource, generationProviderUnsupportedMessage, providerSupportsGeneration } from "../services/aiProviders";
import { withAiTimeout } from "../lib/aiTimeout";
import { stableHash } from "../lib/blocks";
import { MAX_VISUAL_CONTEXT_CAPTURES_PER_DAY } from "../lib/constants";

interface NativeVisualContextResponse {
  insight: {
    activity_summary: string;
    visible_tool: string | null;
    likely_work_category: WorkCategory | null;
    likely_mode: WorkMode | null;
    project_hint: string | null;
    sensitive_content_detected: boolean;
    confidence: number;
    evidence: string[];
  };
  model: string;
  captured_at_ms: number;
  app_name: string;
  window_title: string | null;
  session_id: string | null;
  raw_screenshot_retained: boolean;
}

interface UseVisualContextParams {
  isDemoMode: boolean;
  aiConfig: AIConfig | null;
  setVisualContextInsights: React.Dispatch<React.SetStateAction<VisualContextInsight[]>>;
  setAuditEvents: React.Dispatch<React.SetStateAction<AuditEvent[]>>;
}

export function useVisualContext({
  isDemoMode,
  aiConfig,
  setVisualContextInsights,
  setAuditEvents,
}: UseVisualContextParams) {
  const [visualContextStatus, visualContextError, visualContextAsync] =
    useAsyncStatus<"idle" | "capturing">("idle");

  async function captureVisualContext(session: ActivitySession, captureCountToday: number) {
    if (isDemoMode) return;

    const provider = aiConfig?.provider ?? "openai";
    // Fail fast (before the Rust round-trip 404s or times out) when the configured provider
    // can't run the Rust generation path — it only powers the Agent chat today. Returns before
    // any capture/insight, so a blocked provider adds nothing against the daily visual cap.
    if (!providerSupportsGeneration(provider)) {
      visualContextAsync.fail(generationProviderUnsupportedMessage(provider));
      return;
    }
    const auditSource = aiAuditSource(provider, "vision", aiConfig?.connectionMode);
    const startedAt = new Date().toISOString();
    const prompt = buildVisualContextPrompt({
      session,
      captureCountToday,
      maxDailyCaptures: MAX_VISUAL_CONTEXT_CAPTURES_PER_DAY,
    });

    visualContextAsync.start("capturing");

    try {
      const response = await withAiTimeout(
        invoke<NativeVisualContextResponse>("capture_visual_context_with_openai", {
          request: {
            prompt,
            appName: session.app_name,
            windowTitle: session.window_title,
            sessionId: session.session_id,
            ai_config: aiConfig,
          },
        })
      );
      // Guard the native `captured_at_ms` before ISO-formatting it: a missing / NaN /
      // out-of-range value makes `new Date(x).toISOString()` throw a RangeError, which
      // (inside this try) would be caught and MISREPORTED as a "capture failed" — silently
      // discarding a successful, already-paid vision analysis. Fall back to the capture-start
      // ISO (`startedAt`) so the insight is preserved. Uses the shared finite-before-toISOString
      // idiom (`Number.isFinite(new Date(x).getTime())`, mirroring useActiveWindow's guard on
      // the native timestamp_ms) — which also catches an in-range-finite-but-out-of-Date-range
      // value a bare `Number.isFinite(captured_at_ms)` would miss. `insight.captured_at` is
      // reused for the audit timestamp below, so both stay on one valid ISO.
      const capturedDate = new Date(response.captured_at_ms);
      const capturedAt = Number.isFinite(capturedDate.getTime())
        ? capturedDate.toISOString()
        : startedAt;
      const insight: VisualContextInsight = {
        insight_id: `visual-${stableHash(`${response.captured_at_ms}-${session.session_id}`)}`,
        captured_at: capturedAt,
        session_id: response.session_id,
        app_name: response.app_name,
        window_title: response.window_title,
        activity_summary: response.insight.activity_summary,
        visible_tool: response.insight.visible_tool,
        likely_work_category: response.insight.likely_work_category,
        likely_mode: response.insight.likely_mode,
        project_hint: response.insight.project_hint,
        sensitive_content_detected: response.insight.sensitive_content_detected,
        // Normalize the AI-returned confidence to a finite [0,1] value at the parse layer so a
        // malformed vision response (e.g. a non-strict provider emitting a 0–100 scale → 5) can't
        // render an impossible "500%" in the capture panel, or stream an out-of-range value into
        // the persisted insight, the audit trail, and the getVisualInsightsSummary agent tool.
        // Matches the parse-layer normalization in useClassification/useReviewCopilot/useForecastAgent.
        confidence: Number.isFinite(response.insight.confidence)
          ? Math.max(0, Math.min(1, response.insight.confidence))
          : 0,
        evidence: response.insight.evidence,
        privacy_level: "derived_only",
        model: response.model,
        raw_screenshot_retained: response.raw_screenshot_retained,
      };

      setVisualContextInsights((current) => [...current, insight].slice(-200));
      visualContextAsync.setStatus("idle");
      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "visual_context",
          source: auditSource,
          title: "Visual context captured",
          summary: insight.activity_summary,
          privacy_level: "derived_only",
          timestamp: insight.captured_at,
          details: {
            insight,
            prompt_version: VISUAL_CONTEXT_PROMPT_VERSION,
            capture_mode: "smart_occasional",
            capture_count_today: captureCountToday + 1,
            max_daily_captures: MAX_VISUAL_CONTEXT_CAPTURES_PER_DAY,
            sent_to_provider: true,
            raw_screenshot_retained: response.raw_screenshot_retained,
            ...(aiConfig?.connectionMode === "codex"
              ? { codex_thread_ephemeral: true }
              : { store: false }),
          },
        }),
      ].slice(-1000));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      visualContextAsync.fail(message);
      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "visual_context",
          source: auditSource,
          title: "Visual context capture failed",
          summary: message,
          privacy_level: "derived_only",
          timestamp: startedAt,
          details: {
            session_id: session.session_id,
            app_name: session.app_name,
            window_title: session.window_title,
            prompt_version: VISUAL_CONTEXT_PROMPT_VERSION,
            capture_mode: "smart_occasional",
            sent_to_provider: false,
            raw_screenshot_retained: false,
          },
        }),
      ].slice(-1000));
    }
  }

  return {
    visualContextStatus,
    visualContextError,
    captureVisualContext,
    resetVisualContext: visualContextAsync.reset,
  };
}
