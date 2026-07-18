import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  ariaLabel,
  children
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  ariaLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="empty-state" aria-label={ariaLabel ?? title}>
      <div className="empty-state-icon">
        <Icon size={20} aria-hidden />
      </div>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {children && <div className="empty-state-actions">{children}</div>}
    </section>
  );
}
