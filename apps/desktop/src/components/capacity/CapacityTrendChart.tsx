import { useId, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { PersistedSnapshotRecord } from "../../services/localStore";
import type { computeWeeklyCapacitySnapshot } from "../../../../../packages/inference/src/capacity";
import { normalizeWeekId } from "../../../../../packages/inference/src/capacity";
import { WEEKLY_BASELINE_HOURS } from "../../../../../packages/integrations/src/internal/normalize";
import { formatIsoWeekLabel, pct } from "../../lib/format";

type Snapshot = ReturnType<typeof computeWeeklyCapacitySnapshot>;

// The headline series tracked across weeks. `className` drives the line/dot
// colour through CSS (currentColor) so the palette stays in the design system.
const SERIES = [
  { key: "allocated_pct", label: "Allocated", className: "trend-allocated", betterWhen: "neutral" },
  { key: "reactive_pct", label: "Reactive", className: "trend-reactive", betterWhen: "lower" },
  { key: "deep_work_pct", label: "Deep work", className: "trend-deep", betterWhen: "higher" },
  { key: "reliable_new_work_capacity_pct", label: "Reliable capacity", className: "trend-reliable", betterWhen: "higher" },
  { key: "meeting_pct", label: "Meeting density", className: "trend-meeting", betterWhen: "lower" },
] as const satisfies ReadonlyArray<{
  key: keyof Snapshot;
  label: string;
  className: string;
  betterWhen: "higher" | "lower" | "neutral";
}>;

const TREND_WINDOW_WEEKS = 8;

// SVG canvas geometry (CSS scales it to the container width).
const VB_W = 720;
const VB_H = 260;
const PAD = { l: 34, r: 14, t: 14, b: 30 };
const PLOT_W = VB_W - PAD.l - PAD.r;
const PLOT_H = VB_H - PAD.t - PAD.b;
const Y_TICKS = [0, 25, 50, 75, 100];

function clampPct(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}

// "2026-W26" → "W26" for compact x-axis labels.
function shortWeekLabel(weekId: string): string {
  const match = /W(\d{2})$/.exec(weekId);
  return match ? `W${Number(match[1])}` : weekId;
}

// Multi-week capacity line chart, rendered as a section wherever week-over-week
// context belongs (currently the Forecast screen). Renders nothing until at
// least two weeks of snapshots exist — each completed week adds a point.
export function CapacityTrendChart({
  snapshot: currentSnapshot,
  snapshotHistory,
}: {
  snapshot: Snapshot;
  snapshotHistory: PersistedSnapshotRecord[];
}) {
  // Hovering a legend row (or a line/dot) isolates that series by dimming its
  // peers — mirrors the Weekly StackedBar legend↔segment crosslink, since the
  // four lines cross and colour alone can't disambiguate them.
  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null);

  // Stable id linking the chart's `aria-describedby` to the visually-hidden data
  // table below, so keyboard/screen-reader users reach every week/series value.
  const dataTableId = useId();

  // Merge retained weekly snapshots with the live current-week snapshot (current
  // week wins), newest-last, capped to the trend window.
  const weeks = useMemo(() => {
    const byWeek = new Map<string, Snapshot>();
    // Key by the NORMALIZED week id so the chronological sort below is correct (a non-zero-padded
    // id like "2026-W5" would otherwise sort after "2026-W27") and a legacy non-padded record
    // collapses onto its padded twin rather than plotting twice.
    for (const record of snapshotHistory) byWeek.set(normalizeWeekId(record.week_id), record.snapshot);
    byWeek.set(normalizeWeekId(currentSnapshot.week_id), currentSnapshot);
    return [...byWeek.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .slice(-TREND_WINDOW_WEEKS)
      .map(([week_id, snapshot]) => ({ week_id, snapshot }));
  }, [snapshotHistory, currentSnapshot]);

  const x = (index: number) =>
    weeks.length <= 1 ? PAD.l + PLOT_W / 2 : PAD.l + (index / (weeks.length - 1)) * PLOT_W;
  const y = (value: number) => PAD.t + (1 - clampPct(value) / 100) * PLOT_H;

  // Per-series latest value plus delta from the first week in view, for the legend.
  const legend = useMemo(
    () =>
      SERIES.map((series) => {
        const first = weeks[0]?.snapshot[series.key] ?? 0;
        const last = weeks[weeks.length - 1]?.snapshot[series.key] ?? 0;
        const delta = Math.round(last - first);
        const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
        const tone =
          delta === 0 || series.betterWhen === "neutral"
            ? "flat"
            : (delta > 0) === (series.betterWhen === "higher")
              ? "good"
              : "bad";
        return { ...series, current: Math.round(last), delta, direction, tone };
      }),
    [weeks],
  );

  if (weeks.length < 2) {
    return null;
  }

  return (
    <section className="capacity-section">
      <div className="section-title">
        <h2>Weekly capacity over the last {weeks.length} weeks</h2>
        <span>% of a {WEEKLY_BASELINE_HOURS}-hour week</span>
      </div>

      <div className="trend-legend" role="list">
        {legend.map((item) => {
          const Icon = item.direction === "up" ? ArrowUp : item.direction === "down" ? ArrowDown : Minus;
          const signed = `${item.delta > 0 ? "+" : ""}${item.delta}`;
          return (
            <span
              className={`trend-legend-item ${item.className}`}
              role="listitem"
              key={item.key}
              tabIndex={0}
              style={{
                opacity: hoveredSeries && hoveredSeries !== item.key ? 0.3 : 1,
                transition: "opacity 0.12s",
              }}
              onMouseEnter={() => setHoveredSeries(item.key)}
              onMouseLeave={() => setHoveredSeries(null)}
              onFocus={() => setHoveredSeries(item.key)}
              onBlur={() => setHoveredSeries(null)}
            >
              <span className="trend-legend-swatch" aria-hidden />
              <span className="trend-legend-label">{item.label}</span>
              <strong className="trend-legend-value">{pct(item.current)}</strong>
              <span className="trend-legend-delta" data-tone={item.tone}>
                <Icon size={11} aria-hidden />
                {item.direction === "flat" ? "0" : signed}
                <span className="sr-only">
                  {item.direction === "flat"
                    ? " no change over the window"
                    : ` ${Math.abs(item.delta)} point${Math.abs(item.delta) === 1 ? "" : "s"} ${item.direction === "up" ? "higher" : "lower"} over the window${item.tone === "good" ? " — an improvement" : item.tone === "bad" ? " — a regression" : ""}`}
                </span>
              </span>
            </span>
          );
        })}
      </div>

      <svg
        className="trend-chart"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Line chart of weekly capacity metrics across the last ${weeks.length} weeks`}
        aria-describedby={dataTableId}
      >
        {Y_TICKS.map((tick) => (
          <g key={tick}>
            <line
              className="trend-gridline"
              x1={PAD.l}
              x2={VB_W - PAD.r}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className="trend-axis-label" x={PAD.l - 6} y={y(tick) + 3} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}

        {weeks.map((week, index) => (
          <text
            key={week.week_id}
            className="trend-axis-label"
            x={x(index)}
            y={VB_H - PAD.b + 18}
            textAnchor="middle"
          >
            <title>{formatIsoWeekLabel(week.week_id)}</title>
            {shortWeekLabel(week.week_id)}
          </text>
        ))}

        {SERIES.map((series) => {
          const points = weeks
            .map((week, index) => `${x(index)},${y(week.snapshot[series.key])}`)
            .join(" ");
          return (
            <g
              className={`trend-series ${series.className}`}
              key={series.key}
              style={{
                opacity: hoveredSeries && hoveredSeries !== series.key ? 0.3 : 1,
                transition: "opacity 0.12s",
              }}
              onMouseEnter={() => setHoveredSeries(series.key)}
              onMouseLeave={() => setHoveredSeries(null)}
            >
              <polyline className="trend-line" points={points} />
              {weeks.map((week, index) => (
                <circle
                  className="trend-dot"
                  key={week.week_id}
                  cx={x(index)}
                  cy={y(week.snapshot[series.key])}
                  r={3}
                >
                  <title>
                    {formatIsoWeekLabel(week.week_id)} — {series.label}: {pct(Math.round(week.snapshot[series.key]))}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      {/* Visually-hidden equivalent of the chart: the per-week, per-series
          values are otherwise reachable only through hover-only SVG <title>
          tooltips. Purely additive — no visual change. The `sr-only` clip
          lives on the wrapping div (a table can't be shrunk below its
          min-content width, so `sr-only` on the table itself leaks ~610px of
          layout width and scrolls the screen sideways at narrow viewports);
          the id stays on the table so the svg's aria-describedby linkage holds. */}
      <div className="sr-only">
        <table id={dataTableId}>
          <caption>
          Weekly capacity values across the last {weeks.length} weeks, as percentages of a{" "}
          {WEEKLY_BASELINE_HOURS}-hour week.
        </caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            {SERIES.map((series) => (
              <th scope="col" key={series.key}>
                {series.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.week_id}>
              <th scope="row">{formatIsoWeekLabel(week.week_id)}</th>
              {SERIES.map((series) => (
                <td key={series.key}>{pct(Math.round(week.snapshot[series.key]))}</td>
              ))}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </section>
  );
}
