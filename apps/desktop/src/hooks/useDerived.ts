import { useMemo } from "react";
import { analyzeInterruptionLoad, buildForecastTrackRecord, computeCapacityBaselines, computeWeeklyCapacitySnapshot, generateWeeklyNarrative, normalizeWeekId, scoreForecastAccuracy, summarizeChatStakeholders, summarizeForecastAccuracy } from "../../../../packages/inference/src/capacity";
import type { ChatStakeholderSummary, ForecastAccuracyTrend, ForecastTrackRecordEntry, InterruptionLoadAnalysis } from "../../../../packages/inference/src/capacity";
import {
  mergeActivitySessionWindows,
  sessionizeActiveWindowSamples,
} from "../../../../packages/inference/src/sessionizer/activeWindow";
import { computeWeeklyAIUsageSummary, detectProxyUsage, proxyEventsToUsageDays } from "../../../../packages/inference/src/aiUsage";
import { buildAccelerationSignals, buildRealizedSavings, summarizeRealizedSavings } from "../../../../packages/inference/src/accelerate";
import type { RealizedSavingsEntry, RealizedSavingsSummary } from "../../../../packages/inference/src/accelerate";
import type {
  WorkBlock,
  ActiveWindowSample,
  ActivitySession,
  OutlookCalendarEvent,
  RawEvent,
  AccelerationSignal,
  TokenUsageDay,
  TokenUsageSettings,
  WeeklyAIUsageSummary,
} from "../../../../packages/domain/src/models";
import type { PersistedNarrativeRecord, PersistedForecastRecord, PersistedSnapshotRecord, PersistedAccelerationSnapshot, ForecastAccuracyReview } from "../services/localStore";
import { getCurrentIsoWeekId, replaceIsoWeekIds } from "../lib/date";
import { pct } from "../lib/format";

// The session-based Acceleration detectors report a per-WEEK reclaimable estimate, so they mine only
// the most recent week of captured sessions (a trailing window, since a continuous capture stream has
// no week_id to filter on). The mining window is SESSION_MINING_WINDOW_DAYS * DAY_MS.
const SESSION_MINING_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

interface UseDerivedParams {
  blocks: WorkBlock[];
  chatEvents: RawEvent[];
  activeWindowSamples: ActiveWindowSample[];
  journalSessionWindow?: {
    cutoffMs: number;
    sessions: ActivitySession[];
  } | null;
  calendarEvents: OutlookCalendarEvent[];
  generatedNarrative: PersistedNarrativeRecord | null;
  forecastHistory: PersistedForecastRecord[];
  snapshotHistory: PersistedSnapshotRecord[];
  accelerationHistory: PersistedAccelerationSnapshot[];
  actedOnPlayIds: string[];
  managerSummaryText: string | null;
  tokenUsageDays: TokenUsageDay[];
  tokenUsageSettings: TokenUsageSettings;
  todayKey: string;
  currentWeekId: string;
  currentWeekRangeLabel: string;
  nextWeekRangeLabel: string;
}

