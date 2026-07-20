import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createCalendarImport,
  normalizeCalendarRange,
  mergeCalendarWorkBlocks,
  providerDescriptor,
  reconcileCalendarEvents,
  type CalendarProviderId,
  type CalendarRange,
  type CalendarRangeInput,
  type CalendarTransferMode,
} from "../../../packages/integrations/src/calendar/calendarSync";
import { importChatExport } from "../../../packages/integrations/src/chat/chatExport";
import { dedupeChatCallsAgainstCalendar } from "../../../packages/integrations/src/chat/callDedup";
import {
  chatReviewSignalsToWorkBlocks,
  mergeChatWorkBlocks,
  providerDescriptor as chatProviderDescriptor,
  reconcileChatEvidence,
  reconcileChatEvents,
  transformChatEvidence,
  type ChatEvidenceEventV1,
  type ChatProviderId,
} from "../../../packages/integrations/src/chat/chatSync";
import { parseUsageCsv } from "../../../packages/integrations/src/usage/usageCsv";
import { mergeTokenUsageDays } from "../../../packages/inference/src/aiUsage";
import type {
  AccelerationPlay,
  AccelerationSignal,
  ActiveWindowSample,
  ActivitySession,
  AuditEvent,
  CalendarEvent,
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
  createCodexAIConfig,
  hasAIConnection,
  isCodexConnection,
} from "./services/aiConnection";
import type { ConsentReceiptV1 } from "./services/consentReceipt";
import {
  addDays,
  getLocalDateKey,
} from "./lib/date";
import { unionSpanMs } from "./lib/meetingLoad";
import { fieldLabel, formatDurationMinutes, formatIsoWeekLabel, humanizeCorrectionValue } from "./lib/format";
import {
  downloadTextFile,
  exportFilename,
  exportMimeType,
  prepareNativeFullBackup,
  serializeFullBackup,
  type FullBackup,
} from "./lib/dataExport";
import { createAccelerationPlayAuditEvent, createAuditEvent, createCalendarImportAuditEvent, createChatImportAuditEvent, createChatSyncAuditEvent, createUsageImportAuditEvent, createUsageSettingsAuditEvent, createWeeklyReviewAuditEvent } from "./lib/audit";
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
import { useCloudAccount } from "./hooks/useCloudAccount";
import { useCloudSync, type CloudController } from "./hooks/useCloudSync";
import { useCalendarSources } from "./hooks/useCalendarSources";
import {
  chatSyncApplicationMode,
  chatSyncOperationalState,
  useChatSources,
  type ChatSourceSyncResult,
} from "./hooks/useChatSources";
import { usePersonalCloudSync } from "./hooks/usePersonalCloudSync";
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
import type { Screen, SettingsTab, WindowMode } from "./lib/types";
import { ManagerAccessWorkspace } from "./admin/ManagerAccessWorkspace";
import { createSimulationDemoState } from "./admin/simulationDemoData";
import {
  getManagerModeMemberships,
  getWeekformWebAppUrl,
  resolveSettingsTab,
} from "./services/adminPortal";
import { deriveWeeklyReviewState } from "./services/weeklyReview";
import { resolveGettingStartedExit } from "./services/gettingStartedFlow";
import {
  clearAgentSessionStorage,
  readAgentSessionStorage,
} from "./services/agentSessionStorage";
import {
  getInitialWindowMode,
  isTauriWindow,
  isWebPopup,
  openCompactWebWindow,
  positionCompactWebPopup,
  positionLargeWebPopup,
  restoreWebHost,
  syncWebPopupMode,
} from "./services/webWindowMode";

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

