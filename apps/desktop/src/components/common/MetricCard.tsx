import { pct } from "../../lib/format";
import { CapacityRing } from "./CapacityRing";

export function MetricCard({
  label,
  value,
  helper,
  showRing,
  title,
}: {
  label: string;
  value: number | string;
  helper: string;
  showRing?: boolean;
  /** Plain-language gloss for jargon in `helper`; shown as a hover tooltip and to screen readers. */
  title?: string;
}) {
  return (
    <div className={`metric-card${showRing ? " has-ring" : ""}`} title={title}>
      <span>{label}</span>
      {showRing && typeof value === "number" ? (
        <div className="metric-ring-row">
          <CapacityRing value={value} />
          <strong>{pct(value)}</strong>
        </div>
      ) : (
        <strong>{typeof value === "number" ? pct(value) : value}</strong>
      )}
      <small>{helper}</small>
      {title ? <span className="sr-only">{title}</span> : null}
    </div>
  );
}
