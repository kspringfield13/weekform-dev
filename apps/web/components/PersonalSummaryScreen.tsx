import Link from "next/link";

import type { PersonalReplicaView } from "@/lib/personalReplica";
import { buildPersonalSummaryReadout } from "@/lib/personalSummaryPresentation";
import styles from "./PersonalWeekIntelligence.module.css";

export function PersonalSummaryScreen({
  replicas,
  error,
}: {
  replicas: PersonalReplicaView[];
  error: string | null;
}) {
  const readout = buildPersonalSummaryReadout(replicas[0]?.payload ?? null);

  return (
    <section className={`${styles.screen} narrative-screen`} aria-labelledby="personal-summary-title">
      <header className={`${styles.header} screen-header narrative-hero`}>
        <div>
          <p className={styles.eyebrow}>Weekly summary</p>
          <h1 id="personal-summary-title">
            {readout?.headline ?? "No review-safe week is connected."}
          </h1>
          <p className={styles.intro}>
            Web shows a deterministic allocation readout only. Private evidence and generated narratives are not uploaded.
          </p>
        </div>
        <span
          className={styles.status}
          data-state={error ? "error" : readout ? "ready" : "waiting"}
          role="status"
        >
          {error ? "Replica unavailable" : readout ? `${readout.weekLabel} · review-safe fields` : "Waiting for Mac"}
        </span>
      </header>

      {error ? (
        <div className="form-alert" role="alert">Your review-safe week could not be loaded. Reload the page to try again.</div>
      ) : null}
      <div className={`${styles.layout} narrative-layout`}>
          <section className={`${styles.panel} narrative-panel analyst-narrative`} aria-labelledby="personal-analyst-view-title">
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.kicker}>Deterministic readout</span>
                <h2 id="personal-analyst-view-title">Analyst view</h2>
              </div>
              <span className={styles.purpose}>Review-safe fields</span>
            </div>
            <div className={styles.assessment}>
              <span>Weekly allocation</span>
              <p>{readout?.assessment ?? "Enable Private Web workspace in Weekform for Mac to publish the derived capacity fields this view can display."}</p>
            </div>
            {readout ? (
              <ol className={styles.signals} aria-label="Review-safe workload signals">
                {readout.signals.map((signal, index) => (
                  <li key={signal}><b>{String(index + 1).padStart(2, "0")}</b><span>{signal}</span></li>
                ))}
              </ol>
            ) : null}
          </section>

          <section className={`${styles.panel} narrative-panel manager`} aria-labelledby="personal-manager-version-title">
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.kicker}>Private on Mac</span>
                <h2 id="personal-manager-version-title">Manager-ready version</h2>
              </div>
              <span className={styles.purpose}>Not assembled in Web</span>
            </div>
            <div className={styles.boundary} role="status">
              <strong>Continue with the complete local evidence.</strong>
              <p>Weekform Web will not invent a summary, shareable draft, or recommendation from fields it did not receive.</p>
              <Link className={`button button-primary ${styles.action}`} href="/download">Open Weekform for Mac</Link>
            </div>
          </section>
      </div>
    </section>
  );
}
