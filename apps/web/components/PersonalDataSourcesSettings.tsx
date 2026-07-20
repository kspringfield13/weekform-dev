import type { ReactNode } from "react";

import { SettingsBoundaryNote } from "./PersonalSettingsLocalControl";
import styles from "./PersonalDataSourcesSettings.module.css";

type DataSourceIconId = "activity" | "calendar" | "chat" | "visual";

const DATA_SOURCES: Array<{
  title: string;
  description: string;
  localDetail: string;
  statusTitle: string;
  icon: DataSourceIconId;
}> = [
  {
    title: "Active window activity",
    description: "Records foreground app, window title, and timestamp locally. It never records keystrokes or file contents.",
    localDetail: "App names, titles, sessions, and samples stay on the device that captured them",
    statusTitle: "Derived workload only",
    icon: "activity",
  },
  {
    title: "Calendar",
    description: "Turns selected calendar events into planned-work context after you approve access or import an ICS file on your Mac.",
    localDetail: "Event titles, locations, organizers, attendees, notes, and provider identity are excluded",
    statusTitle: "Planned-work fields only",
    icon: "calendar",
  },
  {
    title: "Chat",
    description: "Connect exactly Slack, Google Chat, or Webex in Weekform for Mac Settings. The Mac discards ambient inbound traffic and message content before app state, retaining content-free attention evidence: directed requests stay at 0% for review, while self-sent actions become response or coordination evidence—not message-volume scoring.",
    localDetail: "No provider, conversation, person, message, hash, or receipt details enter Web",
    statusTitle: "Provider-free when published",
    icon: "chat",
  },
  {
    title: "Visual context",
    description: "Optional screenshot analysis for sustained sessions. Captures and sensitive review details never enter this Web workspace.",
    localDetail: "Screenshots and derived visual insights are excluded from the Web replica",
    statusTitle: "Local analysis only",
    icon: "visual",
  },
];

function DataSourceIcon({ id }: { id: DataSourceIconId }) {
  const paths: Record<DataSourceIconId, ReactNode> = {
    activity: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></>,
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
          <span>See how each evidence source is reduced before anything reaches your private Web workspace.</span>
        </div>
      </div>

      <div className={styles.boundary} role="note" aria-label="Web data boundary">
        <strong>Web receives a derived weekly replica, not source records</strong>
        <span>Your signed-in workspace can show block times, capacity, category, work mode, planned status, confidence, review state, and deterministic weekly metrics after you publish them. Raw samples, source identities, titles, notes, and credentials are never replica fields.</span>
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
          </section>
        ))}
      </div>

      <SettingsBoundaryNote
        eyebrow="Not collected"
        title="Email message content is not collected"
        description="Email is not a Weekform workload source. Calendar providers may supply bounded event metadata, but Weekform does not request inbox access or import email bodies, attachments, or message content. Source connection and review remain on the device holding the evidence."
      />
    </section>
  );
}
