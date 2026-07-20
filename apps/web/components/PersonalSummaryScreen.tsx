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
  const currentReplica = replicas[0] ?? null;
  const readout = buildPersonalSummaryReadout(currentReplica?.payload ?? null);
  const syncedLabel = currentReplica
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(currentReplica.syncedAt))
    : null;

  return (
    <section className={`${styles.screen} narrative-screen`} aria-labelledby="personal-summary-title">
      <div className={styles.result}>
        <header className={`${styles.header} screen-header narrative-hero`}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Weekly summary</p>
            <h1 id="personal-summary-title">
              {readout?.headline ?? "No review-safe week is connected."}
            </h1>
            <p className={styles.intro}>
              Web shows a deterministic allocation readout only. Private evidence and generated narratives are not uploaded.
            </p>
          </div>
          <div className={styles.heroFooter}>
            <div className={styles.statusGroup} role="status" aria-live="polite">
              <span className={styles.status} data-state={error ? "error" : readout ? "ready" : "waiting"}>
                {error ? "Replica unavailable" : readout ? readout.weekLabel : "Waiting for Mac"}
              </span>
              {currentReplica && syncedLabel ? (
                <span>Synced <time dateTime={currentReplica.syncedAt}>{syncedLabel} UTC</time></span>
              ) : null}
              <span>Derived replica</span>
            </div>
            <span className={styles.privacyChip}>Review-safe fields only</span>
          </div>
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
              <div className={styles.evidence}>
                <div className={styles.evidenceHeading}>
                  <span>Evidence considered</span>
                  <small>{readout.signals.length} signal{readout.signals.length === 1 ? "" : "s"}</small>
                </div>
                <ol className={styles.signalList} aria-label="Review-safe workload signals">
                  {readout.signals.map((signal, index) => (
                    <li key={signal}><b>{String(index + 1).padStart(2, "0")}</b><span>{signal}</span></li>
                  ))}
                </ol>
              </div>
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
            <div className={styles.managerToolbar}>
              <span>Private local draft</span>
              <small>Continue on Mac</small>
            </div>
            <div className={styles.boundary} role="status">
              <strong>Continue with the complete local evidence.</strong>
              <p>Weekform Web will not invent a summary, shareable draft, or recommendation from fields it did not receive.</p>
              <Link className={`button button-primary ${styles.action}`} href="/download">Get Weekform for Mac</Link>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
