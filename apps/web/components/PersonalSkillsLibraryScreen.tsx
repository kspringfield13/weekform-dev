"use client";

import Link from "next/link";

import styles from "./PersonalWeekIntelligence.module.css";

function browseAccelerationPlays() {
  window.dispatchEvent(
    new CustomEvent("weekform:web-navigate", {
      detail: { destination: "agent", subview: "accelerate" },
    }),
  );
}

export function PersonalSkillsLibraryScreen() {
  return (
    <section
      className={`${styles.screen} skills-screen`}
      aria-labelledby="personal-skills-library-title"
    >
      <header className={`${styles.header} skills-screen-header`}>
        <div>
          <p className={styles.eyebrow}>Skills library</p>
          <h1 id="personal-skills-library-title">No saved skills are available on Web.</h1>
          <p className={styles.intro}>
            Skill recipes stay in your local Weekform library. Web mirrors the Desktop hierarchy,
            but does not upload their instructions or reconstruct their supporting private evidence.
          </p>
        </div>
        <span className={styles.status} role="status">Local library protected</span>
      </header>

      <section className={`${styles.modelCard} skills-empty-state`} aria-labelledby="personal-skills-empty-title">
        <div>
          <p className={styles.kicker}>Your skills library is empty here.</p>
          <h2 id="personal-skills-empty-title">Build from an acceleration play on your Mac.</h2>
          <p>
            Browse the matching Accelerate view here, then open Weekform for Mac to inspect,
            save, copy, export, or remove a complete skill recipe. This ephemeral Web view has no workload cache.
          </p>
        </div>
        <div className="header-actions">
          <button className="button button-secondary" type="button" onClick={browseAccelerationPlays}>
            Browse acceleration plays
          </button>
          <Link className={`button button-primary ${styles.action}`} href="/download">
            Open Weekform for Mac
          </Link>
        </div>
      </section>
    </section>
  );
}
