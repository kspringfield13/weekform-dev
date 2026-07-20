import Link from "next/link";

import styles from "./PersonalSettingsLocalControl.module.css";

export function LocalSettingsControl({ label = "Local control" }: { label?: string }) {
  return (
    <span className={styles.localControl} aria-disabled="true" title="Change this setting in Weekform for Mac">
      {label}
    </span>
  );
}

export function LocalSettingsHandoff({
  actionLabel = "Get Weekform for Mac",
  href = "/download",
  title,
  description,
}: {
  actionLabel?: "Get Weekform for Mac";
  href?: "/download";
  title: string;
  description: string;
}) {
  return (
    <aside className={styles.handoff} aria-label="Weekform for Mac settings handoff">
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <Link href={href} className="button button-primary">{actionLabel}</Link>
    </aside>
  );
}
