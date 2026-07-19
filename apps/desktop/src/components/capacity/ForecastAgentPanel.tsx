import { useEffect, useRef, useState } from "react";
import { RefreshCw, Target, TrendingUp } from "lucide-react";
import type { ForecastAccuracyReview, PersistedForecastRecord } from "../../services/localStore";
import { forecastRatingLabel, pct } from "../../lib/format";
import { formatAuditTime } from "../../lib/format";
import { ForecastList } from "../common/ForecastList";
import { EmptyState } from "../common/EmptyState";
import { InlineError } from "../common/InlineError";
import { AI_UNAVAILABLE_HINT } from "../../lib/constants";

export function ForecastAgentPanel({
  generatedForecast,
  forecastAccuracy,
  nextWeekRangeLabel,
  status,
  error,
  deterministicReliableCapacity,
  aiAvailable,
  onGenerate
}: {
  generatedForecast: PersistedForecastRecord | null;
  forecastAccuracy: ForecastAccuracyReview | null;
  nextWeekRangeLabel: string;
  status: "idle" | "generating" | "error";
  error: string | null;
  deterministicReliableCapacity: number;
  aiAvailable: boolean;
  onGenerate: () => void;
}) {
  const [isRevealingForecast, setIsRevealingForecast] = useState(false);
  const wasGeneratingRef = useRef(false);
  const revealTimeoutRef = useRef<number | null>(null);
  const forecast = generatedForecast?.forecast;

  // The scenario pcts are AI output — not guaranteed ordered or numeric. Clamp the
  // derived marker position to the track (0–100%) with a finite guard so an out-of-order
  // (likely < conservative → negative) / over-range (likely > optimistic → >100) / NaN
  // response can't push the fill+marker off the track or emit an invalid `left: NaN%`.
  const likelyLeftRaw = forecast
    ? ((forecast.likely_capacity_pct - forecast.conservative_capacity_pct) /
        Math.max(1, forecast.optimistic_capacity_pct - forecast.conservative_capacity_pct)) *
        100
    : 0;
  const likelyLeft = Number.isFinite(likelyLeftRaw)
    ? Math.max(0, Math.min(100, Math.round(likelyLeftRaw)))
    : 0;

  // When the marker sits near either end, the centered "Likely · X%" label collides
  // with the edge-anchored Conservative/Optimistic labels. In that case the likely value
  // is ~equal to the nearest end (and is still shown in the summary cards + range aria-label),
  // so hide the inline center label rather than overlapping the end one.
  const showLikelyLabel = likelyLeft > 12 && likelyLeft < 88;

  useEffect(() => {
    if (status === "generating") {
      wasGeneratingRef.current = true;
      setIsRevealingForecast(false);
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
        revealTimeoutRef.current = null;
      }
      return;
    }

    if (status !== "idle") {
      wasGeneratingRef.current = false;
      return;
    }

    if (!wasGeneratingRef.current || !forecast) return;
    wasGeneratingRef.current = false;
    setIsRevealingForecast(true);
    revealTimeoutRef.current = window.setTimeout(() => {
      setIsRevealingForecast(false);
      revealTimeoutRef.current = null;
    }, 1800);
  }, [forecast, status]);

  useEffect(
    () => () => {
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
      }
    },
    []
  );

  return (
    <section className="capacity-section forecast-panel">
      <div className="section-title">
        <div>
          <h2>Forecast Agent</h2>
          <span>
            {forecast ? (
              <>Generated <time dateTime={generatedForecast.generated_at}>{formatAuditTime(generatedForecast.generated_at)}</time></>
            ) : (
              `Next week: ${nextWeekRangeLabel}`
            )}
          </span>
        </div>
        <button
          className={`secondary-action forecast-generate-action${status === "generating" ? " is-generating" : ""}`}
          type="button"
          disabled={status === "generating" || !aiAvailable}
          aria-busy={status === "generating"}
          onClick={onGenerate}
          title={aiAvailable ? undefined : AI_UNAVAILABLE_HINT}
        >
          <RefreshCw
            key={status === "generating" ? "generating" : "idle"}
            className="forecast-generate-icon"
            size={16}
            aria-hidden
          />
          <span>{status === "generating" ? "Forecasting…" : forecast ? "Regenerate Forecast" : "Generate Forecast"}</span>
        </button>
      </div>
      {forecastAccuracy && (
        <div className={`forecast-accuracy forecast-accuracy--${forecastAccuracy.rating}`} role="status">
          <span className="forecast-accuracy-icon" aria-hidden="true">
            <Target size={16} />
          </span>
          <div className="forecast-accuracy-body">
            <p className="forecast-accuracy-headline">
              <span className="forecast-accuracy-rating">{forecastRatingLabel(forecastAccuracy.rating)}</span>
              {" — last week's forecast for this week predicted "}
              <strong>{pct(forecastAccuracy.predicted_pct)}</strong>
              {" reliable capacity; the model now computes "}
              <strong>{pct(forecastAccuracy.actual_pct)}</strong>.
            </p>
            <p className="forecast-accuracy-detail">
              {forecastAccuracy.error_pts === 0
                ? "Exactly on the mark."
                : `${forecastAccuracy.signed_error_pts > 0 ? "Over" : "Under"}-predicted by ${forecastAccuracy.error_pts} ${forecastAccuracy.error_pts === 1 ? "point" : "points"}.`}
              {" Forecast made "}
              <time dateTime={forecastAccuracy.record.generated_at}>{formatAuditTime(forecastAccuracy.record.generated_at)}</time>.
            </p>
          </div>
        </div>
      )}
      {error && <InlineError message={error} onRetry={onGenerate} />}
      {status === "generating" && !forecast ? (
        <div className="forecast-skeleton" role="status">
          <span className="sr-only">Generating forecast…</span>
          <div className="forecast-skeleton-grid">
            {[0, 1, 2, 3].map((i) => (
              <div className="forecast-skeleton-cell" key={i}>
                <span className="skeleton-line" style={{ height: 11, width: "55%" }} />
                <span className="skeleton-line" style={{ height: 22, width: "45%" }} />
                <span className="skeleton-line" style={{ height: 10, width: "70%" }} />
              </div>
            ))}
          </div>
          <div className="forecast-skeleton-copy">
            <span className="skeleton-line" style={{ height: 18, width: "65%" }} />
            <span className="skeleton-line" style={{ height: 12, width: "90%" }} />
            <span className="skeleton-line" style={{ height: 12, width: "80%" }} />
          </div>
        </div>
      ) : !forecast ? (
        <EmptyState
          icon={TrendingUp}
          title="No AI forecast yet."
          description={`The deterministic estimate is ${pct(deterministicReliableCapacity)}. Generate a forecast to add assumptions, constraints, scenarios, and planning recommendations.`}
        >
          <button
            className="secondary-action forecast-generate-action"
            type="button"
            onClick={onGenerate}
            disabled={!aiAvailable}
            title={aiAvailable ? undefined : AI_UNAVAILABLE_HINT}
          >
            <RefreshCw className="forecast-generate-icon" size={14} aria-hidden />
            <span>Generate Forecast</span>
          </button>
        </EmptyState>
      ) : (
        <div className={`forecast-result${isRevealingForecast ? " is-newly-generated" : ""}`}>
          <div className="forecast-summary">
            <div title="The AI's refined primary estimate of next week's reliable new-work capacity, shown with how confident the forecast is.">
              <span>AI reliable estimate</span>
              <strong>{pct(forecast.reliable_new_work_capacity_pct)}</strong>
              <small>{Math.round(forecast.confidence * 100)}% forecast confidence</small>
              <span className="sr-only">The AI's refined primary estimate of next week's reliable new-work capacity, shown with how confident the forecast is.</span>
            </div>
            <div title="The protected low-end figure to plan and commit against if the flagged risks don't clear.">
              <span>Conservative</span>
              <strong>{pct(forecast.conservative_capacity_pct)}</strong>
              <small>protected planning case</small>
              <span className="sr-only">The protected low-end figure to plan and commit against if the flagged risks don't clear.</span>
            </div>
            <div title="The expected-case capacity, the middle of the conservative-to-optimistic range.">
              <span>Likely</span>
              <strong>{pct(forecast.likely_capacity_pct)}</strong>
              <small>expected case</small>
              <span className="sr-only">The expected-case capacity, the middle of the conservative-to-optimistic range.</span>
            </div>
            <div title="The high-end capacity available only if the flagged risks clear.">
              <span>Optimistic</span>
              <strong>{pct(forecast.optimistic_capacity_pct)}</strong>
              <small>if risks clear</small>
              <span className="sr-only">The high-end capacity available only if the flagged risks clear.</span>
            </div>
          </div>
          <p className="forecast-baseline-note">
            These are the AI's scenario estimates, refined from the deterministic {pct(deterministicReliableCapacity)} reliable-capacity baseline.
          </p>
          <div
            className="forecast-range"
            role="img"
            aria-label={`Scenario range: conservative ${pct(forecast.conservative_capacity_pct)}, likely ${pct(forecast.likely_capacity_pct)}, optimistic ${pct(forecast.optimistic_capacity_pct)}`}
          >
            <div className="forecast-range-track">
              <div className="forecast-range-fill" style={{ width: `${likelyLeft}%` }} />
              <div className="forecast-range-marker" style={{ left: `${likelyLeft}%` }} />
            </div>
            <div className="forecast-range-label-row">
              <span>Conservative · {pct(forecast.conservative_capacity_pct)}</span>
              {showLikelyLabel && (
                <span className="forecast-range-label-center" style={{ left: `${likelyLeft}%` }}>Likely · {pct(forecast.likely_capacity_pct)}</span>
              )}
              <span>Optimistic · {pct(forecast.optimistic_capacity_pct)}</span>
            </div>
          </div>
          <div className="forecast-copy">
            <h3>{forecast.headline}</h3>
            <p>{forecast.summary_text}</p>
          </div>
          <div className="forecast-grid">
            <ForecastList title="Constraints" items={forecast.key_constraints} />
            <ForecastList title="Risk flags" items={forecast.risk_flags} />
            <ForecastList title="Recommended actions" items={forecast.recommended_actions} />
            <ForecastList title="Assumptions" items={forecast.assumptions} />
          </div>
        </div>
      )}
    </section>
  );
}
