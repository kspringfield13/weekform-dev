/**
 * Shared "Why this …?" evidence drill-down — a collapsible `<details>` that lists the
 * derived evidence lines and the source ids a signal/block was derived from. Used by
 * `BlockCard` ("Why this estimate?") and `AccelerationScreen` ("Why this play?") so the
 * evidence-rendering markup lives in one place. Privacy: callers pass derived-only evidence
 * (app names, counts, ids) — never raw window titles.
 */
export function EvidenceDetails({
  summary,
  evidence,
  derivedFrom,
  emptyText,
  className,
}: {
  summary: string;
  evidence: string[];
  derivedFrom: string[];
  emptyText: string;
  /** Extra class on the `<details>` (e.g. `play-evidence`) alongside the base `evidence`. */
  className?: string;
}) {
  return (
    <details className={className ? `evidence ${className}` : "evidence"}>
      <summary>{summary}</summary>
      {evidence.length > 0 && (
        <ul>
          {evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {derivedFrom.length > 0 && (
        <div className="evidence-derived">
          <p className="evidence-derived-label">Derived from</p>
          <small className="evidence-derived-note">
            Source records in your local activity ledger
          </small>
          <ul className="evidence-derived-list">
            {derivedFrom.map((source) => (
              <li key={source}>
                <code>{source}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {evidence.length === 0 && derivedFrom.length === 0 && (
        <p className="evidence-empty">{emptyText}</p>
      )}
    </details>
  );
}
