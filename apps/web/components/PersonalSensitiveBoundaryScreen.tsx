import { WeekformDesktopLink } from "@/components/MacAppLink";
import styles from "./PersonalSensitiveBoundaryScreen.module.css";

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 3 5 6v5c0 4.9 2.9 8.2 7 10 4.1-1.8 7-5.1 7-10V6l-7-3Z" />
      <path d="M12 8v5M12 17h.01" />
    </svg>
  );
}

/**
 * Mirrors Desktop's Flagged Captures destination without crossing its local
 * privacy boundary. The Web replica intentionally contains no visual insight
 * count, summary, screenshot, or destructive action.
 */
export function PersonalSensitiveBoundaryScreen() {
  return (
    <section className={`web-desktop-screen ${styles.screen}`} aria-labelledby="web-sensitive-title">
      <header className={styles.screenHeader}>
        <div>
          <p className={styles.eyebrow}>Flagged captures</p>
          <h1 id="web-sensitive-title">Review and purge visual captures flagged as sensitive.</h1>
        </div>
        <div className={styles.summaryScore} title="Flagged capture count is unavailable in Web">
          <span>Flagged</span>
          <strong aria-hidden="true">—</strong>
          <span className={styles.srOnly}>Flagged capture count is unavailable in Web</span>
        </div>
      </header>

      <p className={styles.intro}>
        Potentially confidential captures stay beside the local source of truth. Web does not receive their count,
        screenshot, derived summary, app name, or project hint.
      </p>

      <div className={styles.emptyState} aria-label="Flagged captures privacy boundary">
        <span className={styles.emptyIcon}><ShieldIcon /></span>
        <div className={styles.emptyCopy}>
          <strong>Flagged captures are unavailable in Web.</strong>
          <p>Visual captures detected as potentially sensitive will appear here for review and removal.</p>
        </div>
        <div className={styles.boundary}>
          <span>Local-only review</span>
          <p>Open Weekform on this Mac to inspect or remove flagged material. This Web view cannot reveal whether local items exist.</p>
        </div>
        <div className={styles.actions}>
          <WeekformDesktopLink className="button button-primary" />
        </div>
      </div>
    </section>
  );
}
