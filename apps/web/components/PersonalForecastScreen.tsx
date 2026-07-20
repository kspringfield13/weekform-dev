import Link from "next/link";
import { LockKeyhole, TrendingUp } from "lucide-react";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";
import {
  buildPersonalForecastPresentation,
  personalForecastRangeGeometry,
} from "@/lib/personalForecastPresentation";
import { PersonalForecastTrajectory } from "./PersonalForecastTrajectory";

function pct(value: number): string {
  return `${Math.round(value)}%`;
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
    <section
      className="web-desktop-screen screen forecast-screen personal-forecast-screen"
      aria-labelledby="personal-forecast-title"
    >
      <header className="screen-header">
        <div>
          <p className="eyebrow">Weekly forecast</p>
          <h1 id="personal-forecast-title">
            {forecast.targetWeekId ? `Next week: ${forecast.targetWeekId}.` : "No forecast inputs yet."}
          </h1>
          <p className="screen-intro">
            See what reliably fits next, with the source and uncertainty kept visible.
          </p>
        </div>
      </header>

      {error ? (
        <div className="form-alert personal-forecast-error" role="alert">
          <strong>Your forecast inputs could not be loaded.</strong>
          <p>No planning baseline is being shown. Reload the page or resync from Weekform for Mac.</p>
        </div>
      ) : !forecast.scenarios ? (
        <section className="empty-state personal-forecast-empty" role="status">
          <span className="empty-state-icon" aria-hidden="true"><TrendingUp size={20} /></span>
          <div>
            <strong>Nothing to forecast.</strong>
            <p>{forecast.explanation}</p>
          </div>
          <div className="empty-state-actions">
            <Link className="button button-primary" href="/download">Get Weekform for Mac</Link>
          </div>
        </section>
      ) : (
        <>
          <section
            className="capacity-section forecast-panel"
            aria-labelledby="personal-forecast-agent-title"
          >
            <div className="section-title">
              <div>
                <h2 id="personal-forecast-agent-title">Forecast Agent</h2>
                <span>
                  {forecast.targetWeekId ?? "Next week"} · {forecast.historyWeekCount} synced {forecast.historyWeekCount === 1 ? "week" : "weeks"}
                </span>
              </div>
              <span className="badge">{forecast.confidencePct ?? 0}% summary confidence</span>
            </div>

            <div className="personal-forecast-local-boundary" role="note">
              <LockKeyhole size={16} aria-hidden="true" />
              <div>
                <strong>AI forecast generation stays on your Mac.</strong>
                <span>Not included in the review-safe replica · no forecast action has run.</span>
              </div>
              <Link className="button button-secondary" href="/download">Get Weekform for Mac</Link>
            </div>

            <div className="forecast-result">
              <div className="forecast-summary">
                <div><span>Conservative</span><strong>{pct(forecast.scenarios.conservative)}</strong><small>protected planning case</small></div>
                <div><span>Likely</span><strong>{pct(forecast.scenarios.likely)}</strong><small>median of synced baselines</small></div>
                <div><span>Optimistic</span><strong>{pct(forecast.scenarios.optimistic)}</strong><small>only if current risks clear</small></div>
              </div>
              <p className="forecast-baseline-note">{forecast.explanation}</p>
              <div
                className="forecast-range"
                role="img"
                aria-label={`Scenario range from ${pct(forecast.scenarios.conservative)} to ${pct(forecast.scenarios.optimistic)}, likely ${pct(forecast.scenarios.likely)}`}
              >
                <div className="forecast-range-track">
                  <span className="forecast-range-fill" style={{ left: `${range!.leftPct}%`, width: `${range!.widthPct}%` }} />
                  <span className="forecast-range-marker" style={{ left: `${range!.likelyPct}%` }} />
                </div>
                <div className="forecast-range-label-row" aria-hidden="true">
                  <span>Conservative · {pct(range!.conservativePct)}</span>
                  <strong>Likely · {pct(range!.likelyPct)}</strong>
                  <span>Optimistic · {pct(range!.optimisticPct)}</span>
                </div>
              </div>
              <div className="forecast-copy">
                <span>Planning guidance</span>
                <h3>Derived planning baseline</h3>
                <p>{forecast.recommendation}</p>
              </div>
              <div className="forecast-grid">
                <section>
                  <h4>Risk flags</h4>
                  {forecast.risks.length > 0 ? (
                    <ul className="personal-forecast-list">
                      {forecast.risks.map((risk) => <li key={risk.key}><strong>{risk.label}</strong><span>{risk.detail}</span></li>)}
                    </ul>
                  ) : <p className="personal-week-empty">No elevated derived risk crossed the planning thresholds.</p>}
                </section>
                <section>
                  <h4>Assumptions</h4>
                  <span className="personal-forecast-list-kicker">Forecast basis</span>
                  <ul className="personal-forecast-list">
                    {forecast.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
                  </ul>
                </section>
              </div>
            </div>
          </section>

          {forecast.trajectory.length >= 2 ? (
            <PersonalForecastTrajectory trajectory={forecast.trajectory} reliableCapacityDeltaPts={forecast.trajectoryDeltaPts} />
          ) : (
            <section className="forecast-track-record personal-forecast-track-boundary" aria-label="Forecast track record unavailable">
              <div>
                <strong>Forecast track record</strong>
                <p>One synced week is a deterministic baseline. Saved predictions and predicted-versus-actual accuracy remain on your Mac.</p>
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
