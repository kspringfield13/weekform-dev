import { Store } from "@tauri-apps/plugin-store";
import type {
  AccelerationPlayType,
  ActiveWindowSample,
  AuditEvent,
  AuditEventType,
  ForecastAgentResult,
  OutlookCalendarEvent,
  RawEvent,
  ReviewCopilotSuggestion,
  SavedSkill,
  TokenUsageDay,
  TokenUsageSettings,
  UsageMeasurement,
  UsageSourceType,
  VisualContextInsight,
  WeeklyCapacitySnapshot,
  WeeklyNarrative,
  UserCorrection,
  WorkBlock,
  AIConfig
} from "../../../../packages/domain/src/models";
import {
  DEFAULT_PROACTIVE_ALERT_SETTINGS,
  EMPTY_PROACTIVE_ALERT_RUNTIME,
  type ProactiveAlertRuntime,
  type ProactiveAlertSettings,
} from "../lib/proactiveAlerts";
import type { WindowMode } from "../lib/types";
import type { AuthoredAccelerationPlay } from "./accelerationSchema";
import { parseConsentReceipts, type ConsentReceiptV1 } from "./consentReceipt";

const STORE_FILE = "clear-capacity.store";
const STATE_KEY = "appState";
const THEME_KEY = "theme";
const STORAGE_KEY = "clear-capacity:v1"; // fallback for non-Tauri
const THEME_STORAGE_KEY = "clear-capacity:theme";

export type AppTheme = "light" | "dark";

/**
 * Lifecycle of the post-walkthrough "Getting started" modal. `unseen` shows the
 * modal once the first-run walkthrough finishes; `skipped` means the user chose
 * "I'll do this later" (the persistent enable-tracking reminder banner shows
 * until tracking is turned on); `complete` means tracking was enabled (from the
 * modal or anywhere else) and the flow never resurfaces.
 */
export type GettingStartedStatus = "unseen" | "skipped" | "complete";

export interface PersistedNarrativeRecord {
  narrative: WeeklyNarrative;
  generated_at: string;
  generated_for_date: string;
  trigger: "auto" | "manual";
  model: string;
  prompt_version: string;
}

export interface PersistedForecastRecord {
  forecast: ForecastAgentResult;
  generated_at: string;
  generated_for_week: string;
  trigger: "manual";
  model: string;
  prompt_version: string;
}

/**
 * The AI-authored Acceleration Plays from the most recent opt-in synthesis run
 * (D2's `useAcceleration`). The deterministic miner re-derives its signals each
 * render, so only the authored payload is persisted here (keyed back to each
 * signal by `signal_id`); the hook merges it onto the live signals. Latest run
 * wins. Mirrors `PersistedForecastRecord`.
 */
export interface PersistedAccelerationRecord {
  plays: AuthoredAccelerationPlay[];
  generated_at: string;
  generated_for_week: string;
  model: string;
  prompt_version: string;
}

/**
 * A computed weekly snapshot retained under its ISO `week_id`. One record per week
 * (latest computation wins); the trail enables cross-week trends and personal
 * baselines. Mirrors `PersistedForecastRecord` so UI/inference can type against it
 * without importing storage internals.
 */
export interface PersistedSnapshotRecord {
  week_id: string;
  snapshot: WeeklyCapacitySnapshot;
  computed_at: string;
}

/** The compact per-signal summary retained in a weekly acceleration snapshot (E2). */
export interface PersistedAccelerationSignalSummary {
  signal_id: string;
  type: AccelerationPlayType;
  estimated_minutes_saved_per_week: number;
}

/**
 * A per-ISO-week snapshot of the surfaced Acceleration signals (the ranked, capped top-N the user
 * actually sees), retained so the engine can see which signals RECUR across weeks (a habit) versus
 * one-offs (noise). Only the derived summary is stored — id/type/minutes, never the evidence
 * strings — which keeps it compact and privacy-trivial (no window titles, no app names). One record
 * per week (latest computation wins). Mirrors `PersistedSnapshotRecord`.
 */
export interface PersistedAccelerationSnapshot {
  week_id: string;
  generated_at: string;
  signals: PersistedAccelerationSignalSummary[];
}

/**
 * A past forecast paired with how it scored once its target week arrived. Assembled
 * in `useDerived` from `forecastHistory` + the live snapshot; kept here next to
 * `PersistedForecastRecord` so UI components type against it without importing
 * inference internals.
 */
export interface ForecastAccuracyReview {
  record: PersistedForecastRecord;
  predicted_pct: number;
  actual_pct: number;
  error_pts: number;
  signed_error_pts: number;
  rating: "on_target" | "close" | "off";
}

/** Everything off, empty price map — AI-usage tracking is opt-in per source. */
export const DEFAULT_TOKEN_USAGE_SETTINGS: TokenUsageSettings = {
  observed_proxy_enabled: false,
  include_in_manager_summary: false,
  price_map: {}
};

