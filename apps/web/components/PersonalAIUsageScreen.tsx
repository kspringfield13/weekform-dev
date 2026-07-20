import Link from "next/link";

import styles from "./PersonalWeekIntelligence.module.css";

export function PersonalAIUsageScreen() {
  return (
    <section
      className={`${styles.screen} ${styles.usageScreen} web-desktop-screen usage-screen`}
      aria-labelledby="personal-ai-usage-title"
    >
      <header className={`${styles.header} ${styles.usageHeader} screen-header usage-screen-header`}>
        <div>
          <p className={`${styles.eyebrow} ${styles.usageEyebrow} eyebrow`}>Weekly AI usage</p>
          <h1 id="personal-ai-usage-title">See how AI supports your work.</h1>
          <p className={`${styles.intro} ${styles.usageIntro} screen-intro`}>
            See when AI supported your work and which models carried the load. Provider tokens and
            locally observed assistant activity are not part of the review-safe Web replica.
          </p>
        </div>
      </header>

      <section
        className={`${styles.usageEmptyState} empty-state usage-empty-state`}
        aria-labelledby="personal-ai-usage-empty-title"
      >
        <div className={`${styles.usageEmptyStateIcon} empty-state-icon`} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
          </svg>
        </div>
        <div>
          <strong id="personal-ai-usage-empty-title">Review AI usage in Weekform for Mac.</strong>
          <p>
            Token totals, model pricing, and observed assistant time stay local. Web does not
            upload or reconstruct those private measurements.
          </p>
        </div>
        <div className={`${styles.usageEmptyStateActions} empty-state-actions`}>
          <Link
            className={`${styles.usageSecondaryAction} secondary-action`}
            href="/app?screen=setup&settings_tab=ai-usage"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" aria-hidden="true">
              <circle cx="12" cy="12" r="3" strokeWidth="2" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.14.38.35.72.6 1 .3.3.68.46 1.1.5H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
            </svg>
            <span>Open Settings</span>
          </Link>
        </div>
      </section>
    </section>
  );
}
