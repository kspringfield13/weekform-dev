import { WeekformDesktopLink } from "@/components/MacAppLink";
import type { PersonalReplicaView } from "@/lib/personalReplica";
import { buildPersonalSummaryReadout } from "@/lib/personalSummaryPresentation";
import styles from "./PersonalWeekIntelligence.module.css";

function FileTextIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h6" />
    </svg>
  );
}

function ArrowUpRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </svg>
  );
}

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

  if (error) {
    return (
      <section className={`${styles.screen} ${styles.summaryScreen} web-desktop-screen narrative-screen`} aria-labelledby="personal-summary-error-title">
        <header className={`${styles.summaryStateHeader} screen-header`}>
          <div>
            <p className={`${styles.summaryEyebrow} eyebrow`}>Weekly summary</p>
            <h1 id="personal-summary-error-title">Your review-safe summary could not be loaded.</h1>
          </div>
        </header>
        <div className={`${styles.summaryError} form-alert`} role="alert">
          <strong>Summary unavailable</strong>
          <p>Reload this page or resync from Weekform for Mac. No stale workload readout is shown while the connection is unavailable.</p>
        </div>
      </section>
    );
  }

  if (!readout) {
    return (
      <section className={`${styles.screen} ${styles.summaryScreen} web-desktop-screen narrative-screen`} aria-labelledby="personal-summary-waiting-title">
        <header className={`${styles.summaryStateHeader} screen-header`}>
          <div>
            <p className={`${styles.summaryEyebrow} eyebrow`}>Weekly summary</p>
            <h1 id="personal-summary-waiting-title">No manager summary until the week has review-safe evidence.</h1>
          </div>
        </header>
        <div className={`${styles.summaryEmptyState} empty-state`} role="status" aria-labelledby="personal-summary-empty-title">
          <span className={`${styles.summaryEmptyIcon} empty-state-icon`}><FileTextIcon /></span>
          <div>
            <strong id="personal-summary-empty-title">Narrative generation is waiting.</strong>
            <p>Enable Private Web workspace in Weekform for Mac to connect the derived capacity fields this deterministic view can display.</p>
          </div>
          <div className={`${styles.summaryEmptyActions} empty-state-actions`}>
            <WeekformDesktopLink className={`button button-primary ${styles.summaryHandoff}`}>
              <ArrowUpRightIcon />
            </WeekformDesktopLink>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`${styles.screen} ${styles.summaryScreen} web-desktop-screen narrative-screen`} aria-labelledby="personal-summary-title">
      <div className={styles.result}>
        <header className={`${styles.header} ${styles.summaryHero} screen-header narrative-hero`}>
          <div className={styles.heroCopy}>
            <p className={`${styles.summaryEyebrow} eyebrow`}>Weekly summary</p>
            <h1 id="personal-summary-title">{readout.headline}</h1>
          </div>
          <div className={styles.heroFooter}>
            <div className={styles.statusGroup} role="status" aria-live="polite">
              <span className={styles.status} data-state="ready">{readout.weekLabel}</span>
              {currentReplica && syncedLabel ? (
                <span>Synced <time dateTime={currentReplica.syncedAt}>{syncedLabel} UTC</time></span>
              ) : null}
              <span>Derived replica</span>
              <span>Review-safe fields only</span>
            </div>
            <div className={styles.summaryActions}>
              <WeekformDesktopLink
                className={`button button-secondary ${styles.summaryHandoff}`}
              >
                <ArrowUpRightIcon />
              </WeekformDesktopLink>
            </div>
          </div>
        </header>

        <div className={`${styles.layout} narrative-layout`}>
          <section className={`${styles.panel} narrative-panel analyst-narrative`} aria-labelledby="personal-analyst-view-title">
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.kicker}>Deterministic assessment</span>
                <h2 id="personal-analyst-view-title">Analyst view</h2>
              </div>
              <span className={styles.purpose}>Review-safe fields</span>
            </div>
            <div className={styles.assessment}>
              <span>Weekly allocation</span>
              <p>{readout.assessment}</p>
            </div>
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
          </section>

          <section className={`${styles.panel} narrative-panel manager`} aria-labelledby="personal-manager-version-title">
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.kicker}>Private on Mac</span>
                <h2 id="personal-manager-version-title">Manager-ready version</h2>
              </div>
              <span className={styles.purpose}>Review before sharing</span>
            </div>
            <div className={styles.managerToolbar}>
              <div><PencilIcon /><span>Private local draft</span></div>
              <small>Changes stay local</small>
            </div>
            <div className={styles.managerPlaceholder} role="note" aria-label="Manager-ready summary privacy boundary">
              <strong>Continue with the complete local evidence.</strong>
              <p>Weekform Web will not invent a summary, shareable draft, or recommendation from fields it did not receive.</p>
            </div>
            <p className={styles.managerNote}>Private evidence and generated narratives are not uploaded. Review the underlying work blocks on Mac before sharing.</p>
          </section>
        </div>
      </div>
    </section>
  );
}
