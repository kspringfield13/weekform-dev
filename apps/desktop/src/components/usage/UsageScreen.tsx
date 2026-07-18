import { Activity, Settings } from "lucide-react";
import type {
  TokenUsageDay,
  TokenUsageSettings,
  WeeklyAIUsageSummary
} from "../../../../../packages/domain/src/models";
import type { SettingsTab } from "../../lib/types";
import { formatCount, formatDurationMinutes, formatTokenCount } from "../../lib/format";
import { EmptyState } from "../common/EmptyState";
import { MetricCard } from "../common/MetricCard";
import { DailyUsageChart } from "./DailyUsageChart";

function modelMeasuredTokens(row: WeeklyAIUsageSummary["by_model"][number]): number {
  return row.input_tokens + row.output_tokens + row.cache_creation_tokens;
}

/**
 * AI Usage — the chart visualizes measured tokens only. Locally observed
 * estimates remain explicitly labeled in the weekly summary and model table.
 */
export function UsageScreen({
  summary,
  tokenUsageDays,
  proxyUsageDays,
  tokenUsageSettings,
  todayKey,
  onOpenSettingsTab
}: {
  summary: WeeklyAIUsageSummary;
  tokenUsageDays: TokenUsageDay[];
  proxyUsageDays: TokenUsageDay[];
  tokenUsageSettings: TokenUsageSettings;
  todayKey: string;
  onOpenSettingsTab: (tab: SettingsTab) => void;
}) {
  const hasAnyData = tokenUsageDays.length > 0 || proxyUsageDays.length > 0;
  const anySourceEnabled = tokenUsageSettings.observed_proxy_enabled;

  const measuredTokens =
    summary.exact.input_tokens + summary.exact.output_tokens + summary.exact.cache_creation_tokens;
  const usageHeadline =
    measuredTokens > 0 && summary.exact.prompt_count > 0
      ? `${formatTokenCount(measuredTokens)} measured tokens across ${formatCount(summary.exact.prompt_count)} ${summary.exact.prompt_count === 1 ? "prompt" : "prompts"}.`
      : measuredTokens > 0
        ? `${formatTokenCount(measuredTokens)} measured tokens captured this week.`
        : summary.proxy.session_minutes > 0
          ? `${formatDurationMinutes(summary.proxy.session_minutes)} of observed AI assistance this week.`
          : "See how AI supports your work.";

  const costTile = summary.cost.total_usd === null ? "—" : `$${summary.cost.total_usd.toFixed(2)}`;
  const costHelper =
    summary.cost.coverage === "full"
      ? summary.cost.authoritative_usd > 0
        ? "Includes costs carried by CSV imports"
        : "Computed from your model price map"
      : summary.cost.coverage === "partial"
        ? `${summary.cost.unpriced_models.length} model${summary.cost.unpriced_models.length === 1 ? "" : "s"} unpriced — total is partial`
        : "Add model prices in Settings to see cost";

  return (
    <section className="screen usage-screen">
      <div className="screen-header usage-screen-header">
        <div>
          <p className="eyebrow">Weekly AI usage</p>
          <h1>{usageHeadline}</h1>
          <p className="screen-intro">
            See when AI supported your work and which models carried the load. Provider tokens are
            measured; assistant activity inferred from local signals is always labeled as an estimate.
          </p>
        </div>
      </div>

      {!hasAnyData ? (
        <EmptyState
          icon={Activity}
          title="Nothing measured yet."
          description={
            anySourceEnabled
              ? "Observed estimates appear as AI-assistant activity is captured. Import a usage CSV to add measured token totals."
              : "Enable observed estimates or import a usage CSV to start tracking AI assistance."
          }
        >
          <button className="secondary-action" type="button" onClick={() => onOpenSettingsTab("ai-usage")}>
            <Settings size={15} aria-hidden />
            <span>Open Settings</span>
          </button>
        </EmptyState>
      ) : (
        <>
          <div className="hero-metrics usage-metrics">
            <MetricCard
              label="Measured tokens"
              value={formatTokenCount(measuredTokens)}
              helper="Input + output + cache writes this week"
              title="Token totals measured from imported provider CSVs. Cache reads are tracked but excluded from this headline."
            />
            <MetricCard
              label="Measured prompts"
              value={formatCount(summary.exact.prompt_count)}
              helper="Distinct AI messages this week"
              title="One per API message found in a measured source — never estimated."
            />
            <MetricCard
              label="Observed assistant time"
              value={
                summary.proxy.session_minutes > 0
                  ? formatDurationMinutes(summary.proxy.session_minutes)
                  : "—"
              }
              helper={
                summary.proxy.session_minutes > 0
                  ? `Estimate · ~${formatCount(summary.proxy.estimated_prompt_count)} prompts across ${summary.proxy.assistant_count} assistant${summary.proxy.assistant_count === 1 ? "" : "s"}`
                  : tokenUsageSettings.observed_proxy_enabled
                    ? "No AI-assistant sessions observed"
                    : "Observed estimates are off"
              }
              title="Time spent in AI assistant apps and browser tabs, derived from your captured activity. Always an estimate — token counts are not observable for these sessions."
            />
            <MetricCard
              label="Estimated cost"
              value={costTile}
              helper={costHelper}
              title="A computed overlay: authoritative CSV costs where present, otherwise your Settings price map applied to measured tokens. Tokens remain the source of truth."
            />
          </div>

          <DailyUsageChart
            tokenUsageDays={tokenUsageDays}
            todayKey={todayKey}
            weekOverWeek={summary.week_over_week}
          />

          <section className="usage-model-card" aria-labelledby="usage-model-title">
            <div className="usage-model-header">
              <div>
                <p className="eyebrow">Model mix</p>
                <h2 id="usage-model-title">This week by model</h2>
                <p>Cache writes are included in measured totals; cache reads remain visible but separate.</p>
              </div>
              <span className="usage-model-count">
                {summary.by_model.length} {summary.by_model.length === 1 ? "source" : "sources"}
              </span>
            </div>

            {summary.by_model.length === 0 ? (
              <p className="usage-quiet-note">No usage recorded in {summary.week_id} yet.</p>
            ) : (
              <div className="usage-table-wrap">
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col">Source grade</th>
                      <th scope="col">Usage</th>
                      <th scope="col">Prompts</th>
                      <th scope="col">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.by_model.map((row) => (
                      <tr key={`${row.provider}|${row.model}|${row.measurement}`}>
                        <th scope="row">
                          {row.model}
                          <small>{row.provider}</small>
                        </th>
                        <td>
                          {row.measurement === "exact" ? (
                            <span className="usage-grade usage-grade-exact">Measured</span>
                          ) : (
                            <span className="usage-grade usage-grade-proxy">Estimate</span>
                          )}
                        </td>
                        <td>
                          {row.measurement === "exact" ? (
                            <div className="usage-model-volume">
                              <strong>{formatTokenCount(modelMeasuredTokens(row))} tokens</strong>
                              <span>
                                {formatTokenCount(row.input_tokens)} in · {formatTokenCount(row.output_tokens)} out
                                {row.cache_creation_tokens > 0
                                  ? ` · ${formatTokenCount(row.cache_creation_tokens)} cache writes`
                                  : ""}
                              </span>
                              {row.cache_read_tokens > 0 && (
                                <span>{formatTokenCount(row.cache_read_tokens)} cache reads tracked separately</span>
                              )}
                            </div>
                          ) : (
                            <div className="usage-model-volume">
                              <strong>{formatDurationMinutes(row.session_minutes)}</strong>
                              <span>Observed assistant time</span>
                            </div>
                          )}
                        </td>
                        <td>
                          {row.measurement === "exact"
                            ? formatCount(row.prompt_count)
                            : `~${formatCount(row.prompt_count)}`}
                        </td>
                        <td>
                          {row.measurement === "proxy" ? (
                            <span
                              title="Cost not applicable — token cost isn't observable for estimated assistant sessions"
                              aria-label="Cost not applicable — token cost isn't observable for estimated assistant sessions"
                            >
                              —
                            </span>
                          ) : row.cost_usd === null ? (
                            <button
                              className="usage-price-link"
                              type="button"
                              onClick={() => onOpenSettingsTab("ai-usage")}
                            >
                              Add price
                            </button>
                          ) : (
                            `$${row.cost_usd.toFixed(2)}`
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