export interface PersistedAppState {
  version: 1;
  blocks: WorkBlock[];
  calendarEvents: OutlookCalendarEvent[];
  /** Imported workplace-chat events (metadata only), kept for the interruption-load signal. */
  chatEvents: RawEvent[];
  activeWindowSamples: ActiveWindowSample[];
  auditEvents: AuditEvent[];
  corrections: UserCorrection[];
  reviewSuggestions: ReviewCopilotSuggestion[];
  generatedForecast: PersistedForecastRecord | null;
  forecastHistory: PersistedForecastRecord[];
  snapshotHistory: PersistedSnapshotRecord[];
  /** Per-week summary of the mined Acceleration signals, for cross-week recurrence (E2). */
  accelerationHistory: PersistedAccelerationSnapshot[];
  visualContextEnabled: boolean;
  visualContextInsights: VisualContextInsight[];
  /** signal_ids of Acceleration Plays the user dismissed (hidden across reloads). */
  dismissedPlayIds: string[];
  /** signal_ids of Acceleration Plays the user marked as acted on (feeds the realized-savings track record). */
  actedOnPlayIds: string[];
  /** Latest AI-authored Acceleration Plays (opt-in synthesis); null until generated. */
  generatedPlays: PersistedAccelerationRecord | null;
  /** User-saved acceleration skill recipes (durable snapshots, survive regeneration). */
  savedSkills: SavedSkill[];
  managerSummaryText: string | null;
  generatedNarrative: PersistedNarrativeRecord | null;
  lastNarrativeAutoRunDate: string | null;
  paused: boolean;
  aiConfig: AIConfig | null;
  /** Auto-expiry window (days) for raw activity samples; null = keep everything. */
  retentionDays: number | null;
  /** Whether the user dismissed the first-run getting-started card. */
  onboardingDismissed: boolean;
  /** Whether the user has finished (or skipped) the first-run app walkthrough. */
  walkthroughCompleted: boolean;
  /** Lifecycle of the post-walkthrough "Getting started" (enable tracking) modal. */
  gettingStartedStatus: GettingStartedStatus;
  /**
   * How the Weekform window opens (tray click / relaunch): the full dashboard or
   * the compact menu-bar widget. Defaults to the full window so a first-time user
   * lands in the walkthrough and getting-started flow, which only run there.
   */
  defaultWindowMode: WindowMode;
  /** Opt-in configuration for proactive menu-bar alerts. */
  proactiveAlertSettings: ProactiveAlertSettings;
  /** Throttle/dedup bookkeeping for proactive OS notifications. */
  proactiveAlertRuntime: ProactiveAlertRuntime;
  /** Persisted measured usage rollups from CSV imports; proxy days are derived live, never stored. */
  tokenUsageDays: TokenUsageDay[];
  /** Opt-in AI-usage tracking configuration (proxy, manager toggle, price map). */
  tokenUsageSettings: TokenUsageSettings;
  /** stableHash of every accepted usage-CSV row, for idempotent re-imports. */
  usageCsvRowHashes: string[];
  /** One durable consent receipt per approved cloud share (consentReceipt.ts). */
  consentReceipts: ConsentReceiptV1[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const SUPPORTED_AUDIT_EVENT_TYPES = new Set<AuditEventType>([
  "active_window_sample",
  "activity_session",
  "calendar_import",
  "chat_import",
  "user_correction",
  "narrative_generation",
  "work_block_classification",
  "review_copilot",
  "forecast_agent",
  "visual_context",
  "privacy_pause",
  "privacy_resume",
  "retention_policy",
  "visual_context_policy",
  "data_reset",
  "data_export",
  "proactive_alert",
  "acceleration_engine",
  "onboarding",
  "usage_import",
  "usage_settings",
  "cloud_sharing",
  "weekly_review"
]);

const AI_AUDIT_EVENT_TYPES = new Set<AuditEventType>([
  "narrative_generation",
  "work_block_classification",
  "review_copilot",
  "forecast_agent",
  "visual_context"
]);

const CURRENT_AI_AUDIT_SOURCES = new Set([
  "openai_responses_api",
  "openai_vision",
  "grok_responses_api",
  "grok_vision",
  "deepseek_responses_api",
  "deepseek_vision",
  "custom_responses_api",
  "custom_vision",
  "codex_app_server",
  "codex_app_server_vision"
]);

/** Drop retired audit variants and normalize usage-setting history to the current fields. */
function parseAuditEvents(value: unknown): AuditEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.event_id !== "string" ||
      typeof entry.timestamp !== "string" ||
      typeof entry.type !== "string" ||
      !SUPPORTED_AUDIT_EVENT_TYPES.has(entry.type as AuditEventType) ||
      typeof entry.source !== "string" ||
      typeof entry.title !== "string" ||
      typeof entry.summary !== "string" ||
      typeof entry.privacy_level !== "string" ||
      !isRecord(entry.details)
    ) {
      return [];
    }

    const event = entry as unknown as AuditEvent;
    if (event.type === "usage_settings") {
      return [{
        ...event,
        title: "AI usage settings changed",
        summary: "Updated AI usage preferences",
        details: {
          observed_proxy_enabled: event.details.observed_proxy_enabled === true,
          include_in_manager_summary: event.details.include_in_manager_summary === true,
          price_map_entry_count:
            typeof event.details.price_map_entry_count === "number" &&
            Number.isFinite(event.details.price_map_entry_count)
              ? event.details.price_map_entry_count
              : 0,
          stored_locally: true,
          sent_to_cloud: false
        }
      }];
    }

    if (AI_AUDIT_EVENT_TYPES.has(event.type) && !CURRENT_AI_AUDIT_SOURCES.has(event.source)) {
      return [{
        ...event,
        source: "configured_ai_provider",
        title: "AI activity retained",
        summary: "Legacy provider metadata removed during local migration",
        details: {
          provider_metadata_removed: true,
          stored_locally: true,
          sent_to_cloud:
            event.details.sent_to_provider === true || event.details.sent_to_cloud === true
        }
      }];
    }

    return [event];
  });
}

const SUPPORTED_AI_PROVIDERS = new Set<AIConfig["provider"]>([
  "openai",
  "grok",
  "deepseek",
  "custom"
]);

/** Drop stale or malformed provider configuration instead of rehydrating it into Settings. */
function parseAIConfig(value: unknown): AIConfig | null {
  if (
    !isRecord(value) ||
    typeof value.provider !== "string" ||
    !SUPPORTED_AI_PROVIDERS.has(value.provider as AIConfig["provider"]) ||
    typeof value.apiKey !== "string" ||
    typeof value.model !== "string"
  ) {
    return null;
  }
  const connectionMode = value.connectionMode === "codex" ? "codex" : "api_key";
  if (connectionMode === "codex" && value.provider !== "openai") return null;
  return {
    provider: value.provider as AIConfig["provider"],
    connectionMode,
    apiKey: value.apiKey,
    model: value.model,
    ...(typeof value.baseUrl === "string" ? { baseUrl: value.baseUrl } : {}),
    ...(typeof value.visionModel === "string" ? { visionModel: value.visionModel } : {})
  };
}

