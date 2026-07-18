import { useState, useMemo } from "react";
import { ArrowDown, ArrowUp, BarChart3, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info, Minus, Upload, Zap } from "lucide-react";
import type { WorkBlock } from "../../../../../packages/domain/src/models";
import type { Screen } from "../../lib/types";
import type { PersistedSnapshotRecord } from "../../services/localStore";
import { computeWeeklyCapacitySnapshot, computeCapacityBaselines, normalizeWeekId, CORE_HOURS_START, CORE_HOURS_END, TARGET_UTILIZATION_PCT, REACTIVE_DISCOUNT_FACTOR } from "../../../../../packages/inference/src/capacity";
import type { ChatStakeholderSummary, InterruptionLoadAnalysis } from "../../../../../packages/inference/src/capacity";
import { categoryColors, modeColors } from "../../../../../packages/domain/src/taxonomy";
import { DEFAULT_SESSION_GAP_MINUTES } from "../../../../../packages/integrations/src/chat/chatExport";
import { WEEKLY_BASELINE_HOURS } from "../../../../../packages/integrations/src/internal/normalize";
import { pct, formatCount, formatHourOfDay } from "../../lib/format";
import { addDays, getCurrentIsoWeekId, getBusinessWeekRangeLabel } from "../../lib/date";
import { EmptyState } from "../common/EmptyState";
import { MetricCard } from "../common/MetricCard";
import { RiskRow } from "../common/RiskRow";

// The headline metrics shown against the user's own rolling baseline. `scale` lifts the
// 0–1 context-switch index onto the same /100 scale the RiskRow uses so its delta reads
// in points like the percentages; `betterWhen` only drives the chip's color/arrow tone.
const BASELINE_METRICS: Array<{
  key: "reliable_new_work_capacity_pct" | "reactive_pct" | "meeting_pct" | "context_switch_score";
  label: string;
  scale: number;
  betterWhen: "higher" | "lower";
}> = [
  { key: "reliable_new_work_capacity_pct", label: "Reliable capacity", scale: 1, betterWhen: "higher" },
  { key: "reactive_pct", label: "Reactive load", scale: 1, betterWhen: "lower" },
  { key: "meeting_pct", label: "Meeting density", scale: 1, betterWhen: "lower" },
  { key: "context_switch_score", label: "Context switching", scale: 100, betterWhen: "lower" },
];

// Plain-language gloss for each part of the committed-load breakdown, keyed on the part.key
// computed in the `committedBreakdown` memo below. Mirrors the per-chip `title` the sibling
// vs-median chips already carry, so a new analyst can hover "Reactive (×0.72)" / "WIP load"
// and read what it means rather than parsing the jargon from the general note alone.
const COMMITTED_PART_GLOSS: Record<string, string> = {
  recurring: "Recurring and fixed commitments — standing meetings and blocks that repeat every week.",
  reactive: `Unplanned support and interruptions, counted at ${Math.round(REACTIVE_DISCOUNT_FACTOR * 100)}% of face value since interrupted work delivers less sustainable throughput.`,
  carryover: "Unfinished work likely to spill over from earlier weeks into this one.",
  fragmentation: "Capacity lost to context-switching across many short, scattered blocks rather than sustained focus.",
  wip: "Extra load from carrying too many projects in progress at once.",
};

// Delivery-risk bar saturation points (%): the Carryover / Meeting-density RiskRow bars fill to
// 100% at these shares of the week. Single-sourced because each value is stated verbatim in its
// RiskRow tooltip copy ("the bar saturates at N% of the week") AND reused by the collapsed summary
// chip's `elevated` gate — a bare literal in any one site would silently make the tooltip lie (or
// the chip and bar disagree on "elevated") the moment the divisor moved. Keep the divisor, the chip
// gate, and the tooltip all reading from the same const.
const CARRYOVER_SATURATION_PCT = 40;
const MEETING_SATURATION_PCT = 35;

function formatCapacityHours(value: number) {
  const hours = (value / 100) * WEEKLY_BASELINE_HOURS;
  if (hours > 0 && hours < 1) return `${Math.round(hours * 60)}m`;
  return `${Number(hours.toFixed(1))}h`;
}

