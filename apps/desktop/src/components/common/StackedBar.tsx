import { computeWeeklyCapacitySnapshot } from "../../../../../packages/inference/src/capacity";
import { categoryColors } from "../../../../../packages/domain/src/taxonomy";

interface StackedBarProps {
  snapshot: ReturnType<typeof computeWeeklyCapacitySnapshot>;
  hoveredCategory?: string | null;
  onHoverCategory?: (label: string | null) => void;
}

export function StackedBar({ snapshot, hoveredCategory, onHoverCategory }: StackedBarProps) {
  const total = snapshot.category_allocation.reduce((acc, item) => acc + item.value, 0);
  const remainder = Math.max(0, 100 - total);

  return (
    <div className="stacked-bar" role="group" aria-label="Capacity category allocation">
      {snapshot.category_allocation.map((item) => (
        <span
          key={item.label}
          role="img"
          aria-label={`${item.label}: ${item.value}%`}
          style={{
            width: `${item.value}%`,
            background: categoryColors[item.label],
            opacity: hoveredCategory && hoveredCategory !== item.label ? 0.3 : 1,
            transition: "opacity 0.12s",
          }}
          onMouseEnter={() => onHoverCategory?.(item.label)}
          onMouseLeave={() => onHoverCategory?.(null)}
          title={`${item.label}: ${item.value}%`}
        />
      ))}
      {remainder > 0 && (
        <span
          role="img"
          aria-label={`Unallocated / buffer: ${Math.round(remainder)}%`}
          style={{
            width: `${remainder}%`,
            background: "var(--surface-muted)",
            opacity: hoveredCategory ? 0.3 : 1,
            transition: "opacity 0.12s",
          }}
          title={`Unallocated / buffer: ${Math.round(remainder)}%`}
        />
      )}
    </div>
  );
}
