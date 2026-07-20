import Link from "next/link";
import type { ReactNode } from "react";

import { SettingsBoundaryNote } from "./PersonalSettingsLocalControl";
import styles from "./PersonalAISettings.module.css";

type AssistanceIconName = "connection" | "guidance" | "vision";

function AssistanceIcon({ name }: { name: AssistanceIconName }) {
  const paths: Record<AssistanceIconName, ReactNode> = {
    connection: <><path d="M8 12h8M12 8v8" /><path d="M5 5 3 3m16 2 2-2M5 19l-2 2m16-2 2 2" /></>,
    guidance: <><path d="m12 3 2.1 4.3L19 8l-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8L5 8l4.9-.7L12 3Z" /></>,
    vision: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  };

  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const ASSISTANCE_ROWS = [
  {
    id: "provider-connection",
    icon: "connection" as const,
    title: "Provider connection",
    description: "Choose an API provider or an isolated ChatGPT/Codex-plan connection. Native API credentials use macOS Keychain; only the credential binding and provider preferences remain in local app state.",
    ownership: "On-device configuration",
    detail: "Credentials never enter Web",
  },
  {
    id: "classification-guidance",
    icon: "guidance" as const,
    title: "Classification and guidance",
    description: "Use an OpenAI (or OpenAI-compatible) key for reviewable classification, forecasts, summaries, Review Copilot, acceleration, and Visual Context. Other providers currently power only the Agent chat.",
    ownership: "Runs from Weekform for Mac",
    detail: "Reviewable output · approval before changes",
  },
  {
    id: "visual-context",
    icon: "vision" as const,
    title: "Visual Context",
    description: "Opt in to rate-limited screenshot analysis from the Mac that captured the screen. Images are never copied into this Web workspace.",
    ownership: "Explicit local opt-in",
    detail: "Images and derived insights excluded from Web",
  },
] as const;

export function PersonalAIAssistanceSettings() {
  return (
    <section className={styles.section} aria-labelledby="web-ai-assistance-title">
      <div className="settings-section-heading">
        <div>
          <h2 id="web-ai-assistance-title">AI assistance</h2>
          <span>Understand which AI runs against local evidence and which capability belongs to your authenticated Web workspace.</span>
        </div>
      </div>

      <div className={styles.boundary} role="status">
        <div>
          <strong>Separate local and Web AI boundaries</strong>
          <span>Weekform Web cannot inspect or inherit your local provider, model, endpoint, credential, prompts, or generated output. Web Ask uses its own authenticated server path and a minimized weekly evidence catalog.</span>
        </div>
        <span className={styles.badge}>Local configuration</span>
      </div>

      <div className={styles.rows}>
        {ASSISTANCE_ROWS.map((row) => (
          <section className={styles.row} key={row.id} aria-labelledby={`web-ai-${row.id}`}>
            <div className={styles.icon}><AssistanceIcon name={row.icon} /></div>
            <div className={styles.copy}>
              <h3 id={`web-ai-${row.id}`}>{row.title}</h3>
              <p>{row.description}</p>
            </div>
            <div className={styles.status}><strong>{row.ownership}</strong><span>{row.detail}</span></div>
          </section>
        ))}
        <section className={`${styles.row} ${styles.webRow}`} aria-labelledby="web-ai-web-ask">
          <div className={styles.icon}><AssistanceIcon name="guidance" /></div>
          <div className={styles.copy}>
            <h3 id="web-ai-web-ask">Web Ask</h3>
            <p>Ask grounded questions from the latest review-safe weekly summary published by your Mac. Your typed question and a minimized review-safe evidence catalog go through the authenticated Web server and, when configured, its separate AI provider.</p>
          </div>
          <div className={styles.status}><strong>Available in Web</strong><span>Separate server configuration</span></div>
          <Link className={`button button-primary ${styles.localAction}`} href="/app?screen=agent">Open Web Ask</Link>
        </section>
      </div>

      <SettingsBoundaryNote
        title="Change AI provider settings beside the evidence they affect"
        description="Provider credentials, connection tests, model capability checks, and Visual Context consent remain on the device. Web presents their privacy boundary for clarity instead of duplicating controls it cannot safely operate."
      />

      <p className={styles.footnote}>Desktop AI output remains reviewable. This Web settings surface does not receive raw local activity, window titles, screenshots, Desktop AI prompts, local provider credentials, or local AI configuration. Web Ask uses its separate authenticated server path and does not inherit these Desktop settings; its conversation stays temporary, requests use no-store processing, and you should not enter sensitive, confidential, or regulated information.</p>
    </section>
  );
}