function AllocationBreakdown<T extends string>({
  title,
  items,
  colors,
}: {
  title: string;
  items: Array<{ label: T; value: number }>;
  colors: Record<T, string>;
}) {
  const [hoveredLabel, setHoveredLabel] = useState<T | null>(null);
  const allocatedTotal = items.reduce((total, item) => total + item.value, 0);

  if (allocatedTotal <= 0) {
    return (
      <section className="allocation-breakdown" aria-label={`${title}: no allocated work`}>
        <div className="allocation-breakdown-heading">
          <h3>{title}</h3>
          <span>within allocated work</span>
        </div>
        <p className="allocation-breakdown-empty">No allocated work to break down.</p>
      </section>
    );
  }

  return (
    <section className="allocation-breakdown" aria-label={`${title} within allocated work`}>
      <div className="allocation-breakdown-heading">
        <h3>{title}</h3>
        <span>within allocated work</span>
      </div>
      <div
        className="allocation-mix-bar"
        role="img"
        aria-label={`${title}: ${items
          .map((item) => `${item.label}, ${Math.round((item.value / allocatedTotal) * 100)}% of allocated work`)
          .join("; ")}`}
      >
        {items.map((item) => {
          const share = (item.value / allocatedTotal) * 100;
          const isMuted = hoveredLabel !== null && hoveredLabel !== item.label;
          return (
            <span
              key={item.label}
              className="allocation-mix-segment"
              style={{
                width: `${share}%`,
                background: colors[item.label],
                opacity: isMuted ? 0.3 : 1,
              }}
              onMouseEnter={() => setHoveredLabel(item.label)}
              onMouseLeave={() => setHoveredLabel(null)}
              title={`${item.label}: ${formatCapacityHours(item.value)} · ${pct(item.value)} of week · ${Math.round(share)}% of allocated work`}
            >
              {share >= 22 && <span>{Math.round(share)}%</span>}
            </span>
          );
        })}
      </div>
      <ul className="allocation-breakdown-list">
        {items.map((item) => {
          const share = (item.value / allocatedTotal) * 100;
          const isMuted = hoveredLabel !== null && hoveredLabel !== item.label;
          return (
            <li
              key={item.label}
              tabIndex={0}
              style={{ opacity: isMuted ? 0.38 : 1 }}
              onMouseEnter={() => setHoveredLabel(item.label)}
              onMouseLeave={() => setHoveredLabel(null)}
              onFocus={() => setHoveredLabel(item.label)}
              onBlur={() => setHoveredLabel(null)}
              aria-label={`${item.label}: ${formatCapacityHours(item.value)}, ${pct(item.value)} of week, ${Math.round(share)}% of allocated work`}
            >
              <span className="allocation-breakdown-label">
                <span className="dot" style={{ background: colors[item.label] }} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{Math.round(share)}% of allocated work</small>
                </span>
              </span>
              <span className="allocation-breakdown-values">
                <strong>{formatCapacityHours(item.value)}</strong>
                <small>{pct(item.value)} of week</small>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function WeeklyCapacityScreen({
  snapshot: currentSnapshot,
  snapshotHistory,
  interruptionLoad,
  chatStakeholders,
  weekRangeLabel,
  hasWorkBlocks,
  blocks,
  onOpenScreen,
}: {
  snapshot: ReturnType<typeof computeWeeklyCapacitySnapshot>;
  snapshotHistory: PersistedSnapshotRecord[];
  interruptionLoad: InterruptionLoadAnalysis | null;
  chatStakeholders: ChatStakeholderSummary | null;
  weekRangeLabel: string;
  hasWorkBlocks: boolean;
  blocks: WorkBlock[];
  onOpenScreen: (screen: Screen) => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [riskExpanded, setRiskExpanded] = useState(false);

  const viewedMonday = useMemo(() => {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() + 1 - day);
    monday.setHours(0, 0, 0, 0);
    return addDays(monday, weekOffset * 7);
  }, [weekOffset]);

  const viewedWeekId = useMemo(() => getCurrentIsoWeekId(viewedMonday), [viewedMonday]);
  const viewedWeekRangeLabel = useMemo(() => getBusinessWeekRangeLabel(viewedMonday), [viewedMonday]);

  const viewedBlocks = useMemo(() => {
    // Current week: scope by week_id so this matches the exact block set the (week-scoped) live
    // snapshot is computed from in useDerived — otherwise blockerCount (whose tooltip says "this
    // week") would count every accumulated week's blockers. Key off the LIVE `currentSnapshot.week_id`
    // (which useDerived recomputes at a midnight/Monday rollover) rather than the locally-derived
    // `viewedWeekId` (frozen at mount by its `[weekOffset]`-only memo), so a tray app left open across
    // a week boundary keeps blockerCount in step with the snapshot instead of showing last week's.
    // Prior weeks recompute from a start_time range, since their snapshot is derived here rather than
    // read from the live one.
    if (weekOffset === 0) return blocks.filter((b) => normalizeWeekId(b.week_id) === currentSnapshot.week_id);
    const start = viewedMonday.getTime();
    const end = addDays(viewedMonday, 7).getTime();
    return blocks.filter((b) => {
      const t = new Date(b.start_time).getTime();
      return t >= start && t < end;
    });
  }, [blocks, weekOffset, viewedMonday, currentSnapshot.week_id]);

  const snapshot = useMemo(
    () => (weekOffset === 0 ? currentSnapshot : computeWeeklyCapacitySnapshot(viewedWeekId, viewedBlocks)),
    [currentSnapshot, weekOffset, viewedWeekId, viewedBlocks]
  );

  const isCurrentWeek = weekOffset === 0;
  // For the current week, use the LIVE range-label prop (useDateContext rolls `currentWeekRangeLabel`
  // over at a midnight/Monday boundary) rather than the locally-derived `viewedWeekRangeLabel` — which
  // is frozen at mount by `viewedMonday`'s `[weekOffset]`-only memo. On a tray app left mounted on this
  // screen across a week rollover, `currentSnapshot` (and thus the headline % + `viewedBlocks`) advance
  // to the new week while the frozen label kept showing the PREVIOUS week's range, so the header would
  // read e.g. "Jun 30 – Jul 4: 25% …" over numbers that are actually for Jul 7–11. Mirrors how
  // `viewedBlocks` (line above) keys off the live `currentSnapshot.week_id` for offset 0, and how the
  // no-workload empty state (early return) already renders the live `weekRangeLabel` prop. Byte-identical
  // at mount: `getBusinessWeekRangeLabel(now)` and `getBusinessWeekRangeLabel(viewedMonday)` both
  // normalize to the same Monday-of-week. Navigated PAST weeks keep the frozen label (correct — they're
  // read against `viewedMonday`, not the live snapshot).
  const headlineWeekRangeLabel = isCurrentWeek ? weekRangeLabel : viewedWeekRangeLabel;
  const blockerCount = useMemo(() => viewedBlocks.filter((b) => b.blocker_flag).length, [viewedBlocks]);

  // Compact one-line summary of the five delivery risk modifiers, shown while the section is
  // collapsed. Each chip mirrors its RiskRow's normalized value and tooltip; `elevated` reuses
  // the RiskRow "high" severity threshold (≥0.67 of the bar) so a chip only turns red when the
  // expanded bar would too.
  const riskSummaryChips = useMemo(() => {
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    return [
      {
        key: "switching",
        label: "Context switch burden",
        display: `${Math.round(clamp(snapshot.context_switch_score) * 100)}/100`,
        elevated: clamp(snapshot.context_switch_score) >= 0.67,
        tooltip: "Task-switching cost index: 0 = minimal, 100 = very high burden",
      },
      {
        key: "wip",
        label: "WIP overload",
        display: `${Math.round(clamp(snapshot.wip_load_score) * 100)}/100`,
        elevated: clamp(snapshot.wip_load_score) >= 0.67,
        tooltip: "Parallel work-in-progress pressure: 0 = manageable, 100 = critical",
      },
      {
        key: "carryover",
        label: "Carryover risk",
        display: `${Math.round(snapshot.carryover_risk_pct)}%`,
        elevated: clamp(snapshot.carryover_risk_pct / CARRYOVER_SATURATION_PCT) >= 0.67,
        tooltip: isCurrentWeek
          ? "Share of this week's load at risk of slipping into next week"
          : "Share of that week's load at risk of slipping into the following week",
      },
      {
        key: "meetings",
        label: "Meeting density",
        display: `${Math.round(snapshot.meeting_pct)}%`,
        elevated: clamp(snapshot.meeting_pct / MEETING_SATURATION_PCT) >= 0.67,
        tooltip: "Share of your tracked week filled by meetings",
      },
      {
        key: "blockers",
        label: "Active blockers",
        display: `${blockerCount}`,
        elevated: blockerCount > 0,
        tooltip: isCurrentWeek
          ? "Number of work blocks flagged as a blocker this week"
          : "Number of work blocks flagged as a blocker that week",
      },
    ];
  }, [snapshot, blockerCount, isCurrentWeek]);
  const allocatedPct = Math.max(0, Math.min(100, snapshot.allocated_pct));
  const unallocatedPct = Math.max(0, 100 - allocatedPct);

  // Reliable-new-work helper: when committed utilization is already at/over the knee, the model
  // clamps reliable headroom to 0, so "room to the 80% knee" would contradict the 0% value shown.
  const reliableHelper =
    snapshot.committed_utilization_pct >= TARGET_UTILIZATION_PCT
      ? `${pct(snapshot.committed_utilization_pct)} already committed · at or past the ${TARGET_UTILIZATION_PCT}% knee`
      : `${pct(snapshot.committed_utilization_pct)} already committed · room to the ${TARGET_UTILIZATION_PCT}% knee`;

  // Explain what the committed-utilization number (the center of the target-utilization model) is
  // made of. capacity.ts computes it as round(recurring + carryover + reactive*0.72 + frag + wip),
  // where every term EXCEPT reactive is already an integer — so the reactive contribution derived as
  // the remainder equals round(reactive_pct * 0.72) exactly, and the five parts sum to the displayed
  // committed_utilization_pct with zero rounding drift (no capacity.ts change needed). The 0.72
  // reactive discount is the model's least-obvious input, so it gets a plain-language note.
  const committedBreakdown = useMemo(() => {
    const reactiveContribution =
      snapshot.committed_utilization_pct -
      snapshot.recurring_pct -
      snapshot.carryover_risk_pct -
      snapshot.fragmentation_penalty_pct -
      snapshot.wip_penalty_pct;
    const parts = [
      { key: "recurring", label: "Recurring & fixed", value: snapshot.recurring_pct },
      { key: "reactive", label: `Reactive (×${REACTIVE_DISCOUNT_FACTOR})`, value: reactiveContribution },
      { key: "carryover", label: "Carryover risk", value: snapshot.carryover_risk_pct },
      { key: "fragmentation", label: "Fragmentation", value: snapshot.fragmentation_penalty_pct },
      { key: "wip", label: "WIP load", value: snapshot.wip_penalty_pct },
    ].filter((part) => part.value > 0);
    const note =
      reactiveContribution > 0
        ? `Reactive load counts at ${Math.round(REACTIVE_DISCOUNT_FACTOR * 100)}% of face value — interrupted work delivers less sustainable throughput (Mark et al., CHI 2008). The parts add up to your committed utilization.`
        : "The parts add up to your committed utilization.";
    return { parts, note };
  }, [snapshot]);

  // Rolling personal baselines from the weeks strictly before the one in view, so each
  // headline number reads against the user's own norm rather than an absolute scale.
  const baselines = useMemo(() => {
    const prior = snapshotHistory
      .filter((record) => normalizeWeekId(record.week_id) < normalizeWeekId(snapshot.week_id))
      .map((record) => record.snapshot);
    return computeCapacityBaselines(prior);
  }, [snapshotHistory, snapshot.week_id]);

  const baselineChips = useMemo(() => {
    if (baselines.week_count < 2) return [];
    return BASELINE_METRICS.flatMap((metric) => {
      const baseline = baselines[metric.key];
      if (baseline === null) return [];
      const current = Math.round(snapshot[metric.key] * metric.scale);
      const median = Math.round(baseline * metric.scale);
      const delta = current - median;
      const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
      const tone =
        delta === 0
          ? "flat"
          : (delta > 0) === (metric.betterWhen === "higher")
            ? "good"
            : "bad";
      return [{ ...metric, current, median, delta, direction, tone }];
    });
  }, [baselines, snapshot]);

  if (!hasWorkBlocks) {
    return (
      <section className="screen capacity-screen">
        <div className="screen-header">
          <div>
            <p className="eyebrow">Weekly capacity view</p>
            <div className="headline-with-score">
              <h1>{weekRangeLabel}: waiting for real workload signal.</h1>
              <div className="summary-score" title="No capacity estimate yet — confidence appears once work blocks exist">
                <span>Summary confidence</span>
                <strong className="summary-score-empty" aria-hidden>—</strong>
                <span className="sr-only">No capacity estimate yet — confidence appears once work blocks exist</span>
              </div>
            </div>
          </div>
        </div>
        <EmptyState
          icon={BarChart3}
          title="No weekly capacity model yet."
          description="The percentage breakdown will stay blank until local sources create work blocks. Import Outlook calendar events now, then let active-window sessions become the next inference source."
        >
          <button className="primary-action" type="button" onClick={() => onOpenScreen("setup")}>
            <Upload size={16} aria-hidden />
            <span>Import calendar in Settings</span>
          </button>
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="screen capacity-screen">
      <div className="screen-header">
        <div>
          <div className="week-nav">
            <p className="eyebrow">Weekly capacity view</p>
            <div className="week-nav-controls">
              <button
                className="week-nav-chevron"
                type="button"
                onClick={() => setWeekOffset((o) => o - 1)}
                aria-label="Previous week"
                title="Previous week"
              >
                <ChevronLeft size={16} aria-hidden />
              </button>
              <button
                className="week-nav-chevron"
                type="button"
                disabled={isCurrentWeek}
                onClick={() => setWeekOffset((o) => o + 1)}
                aria-label={isCurrentWeek ? "Cannot navigate past current week" : "Next week"}
                title={isCurrentWeek ? "Cannot navigate past current week" : "Next week"}
              >
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          </div>
          <div className="headline-with-score">
            {!isCurrentWeek && viewedBlocks.length === 0 ? (
              <h1>{headlineWeekRangeLabel}: no tracked work.</h1>
            ) : (
              <h1>{headlineWeekRangeLabel}: {pct(snapshot.reliable_new_work_capacity_pct)} reliable capacity {isCurrentWeek ? "for new planned work" : "was open for new planned work"}.</h1>
            )}
            {!isCurrentWeek && viewedBlocks.length === 0 ? (
              <div className="summary-score" title="No capacity estimate for that week — confidence appears once work blocks exist">
                <span>Summary confidence</span>
                <strong className="summary-score-empty" aria-hidden>—</strong>
                <span className="sr-only">No capacity estimate for that week</span>
              </div>
            ) : (
              <div className="summary-score" title={isCurrentWeek ? "How confident the model is in this week's capacity estimate" : "How confident the model is in that week's capacity estimate"}>
                <span>Summary confidence</span>
                <strong>{Math.round(snapshot.summary_confidence * 100)}%</strong>
                <span className="sr-only">{isCurrentWeek ? "How confident the model is in this week's capacity estimate" : "How confident the model is in that week's capacity estimate"}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {(isCurrentWeek || viewedBlocks.length > 0) && (
        <div className="hero-metrics">
          <MetricCard label="Allocated capacity" value={snapshot.allocated_pct} helper={isCurrentWeek ? "Estimated distribution this week" : "Estimated distribution that week"} title="The share of your working week already taken up by tracked work — meetings, planned tasks, and reactive load combined." />
          <MetricCard label="Effective planned work" value={snapshot.planned_pct} helper="Capacity spent on planned work" title="The share of your week spent on work you scheduled ahead of time, rather than reacting to interruptions." />
          <MetricCard label="Reactive load" value={snapshot.reactive_pct} helper="Unplanned support and interruption work" title="The share of your week absorbed by unplanned support, interruptions, and ad-hoc requests you didn't schedule." />
          <MetricCard label="Reliable new work" value={snapshot.reliable_new_work_capacity_pct} helper={reliableHelper} showRing title={`Past ~${TARGET_UTILIZATION_PCT}% utilization, delays grow sharply — we hold back the last ~${100 - TARGET_UTILIZATION_PCT}% as buffer`} />
        </div>
      )}

      {committedBreakdown.parts.length > 0 && (isCurrentWeek || viewedBlocks.length > 0) && (
        <section className="committed-breakdown" aria-label="What makes up your committed load">
          <span className="baseline-chips-label">
            Committed load {pct(snapshot.committed_utilization_pct)} · what it&rsquo;s made of
          </span>
          <div className="baseline-chip-row">
            {committedBreakdown.parts.map((part) => (
              <span key={part.key} className="baseline-chip" title={COMMITTED_PART_GLOSS[part.key]}>
                <span className="baseline-chip-metric">{part.label}</span>
                <span className="baseline-chip-delta">{pct(part.value)}</span>
              </span>
            ))}
          </div>
          <p className="committed-breakdown-note">{committedBreakdown.note}</p>
        </section>
      )}

      {baselineChips.length > 0 && (isCurrentWeek || viewedBlocks.length > 0) && (
        <section className="baseline-chips" aria-label={`Selected week versus your ${baselines.week_count}-week baseline`}>
          <span className="baseline-chips-label">vs your {baselines.week_count}-wk median</span>
          <div className="baseline-chip-row">
            {baselineChips.map((chip) => {
              const Icon = chip.direction === "up" ? ArrowUp : chip.direction === "down" ? ArrowDown : Minus;
              const signed = `${chip.delta > 0 ? "+" : ""}${chip.delta}`;
              return (
                <span
                  key={chip.key}
                  className="baseline-chip"
                  data-tone={chip.tone}
                  title={`${chip.label}: ${chip.current} ${isCurrentWeek ? "this week" : "that week"} vs your ${baselines.week_count}-week median of ${chip.median}`}
                >
                  <span className="baseline-chip-metric">{chip.label}</span>
                  <span className="baseline-chip-delta">
                    <Icon size={12} aria-hidden />
                    {chip.direction === "flat" ? "0" : signed}
                  </span>
                  <span className="sr-only">
                    {chip.direction === "flat"
                      ? `matches your ${baselines.week_count}-week median of ${chip.median}`
                      : `${Math.abs(chip.delta)} ${chip.direction === "up" ? "above" : "below"} your ${baselines.week_count}-week median of ${chip.median} — ${chip.tone === "good" ? "an improvement" : "a regression"}`}
                  </span>
                </span>
              );
            })}
          </div>
        </section>
      )}

      {!isCurrentWeek && viewedBlocks.length === 0 && (
        <EmptyState
          icon={BarChart3}
          title={`No work blocks for ${viewedWeekRangeLabel}.`}
          description="Work blocks are tagged to the week they were classified. Earlier weeks will show data if Outlook imports or classifications were run during that week."
        />
      )}

      {(isCurrentWeek || viewedBlocks.length > 0) && (
      <section className="capacity-section capacity-model">
        <div className="section-title">
          <h2>Weekly baseline coverage</h2>
          <span>standard {WEEKLY_BASELINE_HOURS}-hour baseline</span>
        </div>
        <div className="capacity-coverage-summary">
          <div>
            <strong>{pct(allocatedPct)}</strong>
            <span>allocated · {formatCapacityHours(allocatedPct)} of {WEEKLY_BASELINE_HOURS}h</span>
          </div>
          <div>
            <strong>{pct(unallocatedPct)}</strong>
            <span>not allocated in tracked work</span>
          </div>
        </div>
        <div
          className="capacity-coverage-bar"
          role="img"
          aria-label={`${pct(allocatedPct)} of the standard ${WEEKLY_BASELINE_HOURS}-hour week is allocated; ${pct(unallocatedPct)} is not allocated in tracked work`}
        >
          {allocatedPct > 0 && <span style={{ width: `${allocatedPct}%` }} />}
        </div>
        <p className="capacity-coverage-note">
          <Info size={14} aria-hidden />
          <span>
            <strong>{pct(snapshot.reliable_new_work_capacity_pct)} reliable new-work capacity</strong> after recurring load, carryover, reactive work, and delivery-risk adjustments. Unallocated time is not automatically bookable.
          </span>
        </p>
        <div className="allocation-breakdown-grid">
          <AllocationBreakdown title="Category mix" items={snapshot.category_allocation} colors={categoryColors} />
          <AllocationBreakdown title="Work mode mix" items={snapshot.work_mode_allocation} colors={modeColors} />
        </div>
      </section>
      )}

      {(isCurrentWeek || viewedBlocks.length > 0) && (
      <section className="capacity-section">
        <div className="section-title">
          <h2>Delivery risk modifiers</h2>
          <div className="section-title-side">
            <span>forecast inputs</span>
            <button
              className="risk-toggle"
              type="button"
              aria-expanded={riskExpanded}
              onClick={() => setRiskExpanded((v) => !v)}
            >
              {riskExpanded ? "Hide details" : "Details"}
              {riskExpanded ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
            </button>
          </div>
        </div>
        {!riskExpanded && (
          <div className="baseline-chip-row risk-summary-row" aria-label="Delivery risk modifiers summary">
            {riskSummaryChips.map((chip) => (
              <span
                key={chip.key}
                className="baseline-chip"
                data-tone={chip.elevated ? "bad" : undefined}
                title={chip.tooltip}
              >
                <span className="baseline-chip-metric">{chip.label}</span>
                <span className="baseline-chip-delta">{chip.display}</span>
                {chip.elevated && <span className="sr-only"> — elevated</span>}
              </span>
            ))}
          </div>
        )}
        {riskExpanded && (
          <>
            <p className="risk-scale-note">
              Higher values add more delivery risk to next week — lower is better.
            </p>
            <div className="risk-list">
              <RiskRow
                label="Context switch burden"
                value={snapshot.context_switch_score}
                tooltip="Task-switching cost index: 0 = minimal, 100 = very high burden"
                hint="/100"
                caption={
                  snapshot.fragmentation_penalty_pct > 0
                    ? `Costs ~${pct(snapshot.fragmentation_penalty_pct)} of your committed week`
                    : undefined
                }
              />
              <RiskRow
                label="WIP overload"
                value={snapshot.wip_load_score}
                tooltip="Parallel work-in-progress pressure: 0 = manageable, 100 = critical"
                hint="/100"
                caption={
                  snapshot.wip_penalty_pct > 0
                    ? `Costs ~${pct(snapshot.wip_penalty_pct)} of your committed week`
                    : undefined
                }
              />
              <RiskRow
                label="Carryover risk"
                value={snapshot.carryover_risk_pct / CARRYOVER_SATURATION_PCT}
                displayValue={Math.round(snapshot.carryover_risk_pct)}
                hint="%"
                tooltip={
                  isCurrentWeek
                    ? `Share of this week's load at risk of slipping into next week — the bar saturates at ${CARRYOVER_SATURATION_PCT}% of the week`
                    : `Share of that week's load at risk of slipping into the following week — the bar saturates at ${CARRYOVER_SATURATION_PCT}% of the week`
                }
              />
              <RiskRow
                label="Meeting density"
                value={snapshot.meeting_pct / MEETING_SATURATION_PCT}
                displayValue={Math.round(snapshot.meeting_pct)}
                hint="%"
                tooltip={`Share of your tracked week filled by meetings — the bar saturates at ${MEETING_SATURATION_PCT}% of the week`}
              />
              <RiskRow
                label="Active blockers"
                value={Math.min(blockerCount / 5, 1)}
                displayValue={blockerCount}
                tooltip={isCurrentWeek ? "Number of work blocks flagged as a blocker this week" : "Number of work blocks flagged as a blocker that week"}
                dangerActive={blockerCount > 0}
                caption={
                  snapshot.blocked_pct > 0
                    ? `~${pct(snapshot.blocked_pct)} of the tracked week is sitting in blocked work`
                    : undefined
                }
              />
            </div>
          </>
        )}
      </section>
      )}

      {isCurrentWeek && interruptionLoad && (
        <section className="interruption-note" aria-label="Chat interruption load">
          <div className="interruption-header">
            <Zap size={16} aria-hidden className="interruption-icon" />
            <div>
              <strong>Chat interruption load</strong>
              <p>
                Workplace chat is the reactive signal calendar and git can't see. These
                metadata-only counts (no message text) show how much it fragmented your focus —
                feeding the context-switch burden above.
              </p>
            </div>
          </div>
          <ul className="interruption-stats">
            <li
              className="interruption-stat"
              title={`A reactive burst is a cluster of chat messages within ~${DEFAULT_SESSION_GAP_MINUTES} minutes — counted once per imported chat session`}
            >
              <strong>{interruptionLoad.burst_count}</strong>
              <span>reactive {interruptionLoad.burst_count === 1 ? "burst" : "bursts"}</span>
              <span className="sr-only">
                A reactive burst is a cluster of chat messages within about {DEFAULT_SESSION_GAP_MINUTES} minutes.
              </span>
            </li>
            <li
              className="interruption-stat"
              title="Messages per hour spent in chat bursts this week — interruption intensity while engaged"
            >
              <strong>{interruptionLoad.messages_per_active_hour}/hr</strong>
              <span>messages while active</span>
              <span className="sr-only">
                Messages per hour spent in chat bursts — interruption intensity while engaged.
              </span>
            </li>
            <li
              className="interruption-stat"
              title={
                interruptionLoad.mention_pct > 0
                  ? `${formatCount(interruptionLoad.mention_count)} of ${formatCount(interruptionLoad.message_count)} message${interruptionLoad.message_count === 1 ? "" : "s"} @-mentioned you directly (${interruptionLoad.mention_pct}%) — the sharpest interruption signal`
                  : "Messages that @-mentioned you directly — the sharpest interruption signal"
              }
            >
              <strong>{formatCount(interruptionLoad.mention_count)}</strong>
              <span>direct @-mentions</span>
              <span className="sr-only">
                {interruptionLoad.mention_pct > 0
                  ? `${interruptionLoad.mention_pct}% of this week's ${formatCount(interruptionLoad.message_count)} reactive message${interruptionLoad.message_count === 1 ? "" : "s"} pulled you in by name — the sharpest interruption signal, hardest to batch or defer.`
                  : "Messages that pulled you in by name — the sharpest interruption signal."}
              </span>
            </li>
            <li
              className="interruption-stat"
              title={`${interruptionLoad.interrupted_deep_work_count} of ${interruptionLoad.deep_work_block_count} deep-work block${interruptionLoad.deep_work_block_count === 1 ? "" : "s"} overlapped a chat burst`}
            >
              <strong>{interruptionLoad.interrupted_deep_work_pct}%</strong>
              <span>deep work interrupted</span>
              <span className="sr-only">
                {interruptionLoad.interrupted_deep_work_count} of {interruptionLoad.deep_work_block_count} deep-work block{interruptionLoad.deep_work_block_count === 1 ? "" : "s"} overlapped a chat burst.
              </span>
            </li>
          </ul>
          {interruptionLoad.peak_day && interruptionLoad.active_day_count >= 2 && (
            <p className="interruption-peak-note">
              Reactive load peaked on <strong>{interruptionLoad.peak_day}</strong>
              {interruptionLoad.peak_hour !== null && (
                <> around <strong>{formatHourOfDay(interruptionLoad.peak_hour)}</strong></>
              )}{" "}
              —{" "}
              {formatCount(interruptionLoad.peak_day_message_count)}{" "}
              {interruptionLoad.peak_day_message_count === 1 ? "message" : "messages"} that day, the
              busiest of {interruptionLoad.active_day_count} active days.{" "}
              {interruptionLoad.calm_day && interruptionLoad.calm_day !== interruptionLoad.peak_day ? (
                <>
                  Your quietest active day was <strong>{interruptionLoad.calm_day}</strong> —
                  consider protecting it for deep work.
                </>
              ) : (
                "Consider protecting the quieter days for deep work."
              )}
            </p>
          )}
          {interruptionLoad.concentration_is_clustered && (
            <p className="interruption-peak-note">
              <strong>{interruptionLoad.concentration_pct}%</strong> of your reactive load clustered
              into your busiest {interruptionLoad.concentration_day_count} days — batching it into
              set windows could reclaim focus.
            </p>
          )}
          {interruptionLoad.after_hours_message_count > 0 && (
            <p className="interruption-peak-note">
              <strong>{interruptionLoad.after_hours_pct}%</strong> of reactive messages
              ({formatCount(interruptionLoad.after_hours_message_count)} of {formatCount(interruptionLoad.message_count)})
              arrived outside core hours ({formatHourOfDay(CORE_HOURS_START)}–{formatHourOfDay(CORE_HOURS_END)}) — chat bleeding into personal time.
            </p>
          )}
        </section>
      )}

      {isCurrentWeek && chatStakeholders && chatStakeholders.groups.length > 0 && (
        <section
          className="baseline-chips stakeholder-chips"
          aria-label="Who your reactive chat time served this week"
        >
          <span className="baseline-chips-label">Who your reactive time served</span>
          <div className="baseline-chip-row">
            {chatStakeholders.groups.map((group) => (
              <span
                key={group.label}
                className="baseline-chip"
                title={`${group.label}: ${group.share_pct}% of this week's reactive chat volume, across ${group.burst_count} ${group.burst_count === 1 ? "burst" : "bursts"}`}
              >
                <span className="baseline-chip-metric">{group.label}</span>
                <span className="baseline-chip-delta">{group.share_pct}%</span>
                <span className="sr-only">
                  {group.share_pct}% of this week's reactive chat volume, across {group.burst_count} {group.burst_count === 1 ? "burst" : "bursts"}
                </span>
              </span>
            ))}
          </div>
          {chatStakeholders.group_count > chatStakeholders.groups.length && (
            <span className="stakeholder-chips-note">
              Top {chatStakeholders.groups.length} of {chatStakeholders.group_count} groups by reactive
              volume — {chatStakeholders.group_count - chatStakeholders.groups.length} more not shown.
            </span>
          )}
        </section>
      )}
    </section>
  );
}
