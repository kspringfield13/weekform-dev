import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Compass,
  Download,
  ExternalLink,
  Eye,
  FileText,
  LoaderCircle,
  Lock,
  Monitor,
  Pause,
  Play,
  PlugZap,
  RotateCcw,
  Save,
  Settings,
  Share2,
  Timer,
  Upload
} from "lucide-react";
import type {
  ActiveWindowSample,
  ActivitySession,
  AuditEvent,
  OutlookCalendarEvent,
  TokenUsageDay,
  TokenUsageSettings,
  UserCorrection,
  VisualContextInsight,
  WorkBlock,
  AIConfig,
  AIProvider
} from "../../../../../packages/domain/src/models";
import type { SettingsTab, WindowMode } from "../../lib/types";
import { getLocalDateKey } from "../../lib/date";
import { formatCount } from "../../lib/format";
import { AI_UNAVAILABLE_HINT, MAX_PROACTIVE_ALERTS_PER_DAY, MAX_VISUAL_CONTEXT_CAPTURES_PER_DAY } from "../../lib/constants";
import { withAiTimeout } from "../../lib/aiTimeout";
import type { ProactiveAlertSettings } from "../../lib/proactiveAlerts";
import {
  downloadTextFile,
  exportFilename,
  exportMimeType,
  serializeAuditTrail,
  serializeWorkLedger,
  type ExportFormat
} from "../../lib/dataExport";
import {
  AI_PROVIDER_PRESETS,
  aiProviderLabel,
  createDefaultAIConfig,
  getAIProviderPreset,
  providerSupportsGeneration,
  upgradeRetiredAppDefault
} from "../../services/aiProviders";
import {
  createCodexAIConfig,
  isCodexConnection,
} from "../../services/aiConnection";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { AgentMark } from "../common/AgentMark";
import { ModelPricingPanel } from "./ModelPricingPanel";
import { CloudAccountPanel } from "./CloudAccountPanel";
import type { CloudController } from "../../hooks/useCloudSync";
import type { CalendarSourcesController } from "../../hooks/useCalendarSources";
import type { CalendarProviderId, CalendarRangeInput } from "../../../../../packages/integrations/src/calendar/calendarSync";
import { CalendarSourcesPanel } from "./CalendarSourcesPanel";
import { EmailSourcePanel } from "./EmailSourcePanel";
import type { ChatSourcesController } from "../../hooks/useChatSources";
import { ChatSourcesPanel } from "./ChatSourcesPanel";
import type { AsyncOperationGate } from "../../hooks/useAsyncStatus";

// Retention windows (in days) offered for auto-expiring stored activity samples.
const RETENTION_OPTIONS = [7, 14, 30, 90] as const;

// Reliable-capacity floors (%) offered for the proactive guardrail.
const CAPACITY_THRESHOLD_OPTIONS = [5, 10, 15, 20] as const;

// Optional proactive-alert rules (the capacity guardrail has its own row above).
const OPTIONAL_ALERT_RULES = [
  { key: "endOfDayReviewEnabled", label: "End-of-day review nudge", hint: "When blocks still need review late in the day" },
  { key: "heavyDayAheadEnabled", label: "Heavy-day-ahead warning", hint: "The day before a meeting-heavy day" },
  { key: "fragmentationEnabled", label: "Fragmentation nudge", hint: "When context-switching runs high" },
  { key: "weeklyArtifactsEnabled", label: "Weekly summary ready", hint: "When the summary and forecast are ready to review" },
] as const;

const SETTINGS_TABS = [
  { id: "data-sources", label: "Data Sources" },
  { id: "data-control", label: "Data Control" },
  { id: "ai-assistance", label: "AI Assistance" },
  { id: "ai-usage", label: "AI Usage" },
  { id: "notifications", label: "Notifications" },
  { id: "account", label: "Account & Sharing" }
] as const satisfies ReadonlyArray<{ id: SettingsTab; label: string }>;

function settingsTabId(id: SettingsTab): string {
  return `settings-tab-${id}`;
}

function settingsPanelId(id: SettingsTab): string {
  return `settings-panel-${id}`;
}

interface TestConnectionResponse {
  provider: string;
  model: string;
  message: string;
}

type ProviderStatus =
  | { tone: "success" | "error" | "info"; message: string }
  | null;

