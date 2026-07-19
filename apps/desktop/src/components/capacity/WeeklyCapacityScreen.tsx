import { useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  Focus,
  Info,
  Lightbulb,
  MessageSquareText,
  Minus,
  Plus,
  Upload,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WorkBlock, WorkCategory, WorkMode } from "../../../../../packages/domain/src/models";
import type { Screen } from "../../lib/types";
import type { PersistedSnapshotRecord } from "../../services/localStore";
import {
  computeCapacityBaselines,
  computeWeeklyCapacitySnapshot,
  CORE_HOURS_END,
  CORE_HOURS_START,
  normalizeWeekId,
  REACTIVE_DISCOUNT_FACTOR,
} from "../../../../../packages/inference/src/capacity";
import type {
  ChatStakeholderSummary,
  InterruptionLoadAnalysis,
} from "../../../../../packages/inference/src/capacity";
import { categoryColors } from "../../../../../packages/domain/src/taxonomy";
import { WEEKLY_BASELINE_HOURS } from "../../../../../packages/integrations/src/internal/normalize";
import { formatCount, formatHourOfDay, pct } from "../../lib/format";
import { RiskRow } from "../common/RiskRow";
import { CapacitySignalGraphic } from "./CapacitySignalGraphic";

const BASELINE_METRICS: Array<{
  key: "reliable_new_work_capacity_pct" | "reactive_pct" | "meeting_pct" | "context_switch_score";
  label: string;
  scale: number;
  betterWhen: "higher" | "lower";
}> = [
  { key: "reliable_new_work_capacity_pct", label: "New work capacity", scale: 1, betterWhen: "higher" },
  { key: "reactive_pct", label: "Reactive work", scale: 1, betterWhen: "lower" },
  { key: "meeting_pct", label: "Meeting time", scale: 1, betterWhen: "lower" },
  { key: "context_switch_score", label: "Context switching", scale: 100, betterWhen: "lower" },
];

const COMMITTED_PART_GLOSS: Record<string, string> = {
  recurring: "Standing meetings, recurring reports, and other fixed work.",
  reactive: `Unplanned work, counted at ${Math.round(REACTIVE_DISCOUNT_FACTOR * 100)}% because interruptions reduce sustainable throughput.`,
  carryover: "Unfinished work likely to spill into next week.",
  fragmentation: "Capacity lost to short, scattered work blocks and context switching.",
  wip: "Extra load from keeping too many projects moving at once.",
};

const CATEGORY_LABELS: Partial<Record<WorkCategory, string>> = {
  "Planned analysis / project work": "Analysis & project work",
  "Ad hoc stakeholder requests": "Stakeholder requests",
  "Dashboard development / edits": "Dashboards & edits",
  "SQL / data modeling / query work": "SQL & data modeling",
  "QA / data validation": "QA & data validation",
  "Debugging / issue investigation": "Debugging & investigation",
  "Documentation / requirement clarification": "Docs & requirements",
  "Meetings / stakeholder syncs": "Meetings & stakeholder syncs",
  "Admin / coordination": "Admin & coordination",
  "Blocked / waiting / dependency delay": "Blocked & waiting",
};

const MODE_VISUALS: Record<WorkMode, { label: string; color: string }> = {
  "Deep work": { label: "Deep work", color: "var(--week-blue)" },
  Reactive: { label: "Reactive", color: "var(--week-orange)" },
  Collaborative: { label: "Collaborative", color: "var(--week-green)" },
  Fragmented: { label: "Fragmented", color: "var(--week-purple)" },
  Blocked: { label: "Blocked / other", color: "var(--week-gray)" },
};

const MODE_DESCRIPTIONS: Record<WorkMode, string> = {
  "Deep work": "Longer focus blocks with fewer interruptions.",
  Reactive: "Unplanned support and requests handled as they arrived.",
  Collaborative: "Meetings and work completed with other people.",
  Fragmented: "Shorter work blocks split by task switching.",
  Blocked: "Time delayed by dependencies, waiting, or other constraints.",
};

type CoveragePartKey = "committed" | "available" | "protected";

const CARRYOVER_SATURATION_PCT = 40;
const MEETING_SATURATION_PCT = 35;

function clampPct(value: number) {
  return Math.max(0, Math.min(100, value));
}

function formatCapacityHours(value: number) {
  const hours = (value / 100) * WEEKLY_BASELINE_HOURS;
  if (hours > 0 && hours < 1) return `${Math.round(hours * 60)}m`;
  return `${Number(hours.toFixed(1))}h`;
}

function displayCategory(category: WorkCategory) {
  return CATEGORY_LABELS[category] ?? category;
}

