import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { outlookEventsToWorkBlocks, parseOutlookIcs } from "../../../packages/integrations/src/calendar/outlookIcs";
import { importChatExport } from "../../../packages/integrations/src/chat/chatExport";
import { dedupeChatCallsAgainstCalendar } from "../../../packages/integrations/src/chat/callDedup";
import { parseUsageCsv } from "../../../packages/integrations/src/usage/usageCsv";
import { mergeTokenUsageDays } from "../../../packages/inference/src/aiUsage";
import type {
  AccelerationPlay,
  AccelerationSignal,
  ActiveWindowSample,
  AuditEvent,
  OutlookCalendarEvent,
  RawEvent,
  ReviewCopilotSuggestion,
  SavedSkill,
  TokenUsageDay,
  TokenUsageSettings,
  UserCorrection,
  VisualContextInsight,
  WorkBlock,
  AIConfig
} from "../../../packages/domain/src/models";
import { normalizeWeekId } from "../../../packages/inference/src/capacity";
import {
  clearPersistedState,
  DEFAULT_TOKEN_USAGE_SETTINGS,
  readPersistedState,
  readStoredThemeSync,
  readThemePreference,
  writePersistedState,
  writeThemePreference
} from "./services/localStore";
import type { AppTheme, GettingStartedStatus, PersistedAccelerationRecord, PersistedAccelerationSnapshot, PersistedAppState, PersistedForecastRecord, PersistedNarrativeRecord, PersistedSnapshotRecord } from "./services/localStore";
import { createDemoState } from "./services/demoData";
import { createDefaultAIConfig } from "./services/aiProviders";
import {
  addDays,
  getLocalDateKey,
} from "./lib/date";
import { unionSpanMs } from "./lib/meetingLoad";
import { fieldLabel, formatDurationMinutes, humanizeCorrectionValue } from "./lib/format";
import { downloadTextFile, exportFilename, exportMimeType, serializeFullBackup, type FullBackup } from "./lib/dataExport";
import { createAccelerationPlayAuditEvent, createAuditEvent, createCalendarImportAuditEvent, createChatImportAuditEvent, createUsageImportAuditEvent, createUsageSettingsAuditEvent } from "./lib/audit";
import { removeSeededCorrections, removeSeededWorkBlocks } from "./lib/blocks";
import { useDateContext } from "./hooks/useDateContext";
import { useDerived } from "./hooks/useDerived";
import { usePersistence } from "./hooks/usePersistence";
import { useBlocksLedger, MANUAL_REVIEW_ADJUSTMENT_REASON } from "./hooks/useBlocksLedger";
import { useActiveWindow } from "./hooks/useActiveWindow";
import { useClassification } from "./hooks/useClassification";
import { useReviewCopilot } from "./hooks/useReviewCopilot";
import { useForecastAgent } from "./hooks/useForecastAgent";
import { useAcceleration } from "./hooks/useAcceleration";
import { useNarrativeGeneration } from "./hooks/useNarrativeGeneration";
import { useVisualContext } from "./hooks/useVisualContext";
import { useProactiveAlerts } from "./hooks/useProactiveAlerts";
import {
  DEFAULT_PROACTIVE_ALERT_SETTINGS,
  EMPTY_PROACTIVE_ALERT_RUNTIME,
  type ProactiveAlertData,
  type ProactiveAlertRuntime,
  type ProactiveAlertSettings,
} from "./lib/proactiveAlerts";
import { useTrayStatus } from "./hooks/useTrayStatus";
import { useToasts } from "./hooks/useToasts";
import { screenLabels } from "./lib/ui";
import {
  MAX_VISUAL_CONTEXT_CAPTURES_PER_DAY,
  MIN_VISUAL_CONTEXT_SESSION_MINUTES,
  MIN_VISUAL_CONTEXT_GAP_MS
} from "./lib/constants";
import { AppShell } from "./components/shell/AppShell";
import { ScreenRouter } from "./components/shell/ScreenRouter";
import { buildOnboardingSteps } from "./components/common/OnboardingCard";
import { WalkthroughOverlay } from "./components/onboarding/WalkthroughOverlay";
import { GettingStartedModal } from "./components/onboarding/GettingStartedModal";
import { WelcomeOverlay } from "./components/onboarding/WelcomeOverlay";
import type { Screen, SettingsTab, WindowMode } from "./lib/types";

// Correction fields whose inverse can be replayed cleanly through the relabel path
// (`updateBlock`): every entry is a string-typed `keyof WorkBlock`, so the stored
// `old_value` string is directly assignable. Deliberately excludes `blocker_flag`
// (boolean), `notes` (nullable), `start_time`/`end_time` (a single time edit records a
// start+end PAIR, so undoing "the last correction" would revert only one edge), and the
// non-relabel actions `exclude`/`verification`/`manager_summary`/`calendar_import`.
const UNDOABLE_CORRECTION_FIELDS = [
  "category",
  "mode",
  "planned_status",
  "project_name",
  "stakeholder_group"
] as const satisfies readonly (keyof WorkBlock)[];

// True when a re-imported calendar event carries different content than the stored one
// under the same `calendar_event_id`. Excludes identity/constant fields (`calendar_event_id`,
// `uid`, `source`) and `imported_at` (stamped fresh on every parse, so it always differs and
// would misreport an unchanged event as "updated").
function calendarEventChanged(prior: OutlookCalendarEvent, next: OutlookCalendarEvent): boolean {
  return (
    prior.title !== next.title ||
    prior.start_time !== next.start_time ||
    prior.end_time !== next.end_time ||
    prior.location !== next.location ||
    prior.organizer !== next.organizer ||
    prior.attendee_count !== next.attendee_count
  );
}

