import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from "react";
import type {
  TokenUsageDay,
  WeeklyAIUsageSummary
} from "../../../../../packages/domain/src/models";
import {
  formatCount,
  formatIsoWeekLabel,
  formatTokenCount
} from "../../lib/format";

const RANGE_OPTIONS = [7, 14, 28] as const;
type ChartRange = (typeof RANGE_OPTIONS)[number];

const VIEWBOX_WIDTH = 840;
const VIEWBOX_HEIGHT = 248;
const PLOT_LEFT = 54;
const PLOT_RIGHT = 14;
const PLOT_TOP = 28;
const PLOT_HEIGHT = 172;
const PLOT_BASE = PLOT_TOP + PLOT_HEIGHT;

interface DailyUsageDatum {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  measuredPrompts: number;
  measuredModels: string[];
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateKeyOffset(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function fullDateLabel(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(parseDateKey(dateKey));
}

function shortDateLabel(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(parseDateKey(dateKey));
}

function measuredTotal(day: DailyUsageDatum): number {
  return day.inputTokens + day.outputTokens + day.cacheWriteTokens;
}

function hasUsage(day: DailyUsageDatum): boolean {
  return measuredTotal(day) > 0;
}

function addUnique(values: string[], value: string) {
  if (value && value !== "unknown" && !values.includes(value)) values.push(value);
}

function niceCeiling(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function xTickIndices(range: ChartRange): number[] {
  if (range === 7) return [0, 2, 4, 6];
  if (range === 14) return [0, 3, 6, 9, 13];
  return [0, 6, 13, 20, 27];
}

function signedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value}%`;
}

function relativeDayLabel(date: string, todayKey: string): string | null {
  if (date === todayKey) return "Today";
  if (date === dateKeyOffset(todayKey, -1)) return "Yesterday";
  return null;
}

function dayAriaLabel(day: DailyUsageDatum, todayKey: string): string {
  const parts = [fullDateLabel(day.date)];
  const relative = relativeDayLabel(day.date, todayKey);
  if (relative) parts.push(relative);
  const tokens = measuredTotal(day);
  if (tokens > 0) {
    parts.push(
      `${formatCount(tokens)} measured tokens across ${formatCount(day.measuredPrompts)} ${day.measuredPrompts === 1 ? "prompt" : "prompts"}`
    );
  } else {
    parts.push("no input, output, or cache-write tokens");
  }
  if (day.cacheReadTokens > 0) {
    parts.push(`${formatCount(day.cacheReadTokens)} cache-read tokens tracked separately`);
  }
  if (tokens === 0 && day.measuredPrompts > 0) {
    parts.push(`${formatCount(day.measuredPrompts)} measured ${day.measuredPrompts === 1 ? "prompt" : "prompts"}`);
  }
  return parts.join(". ");
}

export function DailyUsageChart({
  tokenUsageDays,
  todayKey,
  weekOverWeek
}: {
  tokenUsageDays: TokenUsageDay[];
  todayKey: string;
  weekOverWeek: WeeklyAIUsageSummary["week_over_week"];
}) {
  const [range, setRange] = useState<ChartRange>(28);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [rovingIndex, setRovingIndex] = useState(range - 1);
  const dayButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tooltipId = `usage-tooltip-${useId().replace(/:/g, "")}`;
  const instructionsId = `usage-instructions-${useId().replace(/:/g, "")}`;

  const days = useMemo<DailyUsageDatum[]>(() => {
    const byDate = new Map<string, DailyUsageDatum>();
    for (let offset = range - 1; offset >= 0; offset -= 1) {
      const date = dateKeyOffset(todayKey, -offset);
      byDate.set(date, {
        date,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        measuredPrompts: 0,
        measuredModels: []
      });
    }

    for (const usage of tokenUsageDays) {
      const day = byDate.get(usage.date);
      if (!day || usage.measurement !== "exact") continue;
      day.inputTokens += usage.input_tokens;
      day.outputTokens += usage.output_tokens;
      day.cacheReadTokens += usage.cache_read_tokens;
      day.cacheWriteTokens += usage.cache_creation_tokens;
      day.measuredPrompts += usage.prompt_count;
      addUnique(day.measuredModels, usage.model);
    }

    return [...byDate.values()];
  }, [range, todayKey, tokenUsageDays]);

  useEffect(() => {
    const lastIndex = days.length - 1;
    setRovingIndex(lastIndex);
    setHoveredIndex(null);
    setFocusedIndex(null);
    dayButtonRefs.current = dayButtonRefs.current.slice(0, days.length);
  }, [days.length, range, todayKey]);

  const activeIndex = hoveredIndex ?? focusedIndex;
  const activeDay = activeIndex === null ? null : days[activeIndex];
  const plotWidth = VIEWBOX_WIDTH - PLOT_LEFT - PLOT_RIGHT;
  const columnWidth = plotWidth / days.length;
  const rawMaxTokens = Math.max(0, ...days.map(measuredTotal));
  const tokenCeiling = niceCeiling(rawMaxTokens);
  const tokenDenominator = tokenCeiling || 1;
  const barWidth = Math.max(5, columnWidth * 0.64);
  const totalTokens = days.reduce((total, day) => total + measuredTotal(day), 0);
  const activeDays = days.filter(hasUsage).length;

  const moveFocus = (index: number) => {
    const next = Math.min(days.length - 1, Math.max(0, index));
    setRovingIndex(next);
    setFocusedIndex(next);
    dayButtonRefs.current[next]?.focus();
  };

  const handleDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveFocus(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      moveFocus(index + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(days.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setHoveredIndex(null);
      setFocusedIndex(null);
    }
  };

  const tooltipStyle = activeIndex === null
    ? undefined
    : ({
        "--usage-tooltip-x": `${((PLOT_LEFT + (activeIndex + 0.5) * columnWidth) / VIEWBOX_WIDTH) * 100}%`
      } as CSSProperties);

  return (
    <section className="usage-chart-card" aria-labelledby="daily-usage-title">
      <div className="usage-chart-header">
        <div>
          <p className="eyebrow">Token usage over time</p>
          <h2 id="daily-usage-title">Daily token usage</h2>
          <p>Measured input, output, and cache-write tokens combined into one total per day.</p>
        </div>
        <div className="usage-chart-controls" role="group" aria-label="Chart range">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className="usage-range-button"
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {option}d
            </button>
          ))}
        </div>
      </div>

      <div className="usage-chart-meta">
        <div className="usage-legend" role="group" aria-label="Chart legend">
          <span className="usage-legend-item">
            <span className="usage-swatch usage-swatch-tokens" aria-hidden />
            Total measured tokens
          </span>
        </div>
        <div className="usage-chart-summary" role="group" aria-label={`${range}-day chart summary`}>
          <span><strong>{activeDays}</strong> {activeDays === 1 ? "day" : "days"} with usage</span>
          <span><strong>{formatTokenCount(totalTokens)}</strong> measured tokens</span>
        </div>
      </div>

      {weekOverWeek && (
        <div className="usage-comparison" role="group" aria-label={`Compared with ${formatIsoWeekLabel(weekOverWeek.prev_week_id)}`}>
          <span>This week vs. {formatIsoWeekLabel(weekOverWeek.prev_week_id)}</span>
          <span className="usage-comparison-chip">
            {weekOverWeek.total_tokens_delta_pct === null
              ? "No measured-token baseline"
              : `${signedPercent(weekOverWeek.total_tokens_delta_pct)} tokens`}
          </span>
        </div>
      )}

      <p className="usage-chart-instructions" id={instructionsId}>
        Hover any day for its token total and breakdown. Keyboard users can focus the chart and use the left and right arrow keys.
      </p>

      <div className="usage-chart-scroll">
        <div
          className="usage-chart-canvas"
          role="group"
          aria-label={`Daily measured token usage for the last ${range} days`}
          aria-describedby={instructionsId}
        >
          <svg
            className="usage-daily-svg"
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            aria-hidden="true"
          >
            {activeIndex !== null && (
              <rect
                className="usage-active-day-band"
                x={PLOT_LEFT + activeIndex * columnWidth}
                y={PLOT_TOP}
                width={columnWidth}
                height={PLOT_HEIGHT}
                rx="4"
              />
            )}

            <text className="usage-lane-title" x={PLOT_LEFT} y="16">MEASURED TOKENS</text>
            {(rawMaxTokens > 0 ? (tokenCeiling > 1 ? [0, 0.5, 1] : [0, 1]) : [0]).map((ratio) => {
              const y = PLOT_BASE - ratio * PLOT_HEIGHT;
              return (
                <g key={`token-grid-${ratio}`}>
                  <line className="usage-grid-line" x1={PLOT_LEFT} y1={y} x2={VIEWBOX_WIDTH - PLOT_RIGHT} y2={y} />
                  <text className="usage-axis-label" x={PLOT_LEFT - 8} y={y + 4} textAnchor="end">
                    {formatTokenCount(tokenCeiling * ratio)}
                  </text>
                </g>
              );
            })}

            {days.map((day, index) => {
              const x = PLOT_LEFT + index * columnWidth + (columnWidth - barWidth) / 2;
              const barHeight = (measuredTotal(day) / tokenDenominator) * PLOT_HEIGHT;
              return (
                <g key={day.date}>
                  {barHeight > 0 && (
                    <rect
                      className="usage-bar-total"
                      x={x}
                      y={PLOT_BASE - barHeight}
                      width={barWidth}
                      height={barHeight}
                      rx="3"
                    />
                  )}
                </g>
              );
            })}

            {activeIndex !== null && (
              <line
                className="usage-active-guide"
                x1={PLOT_LEFT + (activeIndex + 0.5) * columnWidth}
                y1={PLOT_TOP}
                x2={PLOT_LEFT + (activeIndex + 0.5) * columnWidth}
                y2={PLOT_BASE}
              />
            )}

            {xTickIndices(range).map((index) => (
              <text
                key={days[index].date}
                className="usage-x-label"
                x={PLOT_LEFT + (index + 0.5) * columnWidth}
                y={VIEWBOX_HEIGHT - 11}
                textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}
              >
                {index === days.length - 1 ? "Today" : shortDateLabel(days[index].date)}
              </text>
            ))}
          </svg>

          <div
            className="usage-day-hit-grid"
            style={{
              left: `${(PLOT_LEFT / VIEWBOX_WIDTH) * 100}%`,
              right: `${(PLOT_RIGHT / VIEWBOX_WIDTH) * 100}%`,
              top: `${(PLOT_TOP / VIEWBOX_HEIGHT) * 100}%`,
              bottom: `${((VIEWBOX_HEIGHT - PLOT_BASE) / VIEWBOX_HEIGHT) * 100}%`,
              gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`
            }}
          >
            {days.map((day, index) => (
              <button
                key={day.date}
                ref={(node) => { dayButtonRefs.current[index] = node; }}
                type="button"
                className="usage-day-hit"
                tabIndex={rovingIndex === index ? 0 : -1}
                aria-label={dayAriaLabel(day, todayKey)}
                aria-describedby={activeIndex === index ? tooltipId : undefined}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onFocus={() => {
                  setHoveredIndex(null);
                  setRovingIndex(index);
                  setFocusedIndex(index);
                }}
                onBlur={() => setFocusedIndex(null)}
                onClick={() => moveFocus(index)}
                onKeyDown={(event) => handleDayKeyDown(event, index)}
              />
            ))}
          </div>

          {activeDay && activeIndex !== null && (
            <div
              className={`usage-chart-tooltip ${activeIndex < days.length / 2 ? "opens-right" : "opens-left"}`}
              id={tooltipId}
              role="tooltip"
              style={tooltipStyle}
            >
              <div className="usage-tooltip-heading">
                <div>
                  <strong>{fullDateLabel(activeDay.date)}</strong>
                  {relativeDayLabel(activeDay.date, todayKey) && (
                    <span>{relativeDayLabel(activeDay.date, todayKey)}</span>
                  )}
                </div>
                {!hasUsage(activeDay) && <span className="usage-tooltip-quiet">Quiet day</span>}
              </div>

              <div className="usage-tooltip-section">
                <div className="usage-tooltip-section-title">
                  <span className="usage-tooltip-dot measured" aria-hidden />
                  <span>Token usage</span>
                  <strong>{formatCount(measuredTotal(activeDay))}</strong>
                </div>
                {measuredTotal(activeDay) > 0 ? (
                  <dl className="usage-tooltip-breakdown">
                    <div><dt>Input</dt><dd>{formatCount(activeDay.inputTokens)}</dd></div>
                    <div><dt>Output</dt><dd>{formatCount(activeDay.outputTokens)}</dd></div>
                    <div><dt>Cache writes</dt><dd>{formatCount(activeDay.cacheWriteTokens)}</dd></div>
                    <div><dt>Prompts</dt><dd>{formatCount(activeDay.measuredPrompts)}</dd></div>
                  </dl>
                ) : (
                  <p>No input, output, or cache-write tokens captured.</p>
                )}
                {activeDay.cacheReadTokens > 0 && (
                  <p>{formatCount(activeDay.cacheReadTokens)} cache-read tokens tracked separately and not included in the bar.</p>
                )}
                {measuredTotal(activeDay) === 0 && activeDay.measuredPrompts > 0 && (
                  <p>{formatCount(activeDay.measuredPrompts)} measured {activeDay.measuredPrompts === 1 ? "prompt" : "prompts"}.</p>
                )}
                {activeDay.measuredModels.length > 0 && (
                  <p>Models: {activeDay.measuredModels.join(", ")}</p>
                )}
              </div>
            </div>
          )}

          {activeDays === 0 && !activeDay && (
            <div className="usage-chart-empty" aria-hidden="true">
              <strong>No measured token usage in this range</strong>
              <span>
                {range < 28
                  ? "Choose a longer range to look further back."
                  : "No measured tokens were captured in the last 28 days."}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="sr-only">
        <table>
          <caption>Daily measured token usage for the last {range} days</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Total measured tokens</th>
              <th scope="col">Input tokens</th>
              <th scope="col">Output tokens</th>
              <th scope="col">Cache-write tokens</th>
              <th scope="col">Measured prompts</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <th scope="row">{fullDateLabel(day.date)}</th>
                <td>{measuredTotal(day)}</td>
                <td>{day.inputTokens}</td>
                <td>{day.outputTokens}</td>
                <td>{day.cacheWriteTokens}</td>
                <td>{day.measuredPrompts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
