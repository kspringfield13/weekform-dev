import Link from "next/link";
import type { ReactNode, SVGProps } from "react";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";
import { buildPersonalAccelerationPresentation } from "@/lib/personalAccelerationPresentation";
import styles from "./PersonalAccelerationScreen.module.css";

type IconName = "lock" | "rocket" | "sparkles" | "trend" | "zap";

function AccelerationIcon({
  name,
  size = 16,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    rocket: <><path d="M14 4c3-1 5-1 6-1 0 1 0 3-1 6l-5 5-4-4 4-6Z" /><path d="m10 10-4 1-2 2 5 2 2 5 2-2 1-4" /><circle cx="16" cy="7" r="1" /></>,
    sparkles: <><path d="m12 3 1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4L12 3Z" /><path d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z" /><path d="m19 13 .6 1.4L21 15l-1.4.6L19 17l-.6-1.4L17 15l1.4-.6L19 13Z" /></>,
    trend: <><path d="m3 17 6-6 4 4 7-8" /><path d="M15 7h5v5" /></>,
    zap: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
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

export function PersonalAccelerationScreen({
  replica,
  error = null,
}: {
  replica: PersonalWorkloadReplicaV1 | null;
  error?: string | null;
}) {
  const presentation = buildPersonalAccelerationPresentation(replica, error);

  return (
    <section className={`${styles.screen} acceleration-screen`} aria-labelledby="personal-acceleration-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Acceleration</p>
          <h1 id="personal-acceleration-title">{presentation.headline}</h1>
          <p className={styles.intro}>
            Weekform Web matches the Desktop workspace without uploading or reconstructing the local evidence behind a play.
          </p>
        </div>
        <div className={styles.total} aria-label="Estimated weekly savings unavailable on Web">
          <AccelerationIcon name="zap" size={16} aria-hidden="true" />
          <div><strong>—</strong><small>est. saved / week</small></div>
        </div>
      </header>

      <div
        className={styles.connection}
        data-state={presentation.state}
        role={presentation.state === "error" ? "alert" : "status"}
      >
        <span>{presentation.statusLabel}</span>
        <p>{presentation.context}</p>
      </div>

      <section className={styles.synthesis} aria-labelledby="personal-acceleration-synthesis-title">
        <button
          type="button"
          className="button button-primary"
          disabled
          aria-disabled="true"
          title="Skill generation requires private local evidence and your locally configured AI"
        >
          <AccelerationIcon name="sparkles" size={16} aria-hidden="true" />
          Generate Skills
        </button>
        <div>
          <h2 id="personal-acceleration-synthesis-title">AI synthesis remains opt-in on Mac.</h2>
          <p>Web receives no raw window titles, workflow evidence, prompts, saved recipes, or AI credentials.</p>
        </div>
        <Link className="button button-secondary" href="/download">Get Weekform for Mac</Link>
      </section>

      <section className={styles.trackRecord} aria-labelledby="personal-acceleration-track-title">
        <AccelerationIcon name="trend" size={16} className={styles.trackIcon} aria-hidden="true" />
        <div>
          <h2 id="personal-acceleration-track-title">Realized savings</h2>
          <p>
            Acted-on plays and their week-over-week outcomes stay local. Web does not receive enough history to score projected savings against observed changes.
          </p>
        </div>
        <span className={styles.unavailable}>Not included in replica</span>
      </section>

      <section className={styles.playGrid} aria-labelledby="personal-acceleration-plays-title">
        <h2 id="personal-acceleration-plays-title" className={styles.srOnly}>Acceleration plays</h2>
        <article className={styles.boundaryCard}>
          <div className={styles.cardHeader}>
            <span className={styles.typeChip}><AccelerationIcon name="rocket" size={13} aria-hidden="true" /> Local plays</span>
            <span className={styles.confidence}>Confidence unavailable</span>
          </div>
          <h3>Continue with the evidence-backed workspace.</h3>
          <p>
            Open Weekform for Mac to mine repetitive workflows, inspect why each play surfaced, and review an estimate before acting.
          </p>
          <div className={styles.saving}>
            <AccelerationIcon name="lock" size={14} aria-hidden="true" />
            <strong>Private evidence required</strong>
          </div>
          <details className={styles.evidence}>
            <summary>Why no plays appear here</summary>
            <p>
              The positive allowlist exposes derived allocation and review-safe blocks only. Acceleration signals, recipes, evidence references, dismissals, and outcome history have no Web field.
            </p>
          </details>
          <div className={styles.actions}>
            <Link className="button button-primary" href="/download">Get Weekform for Mac</Link>
          </div>
        </article>
      </section>
    </section>
  );
}
