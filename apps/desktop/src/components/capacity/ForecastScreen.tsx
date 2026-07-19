import { useMemo } from "react";
import { ArrowRight, Scale, TrendingUp, Upload } from "lucide-react";
import type { UserCorrection } from "../../../../../packages/domain/src/models";
import type { Screen } from "../../lib/types";
import type { PersistedForecastRecord, ForecastAccuracyReview, PersistedSnapshotRecord } from "../../services/localStore";
import { analyzeCorrections } from "../../../../../packages/inference/src/capacity";
import type { computeWeeklyCapacitySnapshot, ForecastAccuracyTrend, ForecastTrackRecordEntry } from "../../../../../packages/inference/src/capacity";
import { fieldLabel, humanizeCorrectionValue, pct } from "../../lib/format";
import { EmptyState } from "../common/EmptyState";
import { ForecastAgentPanel } from "./ForecastAgentPanel";
import { CapacityTrendChart } from "./CapacityTrendChart";
import { ForecastTrackRecord } from "./ForecastTrackRecord";

export function ForecastScreen({
  snapshot,
  snapshotHistory,
  nextWeekRangeLabel,
  corrections,
  generatedForecast,
  forecastAccuracy,
  forecastAccuracyTrend,
  forecastTrackRecord,
  forecastStatus,
  forecastError,
  onGenerateForecast,
  hasWorkBlocks,
  aiAvailable,
  onOpenScreen,
}: {
  snapshot: ReturnType<typeof computeWeeklyCapacitySnapshot>;
  snapshotHistory: PersistedSnapshotRecord[];
  nextWeekRangeLabel: string;
  onOpenScreen: (screen: Screen) => void;
  corrections: UserCorrection[];
  generatedForecast: PersistedForecastRecord | null;
  forecastAccuracy: ForecastAccuracyReview | null;
  forecastAccuracyTrend: ForecastAccuracyTrend | null;
  forecastTrackRecord: ForecastTrackRecordEntry[];
  forecastStatus: "idle" | "generating" | "error";
  forecastError: string | null;
  onGenerateForecast: () => void;
  hasWorkBlocks: boolean;
  aiAvailable: boolean;
}) {
  // Close the correction feedback loop: surface systematic mislabels the user keeps fixing so
  // the forecast can be read with the model's known blind spots in mind. No retraining.
  const biasAnalysis = useMemo(() => analyzeCorrections(corrections), [corrections]);
  if (!hasWorkBlocks) {
    return (
      <section className="screen forecast-screen">
        <div className="screen-header">
          <div>
            <p className="eyebrow">Weekly forecast</p>
            <h1>No forecast inputs yet.</h1>
          </div>
        </div>
        <EmptyState
          icon={TrendingUp}
          title="Nothing to forecast."
          description="The Forecast Agent projects next week's reliable capacity from this week's work blocks. Import Outlook events or classify active-window sessions first, then generate a forecast."
        >
          <button className="primary-action" type="button" onClick={() => onOpenScreen("setup")}>
            <Upload size={16} aria-hidden />
            <span>Import calendar in Settings</span>
          </button>
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="screen forecast-screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">Weekly forecast</p>
          <h1>Next week: {nextWeekRangeLabel}.</h1>
          <p className="screen-intro">
            This week's model leaves {pct(snapshot.reliable_new_work_capacity_pct)} reliable capacity —
            the baseline the AI forecast refines for next week. Generate one to add assumptions,
            constraints, scenarios, and planning recommendations.
          </p>
        </div>
      </div>
      {biasAnalysis.biases.length > 0 && (
        <section className="model-bias-note" aria-label="Model bias from your corrections">
          <div className="model-bias-header">
            <Scale size={16} aria-hidden className="model-bias-icon" />
            <div>
              <strong>Model bias from your corrections</strong>
              <p>
                You've repeatedly re-labeled the same things, so the model likely mislabels these the
                same way again — weigh the forecast accordingly until the pattern clears.
              </p>
            </div>
          </div>
          <ul className="model-bias-list">
            {biasAnalysis.biases.map((bias) => (
              <li key={`${bias.field}-${bias.from_value}-${bias.to_value}`}>
                <span className="model-bias-field">{fieldLabel(bias.field)}</span>
                <span
                  className="model-bias-change"
                  title={`${humanizeCorrectionValue(bias.field, bias.from_value)} → ${humanizeCorrectionValue(bias.field, bias.to_value)}`}
                >
                  <span className="model-bias-from">{humanizeCorrectionValue(bias.field, bias.from_value)}</span>
                  <ArrowRight size={12} aria-hidden />
                  <span className="model-bias-to">{humanizeCorrectionValue(bias.field, bias.to_value)}</span>
                </span>
                <span className="model-bias-count" title={`Corrected ${bias.count} times`}>
                  ×{bias.count}
                  <span className="sr-only"> corrections of this label</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ForecastAgentPanel
        generatedForecast={generatedForecast}
        forecastAccuracy={forecastAccuracy}
        nextWeekRangeLabel={nextWeekRangeLabel}
        status={forecastStatus}
        error={forecastError}
        deterministicReliableCapacity={snapshot.reliable_new_work_capacity_pct}
        aiAvailable={aiAvailable}
        onGenerate={onGenerateForecast}
      />
      {/* Week-over-week context lives with the forecast: the trajectory behind
          the projection, then how past forecasts actually scored (the rolling
          accuracy trend heads the track record). Both render nothing until
          enough history has accumulated. */}
      <CapacityTrendChart snapshot={snapshot} snapshotHistory={snapshotHistory} />
      <ForecastTrackRecord entries={forecastTrackRecord} trend={forecastAccuracyTrend} />
    </section>
  );
}
