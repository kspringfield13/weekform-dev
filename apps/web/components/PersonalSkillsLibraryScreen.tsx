"use client";

import Link from "next/link";
import type { ReactNode, SVGProps } from "react";

import styles from "./PersonalSkillsLibraryScreen.module.css";

type SkillsIconName = "library" | "lock";

function SkillsIcon({
  name,
  size = 20,
  ...props
}: SVGProps<SVGSVGElement> & { name: SkillsIconName; size?: number }) {
  const paths: Record<SkillsIconName, ReactNode> = {
    library: (
      <>
        <path d="m16 6 4 14" />
        <path d="M12 6v14" />
        <path d="M8 8v12" />
        <path d="M4 4v16" />
        <path d="M2 20h20" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

function browseAccelerationPlays() {
  window.dispatchEvent(
    new CustomEvent("weekform:web-navigate", {
      detail: { destination: "agent", subview: "accelerate" },
    }),
  );
}

export function PersonalSkillsLibraryScreen() {
  return (
    <section className={`${styles.screen} skills-screen`} aria-labelledby="personal-skills-library-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Skills library</p>
          <h1 id="personal-skills-library-title">No saved skills yet.</h1>
        </div>
      </header>

      <section className={styles.emptyState} aria-labelledby="personal-skills-empty-title">
        <span className={styles.emptyIcon} aria-hidden="true">
          <SkillsIcon name="library" size={20} />
        </span>
        <div className={styles.emptyCopy}>
          <strong id="personal-skills-empty-title">Your skills library is empty.</strong>
          <p>
            When an acceleration play comes with a recipe, use its “Save to library” action on Mac
            to snapshot it. Saved skills survive play regeneration and can be exported as Agent Skills.
          </p>
        </div>
        <div className={styles.emptyActions}>
          <button className="button button-primary" type="button" onClick={browseAccelerationPlays}>
            Browse acceleration plays
          </button>
        </div>
      </section>

      <section className={styles.localBoundary} aria-labelledby="personal-skills-boundary-title">
        <div className={styles.boundaryHeading}>
          <div>
            <p className={styles.eyebrow}>Local library boundary</p>
            <h2 id="personal-skills-boundary-title">Saved skill recipes stay on your Mac.</h2>
          </div>
          <span className={styles.unavailable}>Not included in replica</span>
        </div>

        <article className={styles.boundaryCard} data-local-library-boundary>
          <div className={styles.cardHeader}>
            <span className={styles.typeChip}>
              <SkillsIcon name="lock" size={13} aria-hidden="true" />
              Local skill
            </span>
            <span className={styles.savedMeta}>Private library protected</span>
          </div>
          <h3>Recipe content is not uploaded.</h3>
          <p>
            Web does not upload saved instructions, supporting private evidence, or library actions.
            This card reserves the Desktop library layout without fabricating a skill.
          </p>
          <pre className={styles.recipeBoundary} aria-label="Local recipe unavailable on Web">Open Weekform for Mac to inspect the complete recipe.</pre>
          <div className={styles.cardActions}>
            <p>
              <SkillsIcon name="lock" size={13} aria-hidden="true" />
              Copy, export, and remove stay local. This Web view has no workload cache.
            </p>
            <Link className="button button-secondary" href="/download">
              Get Weekform for Mac
            </Link>
          </div>
        </article>
      </section>
    </section>
  );
}
