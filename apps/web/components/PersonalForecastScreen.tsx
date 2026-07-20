import Link from "next/link";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";
import { buildPersonalForecastPresentation } from "@/lib/personalForecastPresentation";

function pct(value: number): string {
  return `${Math.round(value)}%`;
}

export function PersonalForecastScreen({ replicas }: { replicas: PersonalWorkloadReplicaV1[] }) {
  const forecast = buildPersonalForecastPresentation(replicas);

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
        <Link className="button button-secondary" href="/download">Generate an AI forecast on Mac</Link>
      </header>

      {!forecast.scenarios ? (
        <section className="panel web-screen-empty" role="status">
          <h2>Nothing to forecast</h2>
          <p>{forecast.explanation}</p>
          <Link className="button button-primary" href="/download">Open Weekform for Mac</Link>
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
                <span className="forecast-range-fill" style={{ width: `${forecast.scenarios.likely}%` }} />
                <span className="forecast-range-marker" style={{ left: `${forecast.scenarios.likely}%` }} />
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
        </>
      )}
    </section>
  );
}
