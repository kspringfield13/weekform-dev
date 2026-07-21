import type { AppActionResult, Screen, SettingsTab, WindowMode } from "../../lib/types";
import type {
  ActiveWindowSample,
  ActivitySession,
  AuditEvent,
  OutlookCalendarEvent,
  RawEvent,
  ReviewCopilotSuggestion,
  TokenUsageDay,
  TokenUsageSettings,
  WeeklyAIUsageSummary,
  UserCorrection,
  VisualContextInsight,
  WorkBlock,
  AIConfig,
  AccelerationPlay,
  AccelerationSignal,
  SavedSkill,
} from "../../../../../packages/domain/src/models";
import type { PersistedForecastRecord, PersistedNarrativeRecord, ForecastAccuracyReview, PersistedSnapshotRecord } from "../../services/localStore";
import type { ConsentReceiptV1 } from "../../services/consentReceipt";
import type { computeWeeklyCapacitySnapshot, generateWeeklyNarrative, ChatStakeholderSummary, ForecastAccuracyTrend, ForecastTrackRecordEntry, InterruptionLoadAnalysis } from "../../../../../packages/inference/src/capacity";
import type { RealizedSavingsEntry, RealizedSavingsSummary } from "../../../../../packages/inference/src/accelerate";

import { CompactWidget } from "../compact/CompactWidget";
import { SetupScreen } from "../settings/SetupScreen";
import { LedgerScreen } from "../ledger/LedgerScreen";
import { DailyReviewScreen } from "../review/DailyReviewScreen";
import { WeeklyReviewScreen } from "../review/WeeklyReviewScreen";
import { WeeklyCapacityScreen } from "../capacity/WeeklyCapacityScreen";
import { ForecastScreen } from "../capacity/ForecastScreen";
import { NarrativeScreen } from "../narrative/NarrativeScreen";
import { UsageScreen } from "../usage/UsageScreen";
import { AuditLogScreen } from "../audit/AuditLogScreen";
import { SensitiveReviewScreen } from "../audit/SensitiveReviewScreen";
import { AgentScreen } from "../agent/AgentScreen";
import { AccelerationScreen } from "../accelerate/AccelerationScreen";
import { SkillsLibraryScreen } from "../accelerate/SkillsLibraryScreen";
import { TeamScreen } from "../team/TeamScreen";
import type { OnboardingStep } from "../common/OnboardingCard";
import type { ProactiveAlert, ProactiveAlertSettings } from "../../lib/proactiveAlerts";
import type { PushToast } from "../../hooks/useToasts";
import type { AsyncOperationGate } from "../../hooks/useAsyncStatus";
import type { CloudController } from "../../hooks/useCloudSync";
import type { CalendarSourcesController } from "../../hooks/useCalendarSources";
import type { ChatSourcesController } from "../../hooks/useChatSources";
import type { CalendarProviderId, CalendarRangeInput } from "../../../../../packages/integrations/src/calendar/calendarSync";
import type { WeeklyReviewState } from "../../services/weeklyReview";

