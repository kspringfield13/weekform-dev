import Link from "next/link";
import type { ReactNode } from "react";

import { deletePersonalReplicaHistory } from "@/app/dashboard/personalActions";
import { FormSubmitButton } from "@/components/FormSubmitButton";

import styles from "./PersonalWebDataControl.module.css";

type ControlIconName = "cloud" | "timer" | "download" | "reset";

function ControlIcon({ name }: { name: ControlIconName }) {
  const paths: Record<ControlIconName, ReactNode> = {
    cloud: <><path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.3-1.8A5 5 0 0 0 7 18Z" /><path d="M12 11v5m-2-2 2 2 2-2" /></>,
    timer: <><circle cx="12" cy="13" r="8" /><path d="M9 2h6M12 9v4l3 2" /></>,
    download: <><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M5 20h14" /></>,
    reset: <><path d="M4 7v5h5" /><path d="M5.5 16a8 8 0 1 0 .5-8.5L4 12" /></>,
  };
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function formatLatestSync(value: string | null): string {
  if (!value) return "No replica received";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Sync time unavailable";
  return `Last received ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date)}`;
}

export function PersonalWebDataControl({
  replicaCount,
  pendingReviewCount,
  latestWeekId,
  latestSyncedAt,
}: {
  replicaCount: number;
  pendingReviewCount: number | null;
  latestWeekId: string | null;
  latestSyncedAt: string | null;
}) {
  const replicaLabel = `${replicaCount} recent replica${replicaCount === 1 ? "" : "s"} loaded`;
  const pendingLabel = pendingReviewCount === null
    ? "Current-week request status unavailable"
    : `${pendingReviewCount} current-week pending request${pendingReviewCount === 1 ? "" : "s"}`;

  return (
    <section className={styles.section} aria-labelledby="web-data-control-title">
      <div className="settings-section-heading">
        <div>
          <h2 id="web-data-control-title">Data control</h2>
          <span>Manage the review-safe copy held for Web, and keep local evidence controls beside their Mac source of truth.</span>
        </div>
      </div>

      <div className={styles.boundary} role="status">
        <div>
          <strong>API-connected, temporary browser view</strong>
          <span>Web renders authenticated responses without a workload cache. Raw activity, titles, notes, screenshots, and full audit history stay local.</span>
        </div>
        <span className={styles.badge}>No workload cache</span>
      </div>

      <div className={styles.rows}>
        <section className={styles.row} aria-labelledby="web-private-workspace-title">
          <div className={styles.icon}><ControlIcon name="cloud" /></div>
          <div className={styles.copy}>
            <h3 id="web-private-workspace-title">Private Web workspace</h3>
            <p>Delete private Web workspace history owned by this account: replicas, all review-request lifecycle records across every week, and sync receipts. Local Mac data, team snapshots, memberships, account, sign-in, and registered desktop devices stay unchanged. If Private Web remains enabled, your Mac can publish a new replica.</p>
          </div>
          <div className={styles.status}>
            <strong>{replicaLabel} · {pendingLabel}</strong>
            <span>{latestWeekId ? `${latestWeekId} · ${formatLatestSync(latestSyncedAt)}` : formatLatestSync(latestSyncedAt)}</span>
          </div>
          <form className={styles.deleteForm} action={deletePersonalReplicaHistory}>
            <FormSubmitButton
              className="button button-danger"
              pendingLabel="Deleting Web history…"
              confirmMessage="Permanently delete your private Web workspace history, including replicas, all pending and decided review-request records across every week, and sync receipts? Your local Mac data and registered desktop devices will stay untouched."
            >
              Delete private Web history
            </FormSubmitButton>
          </form>
        </section>

        <section className={styles.row} aria-labelledby="web-retention-title">
          <div className={styles.icon}><ControlIcon name="timer" /></div>
          <div className={styles.copy}>
            <h3 id="web-retention-title">Activity retention</h3>
            <p>Choose how long raw active-window samples remain on the device that captured them. Web never receives those samples.</p>
          </div>
          <div className={styles.status}><strong>Mac only</strong><span>Local raw evidence</span></div>
          <Link className={`button button-secondary ${styles.localAction}`} href="/download">Get Weekform for Mac</Link>
        </section>

        <section className={styles.row} aria-labelledby="web-export-title">
          <div className={styles.icon}><ControlIcon name="download" /></div>
          <div className={styles.copy}>
            <h3 id="web-export-title">Export work ledger</h3>
            <p>Export full classified blocks and the explainability trail as JSON or CSV from the local source. Web only has the review-safe allowlist.</p>
          </div>
          <div className={styles.status}><strong>Mac only</strong><span>Full-detail local export</span></div>
          <Link className={`button button-secondary ${styles.localAction}`} href="/download">Get Weekform for Mac</Link>
        </section>

        <section className={styles.row} aria-labelledby="web-reset-title">
          <div className={styles.icon}><ControlIcon name="reset" /></div>
          <div className={styles.copy}>
            <h3 id="web-reset-title">Reset all local data</h3>
            <p>Reset activity, work blocks, corrections, forecasts, imports, and local audit history only from Weekform for Mac, after reviewing the full consequence.</p>
          </div>
          <div className={styles.status}><strong>Mac only · irreversible</strong><span>Never initiated by Web</span></div>
          <Link className={`button button-secondary ${styles.localAction}`} href="/download">Get Weekform for Mac</Link>
        </section>
      </div>
    </section>
  );
}
