"use client";

import { useState } from "react";

import type { PersonalForecastTrajectoryPoint } from "@/lib/personalForecastPresentation";

const TRAJECTORY_WIDTH = 640;
const TRAJECTORY_HEIGHT = 154;
const TRAJECTORY_PAD_X = 22;
const TRAJECTORY_PAD_Y = 18;
const TRAJECTORY_SERIES = [
  { key: "allocatedPct", label: "Allocated", className: "is-allocated", betterWhen: "neutral" },
  { key: "reactivePct", label: "Reactive", className: "is-reactive", betterWhen: "lower" },
  { key: "deepWorkPct", label: "Deep work", className: "is-deep", betterWhen: "higher" },
  { key: "reliableCapacityPct", label: "Reliable capacity", className: "is-reliable", betterWhen: "higher" },
  { key: "meetingPct", label: "Meeting density", className: "is-meeting", betterWhen: "lower" },
] as const satisfies ReadonlyArray<{
  key: keyof PersonalForecastTrajectoryPoint;
  label: string;
  className: string;
  betterWhen: "higher" | "lower" | "neutral";
}>;

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

function trajectoryX(index: number, count: number): number {
  return count <= 1
    ? TRAJECTORY_WIDTH / 2
    : TRAJECTORY_PAD_X + (index / (count - 1)) * (TRAJECTORY_WIDTH - (TRAJECTORY_PAD_X * 2));
}

function trajectoryY(value: number): number {
  return TRAJECTORY_PAD_Y + ((100 - value) / 100) * (TRAJECTORY_HEIGHT - (TRAJECTORY_PAD_Y * 2));
}

function shortWeek(weekId: string): string {
  return weekId.replace(/^\d{4}-/, "");
}

function trajectoryDeltaClass(delta: number | null): string {
  if (delta === null || delta === 0) return "personal-forecast-delta";
  return `personal-forecast-delta ${delta > 0 ? "is-positive" : "is-negative"}`;
}