function WeekVisualTooltip({
  id,
  visible,
  title,
  value,
  detail,
  className = "",
  style,
}: {
  id: string;
  visible: boolean;
  title: string;
  value: string;
  detail: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`week-dashboard-visual-tooltip ${visible ? "is-visible" : ""} ${className}`.trim()}
      id={id}
      role="tooltip"
      aria-hidden={!visible}
      style={style}
    >
      <div>
        <strong>{title}</strong>
        <span>{value}</span>
      </div>
      <p>{detail}</p>
    </div>
  );
}

function AvailabilityGauge({ value }: { value: number }) {
  const size = 154;
  const center = size / 2;
  const radius = 61;
  const circumference = 2 * Math.PI * radius;
  const normalized = clampPct(value);

  return (
    <div
      className="week-dashboard-gauge"
      role="img"
      aria-label={`${pct(normalized)} capacity available for new planned work`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id="week-capacity-gauge-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="week-gauge-gradient-start" />
            <stop offset="1" className="week-gauge-gradient-end" />
          </linearGradient>
        </defs>
        <circle
          className="week-dashboard-gauge-track"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth="13"
        />
        <circle
          className="week-dashboard-gauge-fill"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="url(#week-capacity-gauge-gradient)"
          strokeWidth="13"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - normalized / 100)}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      <div className="week-dashboard-gauge-label" aria-hidden="true">
        <strong>{pct(normalized)}</strong>
        <span>available</span>
      </div>
    </div>
  );
}

function WeekMetricCard({
  icon: Icon,
  label,
  value,
  helper,
  tone,
  title,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  helper: string;
  tone: "blue" | "purple" | "orange" | "green";
  title: string;
}) {
  return (
    <article className="week-dashboard-metric" data-tone={tone} title={title}>
      <div className="week-dashboard-metric-heading">
        <span className="week-dashboard-metric-icon">
          <Icon size={19} aria-hidden="true" />
        </span>
        <div>
          <span>{label}</span>
          <strong>{pct(value)}</strong>
        </div>
      </div>
      <div className="week-dashboard-metric-track" aria-hidden="true">
        <span style={{ width: `${clampPct(value)}%` }} />
      </div>
      <p>{helper}</p>
      <span className="sr-only">{title}</span>
    </article>
  );
}