/**
 * Validate the persisted getting-started status. Legacy blobs predate the field:
 * anyone who already finished the first-run walkthrough must NOT retroactively
 * get the "Getting started" modal on their next launch, so a missing/malformed
 * value degrades to "complete" when the walkthrough flag is set and "unseen"
 * otherwise (a genuinely new profile still gets the flow).
 */
function parseGettingStartedStatus(value: unknown, walkthroughCompleted: boolean): GettingStartedStatus {
  if (value === "unseen" || value === "skipped" || value === "complete") return value;
  return walkthroughCompleted ? "complete" : "unseen";
}

/** Malformed/legacy values fall back to the full window — the mode onboarding needs. */
function parseDefaultWindowMode(value: unknown): WindowMode {
  return value === "compact" ? "compact" : "large";
}

function parseRetentionDays(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function parseProactiveAlertSettings(value: unknown): ProactiveAlertSettings {
  if (!isRecord(value)) return { ...DEFAULT_PROACTIVE_ALERT_SETTINGS };
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_PROACTIVE_ALERT_SETTINGS.enabled,
    capacityGuardrailEnabled:
      typeof value.capacityGuardrailEnabled === "boolean"
        ? value.capacityGuardrailEnabled
        : DEFAULT_PROACTIVE_ALERT_SETTINGS.capacityGuardrailEnabled,
    capacityThresholdPct:
      typeof value.capacityThresholdPct === "number" && Number.isFinite(value.capacityThresholdPct)
        ? value.capacityThresholdPct
        : DEFAULT_PROACTIVE_ALERT_SETTINGS.capacityThresholdPct,
    endOfDayReviewEnabled:
      typeof value.endOfDayReviewEnabled === "boolean"
        ? value.endOfDayReviewEnabled
        : DEFAULT_PROACTIVE_ALERT_SETTINGS.endOfDayReviewEnabled,
    heavyDayAheadEnabled:
      typeof value.heavyDayAheadEnabled === "boolean"
        ? value.heavyDayAheadEnabled
        : DEFAULT_PROACTIVE_ALERT_SETTINGS.heavyDayAheadEnabled,
    weeklyArtifactsEnabled:
      typeof value.weeklyArtifactsEnabled === "boolean"
        ? value.weeklyArtifactsEnabled
        : DEFAULT_PROACTIVE_ALERT_SETTINGS.weeklyArtifactsEnabled,
    fragmentationEnabled:
      typeof value.fragmentationEnabled === "boolean"
        ? value.fragmentationEnabled
        : DEFAULT_PROACTIVE_ALERT_SETTINGS.fragmentationEnabled,
  };
}

function parseProactiveAlertRuntime(value: unknown): ProactiveAlertRuntime {
  if (!isRecord(value)) return { ...EMPTY_PROACTIVE_ALERT_RUNTIME };
  return {
    lastFiredSignatureByRule: isRecord(value.lastFiredSignatureByRule)
      ? (value.lastFiredSignatureByRule as Record<string, string>)
      : {},
    lastFiredAt: typeof value.lastFiredAt === "string" ? value.lastFiredAt : null,
    firedCountByDate: isRecord(value.firedCountByDate)
      ? (value.firedCountByDate as Record<string, number>)
      : {},
  };
}

function parseForecastHistory(value: unknown): PersistedForecastRecord[] {
  if (!Array.isArray(value)) return [];
  // Require a FINITE `reliable_new_work_capacity_pct` — the one numeric field the accuracy
  // math actually reads. `scoreForecastAccuracy` does `roundPct(predicted - actual)` and
  // `Math.round(NaN)` is NaN, which forces every rating to "off" and renders "NaN pts" across
  // the track record + rolling MAE trend. A legacy/hand-edited blob whose `forecast` object is
  // present but lacks a numeric pct degrades to being dropped (matching parseAccelerationHistory)
  // instead of poisoning the UI. `Number.isFinite` (no coercion) rejects missing/null/string/NaN.
  //
  // Also require a string `generated_at`: it's declared required on `PersistedForecastRecord`, and
  // `useDerived` sorts/dedupes these records by it via `entry.generated_at.localeCompare(...)`
  // (`:85` picks the latest forecast for the current week; `:120` keeps the latest per target week).
  // A corrupt/legacy blob missing it would make that receiver `undefined`, and `undefined.localeCompare`
  // THROWS a TypeError — a hard render crash, not the cosmetic NaN the pct guard defends against.
  // Every real/demo write stamps a string `generated_at` (useForecastAgent/App/demoData), so this
  // only ever drops a malformed record, matching the sibling `week_id` guard in parseSnapshotHistory.
  return value.filter(
    (entry): entry is PersistedForecastRecord =>
      isRecord(entry) &&
      isRecord(entry.forecast) &&
      Number.isFinite(entry.forecast.reliable_new_work_capacity_pct) &&
      typeof entry.generated_for_week === "string" &&
      typeof entry.generated_at === "string"
  );
}