export function App() {
  const [isTauriRuntime] = useState(() => isTauriWindow());
  const [isDemoMode] = useState(() => new URLSearchParams(window.location.search).get("demo") === "1");
  const [simulationPersonaId] = useState(() => {
    const search = new URLSearchParams(window.location.search);
    return search.get("simulator") === "1" ? search.get("simulationPersona") : null;
  });
  const isSimulationMode = isDemoMode && Boolean(simulationPersonaId);
  const [persistedSnapshot, setPersistedSnapshot] = useState<PersistedAppState | null>(() => {
    if (!isDemoMode) return null;
    return simulationPersonaId ? createSimulationDemoState(simulationPersonaId) : createDemoState();
  });
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
    readPersistedState().then(async (data) => {
      // One-time compatibility migration: older builds kept raw samples in the
      // general Tauri Store. Move them into the encrypted native journal before
      // allowing the next persistence write to clear that legacy duplicate.
      if (isTauriRuntime && data?.activeWindowSamples?.length) {
        await invoke("import_capture_journal_samples", {
          samples: data.activeWindowSamples.flatMap((sample) => {
            const timestampMs = new Date(sample.timestamp).getTime();
            if (!Number.isFinite(timestampMs)) return [];
            return [{
              sample_id: sample.sample_id,
              timestamp_ms: timestampMs,
              app_name: sample.app_name,
              window_title: sample.window_title,
              capture_error: null,
            }];
          }),
        });
      }
      // The read/migration resolved, so it's now safe to persist regardless of
      // whether data was found.
      persistenceHydrated.current = true;
      if (data) {
        setPersistedSnapshot(data);
        // Hydrate chrome + other states
        setActive((current) => {
          const requested = new URLSearchParams(window.location.search).get("screen") as Screen | null;
          if ((isDemoMode || !isTauriRuntime) && requested && requested in screenLabels) return requested;
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
        setChatEvidence(data.chatEvidence ?? []);
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
        setConsentReceipts(data.consentReceipts ?? []);
      }
      if (isTauriRuntime) {
        const sessionCutoffMs = Date.now();
        const sessionSinceMs = sessionCutoffMs - 8 * 24 * 60 * 60 * 1000;
        void invoke<Array<{
          sample_id: string;
          timestamp_ms: number;
          app_name: string | null;
          window_title: string | null;
          capture_error: string | null;
        }>>("read_capture_journal", { limit: 2000 }).then((journal) => {
          const recovered: ActiveWindowSample[] = journal.flatMap((entry) => {
            if (entry.capture_error || !entry.app_name || !Number.isFinite(entry.timestamp_ms)) return [];
            return [{
              sample_id: entry.sample_id,
              timestamp: new Date(entry.timestamp_ms).toISOString(),
              app_name: entry.app_name,
              window_title: entry.window_title,
              source_type: "macos_active_window",
              privacy_level: "local_only",
            }];
          });
          setActiveWindowSamples((current) => {
            const byId = new Map([...current, ...recovered].map((sample) => [sample.sample_id, sample]));
            return [...byId.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp)).slice(-2000);
          });
        }).catch((error) => {
          setCaptureError(error instanceof Error ? error.message : "The encrypted capture journal could not be read.");
        });
        void invoke<ActivitySession[]>("read_capture_journal_sessions", {
          sinceMs: sessionSinceMs,
          untilMs: sessionCutoffMs,
          maxSessions: 10_000,
        }).then((sessions) => {
          setJournalSessionWindow({ cutoffMs: sessionCutoffMs, sessions });
        }).catch((error) => {
          setCaptureError(
            error instanceof Error
              ? error.message
              : "The recent encrypted activity window could not be reconstructed.",
          );
        });
      }

      // Every launch: bring the main window forward maximized in the full
      // layout (first launch lands in welcome → walkthrough → setup; returning
      // users land on their dashboard). The menu-bar icon stays available
      // either way; closing the window returns the app to tray-only.
      void invoke("present_main_window").catch(() => undefined);
    }).catch((error) => {
      // Never reinterpret a read, Keychain, or legacy-journal migration failure
      // as an empty first launch: that would let a later save overwrite data we
      // failed to hydrate. Keep persistence gated and make recovery visible.
      const detail = error instanceof Error ? error.message : String(error);
      setCaptureError(`Saved Weekform data could not be loaded: ${detail}`);
      void invoke("present_main_window").catch(() => undefined);
    });
  }, [isDemoMode, isTauriRuntime]);

  const initialBlocks = removeSeededWorkBlocks(persistedSnapshot?.blocks ?? []);
  const [active, setActive] = useState<Screen>(() => {
    const requested = new URLSearchParams(window.location.search).get("screen") as Screen | null;
    return (isDemoMode || !isTauriRuntime) && requested && requested in screenLabels
      ? requested
      : initialBlocks.some((block) => !block.user_verified) ? "daily" : "weekly";
  });
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>(() => (
    resolveSettingsTab(new URLSearchParams(window.location.search).get("settings"))
      ?? "data-sources"
  ));
  const [managerModeOpen, setManagerModeOpen] = useState(false);
  const [paused, setPaused] = useState(() => persistedSnapshot?.paused ?? true);
  // Tracks the last `paused` value we've already emitted an audit event for, so
  // the audit effect below records only real user-driven transitions — never the
  // mount value or the value hydration/reset installs. Seeded at mount to the
  // initial `paused` and re-seeded wherever `paused` changes without a user toggle.
  const lastAuditedPausedRef = useRef(paused);
  const [activeWindowSamples, setActiveWindowSamples] = useState<ActiveWindowSample[]>(
    () => persistedSnapshot?.activeWindowSamples ?? []
  );
  const [journalSessionWindow, setJournalSessionWindow] = useState<{
    cutoffMs: number;
    sessions: ActivitySession[];
  } | null>(null);
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
  const [chatEvidence, setChatEvidence] = useState<ChatEvidenceEventV1[]>(
    () => persistedSnapshot?.chatEvidence ?? []
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
  // First-run setup wizard lifecycle: unseen → the wizard opens with its branded
  // introduction; skipped → the persistent enable-tracking reminder stays until
  // tracking turns on; complete → setup is done.
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
  // One durable consent receipt per approved cloud share — written by useCloudSync
  // from the exact uploaded payload, retained like the audit trail (capped, persisted).
  const [consentReceipts, setConsentReceipts] = useState<ConsentReceiptV1[]>(
    () => persistedSnapshot?.consentReceipts ?? []
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
    getInitialWindowMode({ search: window.location.search, isTauriRuntime })
  );
  const [resetConfirmationRequestId, setResetConfirmationRequestId] = useState(0);
  const [agentResetGeneration, setAgentResetGeneration] = useState(0);
  const [isResettingLocalData, setIsResettingLocalData] = useState(false);
  const resetInProgressRef = useRef(false);

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

  const { blocks, setBlocks, mutateBlocksAtomically, calendarEvents, setCalendarEvents, corrections, setCorrections, reviewSuggestions, setReviewSuggestions, updateBlock, confirmBlock, excludeBlock, addCorrection } = ledger;
  const calendarEventsRef = useRef(calendarEvents);
  calendarEventsRef.current = calendarEvents;
  const chatEventsRef = useRef(chatEvents);
  chatEventsRef.current = chatEvents;
  const chatEvidenceRef = useRef(chatEvidence);
  chatEvidenceRef.current = chatEvidence;

  const applyCalendarSourceEvents = useCallback((
    provider: CalendarProviderId,
    range: CalendarRange,
    mode: CalendarTransferMode,
    incoming: CalendarEvent[],
    fileName?: string,
  ) => {
    const currentCalendarEvents = calendarEventsRef.current;
    const previousEventCount = currentCalendarEvents.length;
    const result = reconcileCalendarEvents(currentCalendarEvents, incoming, { provider, range, mode });
    calendarEventsRef.current = result.events;
    setCalendarEvents(result.events);
    setBlocks((current) => {
      const nonCalendarBlocks = current.filter((block) => !block.work_block_id.startsWith("calendar-"));
      const calendarBlocks = mergeCalendarWorkBlocks(current, result.events, currentWeekId);
      const importedBlocks = nonCalendarBlocks.filter((block) => block.work_block_id.startsWith("imported-"));
      const otherBlocks = nonCalendarBlocks.filter((block) => !block.work_block_id.startsWith("imported-"));
      const { kept } = dedupeChatCallsAgainstCalendar(importedBlocks, calendarBlocks);
      return [...otherBlocks, ...kept, ...calendarBlocks].sort(
        (left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime(),
      );
    });
    const deltaParts = [
      result.delta.added > 0 ? `+${result.delta.added} new` : null,
      result.delta.updated > 0 ? `${result.delta.updated} updated` : null,
      result.delta.removed > 0 ? `${result.delta.removed} removed` : null,
      result.delta.unchanged > 0 ? `${result.delta.unchanged} unchanged` : null,
    ].filter((part): part is string => Boolean(part));
    setLastCalendarImportSummary(
      `${providerDescriptor(provider).label}: ${deltaParts.length > 0 ? deltaParts.join(" · ") : "No events in range"}`,
    );
    setAuditEvents((current) => [
      ...current,
      createCalendarImportAuditEvent({
        provider,
        mode,
        range,
        fileName,
        importedEventIds: incoming.map((event) => event.calendar_event_id),
        addedCount: result.delta.added,
        updatedCount: result.delta.updated,
        unchangedCount: result.delta.unchanged,
        removedCount: result.delta.removed,
        previousEventCount,
      }),
    ].slice(-1000));
  }, [currentWeekId, setBlocks, setCalendarEvents]);

  const calendarSources = useCalendarSources({
    enabled: isTauriRuntime && !isDemoMode,
    onEvents: applyCalendarSourceEvents,
    onDisconnected: (provider) => {
      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "calendar_import",
          source: `${provider}_live_sync`,
          title: `${providerDescriptor(provider).label} disconnected`,
          summary: "Automatic calendar reads stopped. Previously imported local evidence was kept.",
          privacy_level: "local_only",
          details: { provider, credentials_removed: true, stored_events_kept: true },
        }),
      ].slice(-1000));
    },
    onConnectionEvent: (provider, action, success) => {
      setAuditEvents((current) => [
        ...current,
        createAuditEvent({
          type: "calendar_import",
          source: `${provider}_live_sync`,
          title: `${providerDescriptor(provider).label} ${action} ${success ? "completed" : "failed"}`,
          summary: success
            ? "The optional live calendar connection was stored in macOS Keychain."
            : `No calendar evidence changed because ${action} did not complete.`,
          privacy_level: "local_only",
          details: { provider, action, success, credentials_in_keychain: success && action === "connect" },
        }),
      ].slice(-1000));
    },
  });

  const applyChatSourceResult = useCallback((result: ChatSourceSyncResult) => {
    const applicationMode = chatSyncApplicationMode(result.receipt);
    const operationalState = chatSyncOperationalState(result.receipt);
    const evidenceMode = result.receipt.authoritative ? "live_sync" : "file_import";
    const reconciledEvidence = reconcileChatEvidence(
      chatEvidenceRef.current,
      result.events,
      {
        provider: result.provider,
        range: result.range,
        mode: evidenceMode,
      },
    );
    chatEvidenceRef.current = reconciledEvidence;
    setChatEvidence(reconciledEvidence);

    // Cursor pages are persisted as canonical content-free evidence, but they
    // do not enter the workload model independently. Only an intact run that
    // began at page one is transformed, preventing page boundaries from
    // splitting one response episode or inventing an unanswered review card.
    // Scope-limited Slack runs apply additively; only authoritative providers
    // can replace missing evidence inside the selected range.
    if (!applicationMode) {
      const transferSucceeded = operationalState === "in_progress";
      setAuditEvents((current) => [
        ...current,
        createChatSyncAuditEvent({
          provider: result.provider,
          action: "sync",
          success: transferSucceeded,
          range: result.range,
          coverage: result.receipt.coverage,
          fetchedCount: result.receipt.fetched_count ?? undefined,
          normalizedCount: result.receipt.normalized_count,
          droppedCount: result.receipt.dropped_count ?? undefined,
          observedEpisodeCount: 0,
          directedReviewCount: 0,
          workloadApplied: false,
          authoritative: false,
          hasMore: result.receipt.has_more,
        }),
      ].slice(-1000));
      pushToast({
        tone: transferSucceeded ? "info" : "error",
        message: transferSucceeded
          ? `${chatProviderDescriptor(result.provider).label}: ${result.receipt.normalized_count} content-free signal${result.receipt.normalized_count === 1 ? "" : "s"} retained · continue sync to finish coverage`
          : `${chatProviderDescriptor(result.provider).label}: transfer incomplete · ${result.receipt.detail}`,
      });
      return { observedEpisodeCount: 0, directedReviewCount: 0, workloadApplied: false };
    }

    const rangeStart = new Date(result.range.start).getTime();
    const rangeEnd = new Date(result.range.end_exclusive).getTime();
    const completeRangeEvidence = reconciledEvidence.filter((event) => {
      const timestamp = new Date(event.timestamp).getTime();
      return event.provider === result.provider && timestamp >= rangeStart && timestamp < rangeEnd;
    });
    const transformed = transformChatEvidence(completeRangeEvidence);
    const reviewBlocks = chatReviewSignalsToWorkBlocks(transformed.review_signals);
    const incomingBlocks = [...transformed.work_blocks, ...reviewBlocks];
    const excludedBlockIds = new Set(
      corrections
        .filter((correction) => correction.field === "exclude")
        .map((correction) => correction.work_block_id),
    );

    const reconciled = reconcileChatEvents(chatEventsRef.current, transformed.events, {
      provider: result.provider,
      range: result.range,
      mode: applicationMode,
    });
    chatEventsRef.current = reconciled.events;
    setChatEvents(reconciled.events);

    setBlocks((current) => {
      const merged = mergeChatWorkBlocks(current, incomingBlocks, {
        provider: result.provider,
        range: result.range,
        mode: applicationMode,
        excludedBlockIds,
      });
      const calendarBlocks = merged.filter((block) => block.work_block_id.startsWith("calendar-"));
      const chatCalls = merged.filter(
        (block) =>
          block.category === "Meetings / stakeholder syncs" &&
          block.derived_from.some((sourceId) => sourceId.startsWith("chat-")),
      );
      const chatCallIds = new Set(chatCalls.map((block) => block.work_block_id));
      const withoutChatCalls = merged.filter((block) => !chatCallIds.has(block.work_block_id));
      const { kept } = dedupeChatCallsAgainstCalendar(chatCalls, calendarBlocks);
      return [...withoutChatCalls, ...kept].sort(
        (left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime(),
      );
    });

    const observedEpisodeCount = transformed.work_blocks.length;
    const directedReviewCount = transformed.review_signals.length;
    setAuditEvents((current) => [
      ...current,
      createChatSyncAuditEvent({
        provider: result.provider,
        action: "sync",
        success: true,
        range: result.range,
        coverage: result.receipt.coverage,
        fetchedCount: result.receipt.fetched_count ?? undefined,
        normalizedCount: result.receipt.normalized_count,
        droppedCount: result.receipt.dropped_count ?? undefined,
        observedEpisodeCount,
        directedReviewCount,
        workloadApplied: true,
        authoritative: result.receipt.authoritative,
        hasMore: false,
      }),
    ].slice(-1000));
    pushToast({
      tone: "success",
      message: `${chatProviderDescriptor(result.provider).label}: ${observedEpisodeCount} observed episode${observedEpisodeCount === 1 ? "" : "s"} · ${directedReviewCount} directed signal${directedReviewCount === 1 ? "" : "s"} held at 0% for review${result.receipt.authoritative ? "" : " · applied additively"}`,
    });
    return { observedEpisodeCount, directedReviewCount, workloadApplied: true };
  }, [corrections, pushToast, setBlocks]);

  const chatSources = useChatSources({
    enabled: isTauriRuntime && !isDemoMode,
    onSyncResult: applyChatSourceResult,
    onConnectionEvent: (provider, action, success) => {
      // Every sync outcome carries its richer receipt in applyChatSourceResult.
      if (action === "sync") return;
      setAuditEvents((current) => [
        ...current,
        createChatSyncAuditEvent({ provider, action, success }),
      ].slice(-1000));
    },
  });

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

  const appPersistence = usePersistence({
    blocks,
    calendarEvents,
    chatEvents,
    chatEvidence,
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
    consentReceipts,
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
    setCaptureError,
  });

  const derived = useDerived({
    blocks,
    chatEvents,
    activeWindowSamples,
    journalSessionWindow,
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

  // Account & Sharing (Weekform Web). Renders "not configured" when the build has
  // no Supabase env; the demo path always starts signed out with sharing disabled.
  // Only the shared allowlist builder's payload can leave the device (useCloudSync).
  const cloudAccount = useCloudAccount({
    isDemoMode,
    onAuditEvent: (event) => {
      if (isDemoMode) return;
      setAuditEvents((current) => [...current, event].slice(-1000));
    },
  });
  const cloudSync = useCloudSync({
    account: cloudAccount,
    snapshot,
    workBlocks: blocks,
    // A receipt exists iff an approved payload actually left the device. Capped
    // like the audit trail; the demo never uploads, so it never writes receipts.
    onConsentReceipt: (receipt) => {
      if (isDemoMode) return;
      setConsentReceipts((current) => [...current, receipt].slice(-1000));
    },
  });
  const personalCloud = usePersonalCloudSync({
    account: cloudAccount,
    snapshot,
    workBlocks: blocks,
    mutateBlocksAtomically,
    addCorrection,
    persistLatestLocalState: appPersistence.flushLatest,
  });
  const cloud: CloudController = useMemo(
    () => ({ account: cloudAccount, sync: cloudSync, personal: personalCloud }),
    [cloudAccount, cloudSync, personalCloud]
  );
  const managerMemberships = useMemo(
    () => getManagerModeMemberships(cloudAccount.teams),
    [cloudAccount.teams],
  );
  const managerAccessAvailable = cloudAccount.account !== null && managerMemberships.length > 0;

  useEffect(() => {
    if (!managerAccessAvailable) setManagerModeOpen(false);
  }, [managerAccessAvailable]);

  // The ritual closes the current week. `forecastTrackRecord` deliberately
  // excludes the accumulating current week, so project its existing live
  // forecast-vs-actual review into the same primitive shape for this checklist.
  const weeklyReviewForecastTrackRecord = useMemo(
    () => forecastAccuracy
      ? [{
          week_id: currentWeekId,
          predicted_pct: forecastAccuracy.predicted_pct,
          actual_pct: forecastAccuracy.actual_pct,
          error_pts: forecastAccuracy.error_pts,
          signed_error_pts: forecastAccuracy.signed_error_pts,
          rating: forecastAccuracy.rating
        }, ...forecastTrackRecord]
      : forecastTrackRecord,
    [forecastAccuracy, forecastTrackRecord, currentWeekId]
  );
  const closingWeekId = currentWeekId;
  const weeklyReviewState = useMemo(
    () => deriveWeeklyReviewState({
      weekId: closingWeekId,
      blocks,
      visualContextInsights,
      forecastTrackRecord: weeklyReviewForecastTrackRecord,
      generatedNarrative,
      cloudSharing: {
        enabled: cloud.account.policy.enabled,
        teamId: cloud.account.policy.teamId
      },
      auditEvents,
      consentReceipts
    }),
    [
      closingWeekId,
      blocks,
      visualContextInsights,
      weeklyReviewForecastTrackRecord,
      generatedNarrative,
      cloud.account.policy.enabled,
      cloud.account.policy.teamId,
      auditEvents,
      consentReceipts
    ]
  );
  const weeklyReviewCompletionRecorded = useMemo(
    () => auditEvents.some((event) =>
      event.type === "weekly_review" &&
      typeof event.details.week_id === "string" &&
      normalizeWeekId(event.details.week_id) === normalizeWeekId(weeklyReviewState.weekId)
    ),
    [auditEvents, weeklyReviewState.weekId]
  );

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

  // Native retention compacts the encrypted journal at most once per local day
  // (and immediately after the policy changes). Sample arrival every five seconds
  // must not trigger a full-history read/rewrite. Failures remain visible because
  // retention is a consequential privacy control, not background housekeeping.
  useEffect(() => {
    if (isDemoMode || !isTauriRuntime || retentionDays === null) return;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    void invoke("prune_capture_journal", { cutoffMs: Math.max(0, Math.floor(cutoff)) })
      .then(() => {
        setCaptureError((current) => (
          current?.startsWith("Could not apply the capture retention policy") ? null : current
        ));
      })
      .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        const message = `Could not apply the capture retention policy: ${detail}`;
        setCaptureError(message);
        pushToast({ tone: "error", message });
      });
  }, [isDemoMode, isTauriRuntime, retentionDays, todayKey, pushToast]);

  // Retention policy: auto-expire raw activity older than the user-chosen window
  // (null = keep everything). This covers both the raw active-window samples and the
  // retained chat `RawEvent` store (each grows one-row-per-event, so both must be
  // pruned or the chat history would accumulate forever). The transient native
  // session rollup is filtered to the same boundary; durable reviewed work blocks
  // remain untouched. The effect
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
    setJournalSessionWindow((current) => {
      if (!current) return current;
      const sessions = current.sessions.filter(
        (session) => new Date(session.end_time).getTime() >= cutoff,
      );
      return sessions.length === current.sessions.length ? current : { ...current, sessions };
    });
    setChatEvents((current) => {
      const kept = current.filter((event) => new Date(event.timestamp_end).getTime() >= cutoff);
      return kept.length === current.length ? current : kept;
    });
    setChatEvidence((current) => {
      const kept = current.filter((event) => new Date(event.timestamp).getTime() >= cutoff);
      return kept.length === current.length ? current : kept;
    });
  }, [isDemoMode, retentionDays, activeWindowSamples, chatEvents, chatEvidence]);

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
      blocks,
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
      setActiveSettingsTab("data-control");
      setActive("setup");
      setWindowMode("large");
      setResetConfirmationRequestId((current) => current + 1);
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
    if (isTauriRuntime) {
      void invoke("set_clear_capacity_window_mode", { mode: windowMode }).catch(() => undefined);
      return;
    }
    if (isWebPopup()) {
      syncWebPopupMode(windowMode);
      if (windowMode === "compact") {
        positionCompactWebPopup();
      } else {
        positionLargeWebPopup();
      }
    }
  }, [isTauriRuntime, windowMode]);

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
    setTourRequested(false);
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

  // The guided tour is optional and explicitly requested from Settings.
  const [tourRequested, setTourRequested] = useState(false);

  // Let the user replay the guided tour from Settings. Resets the persisted
  // flag so the outcome re-audits.
  function replayWalkthrough() {
    setWalkthroughCompleted(false);
    setTourRequested(true);
  }

  // The setup wizard always hands off to Settings. Tracking state determines
  // whether setup is complete or leaves the persistent resume reminder. The
  // tracking toggle itself is audited separately; this records the onboarding
  // decision only.
  function finishGettingStarted() {
    if (gettingStartedStatus !== "unseen") return;
    const exit = resolveGettingStartedExit(paused);
    setGettingStartedStatus(exit.status);
    setActive(exit.screen);
    if (isDemoMode) return;
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: "onboarding",
        source: "onboarding",
        title:
          exit.auditOutcome === "enabled"
            ? "Getting-started setup completed"
            : "Getting-started setup deferred",
        summary:
          exit.auditOutcome === "enabled"
            ? "The first-run setup was completed with activity tracking enabled, then Settings was opened."
            : "The first-run setup was deferred without activity tracking, then Settings was opened.",
        privacy_level: "local_only",
        details: {
          outcome: exit.auditOutcome,
          destination: exit.screen,
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

  // Codex app-server owns the browser sign-in and refresh lifecycle. Weekform
  // stores only the selected model/mode; it never receives or copies OAuth tokens.
  async function connectViaCodexPlanFromWizard(): Promise<string> {
    if (!("__TAURI_INTERNALS__" in window)) {
      throw new Error("Using a ChatGPT/Codex plan needs the desktop app — paste an API key instead.");
    }
    const result = await invoke<{ model: string; planType: string; message: string }>(
      "connect_codex_via_chatgpt"
    );
    setAiConfig(createCodexAIConfig(result.model));
    return result.message;
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
  // action (background expiry of raw activity and Chat evidence stays unlogged).
  function changeRetentionDays(value: number | null) {
    setRetentionDays(value);
    if (isDemoMode) return;
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: "retention_policy",
        source: "privacy_control",
        title: "Raw evidence retention updated",
        summary: value === null
          ? "Automatic raw-evidence expiry disabled — active-window and Chat evidence are kept until reset"
          : `Active-window samples and canonical/derived Chat event evidence now auto-expire after ${value} days`,
        privacy_level: "local_only",
        details: {
          retention_days: value,
          active_window_samples_follow_policy: true,
          canonical_chat_evidence_follows_policy: true,
          derived_chat_events_follow_policy: true,
          derived_work_blocks_are_retained: true,
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
  // reset destroys into one portable local JSON record before the irreversible wipe —
  // the earlier version only exported the ledger + audit, silently
  // omitting the corrections, forecasts, narratives, imports, and skills the confirm
  // dialog itself lists. Downloads always (harmless in demo); audits only for real data
  // (mirrors the retention/visual-context privacy handlers' demo guard).
  async function exportFullBackup() {
    let agentSession;
    try {
      agentSession = readAgentSessionStorage();
    } catch {
      pushToast({
        tone: "error",
        message: "Backup could not read the local Agent conversation. No incomplete backup was created.",
      });
      return;
    }
    const backup: FullBackup = {
      blocks,
      calendarEvents,
      chatEvents,
      chatEvidence,
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
      consentReceipts,
      // Field-by-field projection: sharing policy + sync bookkeeping, never tokens.
      cloudSharing: cloudAccount.backupMetadata(),
      agentSession,
    };
    const fileName = exportFilename("full-backup", "json");
    let exportedActivitySampleCount = activeWindowSamples.length;
    if (isTauriRuntime) {
      pushToast({ tone: "info", message: "Preparing your complete local backup…" });
      try {
        const result = await invoke<{
          file_name: string;
          journal_record_count: number;
        }>("export_full_backup_with_journal", {
          backup: prepareNativeFullBackup(backup),
          fileName,
        });
        exportedActivitySampleCount = result.journal_record_count;
        pushToast({
          tone: "success",
          message: `Backup saved to Downloads as ${result.file_name}. It contains plaintext activity evidence; store it securely.`,
        });
      } catch (error) {
        pushToast({
          tone: "error",
          message: error instanceof Error
            ? `Backup could not be completed: ${error.message}`
            : "Backup could not be completed. No partial export was kept.",
        });
        return;
      }
    } else {
      downloadTextFile(
        fileName,
        serializeFullBackup(backup),
        exportMimeType("json")
      );
    }
    if (isDemoMode) return;
    setAuditEvents((current) => [
      ...current,
      createAuditEvent({
        type: "data_export",
        source: "privacy_control",
        title: "Full data backup exported",
        summary: `Saved a local JSON backup of ${backup.blocks.length} work ${
          backup.blocks.length === 1 ? "block" : "blocks"
        }, the audit trail, imports, every AI output, and the saved Agent conversation.`,
        privacy_level: "local_only",
        details: {
          stored_locally: true,
          sent_to_cloud: false,
          work_blocks: backup.blocks.length,
          activity_samples: exportedActivitySampleCount,
          calendar_events: backup.calendarEvents.length,
          chat_events: backup.chatEvents.length,
          chat_evidence_events: backup.chatEvidence?.length ?? 0,
          corrections: backup.corrections.length,
          audit_events: backup.auditEvents.length,
          consent_receipts: backup.consentReceipts.length,
          saved_skills: backup.savedSkills.length,
          visual_context_insights: backup.visualContextInsights.length,
          agent_messages: backup.agentSession.messages.length,
          agent_draft_included: backup.agentSession.draft.length > 0,
        }
      })
    ].slice(-1000));
  }

  async function resetLocalData() {
    if (isDemoMode) {
      window.location.reload();
      return;
    }
    if (resetInProgressRef.current) return;
    resetInProgressRef.current = true;
    setIsResettingLocalData(true);
    setAgentResetGeneration((current) => current + 1);
    const agentSessionStorageCleared = clearAgentSessionStorage();
    // Invalidate every AI operation before the first asynchronous deletion.
    // Provider calls that cannot be cancelled may finish, but their epoch can no
    // longer commit output into freshly reset state.
    resetNarrative();
    resetClassification();
    resetReviewCopilot();
    resetForecast();
    resetAcceleration();
    resetVisualContext();
    try {
      // Stop the native writer before touching its journal. The Rust journal lock
      // protects individual operations; this pause prevents a fresh post-clear
      // sample from recreating data while the rest of Reset is still running.
      setPaused(true);
      lastAuditedPausedRef.current = true;
    const capturePaused = !isTauriRuntime || await invoke("set_activity_capture_paused", { paused: true })
      .then(() => true)
      .catch(() => false);
    const persistedStateCleared = await clearPersistedState()
      .then(() => true)
      .catch(() => false);
    // Cloud session, sharing policy, sync bookkeeping, and the reserved snapshot id
    // are wiped too — first quiesce every personal sync edge so no late receipt,
    // queue write, or refreshed session can recreate state after deletion.
    const personalSyncQuiesced = await personalCloud.quiesceForReset()
      .then(() => true)
      .catch(() => false);
    const cloudCredentialsCleared = await cloudAccount.clearAll().catch(() => false);
    const captureJournalCleared = !isTauriRuntime || (capturePaused && await invoke("clear_capture_journal")
      .then(() => true)
      .catch(() => false));
    const calendarCredentialsCleared = !isTauriRuntime || (await Promise.all(
      (["outlook", "google", "apple"] as CalendarProviderId[]).map((provider) => (
        invoke("disconnect_calendar_source", { provider }).then(() => true).catch(() => false)
      )),
    )).every(Boolean);
    const codexCredentialsCleared =
      !isTauriRuntime ||
      !isCodexConnection(aiConfig) ||
      await invoke("disconnect_codex").then(() => true).catch(() => false);
    const chatCredentialsCleared = !isTauriRuntime || await invoke("clear_chat_source_storage")
      .then(() => true)
      .catch(() => false);
    const aiCredentialsCleared = persistedStateCleared && codexCredentialsCleared;
    const allDurableDataCleared =
      persistedStateCleared &&
      capturePaused &&
      personalSyncQuiesced &&
      cloudCredentialsCleared &&
      captureJournalCleared &&
      calendarCredentialsCleared &&
      aiCredentialsCleared &&
      chatCredentialsCleared &&
      agentSessionStorageCleared;
    setBlocks([]);
    setCalendarEvents([]);
    setActiveWindowSamples([]);
    setJournalSessionWindow(null);
    // The reset wipes every stored event, but leaves one record of the reset
    // itself and its privacy effects — a user-visible action must stay auditable.
    setAuditEvents([
      createAuditEvent({
        type: "data_reset",
        source: "privacy_control",
        title: "Prototype data reset",
        summary: allDurableDataCleared
          ? "All local activity, the encrypted capture journal, imports, calendar and chat connections, AI outputs, and saved skills were cleared, along with your saved AI provider credentials and Weekform Web session, replica queue, and sharing policies. Screenshot capture was turned off and tracking paused."
          : "The in-memory workspace was reset, but durable removal of Store data, Agent browser storage, a Keychain credential, a connection, or the encrypted capture journal could not be confirmed. Retry Reset Local Data before closing the app.",
        privacy_level: "local_only",
        details: {
          visual_context_enabled: false,
          tracking_paused: true,
          retention_days: null,
          persisted_state_cleared: persistedStateCleared,
          persisted_state_clear_requires_retry: !persistedStateCleared,
          provider_api_key_cleared: persistedStateCleared,
          ai_credentials_cleared: aiCredentialsCleared,
          codex_credentials_cleared: codexCredentialsCleared,
          codex_clear_requires_retry: !codexCredentialsCleared,
          capture_paused_before_reset: capturePaused,
          capture_pause_requires_retry: !capturePaused,
          cloud_session_cleared: cloudCredentialsCleared,
          cloud_sharing_policy_cleared: cloudCredentialsCleared,
          cloud_clear_requires_retry: !cloudCredentialsCleared,
          personal_sync_quiesced_before_clear: personalSyncQuiesced,
          personal_sync_quiesce_requires_retry: !personalSyncQuiesced,
          encrypted_capture_journal_cleared: captureJournalCleared,
          capture_journal_clear_requires_retry: !captureJournalCleared,
          calendar_credentials_cleared: calendarCredentialsCleared,
          calendar_clear_requires_retry: !calendarCredentialsCleared,
          chat_credentials_cursors_and_hash_salt_cleared: chatCredentialsCleared,
          chat_clear_requires_retry: !chatCredentialsCleared,
          agent_session_storage_cleared: agentSessionStorageCleared,
          agent_session_storage_clear_requires_retry: !agentSessionStorageCleared,
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
    setChatEvidence([]);
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
    setConsentReceipts([]);
    setUsageImportError(null);
    setLastUsageImportSummary(null);
    setImportError(null);
    setLastCalendarImportSummary(null);
    setChatImportError(null);
    if (allDurableDataCleared) {
      setCaptureError(null);
      pushToast({ tone: "success", message: "Local data reset and durable deletion verified." });
    } else {
      const message = "Reset finished in memory, but durable deletion could not be verified. Retry before closing Weekform.";
      setCaptureError(message);
      pushToast({ tone: "error", message });
    }
    // The single data_reset event above already records that tracking was paused,
    // so keep the ref in step and let the audit effect skip its own pause row —
    // preserving the "reset leaves exactly one audit event" invariant.
    lastAuditedPausedRef.current = true;
    } finally {
      resetInProgressRef.current = false;
      setIsResettingLocalData(false);
    }
  }

  function importCalendarFile(
    provider: CalendarProviderId,
    file: File,
    rangeInput: CalendarRangeInput,
  ) {
    setImportError(null);
    const reader = new FileReader();

    const failImport = (message: string) => {
      setImportError(message);
      pushToast({ tone: "error", message });
    };

    reader.onerror = () => {
      failImport(`Could not read that ${providerDescriptor(provider).label} export.`);
    };

    reader.onload = () => {
      try {
        const content = String(reader.result ?? "");
        const range = normalizeCalendarRange(rangeInput);
        const importedEvents = createCalendarImport(provider, content, range);

        if (importedEvents.length === 0) {
          failImport("No usable calendar events overlap the selected date range in that .ics file.");
          return;
        }
        applyCalendarSourceEvents(provider, range, "file_import", importedEvents, file.name);
        addCorrection({
          work_block_id: currentWeekId,
          field: "calendar_import",
          old_value: `${providerDescriptor(provider).label} events`,
          new_value: `${importedEvents.length} imported`,
          reason: `Imported ${file.name}`
        });
        const importedCount = importedEvents.length;
        pushToast({
          tone: "success",
          message: `${importedCount} ${providerDescriptor(provider).label} event${importedCount === 1 ? "" : "s"} imported`,
        });
      } catch (error) {
        failImport(error instanceof Error ? error.message : "The .ics file could not be parsed.");
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
        // The legacy normalized-file path is content-free and derives each
        // episode's ISO week from its own timestamp. Pinning to the currently
        // viewed week would silently misfile historical transfers.
        const result = importChatExport(content);

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
          const excludedBlockIds = new Set(
            corrections
              .filter((correction) => correction.field === "exclude")
              .map((correction) => correction.work_block_id)
          );
          setBlocks((current) => {
            // Imported blocks carry stable ids (`imported-<hash>`). Preserve
            // reviewed truth on refresh and never resurrect an explicit exclude.
            const merged = new Map(current.map((block) => [block.work_block_id, block]));
            kept.forEach((block) => {
              if (excludedBlockIds.has(block.work_block_id)) return;
              const prior = merged.get(block.work_block_id);
              merged.set(block.work_block_id, prior?.user_verified
                ? {
                    ...block,
                    category: prior.category,
                    mode: prior.mode,
                    planned_status: prior.planned_status,
                    project_name: prior.project_name,
                    stakeholder_group: prior.stakeholder_group,
                    confidence: prior.confidence,
                    user_verified: true,
                    blocker_flag: prior.blocker_flag,
                    notes: prior.notes,
                  }
                : block);
            });
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
    if (!isTauriRuntime && restoreWebHost(screen)) return;
    // Settings is the intentional escape hatch from first-run guidance. The
    // walkthrough otherwise owns the pointer plane, so dismiss it before the
    // requested screen opens instead of making Settings appear unresponsive.
    if (screen === "setup" && tourRequested) {
      endWalkthrough("skipped");
    }
    setActive(screen);
    changeWindowMode("large");
  }

  function changeWindowMode(nextMode: WindowMode) {
    // A normal browser tab cannot be resized or moved by page script. Open the
    // compact surface as a same-origin auxiliary window from this user gesture;
    // that window can then honor the screenshot-matched geometry. If popups are
    // blocked, keep the existing inline compact layout and report the limitation.
    if (!isTauriRuntime && nextMode === "large" && restoreWebHost()) return;
    if (!isTauriRuntime && nextMode === "compact" && !isWebPopup()) {
      if (openCompactWebWindow()) return;
      pushToast({
        tone: "info",
        message: "Your browser blocked the compact window — showing the compact layout here instead",
      });
    }
    setWindowMode(nextMode);
  }

  function completeWeeklyReview() {
    if (!weeklyReviewState.isComplete || weeklyReviewCompletionRecorded) return;
    setAuditEvents((current) => {
      const alreadyRecorded = current.some((event) =>
        event.type === "weekly_review" &&
        typeof event.details.week_id === "string" &&
        normalizeWeekId(event.details.week_id) === normalizeWeekId(weeklyReviewState.weekId)
      );
      if (alreadyRecorded) return current;
      return [
        ...current,
        createWeeklyReviewAuditEvent({
          weekId: normalizeWeekId(weeklyReviewState.weekId),
          itemIds: weeklyReviewState.items.map((item) => item.id),
          doneCount: weeklyReviewState.doneCount,
          pendingCount: weeklyReviewState.pendingCount
        })
      ].slice(-1000);
    });
    pushToast({ tone: "success", message: "Weekly review completed" });
  }

  // First-run guidance shown on the empty daily/weekly screens. Shares its step
  // definitions with the Settings checklist via `buildOnboardingSteps`.
  const onboardingSteps = useMemo(
    () =>
      buildOnboardingSteps({
        trackingActive: !paused && activeWindowSamples.length > 0,
        calendarImported: calendarEvents.length > 0,
        aiConfigured: hasAIConnection(aiConfig, envOpenAiKeyPresent),
        classified: blocks.length > 0,
      }),
    [paused, activeWindowSamples.length, calendarEvents.length, aiConfig, envOpenAiKeyPresent, blocks.length]
  );
  const showOnboarding = !isDemoMode && !onboardingDismissed && blocks.length === 0;
  // The guided tour spotlights the sidebar nav, so it only runs in the full
  // window (the compact menu-bar widget has no nav) and never in demo mode.
  // Whether AI-backed features can run: a saved Codex-plan connection, provider
  // key, or OPENAI_API_KEY environment fallback. AI-triggering controls disable
  // with shared guidance when this is false.
  const aiAvailable = hasAIConnection(aiConfig, envOpenAiKeyPresent);
  // Onboarding sequence: one wizard with the branded introduction first, then
  // Settings. The guided tour is replayable from Settings after that handoff.
  const showGettingStarted =
    !isDemoMode && windowMode === "large" && gettingStartedStatus === "unseen";
  // The tour renders only when explicitly requested and never under the wizard.
  const showWalkthrough =
    !isDemoMode && windowMode === "large" && tourRequested && !showGettingStarted;
  // Persistent nudge after "I'll do this later": stays until tracking is enabled
  // (the skipped→complete effect above then retires it for good).
  const showTrackingReminder =
    !isDemoMode && windowMode === "large" && gettingStartedStatus === "skipped" && paused;

  if (managerModeOpen && managerAccessAvailable) {
    return (
      <main
        className="admin-portal-shell"
        data-admin-density="comfortable"
        data-admin-motion="off"
        data-admin-theme={theme}
      >
        <ManagerAccessWorkspace
          managerTeams={managerMemberships}
          getFreshSession={cloudAccount.getFreshSession}
          onOpenIndividualWorkspace={() => setManagerModeOpen(false)}
          onOpenPreferences={() => {
            setManagerModeOpen(false);
            setActiveSettingsTab("account");
            setActive("setup");
          }}
          onSignOut={() => {
            setManagerModeOpen(false);
            void cloudAccount.signOut();
          }}
          webAppDashboardUrl={getWeekformWebAppUrl(
            "/manager-access",
            import.meta.env.VITE_WEEKFORM_WEB_URL,
          )}
        />
      </main>
    );
  }

  return (
    <AppShell
      active={active}
      setActive={openScreenFromQuickView}
      snapshot={snapshot}
      hasWorkBlocks={blocks.length > 0}
      reviewCount={reviewQueue.length}
      showFlaggedTab={visualContextEnabled || visualContextInsights.some((insight) => insight.sensitive_content_detected)}
      paused={paused}
      setPaused={setPaused}
      sidebarCollapsed={sidebarCollapsed}
      setSidebarCollapsed={setSidebarCollapsed}
      windowMode={windowMode}
      setWindowMode={changeWindowMode}
      theme={theme}
      setTheme={setTheme}
      weekRangeLabel={active === "weekly-review" ? formatIsoWeekLabel(closingWeekId) : currentWeekRangeLabel}
      demoMode={isDemoMode}
      simulationMode={isSimulationMode}
      showTrackingReminder={showTrackingReminder}
      toasts={toasts}
      onDismissToast={dismissToast}
      managerAccessAvailable={managerAccessAvailable}
      onOpenManagerAccess={() => setManagerModeOpen(true)}
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
        calendarSources={calendarSources}
        chatSources={chatSources}
        onImportCalendar={importCalendarFile}
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
        cloud={cloud}
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
        isResettingLocalData={isResettingLocalData}
        resetConfirmationRequestId={resetConfirmationRequestId}
        onResetConfirmationRequestHandled={() => setResetConfirmationRequestId(0)}
        onExportBackup={exportFullBackup}
        agentResetGeneration={agentResetGeneration}
        reviewSuggestions={reviewSuggestions}
        reviewCopilotStatus={reviewCopilotStatus}
        reviewCopilotError={reviewCopilotError}
        onGenerateReviewSuggestions={() => void generateReviewCopilotSuggestions()}
        onApplyReviewSuggestion={applyReviewSuggestion}
        onDismissReviewSuggestion={dismissReviewSuggestion}
        weekRangeLabel={currentWeekRangeLabel}
        nextWeekRangeLabel={nextWeekRangeLabel}
        weeklyReviewState={weeklyReviewState}
        weeklyReviewCompletionRecorded={weeklyReviewCompletionRecorded}
        onCompleteWeeklyReview={completeWeeklyReview}
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
        consentReceipts={consentReceipts}
        todayKey={todayKey}
        currentWeekRangeLabel={currentWeekRangeLabel}
        onReplayWalkthrough={replayWalkthrough}
        defaultWindowMode={defaultWindowMode}
        onDefaultWindowModeChange={setDefaultWindowMode}
        pushToast={pushToast}
      />
      {showWalkthrough && (
        <WalkthroughOverlay
          onComplete={() => endWalkthrough("completed")}
          onSkip={() => endWalkthrough("skipped")}
          onOpenSettings={() => openScreenFromQuickView("setup")}
        />
      )}
      {showGettingStarted && (
        <GettingStartedModal
          paused={paused}
          retentionDays={retentionDays}
          aiConfigured={hasAIConnection(aiConfig, false)}
          usingCodexPlan={isCodexConnection(aiConfig)}
          envOpenAiKeyPresent={envOpenAiKeyPresent}
          onEnableTracking={() => setPaused(false)}
          onRetentionDaysChange={changeRetentionDays}
          onConnectOpenAiKey={connectOpenAiKeyFromWizard}
          onConnectViaCodexPlan={connectViaCodexPlanFromWizard}
          onDismiss={finishGettingStarted}
        />
      )}
    </AppShell>
  );
}