interface ScreenRouterProps {
  active: Screen;
  windowMode: WindowMode;
  // shared
  paused: boolean;
  setPaused: (value: boolean) => void;
  blocks: WorkBlock[];
  activeWindowSamples: ActiveWindowSample[];
  activeWindowSessions: ActivitySession[];
  snapshot: ReturnType<typeof computeWeeklyCapacitySnapshot>;
  snapshotHistory: PersistedSnapshotRecord[];
  interruptionLoad: InterruptionLoadAnalysis | null;
  chatStakeholders: ChatStakeholderSummary | null;
  accelerationPlays: AccelerationPlay[];
  realizedSavings: RealizedSavingsEntry[];
  realizedSavingsSummary: RealizedSavingsSummary | null;
  dismissedPlayIds: string[];
  actedOnPlayIds: string[];
  onDismissPlay: (signal: AccelerationSignal) => void;
  onMarkPlayActedOn: (signal: AccelerationSignal) => void;
  onUnmarkPlayActedOn: (signalId: string) => void;
  onRestoreDismissedPlays: () => void;
  // saved skills library
  savedSkills: SavedSkill[];
  savedSkillIds: string[];
  onSaveSkill: (play: AccelerationPlay) => void;
  onRemoveSkill: (signalId: string) => void;
  // acceleration AI synthesis (opt-in)
  accelerationStatus: "idle" | "generating" | "error";
  accelerationError: string | null;
  onGenerateAccelerationPlays: () => void;
  accelerationConfigured: boolean;
  /** AI access exists (saved key or env fallback) — false grays every AI-trigger button. */
  aiAvailable: boolean;
  accelerationGeneratedAt: string | null;
  hasAuthoredPlays: boolean;
  onConfirm: (blockId: string) => void;
  onExclude: (blockId: string) => void;
  onRelabel: (blockId: string, field: keyof WorkBlock, value: WorkBlock[keyof WorkBlock]) => void;
  onUndoLastCorrection: () => void;
  canUndoLastCorrection: boolean;
  onOpenScreen: (screen: Screen) => void;
  // first-run onboarding
  onboardingSteps: OnboardingStep[];
  showOnboarding: boolean;
  onDismissOnboarding: () => void;
  onReplayWalkthrough: () => void;
  // setup screen
  activeSettingsTab: SettingsTab;
  onActiveSettingsTabChange: (tab: SettingsTab) => void;
  defaultWindowMode: WindowMode;
  onDefaultWindowModeChange: (mode: WindowMode) => void;
  visualContextEnabled: boolean;
  setVisualContextEnabled: (value: boolean) => void;
  visualContextInsights: VisualContextInsight[];
  onDiscardInsight: (insightId: string) => void;
  calendarEvents: OutlookCalendarEvent[];
  chatEvents: RawEvent[];
  captureError: string | null;
  importError: string | null;
  lastCalendarImportSummary: string | null;
  calendarSources: CalendarSourcesController;
  chatSources: ChatSourcesController;
  onImportCalendar: (provider: CalendarProviderId, file: File, range: CalendarRangeInput) => void;
  chatImportError: string | null;
  onImportChatExport: (file: File) => void;
  // AI usage tracking (setup + usage screens)
  tokenUsageDays: TokenUsageDay[];
  tokenUsageSettings: TokenUsageSettings;
  proxyUsageDays: TokenUsageDay[];
  aiUsageSummary: WeeklyAIUsageSummary;
  onTokenUsageSettingsChange: (value: TokenUsageSettings) => void;
  usageImportError: string | null;
  lastUsageImportSummary: string | null;
  onImportUsageCsv: (file: File) => void;
  aiConfig: AIConfig | null;
  setAiConfig: (value: AIConfig | null) => void;
  retentionDays: number | null;
  setRetentionDays: (value: number | null) => void;
  // Account & Sharing (setup screen)
  cloud: CloudController;
  onOpenManagerWorkspace: () => void;
  // proactive alerts (compact widget + setup screen)
  proactiveAlert: ProactiveAlert | null;
  onDismissProactiveAlert: () => void;
  proactiveAlertSettings: ProactiveAlertSettings;
  onProactiveAlertSettingsChange: (value: ProactiveAlertSettings) => void;
  // ledger screen
  classificationStatus: "idle" | "classifying" | "error";
  classificationError: string | null;
  visualContextStatus: "idle" | "capturing" | "error";
  visualContextError: string | null;
  onClassifySessions: () => Promise<AppActionResult>;
  // corrections screen
  corrections: UserCorrection[];
  onResetLocalData: () => void;
  isResettingLocalData: boolean;
  resetConfirmationRequestId: number;
  onResetConfirmationRequestHandled: () => void;
  onExportBackup: () => Promise<void>;
  // daily review screen
  reviewSuggestions: ReviewCopilotSuggestion[];
  reviewCopilotStatus: "idle" | "generating" | "error";
  reviewCopilotError: string | null;
  onGenerateReviewSuggestions: () => void;
  onApplyReviewSuggestion: (suggestion: ReviewCopilotSuggestion) => void;
  onDismissReviewSuggestion: (suggestionId: string) => void;
  // weekly capacity + forecast
  weekRangeLabel: string;
  nextWeekRangeLabel: string;
  // weekly close-out ritual
  weeklyReviewState: WeeklyReviewState;
  weeklyReviewCompletionRecorded: boolean;
  onCompleteWeeklyReview: () => void;
  // forecast screen
  generatedForecast: PersistedForecastRecord | null;
  forecastAccuracy: ForecastAccuracyReview | null;
  forecastAccuracyTrend: ForecastAccuracyTrend | null;
  forecastTrackRecord: ForecastTrackRecordEntry[];
  forecastStatus: "idle" | "generating" | "error";
  forecastError: string | null;
  onGenerateForecast: () => Promise<AppActionResult>;
  // narrative screen
  narrative: ReturnType<typeof generateWeeklyNarrative>;
  generatedNarrative: PersistedNarrativeRecord | null;
  hasNarrativeEvidence: boolean;
  narrativeGenerationStatus: "idle" | "generating" | "error";
  narrativeGenerationError: string | null;
  managerSummaryText: string | null;
  onManagerSummaryChange: (value: string) => void;
  onRegenerate: () => Promise<AppActionResult>;
  // audit log screen
  auditEvents: AuditEvent[];
  consentReceipts: ConsentReceiptV1[];
  // agent screen
  todayKey: string;
  currentWeekRangeLabel: string;
  agentResetGeneration: number;
  aiConnectionGate: AsyncOperationGate;
  // transient feedback
  pushToast: PushToast;
}