// The SINGULAR persisted forecast (`generatedForecast`) is display-only, but ForecastAgentPanel
// renders FIVE of its numeric fields directly — the four scenario pcts (reliable / conservative /
// likely / optimistic) across the summary cards, the range labels, and the range aria-label, plus
// the confidence subtitle. Those go through `pct()` (a bare `Math.round`, NOT the NaN-clamping
// `formatCount`) and `Math.round(confidence * 100)`, so `pct(NaN)` paints a literal "NaN%". A
// corrupt / legacy / hand-edited persisted blob whose `forecast` object is present but carries a
// non-numeric field would therefore render "NaN%" across the panel. Require every displayed number
// finite (+ the two required string fields, matching parseForecastHistory) and degrade a malformed
// record to `null` — the panel then shows its "No AI forecast yet" empty state with the
// deterministic baseline, mirroring how the history array drops a corrupt record. This guard is
// deliberately STRICTER than parseForecastHistory's (which validates only
// `reliable_new_work_capacity_pct`, the single field its accuracy math reads) BECAUSE the singular
// renders all four scenarios + confidence; the array must stay lenient so it never drops a history
// record that is valid for scoring yet carries an unused non-finite scenario pct. It ALSO validates
// the four string-array fields the panel maps over — ForecastAgentPanel renders
// `key_constraints`/`risk_flags`/`recommended_actions`/`assumptions` through `ForecastList`, whose
// `items.length`/`items.map` would throw a hard render crash on a present-but-incomplete `forecast`
// object (a missing / non-array field), worse than the graceful degrade the empty-state fallback
// gives — the same array-render vector `parseNarrativeRecord` guards for `key_drivers`. Every
// real/demo write stamps finite values + full arrays (useForecastAgent clamps all pcts + confidence
// and coerces the four narrative arrays to `string[]` before persisting; demo seeds finite), so this
// only ever drops a corrupt blob.
function parseForecastRecord(value: unknown): PersistedForecastRecord | null {
  if (!isRecord(value) || !isRecord(value.forecast)) return null;
  const forecast = value.forecast;
  const isStringArray = (candidate: unknown): boolean =>
    Array.isArray(candidate) && candidate.every((entry) => typeof entry === "string");
  if (
    Number.isFinite(forecast.reliable_new_work_capacity_pct) &&
    Number.isFinite(forecast.conservative_capacity_pct) &&
    Number.isFinite(forecast.likely_capacity_pct) &&
    Number.isFinite(forecast.optimistic_capacity_pct) &&
    Number.isFinite(forecast.confidence) &&
    isStringArray(forecast.key_constraints) &&
    isStringArray(forecast.risk_flags) &&
    isStringArray(forecast.recommended_actions) &&
    isStringArray(forecast.assumptions) &&
    typeof value.generated_for_week === "string" &&
    typeof value.generated_at === "string"
  ) {
    return value as unknown as PersistedForecastRecord;
  }
  return null;
}

/**
 * Validate the persisted AI-authored weekly narrative record. Mirrors `parseForecastRecord`:
 * a corrupt/legacy blob degrades to `null` (the Weekly Summary then falls back to the
 * deterministic `generateWeeklyNarrative`). Beyond the record shape this checks the exact
 * fields the render path touches — `displaySafeNarrative` (`date.ts`) does `.replace()` on
 * `headline`/`summary_text`/`manager_ready_summary` and `.map()`+`.replace()` over each
 * `key_drivers` entry, so a present-but-incomplete `narrative` object (e.g. `key_drivers`
 * missing or not an array of strings) would otherwise throw a hard render crash
 * (`key_drivers.map is not a function`), worse than the graceful degrade the sibling
 * forecast/snapshot parsers guarantee. Every real/demo write stamps a full narrative, so
 * this only ever rejects a malformed blob.
 */
function parseNarrativeRecord(value: unknown): PersistedNarrativeRecord | null {
  if (!isRecord(value) || !isRecord(value.narrative)) return null;
  const narrative = value.narrative;
  if (
    typeof narrative.headline === "string" &&
    typeof narrative.summary_text === "string" &&
    typeof narrative.manager_ready_summary === "string" &&
    Array.isArray(narrative.key_drivers) &&
    narrative.key_drivers.every((driver) => typeof driver === "string") &&
    typeof value.generated_at === "string"
  ) {
    return value as unknown as PersistedNarrativeRecord;
  }
  return null;
}

function parseSnapshotHistory(value: unknown): PersistedSnapshotRecord[] {
  if (!Array.isArray(value)) return [];
  // Same guard: a retained snapshot supplies the "actual" for forecast scoring
  // (scoredForecasts reads record.snapshot.reliable_new_work_capacity_pct), so a non-finite
  // value would feed NaN into the same accuracy math. Drop the record rather than poison it.
  //
  // Also require the other three metrics `computeCapacityBaselines` medians over prior-week
  // snapshots — `reactive_pct` / `meeting_pct` / `context_switch_score` — to be finite. `median()`
  // (capacity.ts) sorts and averages its inputs with no NaN filtering, so a single NaN yields a NaN
  // median that renders as a `NaN` baseline chip and silently corrupts the "dense meetings" (meeting
  // density vs. baseline) narrative flag. Every real/demo write stamps finite values for all four,
  // so this only ever drops a corrupt/legacy blob — matching the reliable-pct guard above.
  //
  // Finally require `allocated_pct` / `deep_work_pct`: `CapacityTrendChart` (SERIES) also plots these
  // two, reading `week.snapshot[series.key]` unguarded (the `?? 0` fallback catches only `undefined`,
  // not `NaN`), so a non-finite value renders a broken `<polyline>`/`<circle>` plus a legend/table
  // "NaN%". Per the "a parse guard must validate EVERY field a consumer reads" rule, every field a
  // downstream surface dereferences must be finite for the record to survive.
  return value.filter(
    (entry): entry is PersistedSnapshotRecord =>
      isRecord(entry) &&
      isRecord(entry.snapshot) &&
      Number.isFinite(entry.snapshot.reliable_new_work_capacity_pct) &&
      Number.isFinite(entry.snapshot.reactive_pct) &&
      Number.isFinite(entry.snapshot.meeting_pct) &&
      Number.isFinite(entry.snapshot.context_switch_score) &&
      Number.isFinite(entry.snapshot.allocated_pct) &&
      Number.isFinite(entry.snapshot.deep_work_pct) &&
      typeof entry.week_id === "string"
  );
}

const ACCELERATION_PLAY_TYPES: ReadonlySet<AccelerationPlayType> = new Set<AccelerationPlayType>([
  "automate",
  "tool",
  "technique"
]);

