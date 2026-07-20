import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./PersonalDataSourcesSettings.module.css";

type DataSourceIconId = "activity" | "calendar" | "email" | "chat" | "visual";

const DATA_SOURCES: Array<{
  title: string;
  description: string;
  localDetail: string;
  statusTitle: string;
  badge: string;
  icon: DataSourceIconId;
}> = [
  {
    title: "Active window activity",
    description: "Records foreground app, window title, and timestamp locally. It never records keystrokes or file contents.",
    localDetail: "Sessions and samples stay local",
    statusTitle: "Raw source not shared",
    badge: "Mac only",
    icon: "activity",
  },
  {
    title: "Calendar",
    description: "Turns selected calendar events into planned-work context after you approve access or import an ICS file on your Mac.",
    localDetail: "Source selection stays local",
    statusTitle: "Raw source not shared",
    badge: "Mac only",
    icon: "calendar",
  },
  {
    title: "Email",
    description: "Weekform does not connect to an email inbox today. Neither Web nor Mac requests inbox access or imports message content.",
    localDetail: "Not available",
    statusTitle: "Unavailable",
    badge: "Unavailable",
    icon: "email",
  },
  {
    title: "Chat",
    description: "Connect exactly Slack, Google Chat, or Webex in Weekform for Mac Settings. The Mac discards ambient inbound traffic and message content before app state, retaining content-free attention evidence: directed requests stay at 0% for review, while self-sent actions become response or coordination evidence—not message-volume scoring.",
    localDetail: "Mac review first · provider-free if published",
    statusTitle: "No Chat source detail on Web",
    badge: "Mac only",
    icon: "chat",
  },
  {
    title: "Visual context",
    description: "Optional screenshot analysis for sustained sessions. Captures and sensitive review details never enter this Web workspace.",
    localDetail: "Capture review stays local",
    statusTitle: "Raw source not shared",
    badge: "Mac only",
    icon: "visual",
  },
];

function DataSourceIcon({ id }: { id: DataSourceIconId }) {
  const paths: Record<DataSourceIconId, ReactNode> = {
    activity: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></>,
    email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    chat: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><path d="M8 9h8M8 13h5" /></>,
    visual: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  };

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[id]}
    </svg>
  );
}

export function PersonalDataSourcesSettings() {
  return (
    <section className={styles.section} aria-labelledby="web-data-sources-heading">
      <div className="settings-section-heading">
        <div>
          <h2 id="web-data-sources-heading">Data sources</h2>
          <span>Enable sources on your Mac only when they add useful workload context.</span>
        </div>
      </div>

      <div className={styles.boundary} role="note" aria-label="Web data boundary">
        <strong>Data sources are controlled locally</strong>
        <span>Web receives only the review-safe weekly replica you explicitly publish from Weekform for Mac. Chat-derived entries use generic fields and opaque block IDs; Manager Access is a separate approval boundary and receives only approved aggregates, never source detail.</span>
      </div>

      <div className={styles.rows}>
        {DATA_SOURCES.map((source) => (
          <section className={styles.row} key={source.title}>
            <div className={styles.icon}><DataSourceIcon id={source.icon} /></div>
            <div className={styles.copy}>
              <h3>{source.title}</h3>
              <p>{source.description}</p>
            </div>
            <div className={styles.status}>
              <strong>{source.statusTitle}</strong>
              <span>{source.localDetail}</span>
            </div>
            <span className={styles.localBadge}>{source.badge}</span>
          </section>
        ))}
      </div>

      <div className={styles.handoff}>
        <div>
          <strong>Change source access on the device holding the evidence</strong>
          <span>Open Weekform for Mac Settings to connect, sync, disconnect, retain, or reset Slack, Google Chat, or Webex alongside your other local sources. The Mac initiates source OAuth and performs provider transfers; this Web workspace has no source OAuth controls, credentials, or connection controls.</span>
        </div>
        <Link href="/download" className="button button-primary">Get Weekform for Mac</Link>
      </div>
    </section>
  );
}