export function App() {
  const [isDemoMode] = useState(() => new URLSearchParams(window.location.search).get("demo") === "1");
  const [persistedSnapshot, setPersistedSnapshot] = useState<PersistedAppState | null>(() => isDemoMode ? createDemoState() : null);
  // Date-derived keys that roll over across midnight / a week boundary in this
  // long-running tray app (see useDateContext) rather than freezing at mount.
  const { todayKey, currentWeekId, currentWeekRangeLabel, nextWeekId, nextWeekRangeLabel } =
    useDateContext();

  // Gates the persistence write until the async hydration read below resolves, so the
  // first-mount write can't race ahead of the read and clobber stored state with an empty
  // snapshot (data-loss). Mirrors `themeHydrated`. A ref (not state) so flipping it never
  // re-renders and the write effect stays keyed off the persisted-data deps.
  const persistenceHydrated = useRef(false);

  // Async load persisted state (hydrates non-ledger state and forces re-eval)
  useEffect(() => {
    if (isDemoMode) return;
    readPersistedState().then((data) => {
      // The read resolved (readPersistedState never rejects — it returns null on any
      // failure), so it's now safe to persist regardless of whether data was found.
      persistenceHydrated.current = true;
      if (data) {
        setPersistedSnapshot(data);
        // Hydrate chrome + other states
        setActive((current) => {
          const requested = new URLSearchParams(window.location.search).get("screen") as Screen | null;
          if (isDemoMode && requested && requested in screenLabels) return requested;
          const loadedBlocks = removeSeededWorkBlocks(data.blocks ?? []);
          return loadedBlocks.some((block) => !block.user_verified) ? "daily" : current;
        });
        setPaused(data.paused ?? true);
        // Hydration installing the persisted paused state is not a user toggle —
        // keep the audit ref in step so the effect below doesn't emit a phantom row.
        lastAuditedPausedRef.current = data.paused ?? true;
        setActiveWindowSamples(data.activeWindowSamples ?? []);
        setAuditEvents(data.auditEvents ?? []);
        setGeneratedForecast(data.generatedForecast ?? null);
        setForecastHistory(data.forecastHistory ?? []);
        setSnapshotHistory(data.snapshotHistory ?? []);
        setAccelerationHistory(data.accelerationHistory ?? []);
        setChatEvents(data.chatEvents ?? []);
        setVisualContextEnabled(data.visualContextEnabled ?? false);
        setVisualContextInsights(data.visualContextInsights ?? []);
        setDismissedPlayIds(data.dismissedPlayIds ?? []);
        setActedOnPlayIds(data.actedOnPlayIds ?? []);
        setGeneratedPlays(data.generatedPlays ?? null);
        setSavedSkills(data.savedSkills ?? []);
        setAiConfig(data.aiConfig ?? null);
        setRetentionDays(data.retentionDays ?? null);
        setOnboardingDismissed(data.onboardingDismissed ?? false);
        setWalkthroughCompleted(data.walkthroughCompleted ?? false);
        setGettingStartedStatus(data.gettingStartedStatus ?? "unseen");
        setDefaultWindowMode(data.defaultWindowMode ?? "large");
        // The webview boots hidden in the (default) large layout; adopt the
        // user's preferred open mode before the window is ever shown so a
        // compact-preference user doesn't flash the full dashboard.
        setWindowMode(data.defaultWindowMode ?? "large");
        setManagerSummaryText(data.managerSummaryText ?? null);
        setGeneratedNarrative(data.generatedNarrative ?? null);
        setLastNarrativeAutoRunDate(data.lastNarrativeAutoRunDate ?? null);
        setProactiveAlertSettings(data.proactiveAlertSettings ?? DEFAULT_PROACTIVE_ALERT_SETTINGS);
        setProactiveAlertRuntime(data.proactiveAlertRuntime ?? EMPTY_PROACTIVE_ALERT_RUNTIME);
        setTokenUsageDays(data.tokenUsageDays ?? []);
        setTokenUsageSettings(data.tokenUsageSettings ?? DEFAULT_TOKEN_USAGE_SETTINGS);
        setUsageCsvRowHashes(data.usageCsvRowHashes ?? []);
      }
      // Every launch: bring the main window forward maximized in the full
      // layout (first launch lands in welcome → walkthrough → setup; returning
      // users land on their dashboard). The menu-bar icon stays available
      // either way; closing the window returns the app to tray-only.
      void invoke("present_main_window").catch(() => undefined);
    }).catch(() => {});
  }, [isDemoMode]);

  const initialBlocks = removeSeededWorkBlocks(persistedSnapshot?.blocks ?? []);
  const [active, setActive] = useState<Screen>(() => {
    const requested = new URLSearchParams(window.location.search).get("screen") as Screen | null;
    return isDemoMode && requested && requested in screenLabels
      ? requested
      : initialBlocks.some((block) => !block.user_verified) ? "daily" : "weekly";
  });
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("data-sources");
  const [paused, setPaused] = useState(() => persistedSnapshot?.paused ?? true);
  // Tracks the last `paused` value we've already emitted an audit event for, so
  // the audit effect below records only real user-driven transitions — never the
  // mount value or the value hydration/reset installs. Seeded at mount to the
  // initial `paused` and re-seeded wherever `paused` changes without a user toggle.
  const lastAuditedPausedRef = useRef(paused);
  const [activeWindowSamples, setActiveWindowSamples] = useState<ActiveWindowSample[]>(
    () => persistedSnapshot?.activeWindowSamples ?? []
  );
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(() => persistedSnapshot?.auditEvents ?? []);
  const [generatedForecast, setGeneratedForecast] = useState<PersistedForecastRecord | null>(
    () => persistedSnapshot?.generatedForecast ?? null
  );
  const [forecastHistory, setForecastHistory] = useState<PersistedForecastRecord[]>(
    () => persistedSnapshot?.forecastHistory ?? []
  );
  const [snapshotHistory, setSnapshotHistory] = useState<PersistedSnapshotRecord[]>(
    () => persistedSnapshot?.snapshotHistory ?? []
  );
  // Per-week summary of the mined Acceleration signals — the memory that lets the engine tell a
  // recurring habit from a one-off (E2). Retained once per ISO week, like `snapshotHistory`.
  const [accelerationHistory, setAccelerationHistory] = useState<PersistedAccelerationSnapshot[]>(
    () => persistedSnapshot?.accelerationHistory ?? []
  );
  // Imported workplace-chat events (metadata only) retained for the interruption-load signal.
  const [chatEvents, setChatEvents] = useState<RawEvent[]>(
    () => persistedSnapshot?.chatEvents ?? []
  );
  const [visualContextEnabled, setVisualContextEnabled] = useState<boolean>(
    () => persistedSnapshot?.visualContextEnabled ?? false
  );
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(
    () => persistedSnapshot?.aiConfig ?? null
  );
  const [retentionDays, setRetentionDays] = useState<number | null>(
    () => persistedSnapshot?.retentionDays ?? null
  );
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(
    () => persistedSnapshot?.onboardingDismissed ?? false
  );
  const [walkthroughCompleted, setWalkthroughCompleted] = useState<boolean>(
    () => persistedSnapshot?.walkthroughCompleted ?? false
  );
  // Post-walkthrough "Getting started" (enable tracking) modal lifecycle:
  // unseen → modal shows once the walkthrough finishes; skipped → the persistent
  // enable-tracking reminder banner shows until tracking turns on; complete → done.
  const [gettingStartedStatus, setGettingStartedStatus] = useState<GettingStartedStatus>(
    () => persistedSnapshot?.gettingStartedStatus ?? "unseen"
  );
  // Preferred window size when Weekform opens (tray click / relaunch). Defaults
  // to the full window so first-run users land in the walkthrough and
  // getting-started flow, which only run there. Synced to the native tray below.
  const [defaultWindowMode, setDefaultWindowMode] = useState<WindowMode>(
    () => persistedSnapshot?.defaultWindowMode ?? "large"
  );
  const [visualContextInsights, setVisualContextInsights] = useState<VisualContextInsight[]>(
    () => persistedSnapshot?.visualContextInsights ?? []
  );
  // signal_ids of Acceleration Plays the user dismissed / saved. The miner re-derives
  // plays each render, so these persisted id sets are how a dismiss/save survives a reload.
  const [dismissedPlayIds, setDismissedPlayIds] = useState<string[]>(
    () => persistedSnapshot?.dismissedPlayIds ?? []
  );
  // signal_ids of Acceleration Plays the user marked as acted on — the foundation the
  // realized-savings track record (E3) scores against.
  const [actedOnPlayIds, setActedOnPlayIds] = useState<string[]>(
    () => persistedSnapshot?.actedOnPlayIds ?? []
  );
  // Latest AI-authored Acceleration Plays (opt-in synthesis). Persisted separately from
  // the deterministic signals (which re-derive each render) and merged back on by signal_id.
  const [generatedPlays, setGeneratedPlays] = useState<PersistedAccelerationRecord | null>(
    () => persistedSnapshot?.generatedPlays ?? null
  );
  // Durable snapshots of AUTOMATE recipes the user saved to their skills library. Keyed
  // by the source signal_id (re-saving upserts), these survive regeneration and re-mining.
  const [savedSkills, setSavedSkills] = useState<SavedSkill[]>(
    () => persistedSnapshot?.savedSkills ?? []
  );
  const [managerSummaryText, setManagerSummaryText] = useState<string | null>(
    () => (initialBlocks.length > 0 || persistedSnapshot?.generatedNarrative ? persistedSnapshot?.managerSummaryText ?? null : null)
  );
  const [generatedNarrative, setGeneratedNarrative] = useState<PersistedNarrativeRecord | null>(
    () => persistedSnapshot?.generatedNarrative ?? null
  );
  const [lastNarrativeAutoRunDate, setLastNarrativeAutoRunDate] = useState<string | null>(
    () => persistedSnapshot?.lastNarrativeAutoRunDate ?? null
  );
  const [proactiveAlertSettings, setProactiveAlertSettings] = useState<ProactiveAlertSettings>(
    () => persistedSnapshot?.proactiveAlertSettings ?? DEFAULT_PROACTIVE_ALERT_SETTINGS
  );
  const [proactiveAlertRuntime, setProactiveAlertRuntime] = useState<ProactiveAlertRuntime>(
    () => persistedSnapshot?.proactiveAlertRuntime ?? EMPTY_PROACTIVE_ALERT_RUNTIME
  );
  // Persisted measured usage rollups from CSV imports. Proxy days are derived live
  // from sessions in useDerived, never stored — see aiUsage.ts.
  const [tokenUsageDays, setTokenUsageDays] = useState<TokenUsageDay[]>(
    () => persistedSnapshot?.tokenUsageDays ?? []
  );
  const [tokenUsageSettings, setTokenUsageSettings] = useState<TokenUsageSettings>(
    () => persistedSnapshot?.tokenUsageSettings ?? DEFAULT_TOKEN_USAGE_SETTINGS
  );
  // Hashes of every accepted usage-CSV row, so re-importing the same export is a no-op.
  const [usageCsvRowHashes, setUsageCsvRowHashes] = useState<string[]>(
    () => persistedSnapshot?.usageCsvRowHashes ?? []
  );
  const [visualContextAttemptedSessionIds, setVisualContextAttemptedSessionIds] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [lastCalendarImportSummary, setLastCalendarImportSummary] = useState<string | null>(null);
  const [chatImportError, setChatImportError] = useState<string | null>(null);
  const [usageImportError, setUsageImportError] = useState<string | null>(null);
  // Lingering Settings status line for the last usage-CSV import (the toast expires).
  const [lastUsageImportSummary, setLastUsageImportSummary] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Seed synchronously from localStorage so a dark-preference user's first paint
  // isn't light; the async store read below hydrates the authoritative value.
  const [theme, setTheme] = useState<AppTheme>(() => readStoredThemeSync());
  const themeHydrated = useRef(false);
  const [windowMode, setWindowMode] = useState<WindowMode>(() =>
    isDemoMode && new URLSearchParams(window.location.search).get("mode") === "compact" ? "compact" : "large"
  );

  // Transient app-level feedback (success/error/retry). Queue lives here so any
  // handler or effect can emit one; the visual stack is rendered once in AppShell.
  const { toasts, pushToast, dismissToast } = useToasts();

  // Hydrate theme from persisted preference on mount; the ref prevents the
  // write-back effect from clobbering the saved value before hydration.
  useEffect(() => {
    readThemePreference().then((saved) => {
      themeHydrated.current = true;
      setTheme(saved);
    });
  }, []);

  const ledger = useBlocksLedger({
    initialBlocks,
    initialCalendarEvents: persistedSnapshot?.calendarEvents ?? [],
    initialCorrections: removeSeededCorrections(persistedSnapshot?.corrections ?? []),
    initialReviewSuggestions: persistedSnapshot?.reviewSuggestions ?? [],
    currentWeekId,
    isDemoMode,
    addAuditEvent: (event) => setAuditEvents((current) => [...current, createAuditEvent(event)].slice(-1000)),
  });

  const { blocks, setBlocks, calendarEvents, setCalendarEvents, corrections, setCorrections, reviewSuggestions, setReviewSuggestions, updateBlock, confirmBlock, excludeBlock, addCorrection } = ledger;

  // Late hydrate for ledger-owned state if async load completes after mount.
  // Guard every setter the same way as blocks below: only overwrite when the
  // loaded snapshot actually carries data OR the in-memory list is still empty,
  // so an empty persisted field can't clobber blocks/edits the user made in the
  // mount-to-hydration window (runs once, when persistedSnapshot flips to data).
  useEffect(() => {
    if (isDemoMode || !persistedSnapshot) return;
    const loadedBlocks = removeSeededWorkBlocks(persistedSnapshot.blocks ?? []);
    if (loadedBlocks.length > 0 || blocks.length === 0) {
      setBlocks(loadedBlocks);
    }
    const loadedCalendarEvents = persistedSnapshot.calendarEvents ?? [];
    if (loadedCalendarEvents.length > 0 || calendarEvents.length === 0) {
      setCalendarEvents(loadedCalendarEvents);
    }
    const loadedCorrections = removeSeededCorrections(persistedSnapshot.corrections ?? []);
    if (loadedCorrections.length > 0 || corrections.length === 0) {
      setCorrections(loadedCorrections);
    }
    const loadedReviewSuggestions = persistedSnapshot.reviewSuggestions ?? [];
    if (loadedReviewSuggestions.length > 0 || reviewSuggestions.length === 0) {
      setReviewSuggestions(loadedReviewSuggestions);
    }
  }, [persistedSnapshot, isDemoMode]);

  usePersistence({
    blocks,
    calendarEvents,
    chatEvents,
    activeWindowSamples,
    auditEvents,
    corrections,
    reviewSuggestions,
    generatedForecast,
    forecastHistory,
    snapshotHistory,
    accelerationHistory,
    visualContextEnabled,
    visualContextInsights,
    dismissedPlayIds,
    actedOnPlayIds,
    generatedPlays,
    savedSkills,
    aiConfig,
    managerSummaryText,
    generatedNarrative,
    lastNarrativeAutoRunDate,
    paused,
    retentionDays,
    onboardingDismissed,
    walkthroughCompleted,
    gettingStartedStatus,
    defaultWindowMode,
    proactiveAlertSettings,
    proactiveAlertRuntime,
    tokenUsageDays,
    tokenUsageSettings,
    usageCsvRowHashes,
    isDemoMode,
  }, persistenceHydrated, (error) => {
    console.error("Failed to persist app state", error);
    pushToast({
      tone: "error",
      message: "Couldn't save your latest changes to disk — recent edits may not survive a restart.",
    });
  });

  useActiveWindow({
    isDemoMode,
    setActiveWindowSamples,
    setAuditEvents,
  });

  const derived = useDerived({
    blocks,
    chatEvents,
    activeWindowSamples,
    calendarEvents,
    generatedNarrative,
    forecastHistory,
    snapshotHistory,
    accelerationHistory,
    actedOnPlayIds,
    managerSummaryText,
    tokenUsageDays,
    tokenUsageSettings,
    todayKey,
    currentWeekId,
    currentWeekRangeLabel,
    nextWeekRangeLabel,
  });

  const {
    snapshot,
    narrative,
    managerText,
    activeWindowSessions,
    hasNarrativeEvidence,
    reviewQueue,
    forecastAccuracy,
    forecastAccuracyTrend,
    forecastTrackRecord,
    interruptionLoad,
    chatStakeholders,
    accelerationSignals,
    realizedSavings,
    realizedSavingsSummary,
    proxyUsageDays,
    aiUsageSummary,
  } = derived;

  // Retain the latest computed snapshot per ISO week so cross-week trends and
  // personal baselines have history to read. Mirrors `forecastHistory`: one record
  // per week_id (latest wins), capped to the most recent 24 weeks. Once the ISO
  // week rolls over the prior week's last snapshot stops updating and stays frozen.
  useEffect(() => {
    if (isDemoMode || blocks.length === 0) return;
    setSnapshotHistory((current) => {
      const existing = current.find(
        (entry) => normalizeWeekId(entry.week_id) === normalizeWeekId(snapshot.week_id)
      );
      if (existing && JSON.stringify(existing.snapshot) === JSON.stringify(snapshot)) {
        return current;
      }
      const record: PersistedSnapshotRecord = {
        week_id: snapshot.week_id,
        snapshot,
        computed_at: new Date().toISOString(),
      };
      return [
        ...current.filter(
          (entry) => normalizeWeekId(entry.week_id) !== normalizeWeekId(snapshot.week_id)
        ),
        record,
      ]
        .sort((left, right) => normalizeWeekId(left.week_id).localeCompare(normalizeWeekId(right.week_id)))
        .slice(-24);
    });
  }, [snapshot, blocks.length, isDemoMode]);

  // Retain a compact per-week summary of the surfaced Acceleration signals so the engine can tell a
  // recurring habit from a one-off (E2). Mirrors the snapshot-retention effect: one record per
  // ISO week (latest mining wins), capped to 24 weeks. Only id/type/minutes are stored — never
  // evidence strings — so it's privacy-trivial (no window titles, no app names). The summary is
  // sorted by signal_id so the equality guard below compares SETS, not the recurrence-driven display
  // order — otherwise a pure re-ordering at a week rollover would churn the record needlessly. The
  // current week's record is EXCLUDED from the recurrence count (prior weeks only), so writing it
  // here never feeds back into `recurrenceBySignalId` — no render loop.
  useEffect(() => {
    if (isDemoMode || accelerationSignals.length === 0) return;
    const summary = accelerationSignals
      .map((signal) => ({
        signal_id: signal.signal_id,
        type: signal.type,
        estimated_minutes_saved_per_week: signal.estimated_minutes_saved_per_week,
      }))
      .sort((left, right) =>
        left.signal_id < right.signal_id ? -1 : left.signal_id > right.signal_id ? 1 : 0
      );
    setAccelerationHistory((current) => {
      const existing = current.find(
        (entry) => normalizeWeekId(entry.week_id) === normalizeWeekId(currentWeekId)
      );
      if (existing && JSON.stringify(existing.signals) === JSON.stringify(summary)) {
        return current;
      }
      const record: PersistedAccelerationSnapshot = {
        week_id: currentWeekId,
        generated_at: new Date().toISOString(),
        signals: summary,
      };
      return [
        ...current.filter(
          (entry) => normalizeWeekId(entry.week_id) !== normalizeWeekId(currentWeekId)
        ),
        record,
      ]
        .sort((left, right) => normalizeWeekId(left.week_id).localeCompare(normalizeWeekId(right.week_id)))
        .slice(-24);
    });
  }, [accelerationSignals, currentWeekId, isDemoMode]);

  // Retention policy: auto-expire raw activity older than the user-chosen window
  // (null = keep everything). This covers both the raw active-window samples and the
  // retained chat `RawEvent` store (each grows one-row-per-event, so both must be
  // pruned or the chat history would accumulate forever). Sessions and work blocks
  // already derived from these are untouched — only the raw rows expire. The effect
  // re-runs as rows accrue; each functional update returns the same reference when
  // nothing crosses the cutoff, so this never loops. The discrete policy change is
  // audited in `changeRetentionDays`; the per-row expiry is not logged (it would
  // flood the capped audit trail as rows continuously age past the cutoff).
  useEffect(() => {
    if (isDemoMode || retentionDays === null) return;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    setActiveWindowSamples((current) => {
      const kept = current.filter((sample) => new Date(sample.timestamp).getTime() >= cutoff);
      return kept.length === current.length ? current : kept;
    });
    setChatEvents((current) => {
      const kept = current.filter((event) => new Date(event.timestamp_end).getTime() >= cutoff);
      return kept.length === current.length ? current : kept;
    });
  }, [isDemoMode, retentionDays, activeWindowSamples, chatEvents]);

  const { classificationStatus, classificationError, classifyActiveWindowSessions, resetClassification } =
    useClassification({
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
    });

  const { reviewCopilotStatus, reviewCopilotError, generateReviewCopilotSuggestions, resetReviewCopilot } =
    useReviewCopilot({
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
    });

  const { forecastStatus, forecastError, generateForecastAgent, resetForecast } = useForecastAgent({
    isDemoMode,
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
  });

  const { accelerationStatus, accelerationError, generateAccelerationPlays, resetAcceleration } =
    useAcceleration({
      isDemoMode,
      signals: accelerationSignals,
      currentWeekId,
      currentWeekRangeLabel,
      aiConfig,
      setGeneratedPlays,
      setAuditEvents,
    });

  // Merge the AI-authored payload onto the live deterministic signals by signal_id. The
  // deterministic figures (title, estimate, confidence, evidence) stay authoritative — the
  // AI only overlays the polish: a sharpened `detail`, a runnable `recipe` (AUTOMATE), and
  // `recommended_tools` (TOOL). Without a generated record every play renders deterministically
  // (recipe null / no tools). Authored entries for a signal no longer mined are simply ignored.
  const accelerationPlays = useMemo<AccelerationPlay[]>(() => {
    const authored = new Map((generatedPlays?.plays ?? []).map((play) => [play.signal_id, play]));
    return accelerationSignals.map((signal) => {
      const match = authored.get(signal.signal_id);
      return {
        ...signal,
        detail: match?.detail?.trim() ? match.detail : signal.detail,
        recipe: match?.recipe ?? null,
        skill_name: match?.skill_name ?? null,
        skill_description: match?.skill_description ?? null,
        recommended_tools: match?.recommended_tools ?? [],
        // A matched play means the opt-in AI pass authored this signal's guidance (re-whitelisted
        // to currently-mined ids upstream), so the card can attribute the prose to the AI.
        authored: Boolean(match),
        dismissed: false,
      };
    });
  }, [accelerationSignals, generatedPlays]);

  // signal_ids currently in the saved-skills library — lets the Acceleration cards mark
  // which recipes are already saved without re-scanning the array per card.
  const savedSkillIds = useMemo(() => savedSkills.map((skill) => skill.signal_id), [savedSkills]);

  const { narrativeGenerationStatus, narrativeGenerationError, regenerateNarrative, resetNarrative } =
    useNarrativeGeneration({
      isDemoMode,
      hasNarrativeEvidence,
      snapshot,
      blocks,
      activeWindowSessions,
      calendarEvents,
      visualContextInsights,
      corrections,
      aiUsageSummary,
      includeUsageInManagerSummary: tokenUsageSettings.include_in_manager_summary,
      currentWeekId,
      currentWeekRangeLabel,
      aiConfig,
      setGeneratedNarrative,
      setManagerSummaryText,
      setAuditEvents,
    });

  const { visualContextStatus, visualContextError, captureVisualContext, resetVisualContext } = useVisualContext({
    isDemoMode,
    aiConfig,
    setVisualContextInsights,
    setAuditEvents,
  });

  // Surface the otherwise-swallowed AI error states as transient toasts, fired once
  // per failure cycle (the ref tracks the last-seen value, including the null reset
  // each new attempt produces, so an unchanged error never re-announces). Forecast
  // and narrative carry a Retry that re-runs their generate/regenerate handler;
  // visual-context capture is an opportunistic background pass with no idempotent
  // manual retry, so its toast is informational only.
  const prevForecastError = useRef<string | null>(null);
  useEffect(() => {
    if (forecastError && forecastError !== prevForecastError.current) {
      pushToast({
        tone: "error",
        message: forecastError,
        action: { label: "Retry", onClick: () => void generateForecastAgent() },
      });
    }
    prevForecastError.current = forecastError;
  }, [forecastError, pushToast, generateForecastAgent]);

  const prevAccelerationError = useRef<string | null>(null);
  useEffect(() => {
    if (accelerationError && accelerationError !== prevAccelerationError.current) {
      pushToast({
        tone: "error",
        message: accelerationError,
        action: { label: "Retry", onClick: () => void generateAccelerationPlays() },
      });
    }
    prevAccelerationError.current = accelerationError;
  }, [accelerationError, pushToast, generateAccelerationPlays]);

  const prevNarrativeError = useRef<string | null>(null);
  useEffect(() => {
    if (narrativeGenerationError && narrativeGenerationError !== prevNarrativeError.current) {
      pushToast({
        tone: "error",
        message: narrativeGenerationError,
        action: { label: "Retry", onClick: () => void regenerateNarrative("manual") },
      });
    }
    prevNarrativeError.current = narrativeGenerationError;
  }, [narrativeGenerationError, pushToast, regenerateNarrative]);

  const prevVisualContextError = useRef<string | null>(null);
  useEffect(() => {
    if (visualContextError && visualContextError !== prevVisualContextError.current) {
      pushToast({ tone: "error", message: visualContextError });
    }
    prevVisualContextError.current = visualContextError;
  }, [visualContextError, pushToast]);

  // Workload-derived inputs for the proactive-alert rules — all local, all
  // metrics/counts. Time-of-day fields are injected by the hook at eval time.
  const proactiveAlertData = useMemo<ProactiveAlertData>(() => {
    // `todayKey` is a dep so `tomorrowKey` (and thus tomorrowMeeting* below) slides forward at each
    // local-day rollover even on an idle, mounted-for-days tray app with no block/calendar change —
    // otherwise this memo freezes at mount and, after midnight, `tomorrowKey` points at what is now
    // *today*, so the heavy-day-ahead rule would warn about "tomorrow" using today's meetings (and
    // fire a fresh mis-dated notification, since the hook injects a live `todayKey` into its
    // signature). Same daily-rollover treatment `useDerived.recentSessions` applies to its cutoff.
    const tomorrowKey = getLocalDateKey(addDays(new Date(), 1));
    const tomorrowSpans: { start: number; end: number }[] = [];
    let tomorrowMeetingCount = 0;
    for (const event of calendarEvents) {
      // All-day events (PTO/OOO/holidays/reminders, RFC 5545 VALUE=DATE) span 24h+ of
      // wall-clock but are not meetings — counting their raw span would falsely trip the
      // heavy-meeting-day warning with "24h of meetings". The capacity path already
      // special-cases these (capacityPctFromEvent, outlookIcs.ts); mirror that here.
      if (event.all_day) continue;
      if (getLocalDateKey(new Date(event.start_time)) !== tomorrowKey) continue;
      const start = new Date(event.start_time).getTime();
      const end = new Date(event.end_time).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        tomorrowSpans.push({ start, end });
        tomorrowMeetingCount += 1;
      }
    }
    // Union the day's meeting spans, not a raw sum: two meetings tomorrow can overlap
    // (a double-booking, or short syncs nested inside a longer "hold"/workshop block),
    // and raw-summing their durations would over-report occupied time and falsely trip
    // the heavy-day threshold. The count stays a raw event count.
    const tomorrowMeetingHours = unionSpanMs(tomorrowSpans) / 3_600_000;
    return {
      snapshot,
      hasWorkBlocks: blocks.length > 0,
      unverifiedCount: reviewQueue.length,
      tomorrowMeetingHours,
      tomorrowMeetingCount,
      weeklyArtifacts: generatedNarrative ? { signature: currentWeekId } : null,
    };
  }, [snapshot, blocks.length, reviewQueue.length, calendarEvents, generatedNarrative, currentWeekId, todayKey]);

  const { activeAlert: proactiveAlert, dismissAlert: dismissProactiveAlert } = useProactiveAlerts({
    isDemoMode,
    data: proactiveAlertData,
    settings: proactiveAlertSettings,
    runtime: proactiveAlertRuntime,
    setRuntime: setProactiveAlertRuntime,
    setAuditEvents,
  });

  // Mirror a privacy-safe status line (counts/percent only) into the tray tooltip
  // so the menu bar communicates ambiently without an interruptive notification.
  useTrayStatus({
    isDemoMode,
    paused,
    hasWorkBlocks: blocks.length > 0,
    reviewCount: reviewQueue.length,
    reliableCapacityPct: snapshot.reliable_new_work_capacity_pct,
  });

  // User-initiated proactive-alert config change. A flip of the master toggle is a
  // discrete consent action, logged once (mirrors changeRetentionDays).
  function changeProactiveAlertSettings(next: ProactiveAlertSettings) {
    const previous = proactiveAlertSettings;
    setProactiveAlertSettings(next);
    if (isDemoMode || previous.enabled === next.enabled) return;
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: "proactive_alert",
        source: "proactive_alerts",
        title: next.enabled ? "Proactive alerts enabled" : "Proactive alerts disabled",
        summary: next.enabled
          ? "Menu-bar capacity alerts were turned on by the user."
          : "Menu-bar capacity alerts were turned off by the user.",
        privacy_level: "local_only",
        details: {
          enabled: next.enabled,
          capacity_guardrail_enabled: next.capacityGuardrailEnabled,
          capacity_threshold_pct: next.capacityThresholdPct,
          stored_locally: true,
          sent_to_cloud: false
        }
      })
    ].slice(-1000));
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (themeHydrated.current) {
      writeThemePreference(theme);
    }
  }, [theme]);

  useEffect(() => {
    function navigateFromNative(event: Event) {
      const screen = (event as CustomEvent<Screen>).detail;
      if (screen in screenLabels) {
        setActive(screen);
        setWindowMode("large");
      }
    }

    function togglePauseFromNative() {
      setPaused((current: boolean) => !current);
    }

    function openQuickViewFromNative() {
      setWindowMode("compact");
    }

    function openLargeViewFromNative() {
      setWindowMode("large");
    }

    window.addEventListener("clear-capacity:navigate", navigateFromNative);
    window.addEventListener("clear-capacity:toggle-pause", togglePauseFromNative);
    window.addEventListener("clear-capacity:quick-view", openQuickViewFromNative);
    window.addEventListener("clear-capacity:large-view", openLargeViewFromNative);

    return () => {
      window.removeEventListener("clear-capacity:navigate", navigateFromNative);
      window.removeEventListener("clear-capacity:toggle-pause", togglePauseFromNative);
      window.removeEventListener("clear-capacity:quick-view", openQuickViewFromNative);
      window.removeEventListener("clear-capacity:large-view", openLargeViewFromNative);
    };
  }, []);

  useEffect(() => {
    async function copyManagerSummaryFromNative() {
      setActive("narrative");
      if (!managerText) {
        pushToast({ tone: "info", message: "No manager summary yet" });
        return;
      }
      try {
        // Non-optional so a missing clipboard (insecure webview) throws into the
        // catch rather than silently no-op'ing while we falsely announce success.
        await navigator.clipboard.writeText(managerText);
        pushToast({ tone: "success", message: "Copied to clipboard" });
      } catch {
        pushToast({ tone: "error", message: "Couldn't copy to the clipboard" });
      }
    }

    function resetLocalDataFromNative() {
      resetLocalData();
      setActive("daily");
    }

    window.addEventListener("clear-capacity:copy-manager-summary", copyManagerSummaryFromNative);
    window.addEventListener("clear-capacity:reset-local-data", resetLocalDataFromNative);

    return () => {
      window.removeEventListener("clear-capacity:copy-manager-summary", copyManagerSummaryFromNative);
      window.removeEventListener("clear-capacity:reset-local-data", resetLocalDataFromNative);
    };
  }, [managerText, pushToast]);

  useEffect(() => {
    // One shortcut per primary section (mirrors the sidebar order) plus ⌘9 for
    // Settings — contiguous hints read as intentional; sub-tabs are reached in-section.
    const SCREEN_KEYS: Record<string, Screen> = {
      "1": "daily",
      "2": "weekly",
      "3": "agent",
      "4": "ledger",
      "9": "setup",
    };
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.metaKey || !(event.key in SCREEN_KEYS)) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      event.preventDefault();
      setActive(SCREEN_KEYS[event.key]);
      setWindowMode("large");
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (isDemoMode) return;
    void invoke("set_pause_menu_label", { paused }).catch(() => undefined);
    void invoke("set_activity_capture_paused", { paused }).catch(() => undefined);
  }, [isDemoMode, paused]);

  // Whether an OPENAI_API_KEY is already available from the environment (.env /
  // shell). The Rust AI commands fall back to that variable when no key is saved
  // in Settings, so this is what lets the getting-started wizard truthfully show
  // "already connected to OpenAI". Stays false in the browser preview (no Tauri).
  const [envOpenAiKeyPresent, setEnvOpenAiKeyPresent] = useState(false);
  useEffect(() => {
    if (isDemoMode) return;
    invoke<{ openaiKeyPresent: boolean }>("get_env_ai_key_status")
      .then((status) => setEnvOpenAiKeyPresent(Boolean(status.openaiKeyPresent)))
      .catch(() => undefined);
  }, [isDemoMode]);

  // Tell the native tray which window size to open on click. Runs on mount with
  // the "large" default and again once hydration/preference changes land, so the
  // Rust side always mirrors the persisted choice.
  useEffect(() => {
    if (isDemoMode) return;
    void invoke("set_default_window_mode", { mode: defaultWindowMode }).catch(() => undefined);
  }, [isDemoMode, defaultWindowMode]);

  useEffect(() => {
    if (windowMode === "compact") {
      setSidebarCollapsed(true);
    } else {
      setSidebarCollapsed(false);
    }
    void invoke("set_clear_capacity_window_mode", { mode: windowMode }).catch(() => undefined);
  }, [windowMode]);

  useEffect(() => {
    if (isDemoMode) return;
    // Only a genuine pause/resume transition is a user action worth auditing;
    // mount, hydration, and reset re-seed the ref so they never emit a phantom row.
    if (paused === lastAuditedPausedRef.current) return;
    lastAuditedPausedRef.current = paused;
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: paused ? "privacy_pause" : "privacy_resume",
        source: "privacy_control",
        title: paused ? "Tracking paused" : "Tracking resumed",
        summary: paused
          ? "Native active-window sampling was paused by the user."
          : "Native active-window sampling was resumed by the user.",
        privacy_level: "local_only",
        details: {
          paused,
          stored_locally: true,
          sent_to_cloud: false
        }
      })
    ].slice(-1000));
  }, [isDemoMode, paused]);


  useEffect(() => {
    if (isDemoMode) return;
    if (activeWindowSessions.length === 0) {
      return;
    }

    const latestSession = activeWindowSessions[0];
    setAuditEvents((current) => {
      const alreadyLogged = current.some(
        (event) => event.type === "activity_session" && event.details.session_id === latestSession.session_id
      );
      if (alreadyLogged || latestSession.sample_count < 2) {
        return current;
      }

      return [
        ...current,
        createAuditEvent({
          type: "activity_session",
          source: "sessionizer",
          title: "Active-window session grouped",
          summary: `${latestSession.app_name} grouped for ${formatDurationMinutes(latestSession.duration_minutes)}`,
          privacy_level: "derived_only",
          timestamp: latestSession.end_time,
          details: {
            ...latestSession,
            grouping_rule: "Adjacent samples with matching app and window title within 90 seconds",
            stored_locally: true,
            sent_to_cloud: false
          }
        })
      ].slice(-1000);
    });
  }, [activeWindowSessions, isDemoMode]);

  useEffect(() => {
    if (!hasNarrativeEvidence || lastNarrativeAutoRunDate === todayKey || narrativeGenerationStatus !== "idle") {
      return;
    }

    setLastNarrativeAutoRunDate(todayKey);
    void regenerateNarrative("auto");
  }, [hasNarrativeEvidence, lastNarrativeAutoRunDate, narrativeGenerationStatus, todayKey]);

  useEffect(() => {
    const latestSession = activeWindowSessions[0];
    if (
      !visualContextEnabled ||
      paused ||
      !latestSession ||
      latestSession.duration_minutes < MIN_VISUAL_CONTEXT_SESSION_MINUTES ||
      latestSession.sample_count < 3 ||
      visualContextStatus === "capturing"
    ) {
      return;
    }

    const capturedToday = visualContextInsights.filter(
      (insight) => getLocalDateKey(new Date(insight.captured_at)) === todayKey
    );
    if (capturedToday.length >= MAX_VISUAL_CONTEXT_CAPTURES_PER_DAY) {
      return;
    }

    const alreadyCaptured = visualContextInsights.some((insight) => insight.session_id === latestSession.session_id);
    const alreadyAttempted = visualContextAttemptedSessionIds.includes(latestSession.session_id);
    if (alreadyCaptured || alreadyAttempted) {
      return;
    }

    const lastCapture = [...visualContextInsights].sort(
      (left, right) => new Date(right.captured_at).getTime() - new Date(left.captured_at).getTime()
    )[0];
    if (lastCapture && Date.now() - new Date(lastCapture.captured_at).getTime() < MIN_VISUAL_CONTEXT_GAP_MS) {
      return;
    }

    setVisualContextAttemptedSessionIds((current) => [...current, latestSession.session_id]);
    void captureVisualContext(latestSession, capturedToday.length);
  }, [
    activeWindowSessions,
    paused,
    todayKey,
    visualContextAttemptedSessionIds,
    visualContextEnabled,
    visualContextInsights,
    visualContextStatus
  ]);

  function discardVisualInsight(insightId: string) {
    const target = visualContextInsights.find((insight) => insight.insight_id === insightId);
    if (!target) return;

    setVisualContextInsights((current) => current.filter((insight) => insight.insight_id !== insightId));
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: "visual_context",
        source: "privacy_control",
        title: "Flagged capture discarded",
        summary: `Sensitive visual insight from ${target.app_name} was removed`,
        privacy_level: "local_only",
        details: {
          insight_id: target.insight_id,
          app_name: target.app_name,
          captured_at: target.captured_at,
          sensitive_content_detected: true,
          stored_locally: false,
          sent_to_cloud: false
        }
      })
    ].slice(-1000));
  }

  // User dismissed an Acceleration Play — hide it across reloads and log the discrete
  // action. The play's evidence is derived-only (app names/counts/ids, never window
  // titles), so the audit event is `derived_only`. No-op if already dismissed.
  function dismissPlay(signal: AccelerationSignal) {
    if (dismissedPlayIds.includes(signal.signal_id)) return;
    setDismissedPlayIds((current) =>
      current.includes(signal.signal_id) ? current : [...current, signal.signal_id]
    );
    if (isDemoMode) return;
    setAuditEvents((current) =>
      [...current, createAccelerationPlayAuditEvent({ action: "dismissed", signal })].slice(-1000)
    );
  }

  // Un-dismiss every hidden Play (the "Restore" affordance on the Acceleration screen).
  // Reversing a hide is not a discrete decision worth its own audit line, so it stays
  // unlogged (mirrors the unsave path below).
  function restoreDismissedPlays() {
    setDismissedPlayIds([]);
  }

  // User marked an Acceleration Play as acted on — the discrete "I tried this" signal the
  // realized-savings track record (E3) scores against. Derived-only evidence makes it a
  // `derived_only` event. No-op if already recorded so re-renders never double-log.
  function markPlayActedOn(signal: AccelerationSignal) {
    if (actedOnPlayIds.includes(signal.signal_id)) return;
    setActedOnPlayIds((current) =>
      current.includes(signal.signal_id) ? current : [...current, signal.signal_id]
    );
    if (isDemoMode) return;
    setAuditEvents((current) =>
      [...current, createAccelerationPlayAuditEvent({ action: "acted_on", signal })].slice(-1000)
    );
  }

  // Undo an "acted on" mark (a mistaken toggle) — not audited, mirroring removeSkill.
  function unmarkPlayActedOn(signalId: string) {
    setActedOnPlayIds((current) => current.filter((id) => id !== signalId));
  }

  // Snapshot an AUTOMATE Play's AI-authored recipe into the durable skills library. Storing
  // the recipe TEXT (not just the signal_id) is what makes a generated skill reusable beyond
  // the session — it survives regeneration and the miner retiring the signal. Upserts by
  // signal_id (re-saving refreshes the snapshot). No-op without a recipe; the discrete save is
  // audited `derived_only` (the recipe is AI-authored from derived signals, never window titles).
  function saveSkill(play: AccelerationPlay) {
    if (!play.recipe) return;
    const skill: SavedSkill = {
      signal_id: play.signal_id,
      play_type: play.type,
      title: play.title,
      detail: play.detail,
      recipe: play.recipe,
      recommended_tools: play.recommended_tools,
      estimated_minutes_saved_per_week: play.estimated_minutes_saved_per_week,
      saved_at: new Date().toISOString(),
      // Snapshot the Agent Skills authoring fields so the library can export a valid SKILL.md
      // even after the signal is retired (null when the play was rendered deterministically).
      skill_name: play.skill_name,
      skill_description: play.skill_description,
    };
    setSavedSkills((current) => [
      ...current.filter((existing) => existing.signal_id !== skill.signal_id),
      skill,
    ]);
    if (isDemoMode) return;
    setAuditEvents((current) =>
      [...current, createAccelerationPlayAuditEvent({ action: "saved_to_library", signal: play })].slice(-1000)
    );
  }

  // Remove a skill from the library (an undo of a save) — not audited.
  function removeSkill(signalId: string) {
    setSavedSkills((current) => current.filter((skill) => skill.signal_id !== signalId));
  }

  // User dismissed the first-run getting-started card. Persisted so the nudge stays
  // gone across reloads, and logged once as a discrete, low-noise user action.
  function dismissOnboarding() {
    if (onboardingDismissed) return;
    setOnboardingDismissed(true);
    if (isDemoMode) return;
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: "onboarding",
        source: "onboarding",
        title: "Getting started dismissed",
        summary: "The first-run getting-started checklist was dismissed by the user.",
        privacy_level: "local_only",
        details: {
          stored_locally: true,
          sent_to_cloud: false
        }
      })
    ].slice(-1000));
  }

  // First-run app walkthrough finished or skipped. Persisted so the overlay
  // stays gone across reloads, and logged once as a discrete onboarding action.
  // `outcome` distinguishes a completed tour from an early skip in the audit
  // trail without adding a second event type.
  function endWalkthrough(outcome: "completed" | "skipped") {
    if (walkthroughCompleted) return;
    setWalkthroughCompleted(true);
    if (isDemoMode) return;
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: "onboarding",
        source: "walkthrough",
        title: outcome === "completed" ? "App walkthrough completed" : "App walkthrough skipped",
        summary:
          outcome === "completed"
            ? "The first-run guided tour of the app was completed by the user."
            : "The first-run guided tour of the app was skipped by the user.",
        privacy_level: "local_only",
        details: {
          outcome,
          stored_locally: true,
          sent_to_cloud: false
        }
      })
    ].slice(-1000));
  }

  // Branded first-launch welcome, acknowledged per session: it fronts the
  // walkthrough on a genuine first run, and an interrupted onboarding greets
  // the user again next launch (nothing persisted until the walkthrough ends).
  const [welcomeAcknowledged, setWelcomeAcknowledged] = useState(false);

  // Let the user replay the guided tour from Settings. Skips the branded
  // welcome — replays go straight into the tour.
  function replayWalkthrough() {
    setWelcomeAcknowledged(true);
    setWalkthroughCompleted(false);
  }

  // Post-walkthrough "Getting started" modal closed. `outcome` records whether the
  // user enabled tracking from it or deferred ("I'll do this later" — the reminder
  // banner then persists until tracking turns on). The tracking toggle itself is
  // separately audited by the privacy_pause/privacy_resume effect; this logs only
  // the onboarding decision, mirroring endWalkthrough.
  function finishGettingStarted(outcome: "enabled" | "skipped") {
    if (gettingStartedStatus !== "unseen") return;
    setGettingStartedStatus(outcome === "enabled" ? "complete" : "skipped");
    // Land the user on Today — the home dashboard the modal points them at.
    if (outcome === "enabled") setActive("daily");
    if (isDemoMode) return;
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: "onboarding",
        source: "onboarding",
        title:
          outcome === "enabled"
            ? "Getting-started setup completed"
            : "Getting-started setup deferred",
        summary:
          outcome === "enabled"
            ? "Activity tracking was enabled from the post-walkthrough getting-started screen."
            : "The post-walkthrough getting-started screen was dismissed without enabling tracking.",
        privacy_level: "local_only",
        details: {
          outcome,
          stored_locally: true,
          sent_to_cloud: false
        }
      })
    ].slice(-1000));
  }

  // Connect OpenAI from the getting-started wizard with a pasted API key. Uses
  // the same OpenAI defaults Settings would apply, so the saved config is
  // identical to one entered under Settings → AI Assistance.
  function connectOpenAiKeyFromWizard(apiKey: string) {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setAiConfig({ ...createDefaultAIConfig("openai"), apiKey: trimmed });
  }

  // Connect OpenAI by importing the API key from the Codex CLI's sign-in
  // (~/.codex/auth.json). The Rust command rejects with user-facing copy when
  // there's no sign-in or it's a subscription-only login without an API key.
  async function connectViaCodexFromWizard(): Promise<string> {
    // Mirrors SetupScreen's testConnection guard: the browser preview has no
    // Tauri bridge, so fail with friendly copy instead of a raw invoke error.
    if (!("__TAURI_INTERNALS__" in window)) {
      throw new Error("Connecting via Codex needs the desktop app — paste an API key instead.");
    }
    const result = await invoke<{ apiKey: string }>("connect_openai_via_codex");
    setAiConfig({ ...createDefaultAIConfig("openai"), apiKey: result.apiKey });
    return "Connected with your Codex credentials.";
  }

  // "Play the simulated week" from the getting-started wizard: finish the wizard
  // (recording the outcome the live tracking state implies), then reload into the
  // seeded demo profile on the weekly screen. The short delay lets the persistence
  // effect flush the finished status to disk before the reload tears the app down —
  // otherwise the wizard would reappear when the user exits the demo.
  function openDemoSimulation() {
    finishGettingStarted(paused ? "skipped" : "enabled");
    window.setTimeout(() => {
      window.location.assign("?demo=1&screen=weekly");
    }, 600);
  }

  // Once tracking gets enabled from ANYWHERE (reminder banner, toolbar, tray,
  // Settings), a deferred getting-started flow is complete — retire the reminder
  // banner permanently. Silent: the resume itself is already audited above.
  useEffect(() => {
    if (gettingStartedStatus === "skipped" && !paused) {
      setGettingStartedStatus("complete");
    }
  }, [gettingStartedStatus, paused]);

  // User-initiated retention-window change. Logged once as a discrete privacy
  // action (the background per-sample expiry deliberately stays unlogged).
  function changeRetentionDays(value: number | null) {
    setRetentionDays(value);
    if (isDemoMode) return;
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: "retention_policy",
        source: "privacy_control",
        title: "Activity retention updated",
        summary: value === null
          ? "Automatic sample expiry disabled — samples are kept until reset"
          : `Active-window samples now auto-expire after ${value} days`,
        privacy_level: "local_only",
        details: {
          retention_days: value,
          stored_locally: true,
          sent_to_cloud: false
        }
      })
    ].slice(-1000));
  }

  // User-initiated visual-context (screenshot capture) toggle. Logged as a discrete
  // privacy action — enabling opts the user INTO screenshot capture, the most
  // privacy-consequential switch, so it must leave an audit trail like pause/resume
  // and retention. Individual captures are separately audited (`visual_context`).
  function changeVisualContextEnabled(value: boolean) {
    setVisualContextEnabled(value);
    if (isDemoMode) return;
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: "visual_context_policy",
        source: "privacy_control",
        title: value ? "Visual context enabled" : "Visual context disabled",
        summary: value
          ? "Opt-in screenshot capture was turned on by the user."
          : "Opt-in screenshot capture was turned off by the user.",
        privacy_level: "local_only",
        details: {
          visual_context_enabled: value,
          stored_locally: true,
          sent_to_cloud: false
        }
      })
    ].slice(-1000));
  }

  // User-initiated AI-usage settings change (observed estimates, manager toggle, price map).
  // Each change is a discrete consent action, logged once with the resulting flag
  // states (mirrors changeVisualContextEnabled); price-map CONTENTS are never audited.
  function changeTokenUsageSettings(next: TokenUsageSettings) {
    const previous = tokenUsageSettings;
    setTokenUsageSettings(next);
    if (isDemoMode) return;
    const changedFields: string[] = [];
    if (previous.observed_proxy_enabled !== next.observed_proxy_enabled) {
      changedFields.push(`observed AI estimates ${next.observed_proxy_enabled ? "enabled" : "disabled"}`);
    }
    if (previous.include_in_manager_summary !== next.include_in_manager_summary) {
      changedFields.push(`manager-summary inclusion ${next.include_in_manager_summary ? "enabled" : "disabled"}`);
    }
    if (JSON.stringify(previous.price_map) !== JSON.stringify(next.price_map)) {
      changedFields.push("model price map");
    }
    if (changedFields.length === 0) return;
    setAuditEvents((current) => [
      ...current,
      createUsageSettingsAuditEvent({
        changedFields,
        observedProxyEnabled: next.observed_proxy_enabled,
        includeInManagerSummary: next.include_in_manager_summary,
        priceMapEntryCount: Object.keys(next.price_map).length
      })
    ].slice(-1000));
  }

  // `addCorrection` (single source of truth) lives in `useBlocksLedger` — it stamps the
  // correction, appends it to state, and emits a humanized `user_correction` audit event
  // through the shared `fieldLabel`/`humanizeCorrectionValue` helpers. Both manual relabels
  // (updateBlock/confirmBlock/excludeBlock) and the import/copilot callers below route
  // through it, so every correction persists one identical audit shape.

  // The most recent correction, when it can be cleanly reverted through the relabel path:
  // it came from a single-field manual relabel (not the multi-correction Review Copilot
  // bulk apply), it's today's, edits an undoable field, and its target block still exists
  // AND still holds the changed value (so the revert actually does something — no lying
  // "Reverted…" toast if an AI reclassification already moved the field back).
  const lastCorrection = corrections.length > 0 ? corrections[corrections.length - 1] : null;
  const undoTargetBlock =
    lastCorrection && lastCorrection.reason === MANUAL_REVIEW_ADJUSTMENT_REASON
      ? blocks.find((block) => block.work_block_id === lastCorrection.work_block_id)
      : undefined;
  const canUndoLastCorrection = Boolean(
    lastCorrection &&
      undoTargetBlock &&
      getLocalDateKey(new Date(lastCorrection.timestamp)) === getLocalDateKey() &&
      (UNDOABLE_CORRECTION_FIELDS as readonly string[]).includes(lastCorrection.field) &&
      String(undoTargetBlock[lastCorrection.field as (typeof UNDOABLE_CORRECTION_FIELDS)[number]]) !==
        lastCorrection.old_value
  );

  function undoLastCorrection() {
    if (!lastCorrection || !canUndoLastCorrection) {
      return;
    }
    // Re-apply the prior value via the same relabel path — this records the reversal
    // as a fresh (inverse) correction + audit event, so it stays explainable and redoable.
    updateBlock(
      lastCorrection.work_block_id,
      lastCorrection.field as (typeof UNDOABLE_CORRECTION_FIELDS)[number],
      lastCorrection.old_value
    );
    pushToast({
      tone: "success",
      message: `Reverted ${fieldLabel(lastCorrection.field)} to ${humanizeCorrectionValue(
        lastCorrection.field,
        lastCorrection.old_value
      )}`
    });
  }

  function dismissReviewSuggestion(suggestionId: string) {
    setReviewSuggestions((current) => current.filter((suggestion) => suggestion.suggestion_id !== suggestionId));
  }

  function applyReviewSuggestion(suggestion: ReviewCopilotSuggestion) {
    const targetBlocks = blocks.filter((block) => suggestion.work_block_ids.includes(block.work_block_id));
    if (targetBlocks.length === 0) {
      dismissReviewSuggestion(suggestion.suggestion_id);
      return;
    }

    if (suggestion.action === "confirm") {
      targetBlocks.forEach((block) => confirmBlock(block.work_block_id));
      dismissReviewSuggestion(suggestion.suggestion_id);
      return;
    }

    if (suggestion.action === "exclude") {
      targetBlocks.forEach((block) => excludeBlock(block.work_block_id));
      dismissReviewSuggestion(suggestion.suggestion_id);
      return;
    }

    const updates: Partial<WorkBlock> = {};
    if (suggestion.proposed_category) {
      updates.category = suggestion.proposed_category;
    }
    if (suggestion.proposed_mode) {
      updates.mode = suggestion.proposed_mode;
    }
    if (suggestion.proposed_planned_status) {
      updates.planned_status = suggestion.proposed_planned_status;
    }
    if (suggestion.proposed_project_name) {
      updates.project_name = suggestion.proposed_project_name;
    }
    if (suggestion.proposed_stakeholder_group) {
      updates.stakeholder_group = suggestion.proposed_stakeholder_group;
    }
    if (suggestion.proposed_blocker_flag !== null) {
      updates.blocker_flag = suggestion.proposed_blocker_flag;
    }
    if (suggestion.proposed_notes || suggestion.action === "merge" || suggestion.action === "split" || suggestion.action === "note") {
      updates.notes = suggestion.proposed_notes ?? `Review Copilot suggestion: ${suggestion.rationale}`;
    }

    const correctionFields: Array<keyof WorkBlock> = [
      "category",
      "mode",
      "planned_status",
      "project_name",
      "stakeholder_group",
      "blocker_flag",
      "notes"
    ];
    targetBlocks.forEach((block) => {
      correctionFields.forEach((field) => {
        if (!(field in updates)) {
          return;
        }
        const nextValue = updates[field];
        if (String(block[field]) === String(nextValue)) {
          return;
        }
        addCorrection({
          work_block_id: block.work_block_id,
          field: field as UserCorrection["field"],
          old_value: String(block[field] ?? ""),
          new_value: String(nextValue ?? ""),
          reason: `Review Copilot ${suggestion.action}: ${suggestion.rationale}`
        });
      });
    });

    setBlocks((current) =>
      current.map((block) => {
        if (!suggestion.work_block_ids.includes(block.work_block_id)) {
          return block;
        }
        const updated: WorkBlock = { ...block, ...updates, user_verified: false };
        // blocker_flag is DERIVED (category === "Blocked / waiting / dependency delay" ||
        // planned_status === "blocked"). The prompt tells the model to include only the fields
        // that change on a relabel, so a suggestion moving a block into/out of a blocked state
        // routinely leaves proposed_blocker_flag null — and this apply path only writes the flag
        // when it is non-null. Without recomputing it here the flag goes stale: a block relabeled
        // INTO blocked keeps blocker_flag false, dropping it from capacity's `included` filter
        // (planned_status !== "blocked" || blocker_flag) so committed load is under-counted and
        // reliable capacity over-stated, while a block relabeled OUT of blocked keeps the flag true
        // and is still counted in blocked_pct / the Blockers badge. Recompute silently on the SAME
        // rule as useBlocksLedger.updateBlock — the user-approved category/status change is the
        // audited correction; the flag flip is its mechanical consequence.
        if ("category" in updates || "planned_status" in updates) {
          updated.blocker_flag =
            updated.category === "Blocked / waiting / dependency delay" ||
            updated.planned_status === "blocked";
        }
        return updated;
      })
    );
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: "review_copilot",
        source: "review_layer",
        title: "Review Copilot suggestion applied",
        summary: suggestion.title,
        privacy_level: "local_only",
        details: {
          suggestion,
          applied_work_block_ids: suggestion.work_block_ids
        }
      })
    ].slice(-1000));
    dismissReviewSuggestion(suggestion.suggestion_id);
  }


  function updateManagerSummary(value: string) {
    setManagerSummaryText(value);
    const lastSummaryCorrection = [...corrections]
      .reverse()
      .find((correction) => correction.field === "manager_summary");

    if (!lastSummaryCorrection || lastSummaryCorrection.new_value !== "edited locally") {
      addCorrection({
        work_block_id: currentWeekId,
        field: "manager_summary",
        old_value: "generated",
        new_value: "edited locally",
        reason: "User edited manager-ready narrative"
      });
    }
  }

  // The pre-reset "Export my data first" affordance. Snapshots every data class the
  // reset destroys into one local JSON backup so the irreversible wipe is recoverable
  // from a file — the earlier version only exported the ledger + audit, silently
  // omitting the corrections, forecasts, narratives, imports, and skills the confirm
  // dialog itself lists. Downloads always (harmless in demo); audits only for real data
  // (mirrors the retention/visual-context privacy handlers' demo guard).
  function exportFullBackup() {
    const backup: FullBackup = {
      blocks,
      calendarEvents,
      chatEvents,
      activeWindowSamples,
      auditEvents,
      corrections,
      reviewSuggestions,
      generatedForecast,
      forecastHistory,
      snapshotHistory,
      accelerationHistory,
      visualContextEnabled,
      visualContextInsights,
      dismissedPlayIds,
      actedOnPlayIds,
      generatedPlays,
      savedSkills,
      managerSummaryText,
      generatedNarrative,
      lastNarrativeAutoRunDate,
      paused,
      retentionDays,
      onboardingDismissed,
      walkthroughCompleted,
      gettingStartedStatus,
      defaultWindowMode,
      proactiveAlertSettings,
      proactiveAlertRuntime,
      tokenUsageDays,
      tokenUsageSettings,
      usageCsvRowHashes,
    };
    downloadTextFile(
      exportFilename("full-backup", "json"),
      serializeFullBackup(backup),
      exportMimeType("json")
    );
    if (isDemoMode) return;
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: "data_export",
        source: "privacy_control",
        title: "Full data backup exported",
        summary: `Saved a local JSON backup of ${backup.blocks.length} work ${
          backup.blocks.length === 1 ? "block" : "blocks"
        }, the audit trail, imports, and every AI output.`,
        privacy_level: "local_only",
        details: {
          stored_locally: true,
          sent_to_cloud: false,
          work_blocks: backup.blocks.length,
          activity_samples: backup.activeWindowSamples.length,
          calendar_events: backup.calendarEvents.length,
          chat_events: backup.chatEvents.length,
          corrections: backup.corrections.length,
          audit_events: backup.auditEvents.length,
          saved_skills: backup.savedSkills.length,
          visual_context_insights: backup.visualContextInsights.length
        }
      })
    ].slice(-1000));
  }

  function resetLocalData() {
    if (isDemoMode) {
      window.location.reload();
      return;
    }
    clearPersistedState().catch(() => {});
    setBlocks([]);
    setCalendarEvents([]);
    setActiveWindowSamples([]);
    // The reset wipes every stored event, but leaves one record of the reset
    // itself and its privacy effects — a user-visible action must stay auditable.
    setAuditEvents([
      createAuditEvent({
        type: "data_reset",
        source: "privacy_control",
        title: "Prototype data reset",
        summary:
          "All local activity, imports, AI outputs, and saved skills were cleared, along with your saved AI provider credentials. Screenshot capture was turned off and tracking paused.",
        privacy_level: "local_only",
        details: {
          visual_context_enabled: false,
          tracking_paused: true,
          retention_days: null,
          ai_credentials_cleared: true,
          stored_locally: true,
          sent_to_cloud: false
        }
      })
    ]);
    setCorrections([]);
    setReviewSuggestions([]);
    setGeneratedForecast(null);
    setForecastHistory([]);
    setSnapshotHistory([]);
    setAccelerationHistory([]);
    setChatEvents([]);
    setVisualContextEnabled(false);
    setVisualContextInsights([]);
    setVisualContextAttemptedSessionIds([]);
    setDismissedPlayIds([]);
    setActedOnPlayIds([]);
    setGeneratedPlays(null);
    setSavedSkills([]);
    setRetentionDays(null);
    setOnboardingDismissed(false);
    // A "reset all local data" that wipes disk must also clear the persisted
    // AI provider config (incl. credentials) and the walkthrough flag — otherwise
    // these survive in memory and the next persist write re-seeds them onto disk,
    // so state and disk disagree until then. Theme lives outside PersistedAppState,
    // so it is intentionally untouched.
    setAiConfig(null);
    setWalkthroughCompleted(false);
    setGettingStartedStatus("unseen");
    setDefaultWindowMode("large");
    setManagerSummaryText(null);
    setGeneratedNarrative(null);
    setLastNarrativeAutoRunDate(null);
    setProactiveAlertSettings(DEFAULT_PROACTIVE_ALERT_SETTINGS);
    setProactiveAlertRuntime(EMPTY_PROACTIVE_ALERT_RUNTIME);
    setTokenUsageDays([]);
    setTokenUsageSettings(DEFAULT_TOKEN_USAGE_SETTINGS);
    setUsageCsvRowHashes([]);
    setUsageImportError(null);
    setLastUsageImportSummary(null);
    resetNarrative();
    resetClassification();
    resetReviewCopilot();
    resetForecast();
    resetAcceleration();
    resetVisualContext();
    setImportError(null);
    setLastCalendarImportSummary(null);
    setChatImportError(null);
    setCaptureError(null);
    setPaused(true);
    // The single data_reset event above already records that tracking was paused,
    // so keep the ref in step and let the audit effect skip its own pause row —
    // preserving the "reset leaves exactly one audit event" invariant.
    lastAuditedPausedRef.current = true;
  }

  function importOutlookIcs(file: File) {
    setImportError(null);
    const reader = new FileReader();

    const failImport = (message: string) => {
      setImportError(message);
      pushToast({ tone: "error", message });
    };

    reader.onerror = () => {
      failImport("Could not read that Outlook export.");
    };

    reader.onload = () => {
      try {
        const content = String(reader.result ?? "");
        const importedEvents = parseOutlookIcs(content);

        if (importedEvents.length === 0) {
          failImport("No usable calendar events were found in that .ics file.");
          return;
        }

        // Diff the parsed events against what's already stored so a re-import isn't a
        // silent no-op. The merge is an UPSERT (below) — it never drops stored events —
        // so the honest delta is added / updated / unchanged; there is no truthful
        // "removed" count (an event missing from the new file is retained, not deleted).
        const priorEventsById = new Map(calendarEvents.map((event) => [event.calendar_event_id, event]));
        const previousEventCount = calendarEvents.length;
        let addedCount = 0;
        let updatedCount = 0;
        let unchangedCount = 0;
        importedEvents.forEach((event) => {
          const prior = priorEventsById.get(event.calendar_event_id);
          if (!prior) {
            addedCount += 1;
          } else if (calendarEventChanged(prior, event)) {
            updatedCount += 1;
          } else {
            unchangedCount += 1;
          }
        });
        const deltaParts: string[] = [];
        if (addedCount > 0) deltaParts.push(`+${addedCount} new`);
        if (updatedCount > 0) deltaParts.push(`${updatedCount} updated`);
        if (unchangedCount > 0) deltaParts.push(`${unchangedCount} unchanged`);

        setCalendarEvents((current) => {
          const merged = new Map(current.map((event) => [event.calendar_event_id, event]));
          importedEvents.forEach((event) => merged.set(event.calendar_event_id, event));
          return [...merged.values()].sort(
            (left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime()
          );
        });

        setBlocks((current) => {
          const nonCalendarBlocks = current.filter((block) => !block.work_block_id.startsWith("calendar-outlook-"));
          const currentEvents = new Map(calendarEvents.map((event) => [event.calendar_event_id, event]));
          importedEvents.forEach((event) => currentEvents.set(event.calendar_event_id, event));
          const calendarBlocks = outlookEventsToWorkBlocks([...currentEvents.values()], currentWeekId);
          // Symmetric dedup: importing the calendar after a chat export must also
          // drop any previously-imported chat call block now covered by a calendar
          // meeting, so the order of the two imports never double-counts the call.
          const importedBlocks = nonCalendarBlocks.filter((block) => block.work_block_id.startsWith("imported-"));
          const otherBlocks = nonCalendarBlocks.filter((block) => !block.work_block_id.startsWith("imported-"));
          const { kept } = dedupeChatCallsAgainstCalendar(importedBlocks, calendarBlocks);
          return [...otherBlocks, ...kept, ...calendarBlocks].sort(
            (left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime()
          );
        });

        addCorrection({
          work_block_id: currentWeekId,
          field: "calendar_import",
          old_value: "Outlook events",
          new_value: `${importedEvents.length} imported`,
          reason: `Imported ${file.name}`
        });
        setAuditEvents((current) => [
          ...current,
          createCalendarImportAuditEvent({
            fileName: file.name,
            importedEventIds: importedEvents.map((event) => event.calendar_event_id),
            addedCount,
            updatedCount,
            unchangedCount,
            previousEventCount
          })
        ].slice(-1000));
        // Persist the delta as a lingering Settings line (the toast auto-expires) so the
        // user can confirm the calendar stayed in sync after the fact.
        setLastCalendarImportSummary(deltaParts.length > 0 ? deltaParts.join(" · ") : null);
        const importedCount = importedEvents.length;
        const baseMessage = `${importedCount} event${importedCount === 1 ? "" : "s"} imported`;
        pushToast({
          tone: "success",
          message:
            previousEventCount > 0 && deltaParts.length > 0
              ? `${baseMessage} (${deltaParts.join(", ")})`
              : baseMessage,
        });
      } catch {
        failImport("The .ics file could not be parsed.");
      }
    };

    reader.readAsText(file);
  }

  function importWorkplaceChat(file: File) {
    setChatImportError(null);
    const reader = new FileReader();

    const failImport = (message: string) => {
      setChatImportError(message);
      pushToast({ tone: "error", message });
    };

    reader.onerror = () => {
      failImport("Could not read that chat export.");
    };

    reader.onload = () => {
      try {
        const content = String(reader.result ?? "");
        // Metadata-only: importChatExport whitelists timestamps/channels/counts and
        // has no message-text field, so message bodies can never enter the ledger.
        const result = importChatExport(content, { weekId: currentWeekId });

        // A malformed export no longer throws — it returns a structured result
        // carrying the parse reason, which we surface verbatim.
        if (result.error) {
          failImport(result.error);
          return;
        }

        if (result.work_blocks.length === 0) {
          failImport("No usable chat activity was found in that export.");
          return;
        }

        // Drop chat call/huddle meeting blocks that overlap a meeting already on
        // the calendar, so a Teams/Webex call on both isn't double-counted in
        // meeting_pct. Reactive blocks are always kept.
        const { kept, deduped } = dedupeChatCallsAgainstCalendar(result.work_blocks, blocks);

        if (kept.length > 0) {
          setBlocks((current) => {
            // Imported blocks carry stable ids (`imported-<hash>`), so re-importing
            // the same export upserts rather than duplicating.
            const merged = new Map(current.map((block) => [block.work_block_id, block]));
            kept.forEach((block) => merged.set(block.work_block_id, block));
            return [...merged.values()].sort(
              (left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime()
            );
          });

          // Retain the metadata-only chat events (deduped by event_id) so the
          // interruption-load signal survives a reload — but only the reactive text
          // bursts, not call/huddle meetings (those are meeting blocks, not
          // interruptions). NO message text is stored.
          const reactiveEvents = result.events.filter((event) => event.metadata?.kind !== "call");
          setChatEvents((current) => {
            const merged = new Map(current.map((event) => [event.event_id, event]));
            reactiveEvents.forEach((event) => merged.set(event.event_id, event));
            return [...merged.values()].sort(
              (left, right) =>
                new Date(left.timestamp_start).getTime() - new Date(right.timestamp_start).getTime()
            );
          });
        }

        // Audit every import attempt, including one where every block was a call
        // already covered by the calendar (a user-visible decision that changed
        // what was imported).
        setAuditEvents((current) => [
          ...current,
          createChatImportAuditEvent({
            fileName: file.name,
            importedBlockCount: kept.length,
            skippedRecordCount: result.skipped
          })
        ].slice(-1000));
        pushToast({
          tone: kept.length === 0 ? "info" : "success",
          message:
            kept.length === 0
              ? `${deduped.length} chat call${deduped.length === 1 ? "" : "s"} already on your calendar — nothing new imported`
              : deduped.length > 0
                ? `${kept.length} block${kept.length === 1 ? "" : "s"} imported · ${deduped.length} call${deduped.length === 1 ? "" : "s"} already on your calendar`
                : `${kept.length} block${kept.length === 1 ? "" : "s"} imported`,
        });
      } catch {
        failImport("That chat export could not be parsed.");
      }
    };

    reader.readAsText(file);
  }

  function importUsageCsv(file: File) {
    setUsageImportError(null);
    const reader = new FileReader();

    const failImport = (message: string) => {
      setUsageImportError(message);
      pushToast({ tone: "error", message });
    };

    reader.onerror = () => {
      failImport("Could not read that usage CSV.");
    };

    reader.onload = () => {
      // parseUsageCsv never throws — a malformed file returns an empty result
      // whose `error` carries the reason, surfaced verbatim.
      const content = String(reader.result ?? "");
      const result = parseUsageCsv(content, { knownRowHashes: new Set(usageCsvRowHashes) });

      if (result.error) {
        failImport(result.error);
        return;
      }
      if (result.imported === 0 && result.duplicates === 0) {
        failImport("No usable usage rows were found in that file.");
        return;
      }

      if (result.imported > 0) {
        setTokenUsageDays((current) => mergeTokenUsageDays(current, result.days));
        // Row hashes make a re-import idempotent; cap the list so it can't grow
        // unboundedly inside the single persisted blob.
        setUsageCsvRowHashes((current) => [...current, ...result.row_hashes].slice(-20000));
      }

      const summaryParts = [`${result.imported} imported`];
      if (result.duplicates > 0) summaryParts.push(`${result.duplicates} already imported`);
      if (result.skipped > 0) summaryParts.push(`${result.skipped} skipped`);
      setLastUsageImportSummary(summaryParts.join(" · "));

      if (!isDemoMode) {
        setAuditEvents((current) => [
          ...current,
          createUsageImportAuditEvent({
            fileName: file.name,
            importedRowCount: result.imported,
            skippedRowCount: result.skipped,
            duplicateRowCount: result.duplicates
          })
        ].slice(-1000));
      }
      pushToast({
        tone: result.imported === 0 ? "info" : "success",
        message:
          result.imported === 0
            ? "Every row in that file was already imported — nothing new added"
            : `${result.imported} usage row${result.imported === 1 ? "" : "s"} imported${result.duplicates > 0 ? ` · ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped` : ""}`,
      });
    };

    reader.readAsText(file);
  }

  function openScreenFromQuickView(screen: Screen) {
    setActive(screen);
    setWindowMode("large");
  }

  // First-run guidance shown on the empty daily/weekly screens. Shares its step
  // definitions with the Settings checklist via `buildOnboardingSteps`.
  const onboardingSteps = useMemo(
    () =>
      buildOnboardingSteps({
        trackingActive: !paused && activeWindowSamples.length > 0,
        calendarImported: calendarEvents.length > 0,
        aiConfigured: Boolean(aiConfig?.apiKey),
        classified: blocks.length > 0,
      }),
    [paused, activeWindowSamples.length, calendarEvents.length, aiConfig?.apiKey, blocks.length]
  );
  const showOnboarding = !isDemoMode && !onboardingDismissed && blocks.length === 0;
  // The guided tour spotlights the sidebar nav, so it only runs in the full
  // window (the compact menu-bar widget has no nav) and never in demo mode.
  // Whether AI-backed features can actually run: a key saved in Settings, or the
  // OPENAI_API_KEY environment fallback the Rust commands use. Every AI-triggering
  // button disables (with an explanatory tooltip) when this is false.
  const aiAvailable = Boolean(aiConfig?.apiKey?.trim()) || envOpenAiKeyPresent;
  // Onboarding sequence: branded welcome → walkthrough → getting-started wizard.
  const showWelcome =
    !isDemoMode && windowMode === "large" && !walkthroughCompleted && !welcomeAcknowledged;
  const showWalkthrough =
    !isDemoMode && windowMode === "large" && !walkthroughCompleted && welcomeAcknowledged;
  // The "Getting started" (enable tracking) modal takes over the moment the
  // walkthrough finishes: same large-window/demo gating, but keyed on the
  // walkthrough being DONE so the two full-screen layers never stack.
  const showGettingStarted =
    !isDemoMode && windowMode === "large" && walkthroughCompleted && gettingStartedStatus === "unseen";
  // Persistent nudge after "I'll do this later": stays until tracking is enabled
  // (the skipped→complete effect above then retires it for good).
  const showTrackingReminder =
    !isDemoMode && windowMode === "large" && gettingStartedStatus === "skipped" && paused;

  return (
    <AppShell
      active={active}
      setActive={setActive}
      snapshot={snapshot}
      hasWorkBlocks={blocks.length > 0}
      reviewCount={reviewQueue.length}
      showFlaggedTab={visualContextEnabled || visualContextInsights.some((insight) => insight.sensitive_content_detected)}
      paused={paused}
      setPaused={setPaused}
      sidebarCollapsed={sidebarCollapsed}
      setSidebarCollapsed={setSidebarCollapsed}
      windowMode={windowMode}
      setWindowMode={setWindowMode}
      theme={theme}
      setTheme={setTheme}
      weekRangeLabel={currentWeekRangeLabel}
      demoMode={isDemoMode}
      showTrackingReminder={showTrackingReminder}
      toasts={toasts}
      onDismissToast={dismissToast}
    >
      <ScreenRouter
        active={active}
        windowMode={windowMode}
        paused={paused}
        setPaused={setPaused}
        blocks={blocks}
        activeWindowSamples={activeWindowSamples}
        activeWindowSessions={activeWindowSessions}
        snapshot={snapshot}
        snapshotHistory={snapshotHistory}
        interruptionLoad={interruptionLoad}
        chatStakeholders={chatStakeholders}
        accelerationPlays={accelerationPlays}
        realizedSavings={realizedSavings}
        realizedSavingsSummary={realizedSavingsSummary}
        dismissedPlayIds={dismissedPlayIds}
        actedOnPlayIds={actedOnPlayIds}
        onDismissPlay={dismissPlay}
        onMarkPlayActedOn={markPlayActedOn}
        onUnmarkPlayActedOn={unmarkPlayActedOn}
        onRestoreDismissedPlays={restoreDismissedPlays}
        savedSkills={savedSkills}
        savedSkillIds={savedSkillIds}
        onSaveSkill={saveSkill}
        onRemoveSkill={removeSkill}
        accelerationStatus={accelerationStatus}
        accelerationError={accelerationError}
        onGenerateAccelerationPlays={() => void generateAccelerationPlays()}
        accelerationConfigured={aiAvailable}
        aiAvailable={aiAvailable}
        accelerationGeneratedAt={generatedPlays?.generated_at ?? null}
        hasAuthoredPlays={(generatedPlays?.plays.length ?? 0) > 0}
        onConfirm={confirmBlock}
        onExclude={excludeBlock}
        onRelabel={updateBlock}
        onUndoLastCorrection={undoLastCorrection}
        canUndoLastCorrection={canUndoLastCorrection}
        onOpenScreen={openScreenFromQuickView}
        onboardingSteps={onboardingSteps}
        showOnboarding={showOnboarding}
        onDismissOnboarding={dismissOnboarding}
        activeSettingsTab={activeSettingsTab}
        onActiveSettingsTabChange={setActiveSettingsTab}
        visualContextEnabled={visualContextEnabled}
        setVisualContextEnabled={changeVisualContextEnabled}
        visualContextInsights={visualContextInsights}
        onDiscardInsight={discardVisualInsight}
        calendarEvents={calendarEvents}
        captureError={captureError}
        importError={importError}
        lastCalendarImportSummary={lastCalendarImportSummary}
        onImportOutlookIcs={importOutlookIcs}
        chatImportError={chatImportError}
        onImportChatExport={importWorkplaceChat}
        tokenUsageDays={tokenUsageDays}
        tokenUsageSettings={tokenUsageSettings}
        proxyUsageDays={proxyUsageDays}
        aiUsageSummary={aiUsageSummary}
        onTokenUsageSettingsChange={changeTokenUsageSettings}
        usageImportError={usageImportError}
        lastUsageImportSummary={lastUsageImportSummary}
        onImportUsageCsv={importUsageCsv}
        aiConfig={aiConfig}
        setAiConfig={setAiConfig}
        retentionDays={retentionDays}
        setRetentionDays={changeRetentionDays}
        proactiveAlert={proactiveAlert}
        onDismissProactiveAlert={dismissProactiveAlert}
        proactiveAlertSettings={proactiveAlertSettings}
        onProactiveAlertSettingsChange={changeProactiveAlertSettings}
        classificationStatus={classificationStatus}
        classificationError={classificationError}
        visualContextStatus={visualContextStatus}
        visualContextError={visualContextError}
        onClassifySessions={classifyActiveWindowSessions}
        corrections={corrections}
        onResetLocalData={resetLocalData}
        onExportBackup={exportFullBackup}
        reviewSuggestions={reviewSuggestions}
        reviewCopilotStatus={reviewCopilotStatus}
        reviewCopilotError={reviewCopilotError}
        onGenerateReviewSuggestions={() => void generateReviewCopilotSuggestions()}
        onApplyReviewSuggestion={applyReviewSuggestion}
        onDismissReviewSuggestion={dismissReviewSuggestion}
        weekRangeLabel={currentWeekRangeLabel}
        nextWeekRangeLabel={nextWeekRangeLabel}
        generatedForecast={generatedForecast}
        forecastAccuracy={forecastAccuracy}
        forecastAccuracyTrend={forecastAccuracyTrend}
        forecastTrackRecord={forecastTrackRecord}
        forecastStatus={forecastStatus}
        forecastError={forecastError}
        onGenerateForecast={generateForecastAgent}
        narrative={narrative}
        generatedNarrative={generatedNarrative}
        hasNarrativeEvidence={hasNarrativeEvidence}
        narrativeGenerationStatus={narrativeGenerationStatus}
        narrativeGenerationError={narrativeGenerationError}
        managerSummaryText={managerSummaryText}
        onManagerSummaryChange={updateManagerSummary}
        onRegenerate={() => regenerateNarrative("manual")}
        auditEvents={auditEvents}
        todayKey={todayKey}
        currentWeekRangeLabel={currentWeekRangeLabel}
        onReplayWalkthrough={replayWalkthrough}
        defaultWindowMode={defaultWindowMode}
        onDefaultWindowModeChange={setDefaultWindowMode}
        pushToast={pushToast}
      />
      {showWelcome && <WelcomeOverlay onBegin={() => setWelcomeAcknowledged(true)} />}
      {showWalkthrough && (
        <WalkthroughOverlay
          onComplete={() => endWalkthrough("completed")}
          onSkip={() => endWalkthrough("skipped")}
        />
      )}
      {showGettingStarted && (
        <GettingStartedModal
          paused={paused}
          retentionDays={retentionDays}
          aiConfigured={Boolean(aiConfig?.apiKey?.trim())}
          envOpenAiKeyPresent={envOpenAiKeyPresent}
          onEnableTracking={() => setPaused(false)}
          onRetentionDaysChange={changeRetentionDays}
          onConnectOpenAiKey={connectOpenAiKeyFromWizard}
          onConnectViaCodex={connectViaCodexFromWizard}
          onOpenDemo={openDemoSimulation}
          onDismiss={() => finishGettingStarted(paused ? "skipped" : "enabled")}
        />
      )}
    </AppShell>
  );
}