/**
 * Validate the persisted weekly acceleration history (E2). Drops entries without a string
 * `week_id`/array `signals`, and within each record keeps only well-formed summaries (string
 * `signal_id`, known `type`, finite minutes) — so a corrupted blob degrades gracefully to a
 * smaller/empty history rather than crashing the recurrence computation.
 */
function parseAccelerationHistory(value: unknown): PersistedAccelerationSnapshot[] {
  if (!Array.isArray(value)) return [];
  const records: PersistedAccelerationSnapshot[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.week_id !== "string" || !Array.isArray(entry.signals)) {
      continue;
    }
    const signals: PersistedAccelerationSignalSummary[] = [];
    for (const signal of entry.signals) {
      if (
        isRecord(signal) &&
        typeof signal.signal_id === "string" &&
        typeof signal.type === "string" &&
        ACCELERATION_PLAY_TYPES.has(signal.type as AccelerationPlayType)
      ) {
        signals.push({
          signal_id: signal.signal_id,
          type: signal.type as AccelerationPlayType,
          estimated_minutes_saved_per_week:
            typeof signal.estimated_minutes_saved_per_week === "number" &&
            Number.isFinite(signal.estimated_minutes_saved_per_week)
              ? signal.estimated_minutes_saved_per_week
              : 0
        });
      }
    }
    records.push({
      week_id: entry.week_id,
      generated_at: typeof entry.generated_at === "string" ? entry.generated_at : "",
      signals
    });
  }
  return records;
}

function parseStringIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Validate the persisted Review-Copilot suggestions. `reviewSuggestions` is persisted
 * and hydrated on reload (App.tsx late-hydrate), but was the one AI/derived store still
 * doing a bare `Array.isArray` container check + `as` cast — trusting every field, unlike
 * its siblings (`parseForecastRecord`/`parseNarrativeRecord`/`parseSavedSkills`/
 * `parseAccelerationRecord`). Its required `work_block_ids: string[]` is dereferenced
 * WITHOUT a type guard on the render path — `ReviewCopilotPanel`'s `affectedBlocksLabel`
 * does `ids.length`/`ids.map`, so a corrupt/legacy blob whose `work_block_ids` is a
 * non-array (`null`/omitted) throws a `TypeError` mid-render and white-screens Daily Review
 * (no ErrorBoundary in `apps/desktop/src`). Mirroring `parseAccelerationRecord`, drop
 * entries lacking a string `suggestion_id` (the React key / dedup id, inert without it) and
 * coerce `work_block_ids` via the existing `parseStringIdList` (non-array → `[]`, drop
 * non-strings). Valid records pass through value-identical; only a corrupt blob is normalized.
 */
function parseReviewSuggestions(value: unknown): ReviewCopilotSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is ReviewCopilotSuggestion => isRecord(entry) && typeof entry.suggestion_id === "string")
    .map((entry) => ({ ...entry, work_block_ids: parseStringIdList(entry.work_block_ids) }));
}

/**
 * Validate the persisted AI-authored Acceleration record. Requires a real `plays`
 * array and the record metadata; a malformed blob degrades to `null` (the screen
 * then just renders the deterministic signals). Each play's fields are re-whitelisted
 * at the parse boundary (mirroring `parseSavedSkills`) because the merge/render
 * consumers dereference them WITHOUT a type guard: `App.tsx` does `match?.detail?.trim()`
 * (a non-string `detail` → `TypeError: trim is not a function`) and `recommended_tools`
 * flows through `?? []` (which only guards nullish, not a wrong type) into
 * `AccelerationScreen`'s `recommended_tools.length`/`.map` (a non-array → `.map is not a
 * function`) — either throw DURING render and white-screen the whole Acceleration screen
 * (no ErrorBoundary in `apps/desktop/src`). So `detail` coerces to a string ("" falls back
 * to the deterministic `signal.detail` via the merge's `.trim()` truthiness check),
 * `recipe`/`skill_name`/`skill_description` to `string | null`, and `recommended_tools`
 * via `parseStringIdList` (non-array → `[]`, drop non-string entries); `generated_at`
 * likewise coerces to a string (rendered as a timestamp). A play lacking a string
 * `signal_id` is dropped (it can never match a live signal by id, so it's inert). Valid
 * records pass through value-identical; only a corrupt/legacy blob is normalized.
 */
function parseAccelerationRecord(value: unknown): PersistedAccelerationRecord | null {
  if (!isRecord(value) || !Array.isArray(value.plays) || typeof value.generated_for_week !== "string") {
    return null;
  }
  const plays = value.plays
    .filter((entry): entry is AuthoredAccelerationPlay => isRecord(entry) && typeof entry.signal_id === "string")
    .map((entry) => ({
      ...entry,
      detail: typeof entry.detail === "string" ? entry.detail : "",
      recipe: typeof entry.recipe === "string" ? entry.recipe : null,
      skill_name: typeof entry.skill_name === "string" ? entry.skill_name : null,
      skill_description: typeof entry.skill_description === "string" ? entry.skill_description : null,
      recommended_tools: parseStringIdList(entry.recommended_tools)
    }));
  return {
    ...(value as unknown as PersistedAccelerationRecord),
    generated_at: typeof value.generated_at === "string" ? value.generated_at : "",
    plays
  };
}

/**
 * Validate the persisted saved-skills library. Requires each entry to carry a string
 * `signal_id` and a non-empty `recipe` (the recipe text is the whole point of the
 * snapshot); malformed/recipe-less entries are dropped. `recommended_tools` is a required
 * `string[]` that three consumers dereference unguarded (`SkillsLibraryScreen`'s
 * `.length`/`.map` render, `dataExport`'s `.join`/`for..of` CSV + SKILL.md exports), so a
 * corrupt/legacy blob missing it would crash the library render or an export — coerce it via
 * `parseStringIdList` (non-array → `[]`, drop non-string entries) rather than drop the whole
 * skill, since the recipe is the payload worth keeping (mirrors how `skill_name`/
 * `skill_description` degrade). `saved_at` is likewise coerced to a string (the sort in
 * `SkillsLibraryScreen` calls `.localeCompare` on it, which throws on a non-string receiver).
 * All other fields are trusted as the shape the save handler wrote.
 */
