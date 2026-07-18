export function ForecastList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="forecast-list">
      <strong>{title}</strong>
      {/* An empty forecast category is a real, reachable state (the AI can return `[]` for e.g.
          risk_flags on a clean week). Render an explicit muted placeholder rather than an empty
          `<ul>`, which reads as a semantically-empty "list, 0 items" to screen readers and looks
          like a data gap to sighted users — "None identified" is the actual (positive) signal. */}
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${index}-${item.slice(0, 20)}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="forecast-list-empty">None identified</p>
      )}
    </div>
  );
}