function TimeSpentDonut({ items }: { items: Array<{ label: WorkMode; value: number }> }) {
  const [hoveredMode, setHoveredMode] = useState<WorkMode | null>(null);
  const [focusedMode, setFocusedMode] = useState<WorkMode | null>(null);
  const tooltipId = `week-time-tooltip-${useId().replace(/:/g, "")}`;
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const segments = items.map((item) => {
    const share = total > 0 ? (item.value / total) * 100 : 0;
    const segment = { ...item, share, start: cursor };
    cursor += share;
    return segment;
  });
  const activeMode = hoveredMode ?? focusedMode;
  const activeItem = segments.find((item) => item.label === activeMode) ?? null;
  const chartLabel = segments
    .map((item) => `${MODE_VISUALS[item.label].label}, ${Math.round(item.share)}%`)
    .join("; ");

  const clearMode = (mode: WorkMode, source: "hover" | "focus") => {
    if (source === "hover") {
      setHoveredMode((current) => (current === mode ? null : current));
    } else {
      setFocusedMode((current) => (current === mode ? null : current));
    }
  };

  return (
    <div className={`week-dashboard-time-layout ${activeMode ? "has-active" : ""}`}>
      <div className="week-dashboard-donut-shell">
        <div className="week-dashboard-donut">
          <svg
            className="week-dashboard-donut-svg"
            viewBox="0 0 160 160"
            role="group"
            aria-label={`Tracked time by work mode: ${chartLabel || "no tracked time"}`}
          >
            <circle className="week-dashboard-donut-track" cx="80" cy="80" r="58" pathLength="100" aria-hidden="true" />
            {segments.map((item, index) => {
              const gap = segments.length > 1 ? Math.min(1.2, item.share * 0.16) : 0;
              const visibleShare = Math.min(item.share, Math.max(0.35, item.share - gap));
              const isActive = activeMode === item.label;
              const isMuted = activeMode !== null && !isActive;
              return (
                <circle
                  key={item.label}
                  className={`week-dashboard-donut-segment ${isActive ? "is-active" : ""} ${isMuted ? "is-muted" : ""}`.trim()}
                  cx="80"
                  cy="80"
                  r="58"
                  pathLength="100"
                  stroke={MODE_VISUALS[item.label].color}
                  strokeDasharray={`${visibleShare} ${100 - visibleShare}`}
                  strokeDashoffset={-item.start}
                  style={{ animationDelay: `${70 + index * 45}ms` }}
                  role="img"
                  tabIndex={0}
                  aria-label={`${MODE_VISUALS[item.label].label}: ${formatCapacityHours(item.value)}, ${Math.round(item.share)}% of tracked time. ${MODE_DESCRIPTIONS[item.label]}`}
                  aria-describedby={isActive ? tooltipId : undefined}
                  transform="rotate(-90 80 80)"
                  onMouseEnter={() => setHoveredMode(item.label)}
                  onMouseLeave={() => clearMode(item.label, "hover")}
                  onFocus={() => setFocusedMode(item.label)}
                  onBlur={() => clearMode(item.label, "focus")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setHoveredMode(null);
                      setFocusedMode(null);
                      event.currentTarget.blur();
                    }
                  }}
                />
              );
            })}
          </svg>
          <div className="week-dashboard-donut-center" aria-hidden="true">
            <strong>{activeItem ? formatCapacityHours(activeItem.value) : formatCapacityHours(total)}</strong>
            <span>{activeItem ? MODE_VISUALS[activeItem.label].label : "tracked"}</span>
          </div>
        </div>
      </div>

      <ul className="week-dashboard-time-legend">
        {segments.map((item) => {
          const share = Math.round(item.share);
          const visual = MODE_VISUALS[item.label];
          const isActive = activeMode === item.label;
          const isMuted = activeMode !== null && !isActive;
          return (
            <li key={item.label}>
              <button
                type="button"
                className={`${isActive ? "is-active" : ""} ${isMuted ? "is-muted" : ""}`.trim()}
                aria-label={`${visual.label}: ${formatCapacityHours(item.value)}, ${share}% of tracked time. ${MODE_DESCRIPTIONS[item.label]}`}
                aria-describedby={isActive ? tooltipId : undefined}
                onMouseEnter={() => setHoveredMode(item.label)}
                onMouseLeave={() => clearMode(item.label, "hover")}
                onFocus={() => setFocusedMode(item.label)}
                onBlur={() => clearMode(item.label, "focus")}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setHoveredMode(null);
                    setFocusedMode(null);
                    event.currentTarget.blur();
                  }
                }}
              >
                <span className="week-dashboard-time-label">
                  <span className="dot" style={{ background: visual.color }} />
                  {visual.label}
                </span>
                <strong>{formatCapacityHours(item.value)}</strong>
                <span>{share}%</span>
              </button>
            </li>
          );
        })}
      </ul>

      <WeekVisualTooltip
        id={tooltipId}
        visible={activeItem !== null}
        title={activeItem ? MODE_VISUALS[activeItem.label].label : "Tracked time"}
        value={activeItem ? `${formatCapacityHours(activeItem.value)} · ${Math.round(activeItem.share)}%` : ""}
        detail={activeItem ? MODE_DESCRIPTIONS[activeItem.label] : "How tracked work was distributed."}
        className="week-dashboard-time-tooltip"
      />
    </div>
  );
}

