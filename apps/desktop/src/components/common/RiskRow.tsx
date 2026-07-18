export function RiskRow({
  label,
  value,
  tooltip,
  hint,
  caption,
  displayValue,
  dangerActive,
}: {
  label: string;
  value: number;
  tooltip?: string;
  hint?: string;
  caption?: string;
  displayValue?: number;
  dangerActive?: boolean;
}) {
  const bounded = Math.max(0, Math.min(1, value));
  const shown = displayValue !== undefined ? displayValue : Math.round(bounded * 100);
  const severity = dangerActive
    ? undefined
    : bounded < 0.34
      ? "low"
      : bounded < 0.67
        ? "mid"
        : "high";
  return (
    <div className="risk-row">
      <div className="risk-row-label">
        <span title={tooltip}>{label}</span>
        {caption && <p className="risk-caption">{caption}</p>}
      </div>
      <div
        className="risk-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={shown}
        aria-valuetext={dangerActive ? `${label}: ${shown}` : `${shown} of 100, ${severity} severity`}
      >
        <span
          data-severity={severity}
          style={{
            width: `${bounded * 100}%`,
            ...(dangerActive ? { background: "var(--danger)" } : {}),
          }}
        />
      </div>
      <strong className={dangerActive ? "risk-blocker-count" : undefined}>
        {shown}
        {hint && <span className="risk-hint">{hint}</span>}
      </strong>
    </div>
  );
}
