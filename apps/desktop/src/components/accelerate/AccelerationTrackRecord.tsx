import { ArrowRight, TrendingUp } from "lucide-react";
import type {
  RealizedSavingsEntry,
  RealizedSavingsSummary,
} from "../../../../../packages/inference/src/accelerate";
import {
  accelerationTypeLabel,
  formatDurationMinutes,
  formatIsoWeekLabel,
  realizedSavingsRatingLabel,
} from "../../lib/format";

// Proof, not claims: for every play the user marked acted-on, show how the engine's projected
// weekly saving landed against the observed reduction the following week. Scoring/pairing happens
// in useDerived (`realizedSavings`/`realizedSavingsSummary`); this is presentation-only.
export function AccelerationTrackRecord({
  entries,
  summary,
  titleBySignalId,
}: {
  entries: RealizedSavingsEntry[];
  summary: RealizedSavingsSummary | null;
  // signal_id → live play title, so a still-mined play names itself; absent ones fall back to type.
  titleBySignalId: Map<string, string>;
}) {
  if (entries.length === 0 || !summary) return null;

  // The totals are cumulative sums across every scored week-over-week comparison (a play tracked over
  // N weeks contributes N times) — so this is a running total, NOT a per-week rate. The beat / on
  // track / below breakdown is shown so a single large "beat" can't mask a run of misses.
  const comparisonNoun = summary.scored_count === 1 ? "comparison" : "comparisons";
  const breakdownParts: string[] = [];
  if (summary.beat_count > 0) breakdownParts.push(`${summary.beat_count} beat`);
  if (summary.met_count > 0) breakdownParts.push(`${summary.met_count} on track`);
  if (summary.missed_count > 0) breakdownParts.push(`${summary.missed_count} below`);
  const breakdown = breakdownParts.join(" · ");

  return (
    <section className="acceleration-track-record" aria-label="Realized savings track record">
      <div className="acceleration-track-record-header">
        <TrendingUp size={16} aria-hidden className="acceleration-track-record-icon" />
        <div>
          <strong>Realized savings</strong>
          <p>
            Across {summary.scored_count} week-over-week {comparisonNoun}, plays you've acted on show
            about {formatDurationMinutes(summary.total_realized_minutes)} reclaimed against the ~
            {formatDurationMinutes(summary.total_projected_minutes)} they projected
            {breakdown ? ` (${breakdown})` : ""}. Each row compares a play's projected saving against
            the observed reduction the following week — correlational evidence to review, not proof
            the action alone drove it.
          </p>
        </div>
      </div>
      <ul className="acceleration-track-record-list">
        {entries.map((entry) => {
          const playName =
            titleBySignalId.get(entry.signal_id) ?? `${accelerationTypeLabel(entry.type)} play`;
          const realizedLabel =
            entry.realized_minutes >= 0
              ? `~${formatDurationMinutes(entry.realized_minutes)} reclaimed`
              : `load rose ~${formatDurationMinutes(Math.abs(entry.realized_minutes))}`;
          const deltaGloss =
            entry.rating === "beat"
              ? `reclaimed ~${formatDurationMinutes(entry.realized_minutes)} against a ~${formatDurationMinutes(entry.projected_minutes)} projection`
              : entry.rating === "met"
                ? `reclaimed ~${formatDurationMinutes(Math.max(0, entry.realized_minutes))}, near the ~${formatDurationMinutes(entry.projected_minutes)} projected`
                : `reclaimed ${entry.realized_minutes >= 0 ? `~${formatDurationMinutes(entry.realized_minutes)}` : "nothing"}, below the ~${formatDurationMinutes(entry.projected_minutes)} projected`;
          return (
            <li
              key={`${entry.signal_id}-${entry.week_id}`}
              className={`acceleration-track-record-row acceleration-track-record-row--${entry.rating}`}
            >
              <span className="acceleration-track-record-play">
                <span className="acceleration-track-record-name">{playName}</span>
                <span className="acceleration-track-record-week">
                  {formatIsoWeekLabel(entry.week_id)}
                </span>
              </span>
              <span className="acceleration-track-record-values">
                <span className="acceleration-track-record-metric">
                  Projected <strong>~{formatDurationMinutes(entry.projected_minutes)}</strong>
                </span>
                <ArrowRight size={12} aria-hidden />
                <span className="acceleration-track-record-metric">{realizedLabel}</span>
              </span>
              <span
                className={`acceleration-track-record-chip acceleration-track-record-chip--${entry.rating}`}
                title={deltaGloss}
              >
                {realizedSavingsRatingLabel(entry.rating)}
                <span className="sr-only">, {deltaGloss}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
