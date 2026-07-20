"use client";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";
import { useState, type ReactNode } from "react";

import {
  aggregateReplicaModes,
  aggregateReplicaCategories,
  capacityForPresentation,
  capacityCoverage,
  categoryColor,
  displayPercent,
  isElevatedRatioScore,
  ratioScorePercent,
  safePercent,
} from "@/lib/personalWeekPresentation";

function pct(value: number): string {
  return `${Math.round(displayPercent(value))}%`;
}

function formatCapacityHours(value: number): string {
  const hours = (Math.max(0, value) / 100) * 40;
  if (hours > 0 && hours < 1) return `${Math.round(hours * 60)}m`;
  return `${Number(hours.toFixed(1))}h`;
}

type CapacityIconName = "calendar" | "focus" | "message" | "plus" | "lightbulb" | "info" | "chevron";

function CapacityIcon({ id, size = 18 }: { id: CapacityIconName; size?: number }) {
  const paths: Record<CapacityIconName, ReactNode> = {
    calendar: <><path d="M5 4v3M19 4v3M4 9h16" /><rect x="3" y="5" width="18" height="16" rx="2" /></>,
    focus: <><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /><circle cx="12" cy="12" r="3" /></>,
    message: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    lightbulb: <><path d="M9 18h6M10 22h4" /><path d="M8.4 14.5A7 7 0 1 1 15.6 14.5C14.6 15.3 14 16.2 14 18h-4c0-1.8-.6-2.7-1.6-3.5Z" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
    chevron: <path d="m7 10 5 5 5-5" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[id]}
    </svg>
  );
}

