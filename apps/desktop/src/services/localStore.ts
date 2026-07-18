import { Store } from "@tauri-apps/plugin-store";
import type {
  AccelerationPlayType,
  ActiveWindowSample,
  AuditEvent,
  ForecastAgentResult,
  OutlookCalendarEvent,
  RawEvent,
  ReviewCopilotSuggestion,
  SavedSkill,
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
import type { AuthoredAccelerationPlay } from "./accelerationSchema";

const STORE_FILE = "clear-capacity.store";
const STATE_KEY = "appState";
const THEME_KEY = "theme";
const STORAGE_KEY = "clear-capacity:v1"; // fallback for non-Tauri
const THEME_STORAGE_KEY = "clear-capacity:theme";

export type AppTheme = "light" | "dark";

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
  /** Opt-in configuration for proactive menu-bar alerts. */
  proactiveAlertSettings: ProactiveAlertSettings;
  /** Throttle/dedup bookkeeping for proactive OS notifications. */
  proactiveAlertRuntime: ProactiveAlertRuntime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  return value.filter(
    (entry): entry is PersistedForecastRecord =>
      isRecord(entry) && isRecord(entry.forecast) && typeof entry.generated_for_week === "string"
  );
}

function parseSnapshotHistory(value: unknown): PersistedSnapshotRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is PersistedSnapshotRecord =>
      isRecord(entry) && isRecord(entry.snapshot) && typeof entry.week_id === "string"
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
 * Validate the persisted AI-authored Acceleration record. Requires a real `plays`
 * array and the record metadata; a malformed blob degrades to `null` (the screen
 * then just renders the deterministic signals). The `plays` entries are trusted as
 * the shape the schema/hook already validated at write time.
 */
function parseAccelerationRecord(value: unknown): PersistedAccelerationRecord | null {
  if (!isRecord(value) || !Array.isArray(value.plays) || typeof value.generated_for_week !== "string") {
    return null;
  }
  return value as unknown as PersistedAccelerationRecord;
}

/**
 * Validate the persisted saved-skills library. Requires each entry to carry a string
 * `signal_id` and a non-empty `recipe` (the recipe text is the whole point of the
 * snapshot); malformed/recipe-less entries are dropped. The remaining fields are trusted
 * as the shape the save handler wrote.
 */
function parseSavedSkills(value: unknown): SavedSkill[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is SavedSkill =>
      isRecord(entry) &&
      typeof entry.signal_id === "string" &&
      typeof entry.recipe === "string" &&
      entry.recipe.length > 0
  );
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
        calendarEvents: Array.isArray(parsed.calendarEvents) ? (parsed.calendarEvents as OutlookCalendarEvent[]) : [],
        chatEvents: parseChatEvents(parsed.chatEvents),
        activeWindowSamples: Array.isArray(parsed.activeWindowSamples) ? (parsed.activeWindowSamples as ActiveWindowSample[]) : [],
        auditEvents: Array.isArray(parsed.auditEvents) ? (parsed.auditEvents as AuditEvent[]) : [],
        corrections: Array.isArray(parsed.corrections) ? (parsed.corrections as UserCorrection[]) : [],
        reviewSuggestions: Array.isArray(parsed.reviewSuggestions) ? (parsed.reviewSuggestions as ReviewCopilotSuggestion[]) : [],
        generatedForecast: isRecord(parsed.generatedForecast) && isRecord(parsed.generatedForecast.forecast) ? (parsed.generatedForecast as unknown as PersistedForecastRecord) : null,
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
        generatedNarrative: isRecord(parsed.generatedNarrative) && isRecord(parsed.generatedNarrative.narrative) ? (parsed.generatedNarrative as unknown as PersistedNarrativeRecord) : null,
        lastNarrativeAutoRunDate: typeof parsed.lastNarrativeAutoRunDate === "string" ? parsed.lastNarrativeAutoRunDate : null,
        paused: typeof parsed.paused === "boolean" ? parsed.paused : true,
        aiConfig: isRecord(parsed.aiConfig) ? (parsed.aiConfig as unknown as AIConfig) : null,
        retentionDays: parseRetentionDays(parsed.retentionDays),
        onboardingDismissed: typeof parsed.onboardingDismissed === "boolean" ? parsed.onboardingDismissed : false,
        walkthroughCompleted: typeof parsed.walkthroughCompleted === "boolean" ? parsed.walkthroughCompleted : false,
        proactiveAlertSettings: parseProactiveAlertSettings(parsed.proactiveAlertSettings),
        proactiveAlertRuntime: parseProactiveAlertRuntime(parsed.proactiveAlertRuntime)
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
      calendarEvents: Array.isArray(parsed.calendarEvents) ? (parsed.calendarEvents as OutlookCalendarEvent[]) : [],
      chatEvents: parseChatEvents(parsed.chatEvents),
      activeWindowSamples: Array.isArray(parsed.activeWindowSamples)
        ? (parsed.activeWindowSamples as ActiveWindowSample[])
        : [],
      auditEvents: Array.isArray(parsed.auditEvents) ? (parsed.auditEvents as AuditEvent[]) : [],
      corrections: Array.isArray(parsed.corrections) ? (parsed.corrections as UserCorrection[]) : [],
      reviewSuggestions: Array.isArray(parsed.reviewSuggestions)
        ? (parsed.reviewSuggestions as ReviewCopilotSuggestion[])
        : [],
      generatedForecast:
        isRecord(parsed.generatedForecast) && isRecord(parsed.generatedForecast.forecast)
          ? (parsed.generatedForecast as unknown as PersistedForecastRecord)
          : null,
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
      generatedNarrative:
        isRecord(parsed.generatedNarrative) && isRecord(parsed.generatedNarrative.narrative)
          ? (parsed.generatedNarrative as unknown as PersistedNarrativeRecord)
          : null,
      lastNarrativeAutoRunDate:
        typeof parsed.lastNarrativeAutoRunDate === "string" ? parsed.lastNarrativeAutoRunDate : null,
      paused: typeof parsed.paused === "boolean" ? parsed.paused : true,
      aiConfig: isRecord(parsed.aiConfig) ? (parsed.aiConfig as unknown as AIConfig) : null,
      retentionDays: parseRetentionDays(parsed.retentionDays),
      onboardingDismissed: typeof parsed.onboardingDismissed === "boolean" ? parsed.onboardingDismissed : false,
      walkthroughCompleted: typeof parsed.walkthroughCompleted === "boolean" ? parsed.walkthroughCompleted : false,
      proactiveAlertSettings: parseProactiveAlertSettings(parsed.proactiveAlertSettings),
      proactiveAlertRuntime: parseProactiveAlertRuntime(parsed.proactiveAlertRuntime)
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
  await store.set(STATE_KEY, state);
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