export function ScreenRouter({
  active,
  windowMode,
  paused,
  setPaused,
  blocks,
  activeWindowSamples,
  activeWindowSessions,
  snapshot,
  snapshotHistory,
  interruptionLoad,
  chatStakeholders,
  accelerationPlays,
  realizedSavings,
  realizedSavingsSummary,
  dismissedPlayIds,
  actedOnPlayIds,
  onDismissPlay,
  onMarkPlayActedOn,
  onUnmarkPlayActedOn,
  onRestoreDismissedPlays,
  savedSkills,
  savedSkillIds,
  onSaveSkill,
  onRemoveSkill,
  accelerationStatus,
  accelerationError,
  onGenerateAccelerationPlays,
  accelerationConfigured,
  aiAvailable,
  accelerationGeneratedAt,
  hasAuthoredPlays,
  onConfirm,
  onExclude,
  onRelabel,
  onUndoLastCorrection,
  canUndoLastCorrection,
  onOpenScreen,
  onboardingSteps,
  showOnboarding,
  onDismissOnboarding,
  onReplayWalkthrough,
  activeSettingsTab,
  onActiveSettingsTabChange,
  defaultWindowMode,
  onDefaultWindowModeChange,
  visualContextEnabled,
  setVisualContextEnabled,
  visualContextInsights,
  onDiscardInsight,
  calendarEvents,
  chatEvents,
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
  proxyUsageDays,
  aiUsageSummary,
  onTokenUsageSettingsChange,
  usageImportError,
  lastUsageImportSummary,
  onImportUsageCsv,
  aiConfig,
  setAiConfig,
  retentionDays,
  setRetentionDays,
  cloud,
  onOpenManagerWorkspace,
  proactiveAlert,
  onDismissProactiveAlert,
  proactiveAlertSettings,
  onProactiveAlertSettingsChange,
  classificationStatus,
  classificationError,
  visualContextStatus,
  visualContextError,
  onClassifySessions,
  corrections,
  onResetLocalData,
  isResettingLocalData,
  resetConfirmationRequestId,
  onResetConfirmationRequestHandled,
  onExportBackup,
  reviewSuggestions,
  reviewCopilotStatus,
  reviewCopilotError,
  onGenerateReviewSuggestions,
  onApplyReviewSuggestion,
  onDismissReviewSuggestion,
  weekRangeLabel,
  nextWeekRangeLabel,
  weeklyReviewState,
  weeklyReviewCompletionRecorded,
  onCompleteWeeklyReview,
  generatedForecast,
  forecastAccuracy,
  forecastAccuracyTrend,
  forecastTrackRecord,
  forecastStatus,
  forecastError,
  onGenerateForecast,
  narrative,
  generatedNarrative,
  hasNarrativeEvidence,
  narrativeGenerationStatus,
  narrativeGenerationError,
  managerSummaryText,
  onManagerSummaryChange,
  onRegenerate,
  auditEvents,
  consentReceipts,
  todayKey,
  currentWeekRangeLabel,
  agentResetGeneration,
  aiConnectionGate,
  pushToast,
}: ScreenRouterProps) {
  const aiActionsAvailable = aiAvailable && !isResettingLocalData;

  const openScreen = (screen: Screen) => {
    if (screen === "setup") {
      onActiveSettingsTabChange("data-sources");
    }
    onOpenScreen(screen);
  };

  const openSettingsTab = (tab: SettingsTab) => {
    onActiveSettingsTabChange(tab);
    onOpenScreen("setup");
  };

  if (windowMode === "compact") {
    return (
      <CompactWidget
        paused={paused}
        activeWindowSamples={activeWindowSamples}
        activeWindowSessions={activeWindowSessions}
        blocks={blocks}
        snapshot={snapshot}
        onPauseChange={setPaused}
        onOpenScreen={openScreen}
        onConfirm={onConfirm}
        onExclude={onExclude}
        proactiveAlert={proactiveAlert}
        onDismissProactiveAlert={onDismissProactiveAlert}
      />
    );
  }

  return (
    <>
      {active === "team" && (
        <TeamScreen
          cloud={cloud}
          snapshot={snapshot}
          blocks={blocks}
          calendarEvents={calendarEvents}
          chatEvents={chatEvents}
          calendarConnected={calendarSources.statuses.some((status) => status.connected)}
          chatConnected={chatSources.statuses.some((status) => status.connected)}
          hasWorkBlocks={blocks.length > 0}
          onOpenIndividual={() => onOpenScreen("daily")}
          onOpenManagerWorkspace={onOpenManagerWorkspace}
          onOpenSharingSettings={() => openSettingsTab("account")}
        />
      )}
      {active === "setup" && (
        <SetupScreen
          aiAvailable={aiAvailable}
          paused={paused}
          setPaused={setPaused}
          visualContextEnabled={visualContextEnabled}
          setVisualContextEnabled={setVisualContextEnabled}
          visualContextInsights={visualContextInsights}
          calendarEvents={calendarEvents}
          activeWindowSamples={activeWindowSamples}
          activeWindowSessions={activeWindowSessions}
          captureError={captureError}
          importError={importError}
          lastCalendarImportSummary={lastCalendarImportSummary}
          calendarSources={calendarSources}
          chatSources={chatSources}
          onImportCalendar={onImportCalendar}
          chatImportError={chatImportError}
          onImportChatExport={onImportChatExport}
          tokenUsageDays={tokenUsageDays}
          tokenUsageSettings={tokenUsageSettings}
          onTokenUsageSettingsChange={onTokenUsageSettingsChange}
          usageImportError={usageImportError}
          lastUsageImportSummary={lastUsageImportSummary}
          onImportUsageCsv={onImportUsageCsv}
          aiConfig={aiConfig}
          setAiConfig={setAiConfig}
          blocks={blocks}
          corrections={corrections}
          auditEvents={auditEvents}
          onResetLocalData={onResetLocalData}
          isResettingLocalData={isResettingLocalData}
          aiConnectionGate={aiConnectionGate}
          resetConfirmationRequestId={resetConfirmationRequestId}
          onResetConfirmationRequestHandled={onResetConfirmationRequestHandled}
          onExportBackup={onExportBackup}
          retentionDays={retentionDays}
          setRetentionDays={setRetentionDays}
          proactiveAlertSettings={proactiveAlertSettings}
          onProactiveAlertSettingsChange={onProactiveAlertSettingsChange}
          onReplayWalkthrough={onReplayWalkthrough}
          defaultWindowMode={defaultWindowMode}
          onDefaultWindowModeChange={onDefaultWindowModeChange}
          activeSettingsTab={activeSettingsTab}
          onActiveSettingsTabChange={onActiveSettingsTabChange}
          cloud={cloud}
        />
      )}
      {active === "ledger" && (
        <LedgerScreen
          aiAvailable={aiActionsAvailable}
          blocks={blocks}
          activeWindowSamples={activeWindowSamples}
          activeWindowSessions={activeWindowSessions}
          visualContextInsights={visualContextInsights}
          captureError={captureError}
          classificationStatus={classificationStatus}
          classificationError={classificationError}
          visualContextStatus={visualContextStatus}
          visualContextError={visualContextError}
          paused={paused}
          onClassifySessions={onClassifySessions}
          onOpenAISettings={() => openSettingsTab("ai-assistance")}
          onConfirm={onConfirm}
          onExclude={onExclude}
          onRelabel={onRelabel}
          onOpenScreen={openScreen}
        />
      )}
      {active === "daily" && (
        <DailyReviewScreen
          aiAvailable={aiActionsAvailable}
          blocks={blocks}
          onboardingSteps={onboardingSteps}
          showOnboarding={showOnboarding}
          onDismissOnboarding={onDismissOnboarding}
          onOpenScreen={openScreen}
          reviewSuggestions={reviewSuggestions}
          reviewCopilotStatus={reviewCopilotStatus}
          reviewCopilotError={reviewCopilotError}
          onGenerateReviewSuggestions={onGenerateReviewSuggestions}
          onApplyReviewSuggestion={onApplyReviewSuggestion}
          onDismissReviewSuggestion={onDismissReviewSuggestion}
          onConfirm={onConfirm}
          onExclude={onExclude}
          onRelabel={onRelabel}
          onUndoLastCorrection={onUndoLastCorrection}
          canUndoLastCorrection={canUndoLastCorrection}
          corrections={corrections}
          pushToast={pushToast}
        />
      )}
      {active === "weekly" && (
        <WeeklyCapacityScreen
          snapshot={snapshot}
          snapshotHistory={snapshotHistory}
          interruptionLoad={interruptionLoad}
          chatStakeholders={chatStakeholders}
          weekRangeLabel={weekRangeLabel}
          hasWorkBlocks={blocks.length > 0}
          blocks={blocks}
          onOpenScreen={openScreen}
        />
      )}
      {active === "forecast" && (
        <ForecastScreen
          aiAvailable={aiActionsAvailable}
          snapshot={snapshot}
          snapshotHistory={snapshotHistory}
          nextWeekRangeLabel={nextWeekRangeLabel}
          onOpenScreen={openScreen}
          corrections={corrections}
          generatedForecast={generatedForecast}
          forecastAccuracy={forecastAccuracy}
          forecastAccuracyTrend={forecastAccuracyTrend}
          forecastTrackRecord={forecastTrackRecord}
          forecastStatus={forecastStatus}
          forecastError={forecastError}
          onGenerateForecast={onGenerateForecast}
          hasWorkBlocks={blocks.length > 0}
        />
      )}
      {active === "weekly-review" && (
        <WeeklyReviewScreen
          state={weeklyReviewState}
          completionRecorded={weeklyReviewCompletionRecorded}
          onOpenScreen={openScreen}
          onOpenSettingsTab={openSettingsTab}
          onComplete={onCompleteWeeklyReview}
        />
      )}
      {active === "narrative" && (
        <NarrativeScreen
          aiAvailable={aiActionsAvailable}
          narrative={narrative}
          generatedNarrative={generatedNarrative}
          weekRangeLabel={weekRangeLabel}
          hasNarrativeEvidence={hasNarrativeEvidence}
          generationStatus={narrativeGenerationStatus}
          generationError={narrativeGenerationError}
          managerSummaryText={managerSummaryText}
          onManagerSummaryChange={onManagerSummaryChange}
          onRegenerate={onRegenerate}
          pushToast={pushToast}
        />
      )}
      {active === "usage" && (
        <UsageScreen
          summary={aiUsageSummary}
          tokenUsageDays={tokenUsageDays}
          proxyUsageDays={proxyUsageDays}
          tokenUsageSettings={tokenUsageSettings}
          todayKey={todayKey}
          onOpenSettingsTab={openSettingsTab}
        />
      )}
      {active === "audit" && (
        <AuditLogScreen auditEvents={auditEvents} consentReceipts={consentReceipts} pushToast={pushToast} />
      )}
      {active === "sensitive" && (
        <SensitiveReviewScreen
          visualContextInsights={visualContextInsights}
          onDiscardInsight={onDiscardInsight}
        />
      )}
      {active === "accelerate" && (
        <AccelerationScreen
          signals={accelerationPlays}
          realizedSavings={realizedSavings}
          realizedSavingsSummary={realizedSavingsSummary}
          dismissedPlayIds={dismissedPlayIds}
          actedOnPlayIds={actedOnPlayIds}
          savedSkillIds={savedSkillIds}
          onDismissPlay={onDismissPlay}
          onMarkPlayActedOn={onMarkPlayActedOn}
          onUnmarkPlayActedOn={onUnmarkPlayActedOn}
          onSaveSkill={onSaveSkill}
          onRemoveSkill={onRemoveSkill}
          onRestoreDismissedPlays={onRestoreDismissedPlays}
          hasWorkBlocks={blocks.length > 0}
          onOpenScreen={openScreen}
          onOpenSettingsTab={openSettingsTab}
          generateStatus={accelerationStatus}
          generateError={accelerationError}
          onGenerateSkills={onGenerateAccelerationPlays}
          aiConfigured={accelerationConfigured && !isResettingLocalData}
          generatedAt={accelerationGeneratedAt}
          hasAuthoredPlays={hasAuthoredPlays}
          pushToast={pushToast}
        />
      )}
      {active === "skills" && (
        <SkillsLibraryScreen
          savedSkills={savedSkills}
          onRemoveSkill={onRemoveSkill}
          onOpenScreen={openScreen}
          pushToast={pushToast}
        />
      )}
      {active === "agent" && (
        <AgentScreen
          aiAvailable={aiAvailable}
          blocks={blocks}
          snapshot={snapshot}
          activeWindowSessions={activeWindowSessions}
          calendarEvents={calendarEvents}
          corrections={corrections}
          visualContextInsights={visualContextInsights}
          aiUsageSummary={aiUsageSummary}
          todayKey={todayKey}
          currentWeekRangeLabel={currentWeekRangeLabel}
          aiConfig={aiConfig}
          hasNarrativeEvidence={hasNarrativeEvidence}
          onOpenScreen={openScreen}
          onOpenAISettings={() => openSettingsTab("ai-assistance")}
          onClassifySessions={onClassifySessions}
          onGenerateForecast={onGenerateForecast}
          onGenerateNarrative={onRegenerate}
          pushToast={pushToast}
          resetGeneration={agentResetGeneration}
          isResettingLocalData={isResettingLocalData}
        />
      )}
    </>
  );
}
