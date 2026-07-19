import type { LatestSnapshot } from "@/lib/snapshots";
import {
  classifyFreshness,
  confidenceLabel,
  freshnessLabel,
  memberRiskFlags,
  reviewCoveragePct,
  type Freshness,
} from "@/lib/workload";

/**
 * Shared presentational pieces for rendering one member's shared workload
 * snapshot. Server components only — no client JS. Copy rules: omitted
 * metrics render literally as "Not shared" (never 0%), stale data is always
 * labeled, and nothing here ranks or scores people.
 */

export function formatPct(value: number | null): string {
  return value === null ? "Not shared" : `${Math.round(value)}%`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function shareLevelLabel(level: string): string {
  switch (level) {
    case "summary":
      return "Summary metrics";
    case "categories":
      return "Summary + categories";
    case "projects":
      return "Summary + projects";
    default:
      return level;
  }
}

export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  const cls =
    freshness === "fresh"
      ? "badge badge-ok"
      : freshness === "aging"
        ? "badge"
        : "badge badge-warn";
  return <span className={cls}>{freshnessLabel(freshness)}</span>;
}

/** Definition list of a snapshot's shared metrics, honest about omissions. */
export function SnapshotMetricList({ snapshot }: { snapshot: LatestSnapshot }) {
  const rows: Array<[string, string]> = [
    ["Reliable capacity", formatPct(snapshot.reliableCapacityPct)],
    ["Reactive load", formatPct(snapshot.reactivePct)],
    ["Meetings", formatPct(snapshot.meetingPct)],
    ["Fragmented work", formatPct(snapshot.fragmentedPct)],
  ];

  const coverage = reviewCoveragePct(
    snapshot.reviewedBlocks,
    snapshot.eligibleBlocks,
  );
  rows.push([
    "Review coverage",
    coverage === null
      ? "No reviewable blocks yet"
      : `${coverage}% (${snapshot.reviewedBlocks} of ${snapshot.eligibleBlocks} blocks)`,
  ]);

  const confidence = confidenceLabel(snapshot.summaryConfidence);
  rows.push(["Confidence", confidence === null ? "Not shared" : confidence]);

  return (
    <dl className="metric-list">
      {rows.map(([label, value]) => (
        <div className="metric-row" key={label}>
          <dt>{label}</dt>
          <dd className={value === "Not shared" ? "metric-muted" : undefined}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Deterministic risk flags with their explanations, or nothing at all. */
export function SnapshotRiskFlags({
  snapshot,
  nowIso,
}: {
  snapshot: LatestSnapshot;
  nowIso: string;
}) {
  const flags = memberRiskFlags(snapshot, nowIso);
  if (flags.length === 0) {
    return null;
  }
  return (
    <ul className="flag-list">
      {flags.map((flag) => (
        <li
          key={flag.id}
          className={flag.severity === "warning" ? "flag flag-warning" : "flag"}
        >
          <strong>{flag.title}.</strong> {flag.explanation}
        </li>
      ))}
    </ul>
  );
}

export function snapshotFreshness(
  snapshot: LatestSnapshot,
  nowIso: string,
): Freshness {
  return classifyFreshness(snapshot.observedAt, nowIso);
}