function parseSavedSkills(value: unknown): SavedSkill[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is SavedSkill =>
        isRecord(entry) &&
        typeof entry.signal_id === "string" &&
        typeof entry.recipe === "string" &&
        entry.recipe.length > 0
    )
    .map((entry) => ({
      ...entry,
      // `saved_at` is a required timestamp string that `SkillsLibraryScreen` sorts by via
      // `right.saved_at.localeCompare(left.saved_at)` — a non-string receiver THROWS a TypeError
      // during render and white-screens the whole Skills Library (no ErrorBoundary). Coerce a
      // missing/non-string value to the file's documented corrupt-timestamp default `""` (the
      // Intl helpers render "" as "—", and `<time dateTime="">` is invalid-but-ignored) so the
      // sort receiver is always a string, mirroring the `recommended_tools` coercion below.
      saved_at: typeof entry.saved_at === "string" ? entry.saved_at : "",
      recommended_tools: parseStringIdList(entry.recommended_tools),
    }));
}

function parseChatEvents(value: unknown): RawEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is RawEvent =>
      isRecord(entry) &&
      entry.source_type === "chat" &&
      typeof entry.timestamp_start === "string" &&
      typeof entry.timestamp_end === "string" &&
      // metadata must be a real object — `analyzeInterruptionLoad` reads counts off it
      // without guarding, so a corrupted null/missing bag would crash the render.
      isRecord(entry.metadata)
  );
}

/**
 * Validate persisted `calendarEvents`. Mirrors `parseChatEvents`: the consumer chain runs on
 * every reload (`useDerived` → `buildAccelerationSignals` → `detectMeetingLoad` →
 * `normalizeMeetingTitle(event.title)` → `title.trim()`, plus `start_time`/`end_time` are read as
 * strings when spanning meeting time), and none of it guards the field types — a corrupt/legacy
 * blob whose `title`/`start_time`/`end_time` isn't a string would throw a `TypeError` mid-render
 * and white-screen the app (no ErrorBoundary in `apps/desktop/src`). Drop any entry lacking a
 * string `title`/`start_time`/`end_time`; trust the remaining fields as the import writer's shape.
 */
function parseCalendarEvents(value: unknown): OutlookCalendarEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.title !== "string" ||
      typeof entry.start_time !== "string" ||
      typeof entry.end_time !== "string"
    ) return [];
    const source = entry.source === "google_calendar" || entry.source === "apple_calendar"
      ? entry.source
      : "outlook_calendar";
    return [{ ...entry, source } as OutlookCalendarEvent];
  });
}

const USAGE_SOURCE_TYPES: ReadonlySet<UsageSourceType> = new Set<UsageSourceType>([
  "observed",
  "csv_import"
]);
const USAGE_MEASUREMENTS: ReadonlySet<UsageMeasurement> = new Set<UsageMeasurement>([
  "exact",
  "proxy"
]);

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Validate persisted usage rollups. Requires the bucket identity fields
 * (date/source/provider/model/measurement) to be well-formed; token counts
 * degrade to 0 and a malformed cost degrades to null (recomputable from the
 * price map) — so a corrupted blob shrinks rather than crashing the summary.
 */
function parseTokenUsageDays(value: unknown): TokenUsageDay[] {
  if (!Array.isArray(value)) return [];
  const days: TokenUsageDay[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.date !== "string" ||
      typeof entry.provider !== "string" ||
      typeof entry.model !== "string" ||
      !USAGE_SOURCE_TYPES.has(entry.source_type as UsageSourceType) ||
      !USAGE_MEASUREMENTS.has(entry.measurement as UsageMeasurement)
    ) {
      continue;
    }
    days.push({
      date: entry.date,
      source_type: entry.source_type as UsageSourceType,
      provider: entry.provider,
      model: entry.model,
      measurement: entry.measurement as UsageMeasurement,
      input_tokens: finiteNonNegative(entry.input_tokens),
      output_tokens: finiteNonNegative(entry.output_tokens),
      cache_read_tokens: finiteNonNegative(entry.cache_read_tokens),
      cache_creation_tokens: finiteNonNegative(entry.cache_creation_tokens),
      prompt_count: finiteNonNegative(entry.prompt_count),
      session_minutes: finiteNonNegative(entry.session_minutes),
      cost_usd:
        typeof entry.cost_usd === "number" && Number.isFinite(entry.cost_usd) && entry.cost_usd >= 0
          ? entry.cost_usd
          : null
    });
  }
  return days;
}

