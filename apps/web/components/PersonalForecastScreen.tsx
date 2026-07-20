import Link from "next/link";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";
import {
  buildPersonalForecastPresentation,
  personalForecastRangeGeometry,
  type PersonalForecastTrajectoryPoint,
} from "@/lib/personalForecastPresentation";

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

const TRAJECTORY_WIDTH = 640;
const TRAJECTORY_HEIGHT = 154;
const TRAJECTORY_PAD_X = 22;
const TRAJECTORY_PAD_Y = 18;
const TRAJECTORY_SERIES = [
  { key: "allocatedPct", label: "Allocated", className: "is-allocated" },
  { key: "reactivePct", label: "Reactive", className: "is-reactive" },
  { key: "deepWorkPct", label: "Deep work", className: "is-deep" },
  { key: "reliableCapacityPct", label: "Reliable capacity", className: "is-reliable" },
  { key: "meetingPct", label: "Meeting density", className: "is-meeting" },
] as const satisfies ReadonlyArray<{
  key: keyof PersonalForecastTrajectoryPoint;
  label: string;
  className: string;
}>;

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

export function PersonalForecastScreen({
  replicas,
  error,
}: {
  replicas: PersonalWorkloadReplicaV1[];
  error: string | null;
}) {
  const forecast = buildPersonalForecastPresentation(replicas);
  const range = forecast.scenarios ? personalForecastRangeGeometry(forecast.scenarios) : null;

  return (
    <section className="web-desktop-screen personal-forecast-screen" aria-labelledby="personal-forecast-title">
      <header className="web-screen-heading">
        <div>
          <span>Weekly forecast</span>
          <h1 id="personal-forecast-title">
            {forecast.targetWeekId ? `Next week: ${forecast.targetWeekId}.` : "No forecast inputs yet."}
          </h1>
          <p>See what reliably fits next, with the source and uncertainty kept visible.</p>
        </div>
        <Link className="button button-secondary" href="/download">Get Weekform for Mac</Link>
      </header>

      {error ? (
        <div className="form-alert personal-forecast-error" role="alert">
          <strong>Your forecast inputs could not be loaded.</strong>
          <p>No planning baseline is being shown. Reload the page or resync from Weekform for Mac.</p>
        </div>
      ) : !forecast.scenarios ? (
        <section className="panel web-screen-empty" role="status">
          <h2>Nothing to forecast</h2>
          <p>{forecast.explanation}</p>
          <Link className="button button-primary" href="/download">Get Weekform for Mac</Link>
        </section>
      ) : (
        <>
          <section className="personal-week-panel personal-forecast-panel" aria-labelledby="personal-forecast-agent-title">
            <header>
              <div>
                <h2 id="personal-forecast-agent-title">Derived planning baseline</h2>
                <span>{forecast.targetWeekId ?? "Next week"} · {forecast.historyWeekCount} synced {forecast.historyWeekCount === 1 ? "week" : "weeks"}</span>
              </div>
              <span className="badge">{forecast.confidencePct ?? 0}% summary confidence</span>
            </header>

            <div className="forecast-summary personal-forecast-scenarios">
              <div><span>Conservative</span><strong>{pct(forecast.scenarios.conservative)}</strong><small>protected planning case</small></div>
              <div><span>Likely</span><strong>{pct(forecast.scenarios.likely)}</strong><small>median of synced baselines</small></div>
              <div><span>Optimistic</span><strong>{pct(forecast.scenarios.optimistic)}</strong><small>only if current risks clear</small></div>
            </div>
            <div className="forecast-range" role="img" aria-label={`Scenario range from ${pct(forecast.scenarios.conservative)} to ${pct(forecast.scenarios.optimistic)}, likely ${pct(forecast.scenarios.likely)}`}>
              <div className="forecast-range-track">
                <span className="forecast-range-fill" style={{ left: `${range!.leftPct}%`, width: `${range!.widthPct}%` }} />
                <span className="forecast-range-marker" style={{ left: `${range!.likelyPct}%` }} />
              </div>
              <div className="forecast-range-labels" aria-hidden="true">
                <span>{pct(range!.conservativePct)} conservative</span>
                <strong>{pct(range!.likelyPct)} likely</strong>
                <span>{pct(range!.optimisticPct)} optimistic</span>
              </div>
            </div>
            <p className="personal-week-panel-note">{forecast.explanation}</p>
          </section>

          <div className="personal-week-detail-grid personal-forecast-detail-grid">
            <section className="personal-week-panel">
              <header><h2>Risk flags</h2><span>From the newest review-safe summary</span></header>
              {forecast.risks.length > 0 ? (
                <ul className="personal-forecast-list">
                  {forecast.risks.map((risk) => <li key={risk.key}><strong>{risk.label}</strong><span>{risk.detail}</span></li>)}
                </ul>
              ) : <p className="personal-week-empty">No elevated derived risk crossed the planning thresholds.</p>}
              <h3>Planning guidance</h3>
              <p>{forecast.recommendation}</p>
            </section>
            <section className="personal-week-panel">
              <header><h2>Forecast basis</h2><span>Inspectable assumptions and limits</span></header>
              <h3>Assumptions</h3>
              <ul className="personal-forecast-list">
                {forecast.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
              </ul>
              <p className="personal-week-panel-note">This browser does not generate AI forecasts. The desktop Agent can refine this baseline against private local evidence after you ask it to.</p>
            </section>
          </div>

          {forecast.trajectory.length >= 2 ? (
            <section className="personal-week-panel personal-forecast-trajectory" aria-labelledby="personal-forecast-trajectory-title">
              <header>
                <div>
                  <h2 id="personal-forecast-trajectory-title">Weekly capacity trajectory</h2>
                  <span>Observed review-safe baselines · not forecast accuracy</span>
                </div>
                <span className={trajectoryDeltaClass(forecast.trajectoryDeltaPts)}>
                  {(forecast.trajectoryDeltaPts ?? 0) > 0 ? "+" : ""}{forecast.trajectoryDeltaPts ?? 0} pts
                </span>
              </header>
              <svg
                className="personal-forecast-trajectory-chart"
                viewBox={`0 0 ${TRAJECTORY_WIDTH} ${TRAJECTORY_HEIGHT}`}
                preserveAspectRatio="none"
                role="img"
                aria-describedby="personal-forecast-trajectory-table"
                aria-label={`Reliable new-work capacity from ${forecast.trajectory[0]!.weekId} at ${pct(forecast.trajectory[0]!.reliableCapacityPct)} to ${forecast.trajectory.at(-1)!.weekId} at ${pct(forecast.trajectory.at(-1)!.reliableCapacityPct)}`}
              >
                {[0, 50, 100].map((tick) => (
                  <line className="personal-forecast-gridline" key={tick} x1={TRAJECTORY_PAD_X} x2={TRAJECTORY_WIDTH - TRAJECTORY_PAD_X} y1={trajectoryY(tick)} y2={trajectoryY(tick)} />
                ))}
                {TRAJECTORY_SERIES.map((series) => (
                  <polyline
                    className={`personal-forecast-trajectory-line ${series.className}`}
                    key={series.key}
                    points={forecast.trajectory.map((point, index) => `${trajectoryX(index, forecast.trajectory.length)},${trajectoryY(point[series.key] as number)}`).join(" ")}
                  />
                ))}
                {forecast.trajectory.map((point, index) => (
                  <g key={point.weekId}>
                    {TRAJECTORY_SERIES.map((series) => (
                      <circle className={`personal-forecast-trajectory-dot ${series.className}`} key={series.key} cx={trajectoryX(index, forecast.trajectory.length)} cy={trajectoryY(point[series.key] as number)} r="3">
                        <title>{point.weekId}: {series.label} {pct(point[series.key] as number)}</title>
                      </circle>
                    ))}
                    <text className="personal-forecast-axis-label" x={trajectoryX(index, forecast.trajectory.length)} y={TRAJECTORY_HEIGHT - 2} textAnchor="middle">{shortWeek(point.weekId)}</text>
                  </g>
                ))}
              </svg>

              <div className="personal-forecast-trajectory-legend" role="list" aria-label="Trajectory series">
                {TRAJECTORY_SERIES.map((series) => (
                  <span className={series.className} role="listitem" key={series.key}><i aria-hidden="true" />{series.label}</span>
                ))}
              </div>
              <div className="sr-only" id="personal-forecast-trajectory-table">
                <table>
                  <caption>Observed review-safe weekly capacity trajectory</caption>
                  <thead><tr><th scope="col">Week</th>{TRAJECTORY_SERIES.map((series) => <th scope="col" key={series.key}>{series.label}</th>)}</tr></thead>
                  <tbody>
                    {forecast.trajectory.map((point) => (
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
                  {forecast.trajectory.map((point) => (
                    <li key={point.weekId}>
                      <span>{point.weekId}</span>
                      <strong>{pct(point.reliableCapacityPct)}</strong>
                      <small>{point.summaryConfidencePct}% summary confidence</small>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
