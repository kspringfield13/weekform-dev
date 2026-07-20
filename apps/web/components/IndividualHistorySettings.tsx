"use client";

import Link from "next/link";
import type { KeyboardEvent, ReactNode } from "react";
import { useMemo, useRef, useState } from "react";

import {
  buildReviewSafeActivity,
  buildSyncAuditEntries,
  filterReviewSafeActivity,
  filterSyncAuditEntries,
} from "@/lib/individualHistoryPresentation";
import type { PersonalReplicaView } from "@/lib/personalReplica";

import { PersonalDataSourcesSettings } from "./PersonalDataSourcesSettings";
import styles from "./PersonalHistoryScreen.module.css";

export type HistoryTab = "activity" | "audit";
type SettingsTab =
  | "data-sources"
  | "data-control"
  | "ai-assistance"
  | "ai-usage"
  | "notifications"
  | "account";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "data-sources", label: "Data Sources" },
  { id: "data-control", label: "Data Control" },
  { id: "ai-assistance", label: "AI Assistance" },
  { id: "ai-usage", label: "AI Usage" },
  { id: "notifications", label: "Notifications" },
  { id: "account", label: "Account & Sharing" },
];

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function MacBoundary({ children }: { children: ReactNode }) {
  return (
    <div className={`panel web-screen-empty ${styles.macBoundary}`}>
      {children}
      <p>Raw activity stays on your Mac. This browser never receives window titles, screenshots, notes, or AI credentials.</p>
      <Link href="/download" className="button button-primary">Open Weekform for Mac</Link>
    </div>
  );
}