export function useDerived(params: UseDerivedParams) {
  const {
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
  } = params;

  // This week's reviewed blocks — the single week-scoped ledger slice shared by the capacity
  // snapshot, the interruption analysis, and the Acceleration miner so none of them re-filters the
  // full ledger per render. Work blocks are NEVER pruned (retention only trims raw samples/chat), so
  // the ledger accumulates across weeks; `computeWeeklyCapacitySnapshot` has no internal week filter
  // (it sums estimated_capacity_pct over whatever it's given), so scoping here is what keeps every
  // current-week derivation describing *this* week's load rather than accumulated lifetime totals.
  const weekBlocks = useMemo(
    // Normalize both sides of the stored-`week_id` compare (like scoredForecasts/capacityBaselines/
    // recurrenceBySignalId below): a legacy/imported non-padded id (`2026-W5`) must collapse onto its
    // padded twin (`2026-W05`) so a current-week block isn't silently dropped from the snapshot —
    // CapacityTrendChart already normalizes the same ids, so a raw compare here would omit a week the
    // trend chart still plots. Byte-identical on the padded ids every capacity path already emits.
    () => blocks.filter((block) => normalizeWeekId(block.week_id) === normalizeWeekId(currentWeekId)),
    [blocks, currentWeekId]
  );

  const snapshot = useMemo(
    () => computeWeeklyCapacitySnapshot(currentWeekId, weekBlocks),
    [weekBlocks, currentWeekId]
  );

  // If a forecast made in a prior week targeted the now-current week, score its
  // predicted reliable capacity against what the model actually computed.
  const forecastAccuracy = useMemo<ForecastAccuracyReview | null>(() => {
    const matching = forecastHistory
      .filter((entry) => normalizeWeekId(entry.generated_for_week) === normalizeWeekId(currentWeekId))
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0];
    if (!matching) return null;
    return {
      record: matching,
      ...scoreForecastAccuracy(
        matching.forecast.reliable_new_work_capacity_pct,
        snapshot.reliable_new_work_capacity_pct
      ),
    };
  }, [forecastHistory, currentWeekId, snapshot.reliable_new_work_capacity_pct]);

  // Pair every SETTLED past forecast we can score with the capacity the model actually computed for
  // the week it targeted. Actuals come from the retained per-week snapshots. The still-accumulating
  // CURRENT week is deliberately EXCLUDED — only settled, completed weeks are scored — otherwise a
  // track-record row + the rolling MAE would flip beat↔miss mid-week as this week's blocks fill in
  // (App.tsx continuously rewrites the current week's snapshot into snapshotHistory as it accrues).
  // This mirrors buildRealizedSavings' current-week exclusion (accelerate.ts) and honors its
  // documented invariant ("mirrors the forecast track record scoring only once a week completes").
  // The live current-week read is the separate `forecastAccuracy` banner above. One scored entry per
  // target week (latest forecast wins). Feeds both the rolling trend and the per-week track-record list.
  const scoredForecasts = useMemo(() => {
    // Normalize every week-id key/compare (like the baseline + acceleration blocks below): a
    // legacy/imported non-padded id (`2026-W5`) must collapse onto its padded twin (`2026-W05`)
    // so it isn't silently dropped from scoring — CapacityTrendChart already normalizes the same
    // snapshotHistory keys, so a raw compare here would omit a week the trend chart still plots.
    const normalizedCurrentWeekId = normalizeWeekId(currentWeekId);
    const actualByWeek = new Map<string, number>();
    for (const record of snapshotHistory) {
      actualByWeek.set(normalizeWeekId(record.week_id), record.snapshot.reliable_new_work_capacity_pct);
    }

    const latestForecastByWeek = new Map<string, PersistedForecastRecord>();
    for (const entry of forecastHistory) {
      const weekId = normalizeWeekId(entry.generated_for_week);
      const existing = latestForecastByWeek.get(weekId);
      if (!existing || entry.generated_at.localeCompare(existing.generated_at) > 0) {
        latestForecastByWeek.set(weekId, entry);
      }
    }

    return [...latestForecastByWeek.entries()]
      .filter(([weekId]) => weekId !== normalizedCurrentWeekId && actualByWeek.has(weekId))
      .map(([weekId, entry]) => ({
        week_id: weekId,
        predicted_pct: entry.forecast.reliable_new_work_capacity_pct,
        actual_pct: actualByWeek.get(weekId) as number,
      }));
  }, [forecastHistory, snapshotHistory, currentWeekId]);

  // Roll the scored forecasts into a single mean-absolute-error so the latest forecast can be
  // read against the model's own track record.
  const forecastAccuracyTrend = useMemo<ForecastAccuracyTrend | null>(
    () => summarizeForecastAccuracy(scoredForecasts),
    [scoredForecasts]
  );

  // Per-week predicted-vs-actual list (newest first) so the model can be audited over time.
  const forecastTrackRecord = useMemo<ForecastTrackRecordEntry[]>(
    () => buildForecastTrackRecord(scoredForecasts),
    [scoredForecasts]
  );

  // Chat-driven interruption load (null when no chat data) — explains the context-switch story
  // with the reactive density calendar + git can't see. Metadata-only inputs. Scoped to the
  // current ISO week so the panel (which renders only on the current week) describes *this*
  // week's chat load, not accumulated lifetime totals.
  const weekChatEvents = useMemo(
    () =>
      chatEvents.filter(
        (event) => getCurrentIsoWeekId(new Date(event.timestamp_start)) === currentWeekId
      ),
    [chatEvents, currentWeekId]
  );

  const interruptionLoad = useMemo<InterruptionLoadAnalysis | null>(
    () => analyzeInterruptionLoad(weekChatEvents, weekBlocks),
    [weekChatEvents, weekBlocks]
  );

  // This week's imported calendar events — fed to the meeting-load miner (E5). Scoped to the current
  // ISO week like the blocks/chat above so the engine mines *this* week's meeting load, not lifetime
  // totals accumulated across every imported `.ics`.
  const weekCalendarEvents = useMemo(
    () =>
      calendarEvents.filter(
        (event) => getCurrentIsoWeekId(new Date(event.start_time)) === currentWeekId
      ),
    [calendarEvents, currentWeekId]
  );

  // Who the week's reactive chat work served — the collaboration view that pairs with the
  // interruption load. Same week-scoped, metadata-only chat events; null when no chat data.
  const chatStakeholders = useMemo<ChatStakeholderSummary | null>(
    () => summarizeChatStakeholders(weekChatEvents),
    [weekChatEvents]
  );

  // Rolling personal baselines from the weeks strictly before the current one, so the narrative's
  // "dense meetings" trigger can read against the user's own norm rather than an absolute cut
  // (mirrors the baseline machinery WeeklyCapacityScreen uses for its capacity chips).
  const capacityBaselines = useMemo(() => {
    const prior = snapshotHistory
      .filter((record) => normalizeWeekId(record.week_id) < normalizeWeekId(currentWeekId))
      .map((record) => record.snapshot);
    return computeCapacityBaselines(prior);
  }, [snapshotHistory, currentWeekId]);

  // Pass the user-edited draft (managerSummaryText, always stored already-humanized) through
  // verbatim so a typed ISO-week token isn't rewritten in the native copy; keep replaceIsoWeekIds
  // on the generated fallback, which has no other sanitizer here (unlike NarrativeScreen's :39).
  const managerText = generatedNarrative
    ? managerSummaryText ??
      replaceIsoWeekIds(
        `${generatedNarrative.narrative.headline}\n\n${generatedNarrative.narrative.manager_ready_summary}`,
        currentWeekRangeLabel
      )
    : "";

  const activeWindowSessions = useMemo(() => {
    if (!journalSessionWindow) return sessionizeActiveWindowSamples(activeWindowSamples);
    const postCutoffSamples = activeWindowSamples.filter(
      (sample) => new Date(sample.timestamp).getTime() > journalSessionWindow.cutoffMs,
    );
    return mergeActivitySessionWindows(
      journalSessionWindow.sessions,
      sessionizeActiveWindowSamples(postCutoffSamples),
    );
  }, [activeWindowSamples, journalSessionWindow]);

  // Proxy AI-usage days, derived live from the retained sessions (never persisted —
  // heuristic improvements retroactively apply, and sessions already persist).
  // Empty when the observed-estimates opt-in is off, so nothing downstream renders.
  const proxyUsageDays = useMemo<TokenUsageDay[]>(
    () =>
      tokenUsageSettings.observed_proxy_enabled
        ? proxyEventsToUsageDays(detectProxyUsage(activeWindowSessions))
        : [],
    [tokenUsageSettings.observed_proxy_enabled, activeWindowSessions]
  );

  // The week's usage rollup — persisted exact buckets plus live proxy days, with the
  // cost overlay computed from the Settings price map (tokens stay the source of truth).
  const aiUsageSummary = useMemo<WeeklyAIUsageSummary>(
    () =>
      computeWeeklyAIUsageSummary(
        [...tokenUsageDays, ...proxyUsageDays],
        currentWeekId,
        tokenUsageSettings.price_map
      ),
    [tokenUsageDays, proxyUsageDays, currentWeekId, tokenUsageSettings.price_map]
  );

  const narrative = useMemo(
    () =>
      generateWeeklyNarrative(snapshot, capacityBaselines, {
        summary: aiUsageSummary,
        include_in_manager_summary: tokenUsageSettings.include_in_manager_summary,
      }),
    [snapshot, capacityBaselines, aiUsageSummary, tokenUsageSettings.include_in_manager_summary]
  );

  // Sessions fed to the Acceleration engine, scoped to a trailing 7-day window. The two session
  // detectors (repeating workflows, context-switch hotspots) emit a per-WEEK reclaimable estimate, so
  // mining the full retained history would scale both each estimate and the headline "est. saved / week"
  // total in proportion to retentionDays (which defaults to keep-everything), and a sliding sequence
  // window straddling a week boundary would invent cross-week "workflows" that never happened. Unlike
  // the blocks/chat/calendar inputs above, sessions are a continuous capture stream with no week_id; an
  // ISO-week filter would also under-count early in the week (Monday would mine only Monday while still
  // labeling it "per week"). A trailing week keeps the per-week estimate accurate and stable on every
  // day. `todayKey` (the canonical daily-rollover key from useDateContext) is a dep so the cutoff slides
  // forward each day even on an idle, mounted-for-days tray app with no new samples — not just when new
  // captures re-sessionize activeWindowSessions.
  const recentSessions = useMemo(() => {
    const cutoff = Date.now() - SESSION_MINING_WINDOW_DAYS * DAY_MS;
    return activeWindowSessions.filter((session) => {
      const startMs = new Date(session.start_time).getTime();
      return Number.isFinite(startMs) && startMs >= cutoff;
    });
    // todayKey intentionally re-evaluates the Date.now() cutoff at each local-day rollover.
  }, [activeWindowSessions, todayKey]);

  // Cross-week recurrence (E2): count how many PRIOR ISO weeks each signal_id was mined, from the
  // retained acceleration history. The current week is excluded (it's the week being ranked), so
  // this map is independent of the current mining and can't feed back into it. Emphasis only — it
  // nudges ranking and drives the card badge; the estimate stays deterministic.
  const recurrenceBySignalId = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const record of accelerationHistory) {
      if (normalizeWeekId(record.week_id) >= normalizeWeekId(currentWeekId)) continue;
      const seen = new Set<string>();
      for (const signal of record.signals) {
        if (seen.has(signal.signal_id)) continue; // one record per week, but guard duplicates
        seen.add(signal.signal_id);
        counts[signal.signal_id] = (counts[signal.signal_id] ?? 0) + 1;
      }
    }
    return counts;
  }, [accelerationHistory, currentWeekId]);

  // Deterministic Acceleration signals — repetitive workflows, tool-able time-sinks,
  // context-switch hotspots, (E4) a reactive-comms batching Play, and (E5) meeting-load Plays mined
  // from this week's reviewed blocks, the last week of captured sessions, the chat interruption
  // analysis, and the imported calendar, ranked by reclaimable time. No AI, no network, always on
  // (the D-tasks add the opt-in AI layer).
  const accelerationSignals = useMemo<AccelerationSignal[]>(
    () =>
      buildAccelerationSignals({
        blocks: weekBlocks,
        sessions: recentSessions,
        recurrenceBySignalId,
        interruptionLoad,
        calendarEvents: weekCalendarEvents,
      }),
    [weekBlocks, recentSessions, recurrenceBySignalId, interruptionLoad, weekCalendarEvents]
  );

  // Realized-savings track record (E3): for every play the user marked acted-on, score its estimate
  // one retained week against the following week's — turning the engine's forward-looking estimates
  // into a proven record. Reads only the derived per-week summaries (id/type/minutes), so it's
  // privacy-trivial. Mirrors the forecast track-record pairing above.
  const realizedSavings = useMemo<RealizedSavingsEntry[]>(
    () =>
      buildRealizedSavings({
        history: accelerationHistory,
        actedOnSignalIds: actedOnPlayIds,
        currentWeekId,
      }),
    [accelerationHistory, actedOnPlayIds, currentWeekId]
  );

  const realizedSavingsSummary = useMemo<RealizedSavingsSummary | null>(
    () => summarizeRealizedSavings(realizedSavings),
    [realizedSavings]
  );

  const hasNarrativeEvidence =
    blocks.length > 0 || activeWindowSessions.length > 0 || calendarEvents.length > 0;

  const reviewQueue = useMemo(
    () => blocks.filter((block) => !block.user_verified),
    [blocks]
  );

  const toolbarStatus = useMemo(() => {
    return blocks.length > 0
      ? `${pct(snapshot.reliable_new_work_capacity_pct)} reliable new-work capacity`
      : `${activeWindowSessions.length} session${activeWindowSessions.length === 1 ? "" : "s"}, ${calendarEvents.length} calendar event${calendarEvents.length === 1 ? "" : "s"}`;
  }, [blocks.length, snapshot.reliable_new_work_capacity_pct, activeWindowSessions.length, calendarEvents.length]);

  return {
    snapshot,
    narrative,
    managerText,
    activeWindowSessions,
    proxyUsageDays,
    aiUsageSummary,
    hasNarrativeEvidence,
    reviewQueue,
    toolbarStatus,
    forecastAccuracy,
    forecastAccuracyTrend,
    forecastTrackRecord,
    interruptionLoad,
    chatStakeholders,
    accelerationSignals,
    realizedSavings,
    realizedSavingsSummary,
  };
}
