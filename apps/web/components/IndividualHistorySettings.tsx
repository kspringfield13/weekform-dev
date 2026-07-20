"use client";

import Link from "next/link";
import type { KeyboardEvent, ReactNode } from "react";
import { useMemo, useRef, useState } from "react";

import {
  buildReviewSafeActivity,
  buildSyncAuditEntries,
  filterReviewSafeActivity,
} from "@/lib/individualHistoryPresentation";
import type { PersonalReplicaView } from "@/lib/personalReplica";

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
    <div className="panel web-screen-empty">
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
  const activity = useMemo(() => buildReviewSafeActivity(replicas), [replicas]);
  const visibleActivity = useMemo(
    () => filterReviewSafeActivity(activity, query),
    [activity, query],
  );
  const auditEntries = useMemo(() => buildSyncAuditEntries(replicas), [replicas]);

  return (
    <section className="web-desktop-screen ledger-screen" aria-labelledby={`web-history-${initialTab}-title`}>
      <header className="web-screen-heading screen-header compact">
        <div>
          <span>History</span>
          <h1 id={`web-history-${initialTab}-title`}>
            {tab === "activity" ? "Explainable review-safe work blocks." : "Review-safe sync receipts."}
          </h1>
          <p>
            {tab === "activity"
              ? "Inspect the derived workload fields your Mac approved for this workspace."
              : "See when a derived weekly replica reached Web. The complete local audit log remains on your Mac."}
          </p>
        </div>
        <div className="web-review-count">
          <strong>{tab === "activity" ? activity.length : auditEntries.length}</strong>
          <span>{tab === "activity" ? "Safe blocks" : "Sync receipts"}</span>
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
          <div className="audit-toolbar">
            <label className="search-box">
              <span className="visually-hidden">Search review-safe activity</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search category, mode, week, or review state" />
            </label>
          </div>
          {activity.length === 0 ? (
            <MacBoundary><h2>No review-safe work blocks yet</h2><p>Connect Private Web workspace from the desktop app to publish a derived weekly replica.</p></MacBoundary>
          ) : visibleActivity.length === 0 ? (
            <div className="panel web-screen-empty"><h2>No blocks match</h2><p>Try a category, mode, week, or review state.</p><button type="button" className="button button-secondary" onClick={() => setQuery("")}>Clear search</button></div>
          ) : (
            <div className="ledger-list">
              {visibleActivity.map((row) => (
                <article className="member-card" key={`${row.weekId}-${row.blockId}`}>
                  <div className="member-card-head">
                    <div><strong>{row.category}</strong><span>{row.mode} · {row.plannedStatus}</span></div>
                    <span className="badge">{row.reviewStatus}</span>
                  </div>
                  <p>{formatDateTime(row.startTime)} · {row.durationMinutes} min · {Math.round(row.estimatedCapacityPct)}% of week</p>
                  <div className="status-line"><span>{row.weekId}</span><span>{row.confidencePct}% inference confidence{row.blockerFlag ? " · Blocker flagged" : ""}</span></div>
                </article>
              ))}
            </div>
          )}
        </>
      ) : auditEntries.length === 0 ? (
        <MacBoundary><h2>No Web sync receipts yet</h2><p>Receipts appear after your Mac successfully publishes a review-safe weekly replica.</p></MacBoundary>
      ) : (
        <div className="audit-list">
          <div className="status-line"><span>Web receipts only</span><span>Open Mac for the complete local audit trail</span></div>
          {auditEntries.map((entry) => (
            <details className="audit-row" key={entry.replicaId}>
              <summary>
                <div><span className="badge">Sync receipt</span><time dateTime={entry.timestamp}>{formatDateTime(entry.timestamp)}</time></div>
                <div><strong>{entry.title}</strong><small>{entry.weekId} · derived fields only</small></div>
              </summary>
              <div className="audit-detail"><p>{entry.summary}</p><p className="mono">Replica {entry.replicaId}</p></div>
            </details>
          ))}
        </div>
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
            aria-controls="web-settings-tabpanel"
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
          {item.id === "data-sources" ? <MacBoundary><h2>Data sources are controlled locally</h2><p>Calendar imports, foreground capture, chat metadata imports, and Visual Context are enabled only in Weekform for Mac.</p></MacBoundary> : null}
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