export function IndividualHistoryView({
  replicas,
  error,
  initialTab = "activity",
  showTabs = true,
}: {
  replicas: PersonalReplicaView[];
  error: string | null;
  initialTab?: HistoryTab;
  showTabs?: boolean;
}) {
  const [tab, setTab] = useState<HistoryTab>(initialTab);
  const [query, setQuery] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [auditFilter, setAuditFilter] = useState<"receipts" | "local">("receipts");
  const activity = useMemo(() => buildReviewSafeActivity(replicas), [replicas]);
  const visibleActivity = useMemo(
    () => filterReviewSafeActivity(activity, query),
    [activity, query],
  );
  const auditEntries = useMemo(() => buildSyncAuditEntries(replicas), [replicas]);
  const visibleAuditEntries = useMemo(
    () => filterSyncAuditEntries(auditEntries, auditQuery),
    [auditEntries, auditQuery],
  );
  const current = activity[0];

  return (
    <section className={`web-desktop-screen ${tab === "activity" ? "ledger-screen" : "audit-screen"} ${styles.historyScreen}`} aria-labelledby={`web-history-${initialTab}-title`}>
      <header className={`web-screen-heading screen-header compact ${styles.screenHeader}`}>
        <div>
          <span className={styles.eyebrow}>{tab === "activity" ? "Activity ledger" : "Audit log"}</span>
          <h1 id={`web-history-${initialTab}-title`}>
            {tab === "activity" ? "Explainable review-safe work blocks." : "Review-safe sync receipts."}
          </h1>
          <p>
            {tab === "activity"
              ? "Inspect the derived workload fields your Mac approved for this workspace."
              : "See when a derived weekly replica reached Web. The complete local audit log remains on your Mac."}
          </p>
        </div>
        <div className={styles.summaryScore} title={tab === "activity" ? "Review-safe inferred blocks available in Web" : "Successful derived replica syncs available in Web"}>
          <span>{tab === "activity" ? "Safe blocks" : "Web receipts"}</span>
          <strong>{tab === "activity" ? activity.length : auditEntries.length}</strong>
          <span className={styles.srOnly}>{tab === "activity" ? "Review-safe inferred blocks" : "Successful derived replica syncs"}</span>
        </div>
      </header>

      {showTabs ? <nav className="context-navigation" aria-label="History views">
        <button type="button" className={tab === "activity" ? "is-active" : ""} aria-current={tab === "activity" ? "page" : undefined} onClick={() => setTab("activity")}>Activity ledger</button>
        <button type="button" className={tab === "audit" ? "is-active" : ""} aria-current={tab === "audit" ? "page" : undefined} onClick={() => setTab("audit")}>Audit log</button>
      </nav> : null}

      {error ? (
        <div className="form-alert" role="alert">History could not be loaded. Reload the page to try again.</div>
      ) : tab === "activity" ? (
        <>
          {current ? (
            <section className={styles.currentBlock} aria-label="Current review-safe work block">
              <div>
                <span className={styles.eyebrow}>Current block</span>
                <h2>{current.category}</h2>
                <p>{current.mode} · {current.plannedStatus}</p>
              </div>
              <div className={styles.capacityPulse} title="Share of the modeled week represented by this block">
                <strong>{Math.round(current.estimatedCapacityPct)}%</strong>
                <span>of week</span>
              </div>
            </section>
          ) : null}
          <div className={`audit-toolbar ${styles.activityToolbar}`}>
            <label className={`search-box ${styles.searchBox}`}>
              <span className="visually-hidden">Search review-safe activity</span>
              <span aria-hidden className={styles.searchGlyph}>⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
                placeholder="Search category, mode, week, or review state"
              />
              {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>×</button> : null}
            </label>
          </div>
          {activity.length === 0 ? (
            <MacBoundary><h2>No review-safe work blocks yet</h2><p>Connect Private Web workspace from the desktop app to publish a derived weekly replica.</p></MacBoundary>
          ) : visibleActivity.length === 0 ? (
            <div className="panel web-screen-empty"><h2>No blocks match</h2><p>Try a category, mode, week, or review state.</p><button type="button" className="button button-secondary" onClick={() => setQuery("")}>Clear search</button></div>
          ) : (
            <div className={styles.ledgerList}>
              <h2 className="visually-hidden">Review-safe work blocks</h2>
              {visibleActivity.map((row) => (
                <article className={styles.blockCard} key={`${row.weekId}-${row.blockId}`}>
                  <div className={styles.blockTopline}>
                    <span>{row.weekId}</span>
                    <span className={row.reviewStatus === "Reviewed" ? styles.reviewed : styles.needsReview}>{row.reviewStatus}</span>
                  </div>
                  <div className={styles.blockMain}>
                    <div><h3>{row.category}</h3><p>{row.mode} · {row.plannedStatus}</p></div>
                    <strong>{row.durationMinutes} min</strong>
                  </div>
                  <div className={styles.blockMeta}>
                    <span>{formatDateTime(row.startTime)}</span>
                    <span>{row.confidencePct}% inference confidence</span>
                    <span>{Math.round(row.estimatedCapacityPct)}% of week</span>
                    {row.blockerFlag ? <span className={styles.blocker}>Blocker flagged</span> : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className={styles.auditToolbar}>
            <div className={styles.auditFilters} aria-label="Audit scope">
              <button type="button" className={auditFilter === "receipts" ? styles.activeFilter : ""} aria-pressed={auditFilter === "receipts"} onClick={() => setAuditFilter("receipts")}>Web receipts</button>
              <button type="button" className={auditFilter === "local" ? styles.activeFilter : ""} aria-pressed={auditFilter === "local"} onClick={() => setAuditFilter("local")}>Local history</button>
            </div>
            {auditFilter === "receipts" ? (
              <label className={`search-box ${styles.searchBox}`}>
                <span className="visually-hidden">Search sync receipts</span>
                <span aria-hidden className={styles.searchGlyph}>⌕</span>
                <input
                  aria-label="Search sync receipts"
                  value={auditQuery}
                  onChange={(event) => setAuditQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Escape") setAuditQuery(""); }}
                  placeholder="Search sync receipts"
                />
                {auditQuery ? <button type="button" aria-label="Clear search" onClick={() => setAuditQuery("")}>×</button> : null}
              </label>
            ) : <span>Web shows completed derived syncs only</span>}
          </div>
          {auditFilter === "local" ? (
            <MacBoundary><h2>Local audit history stays on your Mac</h2><p>Signals, corrections, AI activity, privacy changes, and consent receipts remain beside the local source of truth.</p></MacBoundary>
          ) : auditEntries.length === 0 ? (
            <MacBoundary><h2>No Web sync receipts yet</h2><p>Receipts appear after your Mac successfully publishes a review-safe weekly replica.</p></MacBoundary>
          ) : visibleAuditEntries.length === 0 ? (
            <div className="panel web-screen-empty"><h2>No receipts match</h2><p>Try a week, revision, receipt title, or replica ID.</p><button type="button" className="button button-secondary" onClick={() => setAuditQuery("")}>Clear search</button></div>
          ) : (
            <div className={styles.auditList}>
              {visibleAuditEntries.map((entry) => (
                <details className={styles.auditRow} key={entry.replicaId}>
                  <summary>
                    <div><span className={styles.auditBadge}>Sync receipt</span><time dateTime={entry.timestamp}>{formatDateTime(entry.timestamp)}</time></div>
                    <div><strong>{entry.title}</strong><small>{entry.weekId} · derived fields only</small></div>
                  </summary>
                  <div className={styles.auditDetail}><p>{entry.summary}</p><p className="mono">Replica {entry.replicaId}</p></div>
                </details>
              ))}
            </div>
          )}
          <aside className={styles.flaggedBoundary} aria-label="Flagged captures privacy boundary">
            <div><span className={styles.eyebrow}>Flagged captures</span><strong>Raw visual captures stay on your Mac.</strong></div>
            <p>This view appears in Desktop only when Visual Context finds potentially sensitive material. Web never receives the capture, screenshot, or sensitive summary.</p>
            <Link href="/download">Review on Mac <span aria-hidden>→</span></Link>
          </aside>
        </>
      )}
    </section>
  );
}

export function IndividualSettingsView({
  accountEmail,
  accountAndSharing,
}: {
  accountEmail: string;
  accountAndSharing?: ReactNode;
}) {
  const [tab, setTab] = useState<SettingsTab>("data-sources");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedLabel = SETTINGS_TABS.find((item) => item.id === tab)?.label ?? "Settings";
  const selectTab = (index: number) => {
    const item = SETTINGS_TABS[index];
    if (!item) return;
    setTab(item.id);
    tabRefs.current[index]?.focus();
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % SETTINGS_TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = SETTINGS_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectTab(nextIndex);
  };

  return (
    <section className="web-desktop-screen settings-screen" aria-labelledby="web-settings-title">
      <header className="web-screen-heading screen-header">
        <div><span>Settings</span><h1 id="web-settings-title">{selectedLabel}</h1><p>Understand what Web can access and manage local-only controls from the source of truth.</p></div>
      </header>
      <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((item, index) => (
          <button
            key={item.id}
            id={`web-settings-tab-${item.id}`}
            type="button"
            role="tab"
            aria-controls={`web-settings-panel-${item.id}`}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            className={tab === item.id ? "is-active" : ""}
            ref={(element) => { tabRefs.current[index] = element; }}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >{item.label}</button>
        ))}
      </nav>

      {SETTINGS_TABS.map((item) => (
        <div
          key={item.id}
          id={`web-settings-panel-${item.id}`}
          className="settings-tab-panel"
          role="tabpanel"
          aria-labelledby={`web-settings-tab-${item.id}`}
          tabIndex={0}
          hidden={tab !== item.id}
        >
          {item.id === "data-sources" ? <PersonalDataSourcesSettings /> : null}
          {item.id === "data-control" ? <MacBoundary><h2>Data control follows the local source of truth</h2><p>Pause capture, change retention, export a full backup, or reset local data from the desktop app. Web account and team records follow their existing server controls.</p></MacBoundary> : null}
          {item.id === "ai-assistance" ? <MacBoundary><h2>AI assistance stays beside your evidence</h2><p>Provider choice, API credentials, model settings, and Visual Context remain on the Mac.</p></MacBoundary> : null}
          {item.id === "ai-usage" ? <MacBoundary><h2>AI usage remains local</h2><p>Token imports, pricing overlays, and usage budgets are not copied into this browser workspace.</p></MacBoundary> : null}
          {item.id === "notifications" ? <MacBoundary><h2>Notifications run on your Mac</h2><p>Capacity guardrails, review nudges, and weekly readiness alerts use the local workload model.</p></MacBoundary> : null}
          {item.id === "account" ? (
            <div className="settings-section">
              <div className="settings-section-heading"><div><h2>Account &amp; Sharing</h2><span>Signed in as {accountEmail}. Team coordination uses only fields approved by your existing sharing settings.</span></div></div>
              {accountAndSharing ?? <div className="panel"><h3>No additional sharing controls</h3><p>Your account is active. Manager Access appears only when your membership allows it.</p></div>}
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}
