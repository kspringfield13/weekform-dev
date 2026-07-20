import type { ReactNode } from "react";

import { SettingsBoundaryNote } from "./PersonalSettingsLocalControl";
import styles from "./PersonalAISettings.module.css";

type UsageIconName = "estimate" | "share" | "import" | "pricing";

function UsageIcon({ name }: { name: UsageIconName }) {
  const paths: Record<UsageIconName, ReactNode> = {
    estimate: <><path d="M4 19V9m5 10V5m5 14v-7m5 7V8" /><path d="M3 19h18" /></>,
    share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5m-7.6 6.9 7.6 4.5" /></>,
    import: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M5 20h14" /></>,
    pricing: <><path d="M12 2v20M17 6.5c-1-1-2.3-1.5-4-1.5-2.2 0-4 1.2-4 3s1.8 2.6 4 3 4 1.2 4 3-1.8 3-4 3c-1.7 0-3.2-.5-4.3-1.5" /></>,
  };

  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const USAGE_ROWS = [
  {
    id: "observed-estimates",
    icon: "estimate" as const,
    title: "Observed AI estimates",
    description: "Estimate AI-assistant time from captured apps and browser tabs on-device. These estimates are never presented as token counts.",
    detail: "On-device estimate",
  },
  {
    id: "manager-summary",
    icon: "share" as const,
    title: "Include AI usage in manager summaries",
    description: "Choose locally whether the manager-ready weekly summary includes a one-line usage note. The setting is off by default.",
    detail: "Individual-controlled sharing",
  },
  {
    id: "csv-import",
    icon: "import" as const,
    title: "Usage CSV import",
    description: "Import compatible provider exports locally. Re-import deduplication and any authoritative cost columns remain beside the source file.",
    detail: "Parsed locally",
  },
  {
    id: "model-pricing",
    icon: "pricing" as const,
    title: "Model pricing",
    description: "Review and override the local pricing map used to compute cost overlays without changing measured token records.",
    detail: "Local cost overlay",
  },
] as const;

export function PersonalAIUsageSettings() {
  return (
    <section className={styles.section} aria-labelledby="web-ai-usage-title">
      <div className="settings-section-heading">
        <div>
          <h2 id="web-ai-usage-title">AI usage</h2>
          <span>Understand Desktop’s AI usage controls without copying private measurements or local preferences into Web.</span>
        </div>
      </div>

      <div className={styles.boundary} role="status">
        <div>
          <strong>Local measurement boundary</strong>
          <span>Token imports, observed-session estimates, pricing overlays, and usage preferences stay on your Mac and are not copied into the review-safe replica.</span>
        </div>
        <span className={styles.badge}>No usage upload</span>
      </div>

      <div className={styles.rows}>
        {USAGE_ROWS.map((row) => (
          <section className={styles.row} key={row.id} aria-labelledby={`web-ai-usage-${row.id}`}>
            <div className={styles.icon}><UsageIcon name={row.icon} /></div>
            <div className={styles.copy}>
              <h3 id={`web-ai-usage-${row.id}`}>{row.title}</h3>
              <p>{row.description}</p>
            </div>
            <div className={styles.status}><strong>Local measurement</strong><span>{row.detail}</span></div>
          </section>
        ))}
      </div>

      <SettingsBoundaryNote
        eyebrow="Not uploaded"
        title="Keep AI usage measurement beside its local source"
        description="Observed estimates, provider exports, token records, pricing overrides, budgets, and sharing preferences are not part of the private Web replica. This page documents that boundary; it does not reconstruct private usage totals."
      />

      <p className={styles.footnote}>Manager Access can receive a usage note only when the individual explicitly enables that field in an approved team snapshot; the private Web workspace still does not receive the underlying measurements.</p>
    </section>
  );
}
