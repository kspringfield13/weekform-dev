import styles from "./PersonalSettingsLocalControl.module.css";

export function SettingsBoundaryNote({
  eyebrow = "On-device settings",
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description: string;
}) {
  return (
    <aside className={styles.handoff} aria-label={title}>
      <span className={styles.marker} aria-hidden="true" />
      <div>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </aside>
  );
}
