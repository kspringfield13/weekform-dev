import { ArrowRight, History } from "lucide-react";
import type { ForecastAccuracyTrend, ForecastTrackRecordEntry } from "../../../../../packages/inference/src/capacity";
import { forecastBiasPhrase, forecastRatingLabel, formatIsoWeekLabel, pct } from "../../lib/format";

// Audit trail for the forecast model: list how each past forecast landed against the
// capacity the model later computed for the week it targeted, with the rolling accuracy
// trend as the header summary. Pairing/scoring happens in useDerived
// (`forecastTrackRecord` / `forecastAccuracyTrend`); this is presentation-only.
export function ForecastTrackRecord({
  entries,
  trend,
}: {
  entries: ForecastTrackRecordEntry[];
  trend: ForecastAccuracyTrend | null;
}) {
  if (entries.length === 0) return null;

  return (
    <section className="forecast-track-record" aria-label="Forecast track record">
      <div className="forecast-track-record-header">
        <History size={16} aria-hidden className="forecast-track-record-icon" />
        <div>
          <strong className="forecast-track-record-title">Forecast track record</strong>
          <p>
            {trend && trend.week_count >= 2 ? (
              <>
                Forecasts have averaged <strong>±{trend.mean_abs_error_pts} pts</strong> over the
                last {trend.week_count} weeks
                {forecastBiasPhrase(trend.mean_signed_error_pts)
                  ? <> — the model {forecastBiasPhrase(trend.mean_signed_error_pts)}.</>
                  : "."}
              </>
            ) : (
              "How past forecasts landed against the reliable capacity the model later computed for each week."
            )}
          </p>
        </div>
      </div>
      <ul className="forecast-track-record-list">
        {entries.map((entry) => {
          const deltaLabel =
            entry.error_pts === 0
              ? "exactly on target"
              : `${entry.signed_error_pts > 0 ? "over" : "under"}-predicted by ${entry.error_pts} ${entry.error_pts === 1 ? "point" : "points"}`;
          return (
            <li
              key={entry.week_id}
              className={`forecast-track-record-row forecast-track-record-row--${entry.rating}`}
            >
              <span className="forecast-track-record-week">{formatIsoWeekLabel(entry.week_id)}</span>
              <span className="forecast-track-record-values">
                <span className="forecast-track-record-metric">
                  Predicted <strong>{pct(entry.predicted_pct)}</strong>
                </span>
                <ArrowRight size={12} aria-hidden />
                <span className="forecast-track-record-metric">
                  Actual <strong>{pct(entry.actual_pct)}</strong>
                </span>
              </span>
              <span
                className={`forecast-track-record-chip forecast-track-record-chip--${entry.rating}`}
                title={deltaLabel}
              >
                {forecastRatingLabel(entry.rating)}
                <span className="sr-only">, {deltaLabel}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