function DirectionIcon({ delta }: { delta: number }) {
  const path = delta > 0 ? "M4 8l4-4 4 4M8 4v8" : delta < 0 ? "M4 4l4 4 4-4M8 8V0" : "M2 6h12";
  return (
    <svg aria-hidden="true" viewBox="0 0 16 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

export function PersonalForecastTrajectory({
  trajectory,
  reliableCapacityDeltaPts,
}: {
  trajectory: PersonalForecastTrajectoryPoint[];
  reliableCapacityDeltaPts: number | null;
}) {
  const [activeSeries, setActiveSeries] = useState<string | null>(null);
  const first = trajectory[0]!;
  const latest = trajectory.at(-1)!;
  const seriesContext = TRAJECTORY_SERIES.map((series) => {
    const current = latest[series.key] as number;
    const delta = Math.round(current - (first[series.key] as number));
    const tone = delta === 0 || series.betterWhen === "neutral"
      ? "flat"
      : (delta > 0) === (series.betterWhen === "higher") ? "good" : "bad";
    return { ...series, current, delta, tone };
  });

  return (
    <section className="personal-week-panel personal-forecast-trajectory" aria-labelledby="personal-forecast-trajectory-title">
      <header>
        <div>
          <h2 id="personal-forecast-trajectory-title">Weekly capacity trajectory</h2>
          <span>Observed review-safe baselines · not forecast accuracy</span>
        </div>
        <span className={trajectoryDeltaClass(reliableCapacityDeltaPts)}>
          {(reliableCapacityDeltaPts ?? 0) > 0 ? "+" : ""}{reliableCapacityDeltaPts ?? 0} pts
        </span>
      </header>
      <div className="personal-forecast-trajectory-legend" role="list" aria-label="Trajectory series">
        {seriesContext.map((series) => {
          const changeLabel = series.delta === 0
            ? "No change over the window"
            : `${Math.abs(series.delta)} ${Math.abs(series.delta) === 1 ? "point" : "points"} ${series.delta > 0 ? "higher" : "lower"} over the window`;
          return (
            <span
              className={series.className}
              role="listitem"
              tabIndex={0}
              key={series.key}
              data-tone={series.tone}
              style={{ opacity: activeSeries && activeSeries !== series.key ? 0.3 : 1 }}
              onMouseEnter={() => setActiveSeries(series.key)}
              onMouseLeave={() => setActiveSeries(null)}
              onFocus={() => setActiveSeries(series.key)}
              onBlur={() => setActiveSeries(null)}
            >
              <i aria-hidden="true" />
              <span>{series.label}</span>
              <strong>{pct(series.current)}</strong>
              <small>
                <DirectionIcon delta={series.delta} />
                {series.delta > 0 ? "+" : ""}{series.delta}
                <span className="sr-only">. {changeLabel}.</span>
              </small>
            </span>
          );
        })}
      </div>
      <svg
        className="personal-forecast-trajectory-chart"
        viewBox={`0 0 ${TRAJECTORY_WIDTH} ${TRAJECTORY_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-describedby="personal-forecast-trajectory-table"
        aria-label={`Reliable new-work capacity from ${first.weekId} at ${pct(first.reliableCapacityPct)} to ${latest.weekId} at ${pct(latest.reliableCapacityPct)}`}
      >
        {[0, 50, 100].map((tick) => (
          <line className="personal-forecast-gridline" key={tick} x1={TRAJECTORY_PAD_X} x2={TRAJECTORY_WIDTH - TRAJECTORY_PAD_X} y1={trajectoryY(tick)} y2={trajectoryY(tick)} />
        ))}
        {TRAJECTORY_SERIES.map((series) => (
          <polyline
            className={`personal-forecast-trajectory-line ${series.className}`}
            key={series.key}
            points={trajectory.map((point, index) => `${trajectoryX(index, trajectory.length)},${trajectoryY(point[series.key] as number)}`).join(" ")}
            style={{ opacity: activeSeries && activeSeries !== series.key ? 0.3 : 1 }}
            onMouseEnter={() => setActiveSeries(series.key)}
            onMouseLeave={() => setActiveSeries(null)}
          />
        ))}
        {trajectory.map((point, index) => (
          <g key={point.weekId}>
            {TRAJECTORY_SERIES.map((series) => (
              <circle
                className={`personal-forecast-trajectory-dot ${series.className}`}
                key={series.key}
                cx={trajectoryX(index, trajectory.length)}
                cy={trajectoryY(point[series.key] as number)}
                r="3"
                style={{ opacity: activeSeries && activeSeries !== series.key ? 0.3 : 1 }}
                onMouseEnter={() => setActiveSeries(series.key)}
                onMouseLeave={() => setActiveSeries(null)}
              >
                <title>{`${point.weekId}: ${series.label} ${pct(point[series.key] as number)}`}</title>
              </circle>
            ))}
            <text className="personal-forecast-axis-label" x={trajectoryX(index, trajectory.length)} y={TRAJECTORY_HEIGHT - 2} textAnchor="middle">{shortWeek(point.weekId)}</text>
          </g>
        ))}
      </svg>

      <div className="sr-only" id="personal-forecast-trajectory-table">
        <table>
          <caption>Observed review-safe weekly capacity trajectory</caption>
          <thead><tr><th scope="col">Week</th>{TRAJECTORY_SERIES.map((series) => <th scope="col" key={series.key}>{series.label}</th>)}</tr></thead>
          <tbody>
            {trajectory.map((point) => (
              <tr key={point.weekId}><th scope="row">{point.weekId}</th>{TRAJECTORY_SERIES.map((series) => <td key={series.key}>{pct(point[series.key] as number)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="personal-forecast-track-record">
        <div>
          <strong>Synced baseline track record</strong>
          <p>These values show what the deterministic workload model reported each week. The Web replica does not include saved predictions, so it cannot claim predicted-versus-actual accuracy.</p>
        </div>
        <ol aria-label="Synced reliable-capacity baselines">
          {trajectory.map((point) => (
            <li key={point.weekId}>
              <span>{point.weekId}</span>
              <strong>{pct(point.reliableCapacityPct)}</strong>
              <small>{point.summaryConfidencePct}% summary confidence</small>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