export function PersonalWeekOverview({
  replica,
}: {
  replica: PersonalWorkloadReplicaV1;
}) {
  const [showAllCategories, setShowAllCategories] = useState(false);
  const capacity = replica.capacity;
  const hasCurrentWeekSignal = replica.blocks.length > 0;
  const displayCapacity = capacityForPresentation(capacity, hasCurrentWeekSignal);
  const available = safePercent(displayCapacity.reliableNewWorkCapacityPct);
  const coverage = capacityCoverage(displayCapacity, hasCurrentWeekSignal);
  const categories = aggregateReplicaCategories(replica.blocks, Number.POSITIVE_INFINITY);
  const visibleCategories = showAllCategories ? categories : categories.slice(0, 5);
  const maxCategoryCapacity = Math.max(1, ...categories.map((category) => category.capacityPct));
  const metrics = [
    {
      key: "committed",
      icon: "calendar" as const,
      label: "Committed",
      value: displayCapacity.committedUtilizationPct,
      helper: "Work and risk already carried by the week",
    },
    {
      key: "planned",
      icon: "focus" as const,
      label: "Planned work",
      value: displayCapacity.plannedPct,
      helper: "Work scheduled ahead of time",
    },
    {
      key: "reactive",
      icon: "message" as const,
      label: "Reactive work",
      value: displayCapacity.reactivePct,
      helper: "Unplanned requests and interruption time",
    },
    {
      key: "available",
      icon: "plus" as const,
      label: "New work capacity",
      value: displayCapacity.reliableNewWorkCapacityPct,
      helper: "Dependable room for new planned work",
    },
  ];
  const modeTone: Record<string, string> = {
    "Deep work": "deep",
    Reactive: "reactive",
    Collaborative: "collaborative",
    Fragmented: "fragmented",
    Blocked: "blocked",
  };
  const workModes = aggregateReplicaModes(replica.blocks).map((mode) => ({
    label: mode.label === "Blocked" ? "Blocked / other" : mode.label,
    value: mode.capacityPct,
    share: mode.sharePct,
    tone: modeTone[mode.label] ?? "blocked",
  }));
  const allocatedModeTotal = workModes.reduce((sum, mode) => sum + mode.value, 0);
  let donutCursor = 0;
  const donutSegments = workModes.map((mode) => {
    const segment = { ...mode, start: donutCursor };
    donutCursor += mode.share;
    return segment;
  });
  const focusTip = !hasCurrentWeekSignal
    ? {
        title: "Review work on your Mac",
        detail: "Review or import work in Weekform for Mac, then sync this derived weekly picture again.",
      }
    : replica.blocks.some((block) => block.blockerFlag)
    ? {
        title: "Clear active blockers",
        detail: "Resolving blocked work is the fastest way to reduce carryover risk.",
      }
    : isElevatedRatioScore(displayCapacity.contextSwitchScore, 0.3)
      ? {
          title: "Protect more deep-work time",
          detail: "Batch meetings and reactive requests to preserve longer focus blocks.",
        }
      : displayCapacity.reactivePct >= 25
        ? {
            title: "Batch reactive requests",
            detail: "Create set response windows so unplanned work interrupts less of the week.",
          }
        : {
            title: "Keep the delivery buffer intact",
            detail: "Use available capacity for one focused commitment instead of several small ones.",
          };

  return (
    <div className="personal-week-overview capacity-dashboard" aria-label="Weekly capacity dashboard">
      <section
        className="personal-week-hero week-dashboard-hero"
        aria-labelledby="week-capacity-headline"
      >
        <div
          className="personal-week-gauge week-dashboard-gauge"
          role="img"
          aria-label={hasCurrentWeekSignal
            ? `${pct(available)} dependable capacity for new planned work`
            : "No review-safe work is available for this week yet"}
        >
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle className="personal-week-gauge-track" cx="60" cy="60" r="50" pathLength="100" />
            <circle
              className="personal-week-gauge-fill"
              cx="60"
              cy="60"
              r="50"
              pathLength="100"
              style={{ strokeDasharray: `${available} 100` }}
            />
          </svg>
          <span><strong>{pct(available)}</strong><small>available</small></span>
        </div>
        <div className="personal-week-hero-copy">
          {hasCurrentWeekSignal ? (
            <>
              <h1 id="week-capacity-headline">
                You have {pct(available)} capacity for new planned work.
              </h1>
              <p>
                {pct(displayCapacity.committedUtilizationPct)} of the week is already committed.{" "}
                {available >= 30
                  ? "There is room for another focused commitment while keeping a healthy delivery buffer."
                  : available >= 15
                    ? "Keep new commitments focused to protect delivery."
                    : available > 0
                      ? "Capacity is tight—keep additional commitments small until some load clears."
                      : "Let existing work clear before committing to more planned work."}{" "}
                This view contains derived workload signals only; the supporting activity stays on your Mac.
              </p>
            </>
          ) : (
            <>
              <h1 id="week-capacity-headline">No review-safe work this week yet.</h1>
              <p>
                Enable Private Web workspace in Weekform for Mac, review or import this week&apos;s work,
                then sync again. Until then, no capacity or delivery buffer is inferred here.
              </p>
            </>
          )}
        </div>
        <div className="personal-week-signal" aria-hidden="true">
          <span />
          <span />
          <span />
          <i />
        </div>
      </section>

      <section className="personal-week-metrics week-dashboard-metrics" aria-labelledby="week-summary-heading">
        <h2 id="week-summary-heading" className="sr-only">Capacity summary</h2>
        {metrics.map((metric) => {
          const value = safePercent(metric.value);
          return (
            <article className="personal-week-metric" data-tone={metric.key} key={metric.key}>
              <div className="personal-week-metric-heading">
                <span className="personal-week-metric-icon"><CapacityIcon id={metric.icon} /></span>
                <div><span>{metric.label}</span><strong>{pct(metric.value)}</strong></div>
              </div>
              <div
                className="personal-week-metric-track"
                role="progressbar"
                aria-label={metric.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(value)}
              ><span style={{ width: `${value}%` }} /></div>
              <p>{metric.helper}</p>
            </article>
          );
        })}
      </section>

      <div className="personal-week-detail-grid week-dashboard-main-grid">
        <section className="personal-week-panel week-dashboard-panel" aria-labelledby="personal-week-headroom-title">
          <header>
            <h4 id="personal-week-headroom-title">Commitment and headroom</h4>
            <span>How the modeled week is allocated</span>
          </header>
          <div className="personal-week-coverage-labels">
            <strong>{pct(coverage.committedPct)} committed</strong>
            <strong>{pct(coverage.availablePct)} available</strong>
          </div>
          <div
            className="personal-week-coverage-bar"
            role="img"
            aria-label={hasCurrentWeekSignal
              ? `${pct(coverage.committedPct)} committed, ${pct(coverage.availablePct)} available for new planned work, and ${pct(coverage.protectedPct)} protected as delivery buffer`
              : "No commitment, headroom, or protected delivery buffer is inferred until review-safe blocks sync"}
          >
            <span className="is-committed" style={{ width: `${coverage.committedPct}%` }} />
            <span className="is-available" style={{ width: `${coverage.availablePct}%` }} />
            <span className="is-protected" style={{ width: `${coverage.protectedPct}%` }} />
          </div>
          <div className="personal-week-coverage-legend" aria-hidden="true">
            <span><i className="is-committed" />Committed</span>
            <span><i className="is-available" />Available</span>
            <span><i className="is-protected" />Protected buffer</span>
          </div>
          <p className="personal-week-panel-note">
            {hasCurrentWeekSignal
              ? "Available capacity already accounts for recurring work, interruptions, carryover, and delivery risk."
              : "The allocation track stays empty until review-safe blocks sync from Weekform for Mac."}
          </p>

          <div className="personal-week-categories">
            <header>
              <div><h5>Top categories</h5><span>Share of tracked work</span></div>
              {categories.length > 5 ? (
                <button
                  type="button"
                  aria-expanded={showAllCategories}
                  aria-controls="personal-week-category-list"
                  onClick={() => setShowAllCategories((current) => !current)}
                >
                  {showAllCategories ? "Show top 5" : "View all"}
                </button>
              ) : null}
            </header>
            {categories.length === 0 ? (
              <p className="personal-week-empty">Categories appear after review-safe blocks sync.</p>
            ) : (
              <ul id="personal-week-category-list" aria-label="Tracked work by category">
                {visibleCategories.map((category) => (
                  <li key={category.label}>
                    <span className="personal-week-category-label" title={category.label}>
                      <i style={{ background: categoryColor(category.label) }} aria-hidden="true" />
                      <span>{category.label}</span>
                    </span>
                    <div aria-hidden="true"><i style={{ width: `${(category.capacityPct / maxCategoryCapacity) * 100}%`, background: categoryColor(category.label) }} /></div>
                    <strong>{formatCapacityHours(category.capacityPct)}</strong>
                    <span>{Math.round(category.sharePct)}%<span className="sr-only"> of tracked work</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="personal-week-panel personal-week-time week-dashboard-panel" aria-labelledby="personal-week-patterns-title">
          <header>
            <h4 id="personal-week-patterns-title">How tracked time is spent</h4>
            <span>Review-safe block modes within the time already allocated</span>
          </header>
          <div className="personal-week-time-layout">
            <div
              className="personal-week-donut"
              role="img"
              aria-label={donutSegments.length > 0
                ? `Tracked time by work mode: ${donutSegments.map((mode) => `${mode.label}, ${formatCapacityHours(mode.value)}, ${Math.round(mode.share)}%`).join("; ")}`
                : "No tracked work-mode time is available for this week"}
            >
              <svg viewBox="0 0 160 160" aria-hidden="true">
                <circle className="personal-week-donut-track" cx="80" cy="80" r="58" pathLength="100" />
                {donutSegments.map((mode) => {
                  const gap = donutSegments.length > 1 ? Math.min(1.2, mode.share * 0.16) : 0;
                  const visibleShare = Math.min(mode.share, Math.max(0, mode.share - gap));
                  return mode.share > 0 ? (
                    <circle
                      className="personal-week-donut-segment"
                      data-tone={mode.tone}
                      cx="80"
                      cy="80"
                      key={mode.label}
                      pathLength="100"
                      r="58"
                      strokeDasharray={`${visibleShare} ${100 - visibleShare}`}
                      strokeDashoffset={-mode.start}
                      transform="rotate(-90 80 80)"
                    />
                  ) : null;
                })}
              </svg>
              <span aria-hidden="true"><strong>{formatCapacityHours(allocatedModeTotal)}</strong><small>tracked</small></span>
            </div>
            <ul className="personal-week-time-legend">
              {donutSegments.map((mode) => (
                <li key={mode.label}>
                  <span><i data-tone={mode.tone} />{mode.label}</span>
                  <strong>{formatCapacityHours(mode.value)}</strong>
                  <small>{Math.round(mode.share)}%</small>
                </li>
              ))}
            </ul>
          </div>
          <div className="personal-week-tip">
            <span><CapacityIcon id="lightbulb" size={17} /></span>
            <div>
              <strong>Tip: {focusTip.title}</strong>
              <p>{focusTip.detail}</p>
            </div>
          </div>
        </section>
      </div>

      <details className="personal-week-explainability week-dashboard-explainability">
        <summary>
          <span className="personal-week-explainability-icon"><CapacityIcon id="info" size={17} /></span>
          <span>
            <strong>How this estimate is built</strong>
            <small>Review the delivery-risk signals included in this browser-safe view</small>
          </span>
          <span className="personal-week-explainability-chevron"><CapacityIcon id="chevron" size={17} /></span>
        </summary>
        <div className="personal-week-explainability-body">
          <header>
            <h3>Delivery-risk signals</h3>
            <span>Derived metrics only; supporting activity stays on your Mac</span>
          </header>
          <dl>
            <div><dt>Context switching</dt><dd>{ratioScorePercent(displayCapacity.contextSwitchScore)}/100</dd></div>
            <div><dt>Work in progress load</dt><dd>{ratioScorePercent(displayCapacity.wipLoadScore)}/100</dd></div>
            <div><dt>Carryover risk</dt><dd>{pct(displayCapacity.carryoverRiskPct)}</dd></div>
          </dl>
        </div>
      </details>
    </div>
  );
}
