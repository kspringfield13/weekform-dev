import Link from "next/link";

import styles from "./PersonalWeekIntelligence.module.css";

const LOCAL_USAGE_BOUNDARIES = [
  { label: "Source", value: "Mac app", helper: "Local provider activity" },
  { label: "Web replica", value: "Not included", helper: "Positive allowlist only" },
  { label: "Browser state", value: "Ephemeral", helper: "No workload cache" },
  { label: "Control", value: "You decide", helper: "Open the local workspace" },
];

export function PersonalAIUsageScreen() {
  return (
    <section className={`${styles.screen} usage-screen`} aria-labelledby="personal-ai-usage-title">
      <header className={`${styles.header} usage-screen-header`}>
        <div>
          <p className={styles.eyebrow}>Weekly AI usage</p>
          <h1 id="personal-ai-usage-title">Usage intelligence stays with your local AI activity.</h1>
          <p className={styles.intro}>
            AI activity is not part of the Web replica. This page preserves the Desktop layout without uploading or reconstructing private usage.
          </p>
        </div>
        <span className={styles.status} role="status">Review-safe boundary active</span>
      </header>

      <section className={`${styles.metrics} usage-metrics`} aria-label="AI usage availability">
        {LOCAL_USAGE_BOUNDARIES.map((item) => (
          <article className={styles.metric} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.helper}</small>
          </article>
        ))}
      </section>

      <section className={`${styles.modelCard} usage-model-card`} aria-labelledby="local-usage-detail-title">
        <div>
          <p className={styles.kicker}>Local usage detail</p>
          <h2 id="local-usage-detail-title">Continue with the complete private source.</h2>
          <p>
            Provider activity, pricing overlays, budgets, and assistant-session detail remain on your Mac and are not uploaded to Web. Need the local controls?{" "}
            <Link href="/download">Get Weekform for Mac</Link>.
          </p>
        </div>
        <Link className={`button button-primary ${styles.action}`} href="/app?screen=setup&settings_tab=ai-usage">Review AI Usage settings</Link>
      </section>
    </section>
  );
}
