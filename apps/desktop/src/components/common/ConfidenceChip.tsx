export function ConfidenceChip({ value, glossLabel = "classification" }: { value: number; glossLabel?: string }) {
  if (value === 0 || !Number.isFinite(value)) {
    return <span className="confidence unscored">Unscored</span>;
  }
  const pct = Math.round(value * 100);
  // Derive the level word from the already-rounded pct (not the raw float) so the
  // word and the displayed number can never disagree — e.g. value 0.847 shows 85%
  // and must read "High", not "Medium".
  const level = pct >= 85 ? "High" : pct >= 74 ? "Medium" : "Needs review";
  return <span className={`confidence ${level === "Needs review" ? "low" : level.toLowerCase()}`} title={`${pct}% ${glossLabel} confidence`}>{level} {pct}%</span>;
}