export function WeeklyCapacityScreen({
  snapshot,
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
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [hoveredCoverage, setHoveredCoverage] = useState<CoveragePartKey | null>(null);
  const [focusedCoverage, setFocusedCoverage] = useState<CoveragePartKey | null>(null);
  const [hoveredCategory, setHoveredCategory] = useState<WorkCategory | null>(null);
  const [focusedCategory, setFocusedCategory] = useState<WorkCategory | null>(null);
  const coverageTooltipId = `week-coverage-tooltip-${useId().replace(/:/g, "")}`;
  const categoryTooltipId = `week-category-tooltip-${useId().replace(/:/g, "")}`;
  const viewedBlocks = useMemo(
    () => blocks.filter((block) => normalizeWeekId(block.week_id) === normalizeWeekId(snapshot.week_id)),
    [blocks, snapshot.week_id]
  );
  const hasCurrentWeekSignal = viewedBlocks.length > 0;
  const blockerCount = useMemo(
    () => viewedBlocks.filter((block) => block.blocker_flag).length,
    [viewedBlocks]
  );

  const committedBreakdown = useMemo(() => {
    const reactiveContribution =
      snapshot.committed_utilization_pct -
      snapshot.recurring_pct -
      snapshot.carryover_risk_pct -
      snapshot.fragmentation_penalty_pct -
      snapshot.wip_penalty_pct;
    const parts = [
      { key: "recurring", label: "Recurring & fixed", value: snapshot.recurring_pct },
      { key: "reactive", label: "Reactive work", value: reactiveContribution },
      { key: "carryover", label: "Carryover risk", value: snapshot.carryover_risk_pct },
      { key: "fragmentation", label: "Context switching", value: snapshot.fragmentation_penalty_pct },
      { key: "wip", label: "Too much parallel work", value: snapshot.wip_penalty_pct },
    ].filter((part) => part.value > 0);
    return { parts, reactiveContribution };
  }, [snapshot]);

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

  const reliableBaseline = baselineChips.find(
    (chip) => chip.key === "reliable_new_work_capacity_pct"
  );
  const reliableCapacity = Math.round(snapshot.reliable_new_work_capacity_pct);
  const committed = Math.round(snapshot.committed_utilization_pct);
  const guidance =
    reliableCapacity >= 30
      ? "There is room for another focused commitment while keeping a healthy delivery buffer."
      : reliableCapacity >= 15
        ? "You’re in a good range—keep new commitments focused to protect delivery."
        : reliableCapacity > 0
          ? "Capacity is tight—keep additional commitments small until some load clears."
          : "Let existing work clear before committing to more planned work.";

  const recentComparison = reliableBaseline
    ? reliableBaseline.delta === 0
      ? `In line with your recent ${baselines.week_count}-week median`
      : `${Math.abs(reliableBaseline.delta)} pts ${reliableBaseline.delta > 0 ? "above" : "below"} your recent ${baselines.week_count}-week median`
    : null;

  const categoryItems = useMemo(
    () => [...snapshot.category_allocation].sort((left, right) => right.value - left.value),
    [snapshot.category_allocation]
  );
  const visibleCategories = showAllCategories ? categoryItems : categoryItems.slice(0, 5);
  const maxCategoryValue = Math.max(...categoryItems.map((item) => item.value), 1);
  const allocatedCategoryTotal = categoryItems.reduce((sum, item) => sum + item.value, 0);
  const modeItems = useMemo(
    () => snapshot.work_mode_allocation.filter((item) => item.value > 0),
    [snapshot.work_mode_allocation]
  );

  const committedWidth = clampPct(snapshot.committed_utilization_pct);
  const availableWidth = Math.min(
    clampPct(snapshot.reliable_new_work_capacity_pct),
    Math.max(0, 100 - committedWidth)
  );
  // An untracked week renders an empty coverage track rather than a full
  // "protected buffer", which would misread as a real allocation.
  const protectedWidth =
    !hasWorkBlocks || viewedBlocks.length === 0
      ? 0
      : Math.max(0, 100 - committedWidth - availableWidth);
  const coverageParts: Array<{
    key: CoveragePartKey;
    label: string;
    width: number;
    center: number;
    detail: string;
  }> = [
    {
      key: "committed",
      label: "Committed",
      width: committedWidth,
      center: committedWidth / 2,
      detail: "Work and delivery risk already carried by this week.",
    },
    {
      key: "available",
      label: "Available",
      width: availableWidth,
      center: committedWidth + availableWidth / 2,
      detail: "Dependable room remaining for new planned work.",
    },
    {
      key: "protected",
      label: "Protected buffer",
      width: protectedWidth,
      center: committedWidth + availableWidth + protectedWidth / 2,
      detail: "Room held back to absorb delivery risk and keep plans realistic.",
    },
  ];
  const activeCoverage = hoveredCoverage ?? focusedCoverage;
  const activeCoveragePart = coverageParts.find((part) => part.key === activeCoverage) ?? null;
  const activeCategory = hoveredCategory ?? focusedCategory;

  const clearCoveragePart = (key: CoveragePartKey, source: "hover" | "focus") => {
    if (source === "hover") {
      setHoveredCoverage((current) => (current === key ? null : current));
    } else {
      setFocusedCoverage((current) => (current === key ? null : current));
    }
  };

  const clearCategory = (category: WorkCategory, source: "hover" | "focus") => {
    if (source === "hover") {
      setHoveredCategory((current) => (current === category ? null : current));
    } else {
      setFocusedCategory((current) => (current === category ? null : current));
    }
  };

  const focusTip = useMemo(() => {
    if (!hasWorkBlocks || viewedBlocks.length === 0) {
      return {
        title: "Add your first workload signal",
        detail: "Enable tracking or import a calendar, then review the resulting work blocks to build this week's picture.",
      };
    }
    if (blockerCount > 0) {
      return {
        title: blockerCount === 1 ? "Clear the active blocker" : "Clear active blockers",
        detail: "Resolving blocked work is the fastest way to reduce carryover risk.",
      };
    }
    if (snapshot.context_switch_score >= 0.3) {
      return {
        title: "Protect more deep-work time",
        detail: "Batch meetings and reactive requests to preserve longer focus blocks.",
      };
    }
    if (snapshot.reactive_pct >= 25) {
      return {
        title: "Batch reactive requests",
        detail: "Create set response windows so unplanned work interrupts less of the week.",
      };
    }
    return {
      title: "Keep the delivery buffer intact",
      detail: "Use available capacity for one focused commitment instead of several small ones.",
    };
  }, [hasWorkBlocks, viewedBlocks.length, blockerCount, snapshot.context_switch_score, snapshot.reactive_pct]);

  // With no reviewed work blocks this week the dashboard still renders its full
  // layout — gauge, metrics, coverage, and time breakdown all at zero — so the
  // user always sees what the screen will become. Copy and the primary action
  // adapt instead of swapping the layout out for a bare empty state.
  const isEmptyWeek = !hasWorkBlocks || !hasCurrentWeekSignal;
  const hasHistoricalSignal = hasWorkBlocks && !hasCurrentWeekSignal;

  return (
    <section className="screen capacity-screen capacity-dashboard">
      <div className="screen-header capacity-dashboard-header">
        <p className="eyebrow">Weekly capacity</p>
      </div>

      <section className="week-dashboard-hero" aria-labelledby="week-capacity-headline">
        <AvailabilityGauge value={isEmptyWeek ? 0 : snapshot.reliable_new_work_capacity_pct} />
        <div className="week-dashboard-hero-copy">
          {isEmptyWeek ? (
            <>
              <h1 id="week-capacity-headline">
                {hasHistoricalSignal
                  ? "No tracked work this week yet."
                  : "Your weekly capacity picture builds here."}
              </h1>
              <p>
                {hasHistoricalSignal
                  ? `${weekRangeLabel} fills in as current sessions become reviewed work blocks — the gauge, commitments, and time breakdown below update with every review.`
                  : "Once activity is tracked or a calendar is imported and reviewed into work blocks, this dashboard shows what's committed, how much dependable room remains, and where the week's time went."}
              </p>
              <button
                className="primary-action week-dashboard-hero-action"
                type="button"
                onClick={() => onOpenScreen(hasHistoricalSignal ? "ledger" : "setup")}
              >
                {hasHistoricalSignal ? <Focus size={16} aria-hidden /> : <Upload size={16} aria-hidden />}
                <span>{hasHistoricalSignal ? "Classify current activity" : "Import calendar in Settings"}</span>
              </button>
            </>
          ) : (
            <>
              <h1 id="week-capacity-headline">
                You have {pct(snapshot.reliable_new_work_capacity_pct)} capacity for new planned work.
              </h1>
              <p>
                {pct(snapshot.committed_utilization_pct)} of the week is already committed. {guidance}
              </p>
              {recentComparison && (
                <span className="week-dashboard-comparison" data-tone={reliableBaseline?.tone}>
                  {recentComparison}
                </span>
              )}
            </>
          )}
        </div>
        <CapacitySignalGraphic
          available={snapshot.reliable_new_work_capacity_pct}
          committed={snapshot.committed_utilization_pct}
        />
      </section>

      <section className="week-dashboard-metrics" aria-labelledby="week-summary-heading">
        <h2 id="week-summary-heading" className="sr-only">Capacity summary</h2>
        <WeekMetricCard
          icon={CalendarDays}
          label="Committed"
          value={snapshot.committed_utilization_pct}
          helper="Work and risk already carried by the week"
          tone="blue"
          title="Recurring work, carryover, reactive demand, and delivery-risk adjustments already committed this week."
        />
        <WeekMetricCard
          icon={Focus}
          label="Planned work"
          value={snapshot.planned_pct}
          helper="Work scheduled ahead of time"
          tone="purple"
          title="The share of the week spent on work scheduled ahead of time. Planned work may still be collaborative or fragmented."
        />
        <WeekMetricCard
          icon={MessageSquareText}
          label="Reactive work"
          value={snapshot.reactive_pct}
          helper="Unplanned requests and interruption time"
          tone="orange"
          title="The share of the week absorbed by unplanned support, interruptions, and ad-hoc requests."
        />
        <WeekMetricCard
          icon={Plus}
          label="New work capacity"
          value={snapshot.reliable_new_work_capacity_pct}
          helper="Dependable room for new planned work"
          tone="green"
          title="Capacity that can absorb new planned work while preserving the model’s delivery buffer."
        />
      </section>

      <div className="week-dashboard-main-grid">
        <section className="week-dashboard-panel week-dashboard-coverage" aria-labelledby="week-coverage-heading">
          <div className="week-dashboard-panel-heading">
            <div>
              <h2 id="week-coverage-heading">Commitment and headroom</h2>
              <span>Committed load and dependable room within a standard {WEEKLY_BASELINE_HOURS}-hour week</span>
            </div>
          </div>

          <div className="week-dashboard-coverage-labels">
            <strong>{pct(committedWidth)} committed</strong>
            <strong>{pct(availableWidth)} available</strong>
          </div>
          <div
            className="week-dashboard-coverage-visual"
            role="group"
            aria-label={`${pct(committedWidth)} committed, ${pct(availableWidth)} available for new planned work, and ${pct(protectedWidth)} protected as delivery buffer`}
          >
            <div className={`week-dashboard-coverage-bar ${activeCoverage ? "has-active" : ""}`}>
              {coverageParts.map((part, index) => {
                if (part.width <= 0) return null;
                const isActive = activeCoverage === part.key;
                const isMuted = activeCoverage !== null && !isActive;
                return (
                  <span
                    key={part.key}
                    className={`is-${part.key} ${isActive ? "is-active" : ""} ${isMuted ? "is-muted" : ""}`.trim()}
                    style={{ width: `${part.width}%`, animationDelay: `${45 + index * 45}ms` }}
                    role="img"
                    tabIndex={0}
                    aria-label={`${part.label}: ${pct(part.width)} of the standard work week. ${part.detail}`}
                    aria-describedby={isActive ? coverageTooltipId : undefined}
                    onMouseEnter={() => setHoveredCoverage(part.key)}
                    onMouseLeave={() => clearCoveragePart(part.key, "hover")}
                    onFocus={() => setFocusedCoverage(part.key)}
                    onBlur={() => clearCoveragePart(part.key, "focus")}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setHoveredCoverage(null);
                        setFocusedCoverage(null);
                        event.currentTarget.blur();
                      }
                    }}
                  />
                );
              })}
            </div>
            <WeekVisualTooltip
              id={coverageTooltipId}
              visible={activeCoveragePart !== null}
              title={activeCoveragePart?.label ?? "Weekly capacity"}
              value={activeCoveragePart ? `${pct(activeCoveragePart.width)} · ${formatCapacityHours(activeCoveragePart.width)}` : ""}
              detail={activeCoveragePart?.detail ?? "How the standard work week is allocated."}
              className="week-dashboard-coverage-tooltip"
              style={{
                left: `clamp(112px, ${activeCoveragePart?.center ?? 50}%, calc(100% - 112px))`,
              }}
            />
          </div>
          <div className="week-dashboard-coverage-legend" aria-hidden="true">
            {coverageParts.map((part) => (
              <span
                key={part.key}
                className={activeCoverage === part.key ? "is-active" : ""}
                onMouseEnter={() => setHoveredCoverage(part.key)}
                onMouseLeave={() => clearCoveragePart(part.key, "hover")}
              >
                <i className={`is-${part.key}`} />{part.label}
              </span>
            ))}
          </div>
          <p className="week-dashboard-coverage-note">
            Available capacity already accounts for recurring work, interruptions, carryover, and delivery risk.
          </p>

          <div className="week-dashboard-category-section">
            <div className="week-dashboard-category-heading">
              <div>
                <h3>Top categories</h3>
                <span>Share of tracked work</span>
              </div>
              {categoryItems.length > 5 && (
                <button
                  type="button"
                  aria-expanded={showAllCategories}
                  aria-controls="week-category-list"
                  onClick={() => {
                    setHoveredCategory(null);
                    setFocusedCategory(null);
                    setShowAllCategories((current) => !current);
                  }}
                >
                  {showAllCategories ? "Show top 5" : "View all"}
                </button>
              )}
            </div>
            {categoryItems.length === 0 && (
              <p className="week-dashboard-empty-note">
                Top categories appear here once this week has reviewed work blocks.
              </p>
            )}
            <ul className="week-dashboard-category-list" id="week-category-list">
              {visibleCategories.map((item, index) => {
                const allocatedShare = Math.round((item.value / Math.max(allocatedCategoryTotal, 1)) * 100);
                const isActive = activeCategory === item.label;
                const tooltipId = `${categoryTooltipId}-${index}`;
                return (
                  <li key={item.label}>
                    <div
                      className={`week-dashboard-category-item ${isActive ? "is-active" : ""}`}
                      role="img"
                      tabIndex={0}
                      aria-label={`${displayCategory(item.label)}: ${formatCapacityHours(item.value)}, ${allocatedShare}% of tracked work`}
                      aria-describedby={isActive ? tooltipId : undefined}
                      onMouseEnter={() => setHoveredCategory(item.label)}
                      onMouseLeave={() => clearCategory(item.label, "hover")}
                      onFocus={() => setFocusedCategory(item.label)}
                      onBlur={() => clearCategory(item.label, "focus")}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setHoveredCategory(null);
                          setFocusedCategory(null);
                          event.currentTarget.blur();
                        }
                      }}
                    >
                      <span className="week-dashboard-category-label">
                        <span className="dot" style={{ background: categoryColors[item.label] }} />
                        <span>{displayCategory(item.label)}</span>
                      </span>
                      <span className="week-dashboard-category-track" aria-hidden="true">
                        <span
                          style={{
                            width: `${(item.value / maxCategoryValue) * 100}%`,
                            background: categoryColors[item.label],
                            animationDelay: `${110 + index * 45}ms`,
                          }}
                        />
                      </span>
                      <strong>{formatCapacityHours(item.value)}</strong>
                      <span>{allocatedShare}%</span>
                    </div>
                    <WeekVisualTooltip
                      id={tooltipId}
                      visible={isActive}
                      title={displayCategory(item.label)}
                      value={`${formatCapacityHours(item.value)} · ${allocatedShare}%`}
                      detail="Share of the work already tracked this week."
                      className="week-dashboard-category-tooltip"
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="week-dashboard-panel week-dashboard-time" aria-labelledby="week-time-heading">
          <div className="week-dashboard-panel-heading">
            <div>
              <h2 id="week-time-heading">How tracked time is spent</h2>
              <span>Work modes within the time already allocated</span>
            </div>
          </div>
          <TimeSpentDonut items={modeItems} />
          {modeItems.length === 0 && (
            <p className="week-dashboard-empty-note">
              The work-mode breakdown fills in as tracked time accumulates — deep work, meetings,
              reactive requests, and more.
            </p>
          )}
          <div className="week-dashboard-tip">
            <span><Lightbulb size={17} aria-hidden="true" /></span>
            <div>
              <strong>Tip: {focusTip.title}</strong>
              <p>{focusTip.detail}</p>
            </div>
          </div>
        </section>
      </div>

      <details className="week-dashboard-explainability">
        <summary>
          <span className="week-dashboard-explainability-icon"><Info size={17} aria-hidden="true" /></span>
          <span>
            <strong>How this estimate is built</strong>
            <small>Review commitments, recent comparisons, and delivery-risk signals</small>
          </span>
          <ChevronDown className="week-dashboard-explainability-chevron" size={17} aria-hidden="true" />
        </summary>
        <div className="week-dashboard-explainability-body">
          {baselineChips.length > 0 && (
            <section className="week-dashboard-baselines" aria-labelledby="week-baselines-heading">
              <div className="week-dashboard-detail-heading">
                <h3 id="week-baselines-heading">Compared with your recent {baselines.week_count}-week median</h3>
                <span>Personal context, not a generic benchmark</span>
              </div>
              <div className="week-dashboard-baseline-list">
                {baselineChips.map((chip) => {
                  const Icon = chip.direction === "up" ? ArrowUp : chip.direction === "down" ? ArrowDown : Minus;
                  return (
                    <span key={chip.key} data-tone={chip.tone}>
                      <span>{chip.label}</span>
                      <strong><Icon size={12} aria-hidden="true" />{chip.delta > 0 ? "+" : ""}{chip.delta}</strong>
                      <small>median {chip.median}</small>
                    </span>
                  );
                })}
              </div>
            </section>
          )}

          <div className="week-dashboard-detail-grid">
            <section className="week-dashboard-detail-group" aria-labelledby="week-committed-heading">
              <div className="week-dashboard-detail-heading">
                <h3 id="week-committed-heading">What makes up the {pct(snapshot.committed_utilization_pct)} committed load</h3>
                <span>These parts add up to the committed estimate</span>
              </div>
              {committedBreakdown.parts.length === 0 && (
                <p className="week-dashboard-empty-note">
                  Nothing is committed yet — recurring work, reactive demand, and delivery-risk
                  adjustments appear here as the week is tracked.
                </p>
              )}
              <ul className="week-dashboard-detail-list">
                {committedBreakdown.parts.map((part) => (
                  <li key={part.key}>
                    <span>
                      <span>{part.label}</span>
                      <small>{COMMITTED_PART_GLOSS[part.key]}</small>
                    </span>
                    <strong>{pct(part.value)}</strong>
                  </li>
                ))}
              </ul>
              {committedBreakdown.reactiveContribution > 0 && (
                <p>
                  Reactive work counts at {Math.round(REACTIVE_DISCOUNT_FACTOR * 100)}% of face value because interrupted work delivers less sustainable throughput.
                </p>
              )}
            </section>

            <section className="week-dashboard-detail-group" aria-labelledby="week-risk-heading">
              <div className="week-dashboard-detail-heading">
                <h3 id="week-risk-heading">Delivery-risk signals</h3>
                <span>Lower is better</span>
              </div>
              <div className="risk-list">
                <RiskRow
                  label="Context switching"
                  value={snapshot.context_switch_score}
                  tooltip="Task-switching cost index: 0 = minimal, 100 = very high burden"
                  hint="/100"
                  caption={snapshot.fragmentation_penalty_pct > 0 ? `Costs about ${pct(snapshot.fragmentation_penalty_pct)} of the committed week` : undefined}
                />
                <RiskRow
                  label="Too much parallel work"
                  value={snapshot.wip_load_score}
                  tooltip="Pressure from keeping several projects in progress at once"
                  hint="/100"
                  caption={snapshot.wip_penalty_pct > 0 ? `Costs about ${pct(snapshot.wip_penalty_pct)} of the committed week` : undefined}
                />
                <RiskRow
                  label="Carryover risk"
                  value={snapshot.carryover_risk_pct / CARRYOVER_SATURATION_PCT}
                  displayValue={Math.round(snapshot.carryover_risk_pct)}
                  hint="%"
                  tooltip="Share of this week’s load at risk of slipping into next week"
                />
                <RiskRow
                  label="Meeting time"
                  value={snapshot.meeting_pct / MEETING_SATURATION_PCT}
                  displayValue={Math.round(snapshot.meeting_pct)}
                  hint="%"
                  tooltip="Share of the tracked week filled by meetings"
                />
                <RiskRow
                  label="Active blockers"
                  value={Math.min(blockerCount / 5, 1)}
                  displayValue={blockerCount}
                  tooltip="Number of work blocks flagged as blocked this week"
                  dangerActive={blockerCount > 0}
                  caption={snapshot.blocked_pct > 0 ? `${pct(snapshot.blocked_pct)} of the week is in blocked work` : undefined}
                />
              </div>
            </section>
          </div>

          {interruptionLoad && (
            <section className="week-dashboard-interruptions" aria-labelledby="week-interruptions-heading">
              <div className="week-dashboard-detail-heading">
                <h3 id="week-interruptions-heading"><Zap size={15} aria-hidden="true" />Chat interruption signals</h3>
                <span>Metadata only—never message text</span>
              </div>
              <ul>
                <li><strong>{interruptionLoad.burst_count}</strong><span>reactive bursts</span></li>
                <li><strong>{interruptionLoad.messages_per_active_hour}/hr</strong><span>messages while active</span></li>
                <li><strong>{formatCount(interruptionLoad.mention_count)}</strong><span>direct @-mentions</span></li>
                <li><strong>{interruptionLoad.interrupted_deep_work_pct}%</strong><span>deep work interrupted</span></li>
              </ul>
              {interruptionLoad.peak_day && interruptionLoad.active_day_count >= 2 && (
                <p>
                  Reactive load peaked on <strong>{interruptionLoad.peak_day}</strong>
                  {interruptionLoad.peak_hour !== null && <> around <strong>{formatHourOfDay(interruptionLoad.peak_hour)}</strong></>}.
                  {interruptionLoad.calm_day && interruptionLoad.calm_day !== interruptionLoad.peak_day && (
                    <> Your quietest active day was <strong>{interruptionLoad.calm_day}</strong>—a good candidate for protected focus time.</>
                  )}
                </p>
              )}
              {interruptionLoad.after_hours_message_count > 0 && (
                <p>
                  <strong>{interruptionLoad.after_hours_pct}%</strong> of reactive messages arrived outside core hours ({formatHourOfDay(CORE_HOURS_START)}–{formatHourOfDay(CORE_HOURS_END)}).
                </p>
              )}
              {chatStakeholders && chatStakeholders.groups.length > 0 && (
                <div className="week-dashboard-stakeholders">
                  <span>Reactive time served</span>
                  <div>
                    {chatStakeholders.groups.map((group) => (
                      <span key={group.label} title={`${group.burst_count} ${group.burst_count === 1 ? "burst" : "bursts"}`}>
                        {group.label} <strong>{group.share_pct}%</strong>
                      </span>
                    ))}
                  </div>
                  {chatStakeholders.group_count > chatStakeholders.groups.length && (
                    <small>
                      Top {chatStakeholders.groups.length} of {chatStakeholders.group_count} groups · {chatStakeholders.group_count - chatStakeholders.groups.length} more not shown
                    </small>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </details>
    </section>
  );
}