/** Validate the usage settings; unknown/malformed fields fall back to the opt-out defaults. */
function parseTokenUsageSettings(value: unknown): TokenUsageSettings {
  if (!isRecord(value)) return { ...DEFAULT_TOKEN_USAGE_SETTINGS };
  const priceMap: TokenUsageSettings["price_map"] = Object.create(null) as TokenUsageSettings["price_map"];
  if (isRecord(value.price_map)) {
    for (const [model, price] of Object.entries(value.price_map)) {
      if (
        isRecord(price) &&
        typeof price.input_usd_per_mtok === "number" &&
        Number.isFinite(price.input_usd_per_mtok) &&
        price.input_usd_per_mtok >= 0 &&
        typeof price.output_usd_per_mtok === "number" &&
        Number.isFinite(price.output_usd_per_mtok) &&
        price.output_usd_per_mtok >= 0
      ) {
        const parsedPrice: TokenUsageSettings["price_map"][string] = {
          input_usd_per_mtok: price.input_usd_per_mtok,
          output_usd_per_mtok: price.output_usd_per_mtok
        };
        if (
          typeof price.cache_read_usd_per_mtok === "number" &&
          Number.isFinite(price.cache_read_usd_per_mtok) &&
          price.cache_read_usd_per_mtok >= 0
        ) {
          parsedPrice.cache_read_usd_per_mtok = price.cache_read_usd_per_mtok;
        }
        if (
          typeof price.cache_write_usd_per_mtok === "number" &&
          Number.isFinite(price.cache_write_usd_per_mtok) &&
          price.cache_write_usd_per_mtok >= 0
        ) {
          parsedPrice.cache_write_usd_per_mtok = price.cache_write_usd_per_mtok;
        }
        if (typeof price.provider === "string" && price.provider.trim()) {
          parsedPrice.provider = price.provider.trim().toLowerCase().slice(0, 80);
        }
        parsedPrice.source_kind = price.source_kind === "official" ? "official" : "manual";
        if (parsedPrice.source_kind === "official") {
          if (typeof price.source_id === "string" && price.source_id.trim()) {
            parsedPrice.source_id = price.source_id.trim().slice(0, 80);
          }
          if (
            typeof price.source_url === "string" &&
            price.source_url.startsWith("https://")
          ) {
            parsedPrice.source_url = price.source_url.slice(0, 500);
          }
          if (
            typeof price.updated_at === "string" &&
            /^\d{4}-\d{2}-\d{2}/.test(price.updated_at)
          ) {
            parsedPrice.updated_at = price.updated_at.slice(0, 30);
          }
          if (
            typeof price.effective_until === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(price.effective_until)
          ) {
            parsedPrice.effective_until = price.effective_until;
          }
        }
        priceMap[model] = parsedPrice;
      }
    }
  }
  return {
    observed_proxy_enabled:
      typeof value.observed_proxy_enabled === "boolean"
        ? value.observed_proxy_enabled
        : DEFAULT_TOKEN_USAGE_SETTINGS.observed_proxy_enabled,
    include_in_manager_summary:
      typeof value.include_in_manager_summary === "boolean"
        ? value.include_in_manager_summary
        : DEFAULT_TOKEN_USAGE_SETTINGS.include_in_manager_summary,
    price_map: priceMap
  };
}

async function getStore(): Promise<Store | null> {
  try {
    if (!("__TAURI_INTERNALS__" in window)) {
      // Non-Tauri environment (web dev/preview) - return null to fallback
      return null;
    }
    return await Store.load(STORE_FILE);
  } catch {
    return null;
  }
}

export async function readPersistedState(): Promise<PersistedAppState | null> {
  try {
    const store = await getStore();
    if (!store) {
      // Fallback to localStorage for web/dev
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.blocks)) return null;
      // (simplified return, same mapping as before)
      return {
        version: 1,
        blocks: parsed.blocks as WorkBlock[],
        calendarEvents: parseCalendarEvents(parsed.calendarEvents),
        chatEvents: parseChatEvents(parsed.chatEvents),
        activeWindowSamples: Array.isArray(parsed.activeWindowSamples) ? (parsed.activeWindowSamples as ActiveWindowSample[]) : [],
        auditEvents: parseAuditEvents(parsed.auditEvents),
        corrections: Array.isArray(parsed.corrections) ? (parsed.corrections as UserCorrection[]) : [],
        reviewSuggestions: parseReviewSuggestions(parsed.reviewSuggestions),
        generatedForecast: parseForecastRecord(parsed.generatedForecast),
        forecastHistory: parseForecastHistory(parsed.forecastHistory),
        snapshotHistory: parseSnapshotHistory(parsed.snapshotHistory),
        accelerationHistory: parseAccelerationHistory(parsed.accelerationHistory),
        visualContextEnabled: typeof parsed.visualContextEnabled === "boolean" ? parsed.visualContextEnabled : false,
        visualContextInsights: Array.isArray(parsed.visualContextInsights) ? (parsed.visualContextInsights as VisualContextInsight[]) : [],
        dismissedPlayIds: parseStringIdList(parsed.dismissedPlayIds),
        actedOnPlayIds: parseStringIdList(parsed.actedOnPlayIds),
        generatedPlays: parseAccelerationRecord(parsed.generatedPlays),
        savedSkills: parseSavedSkills(parsed.savedSkills),
        managerSummaryText: typeof parsed.managerSummaryText === "string" ? parsed.managerSummaryText : null,
        generatedNarrative: parseNarrativeRecord(parsed.generatedNarrative),
        lastNarrativeAutoRunDate: typeof parsed.lastNarrativeAutoRunDate === "string" ? parsed.lastNarrativeAutoRunDate : null,
        paused: typeof parsed.paused === "boolean" ? parsed.paused : true,
        aiConfig: parseAIConfig(parsed.aiConfig),
        retentionDays: parseRetentionDays(parsed.retentionDays),
        onboardingDismissed: typeof parsed.onboardingDismissed === "boolean" ? parsed.onboardingDismissed : false,
        walkthroughCompleted: typeof parsed.walkthroughCompleted === "boolean" ? parsed.walkthroughCompleted : false,
        gettingStartedStatus: parseGettingStartedStatus(
          parsed.gettingStartedStatus,
          parsed.walkthroughCompleted === true
        ),
        defaultWindowMode: parseDefaultWindowMode(parsed.defaultWindowMode),
        proactiveAlertSettings: parseProactiveAlertSettings(parsed.proactiveAlertSettings),
        proactiveAlertRuntime: parseProactiveAlertRuntime(parsed.proactiveAlertRuntime),
        tokenUsageDays: parseTokenUsageDays(parsed.tokenUsageDays),
        tokenUsageSettings: parseTokenUsageSettings(parsed.tokenUsageSettings),
        usageCsvRowHashes: parseStringIdList(parsed.usageCsvRowHashes),
        consentReceipts: parseConsentReceipts(parsed.consentReceipts)
      };
    }
    const data = await store.get<unknown>(STATE_KEY);
    if (!data) {
      return null;
    }

    const parsed: unknown = data;
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.blocks)) {
      return null;
    }

    return {
      version: 1,
      blocks: parsed.blocks as WorkBlock[],
      calendarEvents: parseCalendarEvents(parsed.calendarEvents),
      chatEvents: parseChatEvents(parsed.chatEvents),
      activeWindowSamples: Array.isArray(parsed.activeWindowSamples)
        ? (parsed.activeWindowSamples as ActiveWindowSample[])
        : [],
      auditEvents: parseAuditEvents(parsed.auditEvents),
      corrections: Array.isArray(parsed.corrections) ? (parsed.corrections as UserCorrection[]) : [],
      reviewSuggestions: parseReviewSuggestions(parsed.reviewSuggestions),
      generatedForecast: parseForecastRecord(parsed.generatedForecast),
      forecastHistory: parseForecastHistory(parsed.forecastHistory),
      snapshotHistory: parseSnapshotHistory(parsed.snapshotHistory),
      accelerationHistory: parseAccelerationHistory(parsed.accelerationHistory),
      visualContextEnabled:
        typeof parsed.visualContextEnabled === "boolean" ? parsed.visualContextEnabled : false,
      visualContextInsights: Array.isArray(parsed.visualContextInsights)
        ? (parsed.visualContextInsights as VisualContextInsight[])
        : [],
      dismissedPlayIds: parseStringIdList(parsed.dismissedPlayIds),
      actedOnPlayIds: parseStringIdList(parsed.actedOnPlayIds),
      generatedPlays: parseAccelerationRecord(parsed.generatedPlays),
      savedSkills: parseSavedSkills(parsed.savedSkills),
      managerSummaryText:
        typeof parsed.managerSummaryText === "string" ? parsed.managerSummaryText : null,
      generatedNarrative: parseNarrativeRecord(parsed.generatedNarrative),
      lastNarrativeAutoRunDate:
        typeof parsed.lastNarrativeAutoRunDate === "string" ? parsed.lastNarrativeAutoRunDate : null,
      paused: typeof parsed.paused === "boolean" ? parsed.paused : true,
      aiConfig: parseAIConfig(parsed.aiConfig),
      retentionDays: parseRetentionDays(parsed.retentionDays),
      onboardingDismissed: typeof parsed.onboardingDismissed === "boolean" ? parsed.onboardingDismissed : false,
      walkthroughCompleted: typeof parsed.walkthroughCompleted === "boolean" ? parsed.walkthroughCompleted : false,
      gettingStartedStatus: parseGettingStartedStatus(
        parsed.gettingStartedStatus,
        parsed.walkthroughCompleted === true
      ),
      defaultWindowMode: parseDefaultWindowMode(parsed.defaultWindowMode),
      proactiveAlertSettings: parseProactiveAlertSettings(parsed.proactiveAlertSettings),
      proactiveAlertRuntime: parseProactiveAlertRuntime(parsed.proactiveAlertRuntime),
      tokenUsageDays: parseTokenUsageDays(parsed.tokenUsageDays),
      tokenUsageSettings: parseTokenUsageSettings(parsed.tokenUsageSettings),
      usageCsvRowHashes: parseStringIdList(parsed.usageCsvRowHashes),
      consentReceipts: parseConsentReceipts(parsed.consentReceipts)
    };
  } catch {
    return null;
  }
}

