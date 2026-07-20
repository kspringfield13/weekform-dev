import type { ReactNode } from "react";

import { LocalSettingsControl, LocalSettingsHandoff } from "./PersonalSettingsLocalControl";
import styles from "./PersonalNotificationsSettings.module.css";

type NotificationIconName = "alerts" | "guardrail" | "review" | "calendar" | "fragmentation" | "summary";

function NotificationIcon({ name }: { name: NotificationIconName }) {
  const paths: Record<NotificationIconName, ReactNode> = {
    alerts: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    guardrail: <><path d="M12 3 4.5 6v5c0 4.8 3.2 8.2 7.5 10 4.3-1.8 7.5-5.2 7.5-10V6L12 3Z" /><path d="M12 8v4m0 4h.01" /></>,
    review: <><path d="M7 3h10v4H7z" /><path d="M5 5H4a1 1 0 0 0-1 1v14h18V6a1 1 0 0 0-1-1h-1" /><path d="m8 14 2.3 2.3L16 11" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /><path d="m9 15 2 2 4-4" /></>,
    fragmentation: <><path d="M4 7h5v5H4zM15 4h5v5h-5zM15 15h5v5h-5z" /><path d="M9 9.5h3a3 3 0 0 1 3 3v2.5M12 12.5H9" /></>,
    summary: <><path d="M5 3h14v18H5z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  };

  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const ALERT_ROWS = [
  {
    id: "capacity-guardrail",
    icon: "guardrail" as const,
    title: "Capacity guardrail",
    description: "Notify when reliable new-work capacity reaches the locally chosen floor or carryover risk spikes.",
    status: "Threshold on Mac",
  },
  {
    id: "end-of-day-review",
    icon: "review" as const,
    title: "End-of-day review nudge",
    description: "Prompt a final review when inferred blocks still need confirmation late in the day.",
    status: "Metrics only",
  },
  {
    id: "heavy-day-ahead",
    icon: "calendar" as const,
    title: "Heavy-day-ahead warning",
    description: "Surface a warning the day before the local workload model identifies a meeting-heavy day.",
    status: "Calendar metrics",
  },
  {
    id: "fragmentation",
    icon: "fragmentation" as const,
    title: "Fragmentation nudge",
    description: "Call attention to high context switching without sharing the apps or titles behind the signal.",
    status: "Metrics only",
  },
  {
    id: "weekly-summary",
    icon: "summary" as const,
    title: "Weekly summary ready",
    description: "Let you know when the local summary and forecast are ready for review.",
    status: "Local readiness",
  },
] as const;

export function PersonalNotificationsSettings() {
  return (
    <section className={styles.section} aria-labelledby="web-notifications-title">
      <div className="settings-section-heading">
        <div>
          <h2 id="web-notifications-title">Notifications</h2>
          <span>Review the same workload signals as Desktop. Delivery and alert preferences remain owned by Weekform for Mac.</span>
        </div>
      </div>

      <div className={styles.rows}>
        <section className={`${styles.row} ${styles.leadRow}`} aria-labelledby="web-notification-proactive-alerts">
          <div className={styles.icon}><NotificationIcon name="alerts" /></div>
          <div className={styles.copy}>
            <h3 id="web-notification-proactive-alerts">Proactive alerts</h3>
            <p>Menu-bar alerts use capacity metrics only — never window titles or app names — and are capped at 4 per day.</p>
          </div>
          <div className={styles.status}>
            <strong>Mac only</strong>
            <span>Delivery and master switch</span>
          </div>
          <LocalSettingsControl />
        </section>
        {ALERT_ROWS.map((row) => (
          <section className={styles.row} key={row.id} aria-labelledby={`web-notification-${row.id}`}>
            <div className={styles.icon}><NotificationIcon name={row.icon} /></div>
            <div className={styles.copy}>
              <h3 id={`web-notification-${row.id}`}>{row.title}</h3>
              <p>{row.description}</p>
            </div>
            <div className={styles.status}>
              <strong>Mac only</strong>
              <span>{row.status}</span>
            </div>
            <LocalSettingsControl />
          </section>
        ))}
      </div>

      <LocalSettingsHandoff
        actionLabel="Get Weekform for Mac"
        href="/download"
        title="Choose alert delivery on the Mac that owns your workload model"
        description="Weekform for Mac controls notification permission, thresholds, and delivery. Web shows the same signal boundaries without requesting browser permission or keeping another settings copy."
      />

      <p className={styles.footnote}>Web does not request browser notification permission or keep a second copy of your alert settings.</p>
    </section>
  );
}