export function SetupScreen({
  paused,
  setPaused,
  visualContextEnabled,
  setVisualContextEnabled,
  visualContextInsights,
  calendarEvents,
  activeWindowSamples,
  activeWindowSessions,
  captureError,
  importError,
  lastCalendarImportSummary,
  calendarSources,
  chatSources,
  onImportCalendar,
  chatImportError,
  onImportChatExport,
  tokenUsageDays,
  tokenUsageSettings,
  onTokenUsageSettingsChange,
  usageImportError,
  lastUsageImportSummary,
  onImportUsageCsv,
  aiConfig,
  setAiConfig,
  blocks,
  corrections,
  auditEvents,
  onResetLocalData,
  isResettingLocalData,
  aiConnectionGate,
  onExportBackup,
  retentionDays,
  setRetentionDays,
  proactiveAlertSettings,
  onProactiveAlertSettingsChange,
  onReplayWalkthrough,
  defaultWindowMode,
  onDefaultWindowModeChange,
  activeSettingsTab,
  onActiveSettingsTabChange,
  aiAvailable,
  cloud,
  resetConfirmationRequestId,
  onResetConfirmationRequestHandled,
}: {
  paused: boolean;
  setPaused: (value: boolean) => void;
  visualContextEnabled: boolean;
  setVisualContextEnabled: (value: boolean) => void;
  visualContextInsights: VisualContextInsight[];
  calendarEvents: OutlookCalendarEvent[];
  activeWindowSamples: ActiveWindowSample[];
  activeWindowSessions: ActivitySession[];
  captureError: string | null;
  importError: string | null;
  lastCalendarImportSummary: string | null;
  calendarSources: CalendarSourcesController;
  chatSources: ChatSourcesController;
  onImportCalendar: (provider: CalendarProviderId, file: File, range: CalendarRangeInput) => void;
  chatImportError: string | null;
  onImportChatExport: (file: File) => void;
  tokenUsageDays: TokenUsageDay[];
  tokenUsageSettings: TokenUsageSettings;
  onTokenUsageSettingsChange: (value: TokenUsageSettings) => void;
  usageImportError: string | null;
  lastUsageImportSummary: string | null;
  onImportUsageCsv: (file: File) => void;
  aiConfig: AIConfig | null;
  setAiConfig: (config: AIConfig | null) => void;
  blocks: WorkBlock[];
  corrections: UserCorrection[];
  auditEvents: AuditEvent[];
  onResetLocalData: () => void;
  isResettingLocalData: boolean;
  aiConnectionGate: AsyncOperationGate;
  onExportBackup: () => Promise<void>;
  retentionDays: number | null;
  setRetentionDays: (value: number | null) => void;
  proactiveAlertSettings: ProactiveAlertSettings;
  onProactiveAlertSettingsChange: (value: ProactiveAlertSettings) => void;
  onReplayWalkthrough: () => void;
  defaultWindowMode: WindowMode;
  onDefaultWindowModeChange: (mode: WindowMode) => void;
  activeSettingsTab: SettingsTab;
  onActiveSettingsTabChange: (tab: SettingsTab) => void;
  /** AI access exists (Codex plan, Keychain-backed key, or env fallback). */
  aiAvailable: boolean;
  cloud: CloudController;
  resetConfirmationRequestId: number;
  onResetConfirmationRequestHandled: () => void;
}) {
  const visualCapturesToday = visualContextInsights.filter((insight) => getLocalDateKey(new Date(insight.captured_at)) === getLocalDateKey()).length;

  const [draftConfig, setDraftConfig] = useState<AIConfig>(() =>
    upgradeRetiredAppDefault(aiConfig || createDefaultAIConfig())
  );
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>(() =>
    aiConfig && aiConfig.model !== upgradeRetiredAppDefault(aiConfig).model
      ? { tone: "info", message: `Updated the retired ${aiConfig.model} default. Save to keep the new model.` }
      : null
  );
  const [isTesting, setIsTesting] = useState(false);
  const [isConnectingCodex, setIsConnectingCodex] = useState(false);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const settingsTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (resetConfirmationRequestId > 0) {
      setConfirmingReset(true);
      onResetConfirmationRequestHandled();
    }
  }, [onResetConfirmationRequestHandled, resetConfirmationRequestId]);

  // "Reset all local data" from the in-app dialog on this screen clears aiConfig
  // to null WITHOUT navigating away (unlike the native-menu path, which routes to
  // "daily" and unmounts this screen), so SetupScreen stays mounted. The draft form
  // is seeded from aiConfig only once (the useState initializer above) and never
  // re-syncs, so without this the form would keep showing — and let isDirty re-enable
  // "Save Settings" to re-persist — the very API key the reset just wiped from disk.
  // Re-sync the draft to defaults whenever aiConfig is cleared so the form matches
  // the wiped state. Guarded on `!aiConfig`, so an in-progress edit of a configured
  // provider is untouched; on first run (aiConfig already null) it's a no-op reset
  // to the same defaults the initializer produced.
  useEffect(() => {
    if (!aiConfig) {
      setDraftConfig(createDefaultAIConfig());
      setProviderStatus(null);
    }
  }, [aiConfig]);

  useEffect(() => {
    if (!isResettingLocalData) return;
    setDraftConfig(createDefaultAIConfig());
    setProviderStatus(null);
    setIsTesting(false);
    setIsConnectingCodex(false);
  }, [isResettingLocalData]);

  const csvBucketCount = tokenUsageDays.filter((day) => day.source_type === "csv_import").length;
  const selectedPreset = getAIProviderPreset(draftConfig.provider);
  const modelSuggestions =
    selectedPreset.modelSuggestions ?? (selectedPreset.model ? [selectedPreset.model] : []);
  const isDirty = !aiConfig || JSON.stringify(draftConfig) !== JSON.stringify(aiConfig);

  const updateDraftConfig = (patch: Partial<AIConfig>) => {
    if (isResettingLocalData) return;
    const newConfig: AIConfig = { ...draftConfig, connectionMode: "api_key", ...patch };
    if (patch.provider) {
      const preset = getAIProviderPreset(patch.provider);
      newConfig.baseUrl = preset.baseUrl;
      newConfig.model = preset.model;
      newConfig.visionModel = preset.visionModel;
    }
    setDraftConfig(newConfig);
    setProviderStatus(null);
  };

  const restoreDefaults = () => {
    if (isResettingLocalData) return;
    const defaults = createDefaultAIConfig(draftConfig.provider);
    setDraftConfig({ ...defaults, apiKey: draftConfig.apiKey });
    setProviderStatus({ tone: "info", message: `Restored the recommended ${selectedPreset.label} settings.` });
  };

  const saveAIConfig = () => {
    if (isResettingLocalData) return;
    const config = {
      ...draftConfig,
      connectionMode: "api_key" as const,
      apiKey: draftConfig.apiKey.trim(),
      baseUrl: draftConfig.baseUrl?.trim().replace(/\/+$/, ""),
      model: draftConfig.model.trim(),
      visionModel: draftConfig.visionModel?.trim() || undefined
    };
    if (!config.apiKey || !config.baseUrl || !config.model) {
      setProviderStatus({ tone: "error", message: "API key, base URL, and model are required." });
      return;
    }
    setDraftConfig(config);
    setAiConfig(config);
    setProviderStatus({
      tone: "success",
      message: "Provider settings saved locally; desktop API keys use macOS Keychain.",
    });
  };

  const testConnection = async () => {
    if (isResettingLocalData) return;
    const codexConnection = isCodexConnection(draftConfig);
    if (!codexConnection && (!draftConfig.apiKey.trim() || !draftConfig.baseUrl?.trim() || !draftConfig.model.trim())) {
      setProviderStatus({ tone: "error", message: "Enter an API key, base URL, and model before testing." });
      return;
    }
    if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
      setProviderStatus({
        tone: "error",
        message: "Connection testing needs the desktop app — the browser preview can't reach your provider. Your settings can still be saved."
      });
      return;
    }

    const connectionToken = aiConnectionGate.begin();
    if (connectionToken === null) return;
    setIsTesting(true);
    setProviderStatus(null);
    const testedConfig: AIConfig = codexConnection
      ? draftConfig
      : {
          ...draftConfig,
          connectionMode: "api_key",
          apiKey: draftConfig.apiKey.trim(),
          baseUrl: draftConfig.baseUrl!.trim().replace(/\/+$/, ""),
          model: draftConfig.model.trim(),
          visionModel: draftConfig.visionModel?.trim() || undefined
        };
    try {
      const result = await withAiTimeout(
        invoke<TestConnectionResponse>("test_ai_connection", {
          request: {
            aiConfig: testedConfig
          }
        })
      );
      if (!aiConnectionGate.isCurrent(connectionToken)) return;
      setDraftConfig(testedConfig);
      setAiConfig(testedConfig);
      setProviderStatus({ tone: "success", message: result.message });
    } catch (error) {
      if (!aiConnectionGate.isCurrent(connectionToken)) return;
      setProviderStatus({
        tone: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      if (aiConnectionGate.isCurrent(connectionToken)) setIsTesting(false);
    }
  };

  const connectCodexPlan = async () => {
    if (isResettingLocalData) return;
    if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
      setProviderStatus({
        tone: "error",
        message: "ChatGPT/Codex sign-in needs the desktop app."
      });
      return;
    }
    const connectionToken = aiConnectionGate.begin();
    if (connectionToken === null) return;
    setIsConnectingCodex(true);
    setProviderStatus(null);
    try {
      const result = await invoke<{ model: string; planType: string; message: string }>(
        "connect_codex_via_chatgpt"
      );
      if (!aiConnectionGate.isCurrent(connectionToken)) return;
      const config = createCodexAIConfig(result.model);
      setDraftConfig(config);
      setAiConfig(config);
      setProviderStatus({ tone: "success", message: result.message });
    } catch (error) {
      if (!aiConnectionGate.isCurrent(connectionToken)) return;
      setProviderStatus({
        tone: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      if (aiConnectionGate.isCurrent(connectionToken)) setIsConnectingCodex(false);
    }
  };

  const switchToApiKey = async () => {
    if (isResettingLocalData) return;
    const connectionToken = aiConnectionGate.begin();
    if (connectionToken === null) return;
    if (isCodexConnection(aiConfig) && "__TAURI_INTERNALS__" in window) {
      setIsConnectingCodex(true);
      setProviderStatus(null);
      try {
        await invoke("disconnect_codex");
        if (!aiConnectionGate.isCurrent(connectionToken)) return;
      } catch (error) {
        if (!aiConnectionGate.isCurrent(connectionToken)) return;
        setProviderStatus({
          tone: "error",
          message: `Could not clear the Weekform Codex sign-in: ${error instanceof Error ? error.message : String(error)}`
        });
        setIsConnectingCodex(false);
        return;
      }
      setIsConnectingCodex(false);
    }
    if (!aiConnectionGate.isCurrent(connectionToken)) return;
    const config = createDefaultAIConfig("openai");
    setDraftConfig(config);
    setAiConfig(null);
    setProviderStatus({ tone: "info", message: "Codex sign-in cleared. Enter a provider API key to reconnect." });
  };

  const exportLedger = (format: ExportFormat) => {
    downloadTextFile(
      exportFilename("work-ledger", format),
      serializeWorkLedger(blocks, format),
      exportMimeType(format)
    );
  };

  const exportAudit = (format: ExportFormat) => {
    downloadTextFile(
      exportFilename("audit-trail", format),
      serializeAuditTrail(auditEvents, format),
      exportMimeType(format)
    );
  };

  const onRetentionChange = (value: string) => {
    setRetentionDays(value === "off" ? null : Number(value));
  };

  // Nudge: let the user save a complete local backup before the irreversible wipe —
  // covering every data class the reset destroys (blocks, raw activity, imports,
  // corrections, the audit trail, forecasts, narratives, plays, and saved skills),
  // not just the ledger + audit. Handled in App.tsx (where the full state + audit
  // emitter live). The dialog stays open after exporting so they can review the
  // download and then confirm (or cancel).
  const exportBeforeReset = async () => {
    if (isExportingBackup) return;
    setIsExportingBackup(true);
    try {
      await onExportBackup();
    } finally {
      setIsExportingBackup(false);
    }
  };

  const focusSettingsTab = (index: number) => {
    const tab = SETTINGS_TABS[index];
    if (!tab) return;
    onActiveSettingsTabChange(tab.id);
    settingsTabRefs.current[index]?.focus();
  };

  const handleSettingsTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
        nextIndex = (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
        break;
      case "ArrowRight":
        nextIndex = (index + 1) % SETTINGS_TABS.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = SETTINGS_TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    focusSettingsTab(nextIndex);
  };

  const isAccountSettings = activeSettingsTab === "account";

  return (
    <section className="screen settings-screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>{isAccountSettings ? "Account & sharing" : "Privacy and data sources"}</h1>
          <p className="screen-intro">
            {isAccountSettings
              ? "Connect Weekform Web and control every shared field from this Mac."
              : "Weekform collects only the signals you enable. Tracking can be paused at any time."}
          </p>
        </div>
        {/* Secondary on purpose: the toolbar owns the always-visible pause control;
            this is a contextual page action, not the page's primary CTA. */}
        {!isAccountSettings && (
          <button className="secondary-action" type="button" onClick={() => setPaused(!paused)}>
            {paused ? <Play size={18} aria-hidden /> : <Pause size={18} aria-hidden />}
            <span>{paused ? "Resume Tracking" : "Pause Tracking"}</span>
          </button>
        )}
      </div>

      <div className="settings-preferences-grid">
        <div className="settings-walkthrough-replay">
          <div>
            <strong>App walkthrough</strong>
            <span>Replay the guided tour of the main sections.</span>
          </div>
          <button className="ghost-action" type="button" onClick={onReplayWalkthrough}>
            <Compass size={15} aria-hidden />
            <span>Replay walkthrough</span>
          </button>
        </div>

        <div className="settings-walkthrough-replay">
          <div>
            <strong>Default window size</strong>
            <span>How Weekform opens from the menu bar.</span>
          </div>
          <div className="data-export-options">
            <label className="sr-only" htmlFor="default-window-mode">Default window size on open</label>
            <select
              id="default-window-mode"
              value={defaultWindowMode}
              onChange={(event) =>
                onDefaultWindowModeChange(event.target.value === "compact" ? "compact" : "large")
              }
            >
              <option value="large">Full window</option>
              <option value="compact">Compact widget</option>
            </select>
          </div>
        </div>
      </div>

      <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => { settingsTabRefs.current[index] = node; }}
            id={settingsTabId(tab.id)}
            className={activeSettingsTab === tab.id ? "is-active" : ""}
            type="button"
            role="tab"
            aria-selected={activeSettingsTab === tab.id}
            aria-controls={settingsPanelId(tab.id)}
            tabIndex={activeSettingsTab === tab.id ? 0 : -1}
            onClick={() => onActiveSettingsTabChange(tab.id)}
            onKeyDown={(event) => handleSettingsTabKeyDown(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div
        className="settings-tab-panel"
        id={settingsPanelId("data-sources")}
        role="tabpanel"
        aria-labelledby={settingsTabId("data-sources")}
        tabIndex={0}
        hidden={activeSettingsTab !== "data-sources"}
      >
      <div className="settings-section-heading">
        <div>
          <h2>Data sources</h2>
          <span>Enable sources only when they add useful workload context.</span>
        </div>
      </div>

      <section className="settings-row">
        <div className="settings-row-icon"><Monitor size={18} aria-hidden /></div>
        <div>
          <h3>Active window activity</h3>
          <p>Records foreground app, window title, and timestamp locally. It never records keystrokes or file contents.</p>
        </div>
        <div className="settings-row-status">
          <strong>{formatCount(activeWindowSessions.length)} session{activeWindowSessions.length === 1 ? "" : "s"}</strong>
          <span>{formatCount(activeWindowSamples.length)} sample{activeWindowSamples.length === 1 ? "" : "s"} stored</span>
          {captureError && <small className="import-error" role="alert">{captureError}</small>}
        </div>
        <span className={paused ? "source-status is-paused" : "source-status is-active"}>
          {paused ? <Pause size={13} aria-hidden /> : <span className="source-status-dot" />}
          {paused ? "Paused" : "Active"}
        </span>
      </section>

      <CalendarSourcesPanel
        events={calendarEvents}
        controller={calendarSources}
        importError={importError}
        lastSummary={lastCalendarImportSummary}
        onImport={onImportCalendar}
        disabled={isResettingLocalData}
      />

      <EmailSourcePanel />

      <ChatSourcesPanel
        controller={chatSources}
        legacyImportError={chatImportError}
        onImportLegacy={onImportChatExport}
        disabled={isResettingLocalData}
      />

      <section className="settings-row">
        <div className="settings-row-icon"><Eye size={18} aria-hidden /></div>
        <div>
          <h3>Visual context</h3>
          <p>Optional screenshot analysis for sustained sessions. API-key requests use `store: false` where supported; Codex-plan requests use ephemeral threads. Temporary screenshots are deleted locally before the result is stored.</p>
        </div>
        <div className="settings-row-status">
          <strong>{visualContextEnabled ? "On" : "Off"}</strong>
          <span>{visualCapturesToday}/{MAX_VISUAL_CONTEXT_CAPTURES_PER_DAY} captures today</span>
        </div>
        {/* Turning visual context ON needs AI (captures are analyzed by the vision
            model); turning it OFF must always stay possible. */}
        <button
          className={visualContextEnabled ? "settings-control is-on" : "settings-control"}
          type="button"
          aria-pressed={visualContextEnabled}
          disabled={isResettingLocalData || (!visualContextEnabled && !aiAvailable)}
          title={!visualContextEnabled && !aiAvailable ? AI_UNAVAILABLE_HINT : undefined}
          onClick={() => setVisualContextEnabled(!visualContextEnabled)}
        >
          {visualContextEnabled ? "Disable Visual Context" : "Enable Visual Context"}
        </button>
      </section>
      </div>

      <div
        className="settings-tab-panel"
        id={settingsPanelId("ai-usage")}
        role="tabpanel"
        aria-labelledby={settingsTabId("ai-usage")}
        tabIndex={0}
        hidden={activeSettingsTab !== "ai-usage"}
      >
      <div className="settings-section-heading">
        <div>
          <h2>AI usage</h2>
          <span>Track how much AI assistance you use. Tokens are the source of truth; costs are a computed overlay. Everything here is opt-in and stays local.</span>
        </div>
      </div>

      <section className="settings-row">
        <div className="settings-row-icon"><AgentMark size={18} aria-hidden /></div>
        <div>
          <h3>Observed AI estimates</h3>
          <p>Estimates AI assistant time from apps and browser tabs you already capture. Window titles are matched on-device only and never stored or sent — only labels like &quot;Browser AI session&quot; and minutes are kept. Always shown as estimates, and estimates cover your retained activity window.</p>
        </div>
        <div className="settings-row-status">
          <strong>{tokenUsageSettings.observed_proxy_enabled ? "On" : "Off"}</strong>
          <span>Estimates, never token counts</span>
        </div>
        <button
          className={tokenUsageSettings.observed_proxy_enabled ? "settings-control is-on" : "settings-control"}
          type="button"
          onClick={() =>
            onTokenUsageSettingsChange({
              ...tokenUsageSettings,
              observed_proxy_enabled: !tokenUsageSettings.observed_proxy_enabled
            })
          }
        >
          {tokenUsageSettings.observed_proxy_enabled ? "Disable Estimates" : "Enable Estimates"}
        </button>
      </section>

      <section className="settings-row">
        <div className="settings-row-icon"><Share2 size={18} aria-hidden /></div>
        <div>
          <h3>Include AI usage in manager summaries</h3>
          <p>Adds a one-line AI-usage note to the manager-ready weekly summary (and the AI-generated narrative). Off by default — your internal summary always shows usage either way; sharing it upward is your call.</p>
        </div>
        <div className="settings-row-status">
          <strong>{tokenUsageSettings.include_in_manager_summary ? "Shared" : "Internal only"}</strong>
          <span>{tokenUsageSettings.include_in_manager_summary ? "Manager summary includes usage" : "Usage stays in your internal view"}</span>
        </div>
        <button
          className={tokenUsageSettings.include_in_manager_summary ? "settings-control is-on" : "settings-control"}
          type="button"
          onClick={() =>
            onTokenUsageSettingsChange({
              ...tokenUsageSettings,
              include_in_manager_summary: !tokenUsageSettings.include_in_manager_summary
            })
          }
        >
          {tokenUsageSettings.include_in_manager_summary ? "Make Internal Only" : "Include in Summary"}
        </button>
      </section>

      <section className="settings-row">
        <div className="settings-row-icon"><Upload size={18} aria-hidden /></div>
        <div>
          <h3>Usage CSV import</h3>
          <p>Import a token-usage export from the OpenAI console or another compatible provider. Columns are matched flexibly; rows that carry a cost column keep that cost as authoritative. Re-importing the same file never double-counts.</p>
        </div>
        <div className="settings-row-status">
          <strong>{csvBucketCount > 0 ? `${csvBucketCount} day-bucket${csvBucketCount === 1 ? "" : "s"}` : "Nothing imported"}</strong>
          <span>{lastUsageImportSummary ?? "Parsed locally, never uploaded"}</span>
          {usageImportError && <small className="import-error" role="alert">{usageImportError}</small>}
        </div>
        <label className="settings-control">
          <Upload size={16} aria-hidden />
          <span>Import Usage CSV</span>
          <input
            accept=".csv,text/csv"
            type="file"
            disabled={isResettingLocalData}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onImportUsageCsv(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </section>

      <ModelPricingPanel
        tokenUsageDays={tokenUsageDays}
        priceMap={tokenUsageSettings.price_map}
        preferredProvider={draftConfig.provider}
        onSave={(priceMap) =>
          onTokenUsageSettingsChange({ ...tokenUsageSettings, price_map: priceMap })
        }
      />
      </div>

      <div
        className="settings-tab-panel"
        id={settingsPanelId("ai-assistance")}
        role="tabpanel"
        aria-labelledby={settingsTabId("ai-assistance")}
        tabIndex={0}
        hidden={activeSettingsTab !== "ai-assistance"}
      >
      <div className="settings-section-heading">
        <div>
          <h2>AI assistance</h2>
          <span>
            {isCodexConnection(aiConfig)
              ? `Configured — ChatGPT/Codex plan · ${aiConfig?.model}. Every AI feature stays reviewable.`
              : aiConfig?.apiKey
                ? `Configured — ${getAIProviderPreset(aiConfig.provider).label} · ${aiConfig.model}. Every AI feature stays reviewable.`
                : "Optional. Use a ChatGPT/Codex plan or provider API key for classification, forecasts, summaries, and the Agent."}
          </span>
        </div>
      </div>

      <div className="ai-assistance">
          <p>Raw activity metadata stays in the encrypted native journal. AI features send only the compact context required for the feature you invoke to the connection you select.</p>
          <p>Window titles and screenshots may include sensitive details. Pause tracking or disable visual context before handling confidential work.</p>

          <div className="ai-provider">
            <div className="ai-provider-header">
              <div className="ai-provider-title">
                <span className="ai-provider-icon"><PlugZap size={17} aria-hidden /></span>
                <div>
                  <strong>AI Provider</strong>
                  <small><Lock size={12} aria-hidden /> Desktop API keys stay in macOS Keychain; Codex-plan tokens remain managed by Codex.</small>
                </div>
              </div>
              {selectedPreset.docsUrl && (
                <a
                  className="ai-provider-docs"
                  href={selectedPreset.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={12} aria-hidden />
                  <span>{selectedPreset.label} model docs</span>
                </a>
              )}
            </div>

            {isCodexConnection(draftConfig) ? (
              <div className="ai-form">
                <div className="ai-field">
                  <strong>ChatGPT/Codex plan</strong>
                  <small>
                    OpenAI manages browser sign-in and refresh through a Weekform-isolated Codex
                    app-server. Weekform never receives or copies your OAuth token or a Platform API key.
                  </small>
                </div>
                <div className="ai-field">
                  <label htmlFor="ai-codex-model">Selected model</label>
                  <input id="ai-codex-model" type="text" value={draftConfig.model} readOnly />
                  <small>The available default comes from your ChatGPT workspace.</small>
                </div>
                <div className="ai-provider-actions">
                  <button className="settings-control" type="button" onClick={testConnection} disabled={isTesting || isConnectingCodex || isResettingLocalData} aria-busy={isTesting}>
                    {isTesting ? <LoaderCircle className="spin" size={15} aria-hidden /> : <PlugZap size={15} aria-hidden />}
                    {isTesting ? "Testing…" : "Test Connection"}
                  </button>
                  <button className="settings-control" type="button" onClick={() => void switchToApiKey()} disabled={isConnectingCodex || isResettingLocalData}>
                    {isConnectingCodex ? <LoaderCircle className="spin" size={15} aria-hidden /> : <RotateCcw size={15} aria-hidden />}
                    Use an API key instead
                  </button>
                </div>
              </div>
            ) : (
            <>
              <div className="ai-field ai-codex-connect">
                <strong>Already have a ChatGPT plan with Codex?</strong>
                <small>Use your included Codex access without creating or pasting a Platform API key.</small>
                <button className="settings-control" type="button" onClick={() => void connectCodexPlan()} disabled={isConnectingCodex || isResettingLocalData} aria-busy={isConnectingCodex}>
                  {isConnectingCodex ? <LoaderCircle className="spin" size={15} aria-hidden /> : <AgentMark />}
                  {isConnectingCodex ? "Finish signing in your browser…" : "Use ChatGPT/Codex plan"}
                </button>
              </div>

              <div className="ai-form">
              <div className="ai-field">
                <label htmlFor="ai-provider">Provider</label>
                <select
                  id="ai-provider"
                  value={draftConfig.provider}
                  onChange={(e) => updateDraftConfig({ provider: e.target.value as AIProvider })}
                >
                  {AI_PROVIDER_PRESETS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                {!providerSupportsGeneration(draftConfig.provider) && (
                  <small className="ai-provider-support-note" role="note">
                    <AlertCircle size={12} aria-hidden />
                    <span>
                      {aiProviderLabel(draftConfig.provider)} currently powers only the Agent chat.
                      Classification, forecasts, summaries, the Review Copilot, acceleration, and visual
                      context need an OpenAI (or OpenAI-compatible) key today.
                    </span>
                  </small>
                )}
              </div>

              <div className="ai-field">
                <label htmlFor="ai-api-key">API Key</label>
                <input
                  id="ai-api-key"
                  type="password"
                  autoComplete="off"
                  placeholder={selectedPreset.keyPlaceholder}
                  value={draftConfig.apiKey}
                  onChange={(e) => updateDraftConfig({ apiKey: e.target.value })}
                />
              </div>

              <div className="ai-field">
                <label htmlFor="ai-base-url">Base URL</label>
                <input
                  id="ai-base-url"
                  type="text"
                  placeholder="https://api.example.com/v1"
                  value={draftConfig.baseUrl || ""}
                  onChange={(e) => updateDraftConfig({ baseUrl: e.target.value || undefined })}
                />
                <small>{selectedPreset.baseUrlNote}</small>
              </div>

              <div className="ai-field">
                <label htmlFor="ai-model">Model</label>
                <input
                  id="ai-model"
                  type="text"
                  placeholder={selectedPreset.model || "provider-model-id"}
                  value={draftConfig.model}
                  onChange={(e) => updateDraftConfig({ model: e.target.value })}
                />
                <small>{selectedPreset.modelNote}</small>
                {modelSuggestions.length > 0 && (
                  <div className="ai-model-suggestions">
                    <span className="ai-model-suggestions-label">Recommended</span>
                    {modelSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="ai-model-chip"
                        aria-pressed={draftConfig.model === suggestion}
                        onClick={() => updateDraftConfig({ model: suggestion })}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="ai-field">
                <label htmlFor="ai-vision-model">Vision Model <span>Optional</span></label>
                <input
                  id="ai-vision-model"
                  type="text"
                  placeholder={selectedPreset.visionModel || "No recommended vision model"}
                  value={draftConfig.visionModel || ""}
                  onChange={(e) => updateDraftConfig({ visionModel: e.target.value || undefined })}
                />
                <small>{selectedPreset.visionNote}</small>
              </div>
            </div>

            <div className="ai-provider-footer">
              <button className="ai-text-button" type="button" onClick={restoreDefaults} disabled={isResettingLocalData}>
                <RotateCcw size={14} aria-hidden />
                Restore recommended defaults
              </button>
              <div className="ai-provider-actions">
                <button className="settings-control" type="button" onClick={testConnection} disabled={isTesting || isResettingLocalData} aria-busy={isTesting}>
                  {isTesting ? <LoaderCircle className="spin" size={15} aria-hidden /> : <PlugZap size={15} aria-hidden />}
                  {isTesting ? "Testing…" : "Test Connection"}
                </button>
                <button className="primary-action" type="button" onClick={saveAIConfig} disabled={!isDirty || isResettingLocalData}>
                  <Save size={15} aria-hidden />
                  {isDirty ? "Save Settings" : "Saved"}
                </button>
              </div>
            </div>
            </>
            )}

            <div
              className={`ai-provider-status${providerStatus ? ` is-${providerStatus.tone}` : ''}`}
              role={providerStatus?.tone === "error" ? "alert" : "status"}
              aria-live={providerStatus?.tone === "error" ? "assertive" : "polite"}
              aria-atomic="true"
            >
              {providerStatus && (
                <>
                  {providerStatus.tone === "success"
                    ? <CheckCircle2 size={15} aria-hidden />
                    : providerStatus.tone === "error"
                      ? <AlertCircle size={15} aria-hidden />
                      : <Settings size={15} aria-hidden />}
                  <span>{providerStatus.message}</span>
                </>
              )}
            </div>
          </div>
      </div>
      </div>

      <div
        className="settings-tab-panel"
        id={settingsPanelId("notifications")}
        role="tabpanel"
        aria-labelledby={settingsTabId("notifications")}
        tabIndex={0}
        hidden={activeSettingsTab !== "notifications"}
      >
      <div className="settings-section-heading">
        <div>
          <h2>Notifications</h2>
          <span>Turn menu-bar alerts on or off, and choose which workload signals notify you.</span>
        </div>
      </div>

      <section className="settings-row">
        <div className="settings-row-icon"><BellRing size={18} aria-hidden /></div>
        <div>
          <h3>Proactive alerts</h3>
          <p>Get a menu-bar notification when your reliable capacity runs low or carryover risk climbs. Alerts use capacity metrics only — never window titles or app names — and are capped at {MAX_PROACTIVE_ALERTS_PER_DAY} per day. Turn everything off with this switch, or fine-tune individual alerts below.</p>
        </div>
        <div className="settings-row-status">
          <strong>{proactiveAlertSettings.enabled ? "On" : "Off"}</strong>
          <span>{proactiveAlertSettings.enabled ? `Warns at or below ${proactiveAlertSettings.capacityThresholdPct}%` : "No notifications sent"}</span>
        </div>
        <button
          className={proactiveAlertSettings.enabled ? "settings-control is-on" : "settings-control"}
          type="button"
          aria-pressed={proactiveAlertSettings.enabled}
          onClick={() => onProactiveAlertSettingsChange({ ...proactiveAlertSettings, enabled: !proactiveAlertSettings.enabled })}
        >
          {proactiveAlertSettings.enabled ? "Disable Alerts" : "Enable Alerts"}
        </button>
      </section>

      {proactiveAlertSettings.enabled && (
        <section className="settings-row">
          <div className="settings-row-icon"><AlertCircle size={18} aria-hidden /></div>
          <div>
            <h3>Capacity guardrail</h3>
            <p>Notify me when reliable new-work capacity drops to or below this level (or carryover risk spikes). Lower it to be warned only when capacity is nearly gone.</p>
          </div>
          <div className="settings-row-status">
            <strong>{proactiveAlertSettings.capacityGuardrailEnabled ? "Active" : "Muted"}</strong>
            <span>Floor at {proactiveAlertSettings.capacityThresholdPct}%</span>
          </div>
          <div className="data-export-options">
            <label className="sr-only" htmlFor="capacity-threshold">Capacity warning threshold</label>
            <select
              id="capacity-threshold"
              value={String(proactiveAlertSettings.capacityThresholdPct)}
              onChange={(event) => onProactiveAlertSettingsChange({ ...proactiveAlertSettings, capacityThresholdPct: Number(event.target.value) })}
            >
              {CAPACITY_THRESHOLD_OPTIONS.map((value) => (
                <option key={value} value={value}>At or below {value}%</option>
              ))}
            </select>
            <button
              className={proactiveAlertSettings.capacityGuardrailEnabled ? "settings-control is-on" : "settings-control"}
              type="button"
              aria-pressed={proactiveAlertSettings.capacityGuardrailEnabled}
              onClick={() => onProactiveAlertSettingsChange({ ...proactiveAlertSettings, capacityGuardrailEnabled: !proactiveAlertSettings.capacityGuardrailEnabled })}
            >
              {proactiveAlertSettings.capacityGuardrailEnabled ? "Mute Guardrail" : "Unmute Guardrail"}
            </button>
          </div>
        </section>
      )}

      {proactiveAlertSettings.enabled && OPTIONAL_ALERT_RULES.map((rule) => (
        <section className="settings-row" key={rule.key}>
          <div className="settings-row-icon"><BellRing size={18} aria-hidden /></div>
          <div>
            <h3>{rule.label}</h3>
            <p>{rule.hint}.</p>
          </div>
          <div className="settings-row-status">
            <strong>{proactiveAlertSettings[rule.key] ? "On" : "Off"}</strong>
            <span>Metrics only</span>
          </div>
          <button
            className={proactiveAlertSettings[rule.key] ? "settings-control is-on" : "settings-control"}
            type="button"
            aria-pressed={proactiveAlertSettings[rule.key]}
            aria-label={`${proactiveAlertSettings[rule.key] ? "Disable" : "Enable"} — ${rule.label}`}
            onClick={() => onProactiveAlertSettingsChange({ ...proactiveAlertSettings, [rule.key]: !proactiveAlertSettings[rule.key] })}
          >
            {proactiveAlertSettings[rule.key] ? "Disable" : "Enable"}
          </button>
        </section>
      ))}
      </div>

      <div
        className="settings-tab-panel"
        id={settingsPanelId("data-control")}
        role="tabpanel"
        aria-labelledby={settingsTabId("data-control")}
        tabIndex={0}
        hidden={activeSettingsTab !== "data-control"}
      >
      <div className="settings-section-heading">
        <div>
          <h2>Data control</h2>
          <span>Your ledger stays local. Export it, or set how long raw activity and canonical Chat evidence are kept.</span>
        </div>
      </div>

      <section className="settings-row">
        <div className="settings-row-icon"><Timer size={18} aria-hidden /></div>
        <div>
          <h3>Raw evidence retention</h3>
          <p>Automatically delete active-window samples plus canonical and derived Chat event evidence older than the window you choose. Sessions and work blocks already derived from them are kept.</p>
        </div>
        <div className="settings-row-status">
          <strong>{formatCount(activeWindowSamples.length)} sample{activeWindowSamples.length === 1 ? "" : "s"} stored</strong>
          <span>{retentionDays === null ? "Kept until you reset" : `Auto-expire after ${retentionDays} days`}</span>
        </div>
        <div className="data-export-options">
          <label className="sr-only" htmlFor="retention-window">Activity retention window</label>
          <select
            id="retention-window"
            value={retentionDays === null ? "off" : String(retentionDays)}
            onChange={(event) => onRetentionChange(event.target.value)}
          >
            <option value="off">Keep all samples</option>
            {RETENTION_OPTIONS.map((days) => (
              <option key={days} value={days}>Last {days} days</option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-row">
        <div className="settings-row-icon"><Download size={18} aria-hidden /></div>
        <div>
          <h3>Export work ledger</h3>
          <p>Download every classified work block as JSON or CSV. The file is saved locally — nothing leaves this device.</p>
        </div>
        <div className="settings-row-status">
          <strong>{formatCount(blocks.length)} work block{blocks.length === 1 ? "" : "s"}</strong>
          <span>{blocks.length === 0 ? "Nothing to export yet" : "JSON keeps full detail"}</span>
        </div>
        <div className="data-export-options">
          <button
            className="settings-control"
            type="button"
            disabled={blocks.length === 0}
            onClick={() => exportLedger("json")}
            aria-label="Export work ledger as JSON"
          >
            <Download size={15} aria-hidden />
            <span>JSON</span>
          </button>
          <button
            className="settings-control"
            type="button"
            disabled={blocks.length === 0}
            onClick={() => exportLedger("csv")}
            aria-label="Export work ledger as CSV"
          >
            <Download size={15} aria-hidden />
            <span>CSV</span>
          </button>
        </div>
      </section>

      <section className="settings-row">
        <div className="settings-row-icon"><FileText size={18} aria-hidden /></div>
        <div>
          <h3>Export audit trail</h3>
          <p>Download the full explainability log — every classification, correction, and privacy action — as JSON or CSV.</p>
        </div>
        <div className="settings-row-status">
          <strong>{formatCount(auditEvents.length)} audit event{auditEvents.length === 1 ? "" : "s"}</strong>
          <span>{auditEvents.length === 0 ? "Nothing to export yet" : "Stored locally only"}</span>
        </div>
        <div className="data-export-options">
          <button
            className="settings-control"
            type="button"
            disabled={auditEvents.length === 0}
            onClick={() => exportAudit("json")}
            aria-label="Export audit trail as JSON"
          >
            <Download size={15} aria-hidden />
            <span>JSON</span>
          </button>
          <button
            className="settings-control"
            type="button"
            disabled={auditEvents.length === 0}
            onClick={() => exportAudit("csv")}
            aria-label="Export audit trail as CSV"
          >
            <Download size={15} aria-hidden />
            <span>CSV</span>
          </button>
        </div>
      </section>

      <section className="settings-row">
        <div className="settings-row-icon"><RotateCcw size={18} aria-hidden /></div>
        <div>
          <h3>Reset all local data</h3>
          <p>Permanently clears everything Weekform has stored on this device — work blocks, activity and Chat evidence, corrections, the audit trail, forecasts, imports, and Calendar/Chat connections. Export first if you want a copy.</p>
        </div>
        <div className="settings-row-status">
          <strong>Irreversible</strong>
          <span>Everything stays local until then</span>
        </div>
        <button
          className="settings-control"
          type="button"
          disabled={isResettingLocalData || isExportingBackup}
          aria-busy={isResettingLocalData}
          onClick={() => setConfirmingReset(true)}
        >
          <RotateCcw size={15} aria-hidden />
          <span>{isResettingLocalData ? "Resetting…" : "Reset Data"}</span>
        </button>
      </section>
      </div>

      <div
        className="settings-tab-panel"
        id={settingsPanelId("account")}
        role="tabpanel"
        aria-labelledby={settingsTabId("account")}
        tabIndex={0}
        hidden={activeSettingsTab !== "account"}
      >
      <CloudAccountPanel cloud={cloud} disabled={isResettingLocalData} />
      </div>

      {confirmingReset && (
        <ConfirmDialog
          title="Reset all local data?"
          description="This permanently clears everything Weekform has stored on this device. It can't be undone."
          confirmLabel="Reset everything"
          confirmDisabled={isExportingBackup || isResettingLocalData}
          onConfirm={() => {
            setConfirmingReset(false);
            onResetLocalData();
          }}
          onCancel={() => setConfirmingReset(false)}
        >
          <ul className="dialog-delete-list">
            <li>{formatCount(blocks.length)} work {blocks.length === 1 ? "block" : "blocks"} &amp; activity samples</li>
            <li>{formatCount(corrections.length)} {corrections.length === 1 ? "correction" : "corrections"}</li>
            <li>The audit trail, forecasts &amp; weekly history</li>
            <li>Calendar imports, Chat evidence &amp; retention settings</li>
            <li>Calendar and Chat connection credentials &amp; cursors</li>
            <li>Your saved AI provider settings &amp; credentials</li>
          </ul>
          <p className="dialog-desc">
            A backup includes raw activity, window titles, and your saved Agent conversation as plaintext. Keep the exported file somewhere private and secure.
          </p>
          <button
            type="button"
            className="secondary-action dialog-export-action"
            disabled={isExportingBackup}
            aria-busy={isExportingBackup}
            onClick={() => void exportBeforeReset()}
          >
            <Download size={15} aria-hidden />
            <span>{isExportingBackup ? "Preparing backup…" : "Export my data first"}</span>
          </button>
        </ConfirmDialog>
      )}
    </section>
  );
}