export async function writePersistedState(state: PersistedAppState): Promise<void> {
  // Errors propagate to the caller (usePersistence) so a genuine write failure
  // (quota exceeded, disk error) can be surfaced instead of silently swallowed.
  // `getStore()` already handles the Tauri-absent case by returning null.
  const store = await getStore();
  if (!store) {
    // fallback
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return;
  }
  // Raw active-window samples are durably owned by the encrypted native journal.
  // Do not duplicate them into the general unencrypted Tauri Store. Browser/demo
  // mode has no native capture journal and keeps its documented fallback behavior.
  await store.set(STATE_KEY, { ...state, activeWindowSamples: [] });
  await store.save();
}

export async function clearPersistedState(): Promise<void> {
  try {
    const store = await getStore();
    if (!store) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    await store.delete(STATE_KEY);
    await store.save();
  } catch {
    // ignore
  }
}

// Best-effort read of the OS dark-mode preference, used as the first-launch
// default when the user has NEVER made an explicit theme choice. A stored
// preference always wins over this. Guarded for environments without
// `matchMedia` (older/embedded webviews) — falls back to "light" there.
function osThemePreference(): AppTheme {
  try {
    return typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

// Synchronous, best-effort read of the persisted theme for first-paint seeding.
// Reads localStorage directly (available in both web and Tauri webviews) so the
// dark-preference user doesn't get a light flash before the async store read
// (`readThemePreference`) lands as the authoritative follow-up. When nothing is
// persisted (a genuine first launch — distinct from a stored "light"), it
// honors the OS `prefers-color-scheme` so a dark-OS analyst launches into dark.
// In the Tauri runtime the persisted choice lives in the plugin store, not
// localStorage, so this seeds from the OS default and `readThemePreference`
// reconciles to the stored value — the flash only shortens, per design.
export function readStoredThemeSync(): AppTheme {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "dark") return "dark";
    if (raw === "light") return "light";
    return osThemePreference();
  } catch {
    return "light";
  }
}

export async function readThemePreference(): Promise<AppTheme> {
  try {
    const store = await getStore();
    if (!store) {
      const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (raw === "dark") return "dark";
      if (raw === "light") return "light";
      return osThemePreference();
    }
    const theme = await store.get<string>(THEME_KEY);
    if (theme === "dark") return "dark";
    if (theme === "light") return "light";
    return osThemePreference();
  } catch {
    return "light";
  }
}

export async function writeThemePreference(theme: AppTheme): Promise<void> {
  try {
    const store = await getStore();
    if (!store) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      return;
    }
    await store.set(THEME_KEY, theme);
    await store.save();
  } catch {
    // The in-memory theme still works when storage is unavailable.
  }
}
