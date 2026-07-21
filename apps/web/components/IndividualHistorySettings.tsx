"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import {
  buildReviewSafeActivity,
  buildSyncAuditEntries,
  filterReviewSafeActivity,
  filterSyncAuditEntries,
  formatHistoryDuration,
} from "@/lib/individualHistoryPresentation";
import type { PersonalReplicaView } from "@/lib/personalReplica";
import {
  buildIndividualSettingsUrl,
  INDIVIDUAL_SETTINGS_TABS,
  resolveIndividualSettingsTab,
  shouldPushIndividualSettingsTab,
  type IndividualSettingsTab,
} from "@/lib/individualSettingsRoute";

import { PersonalDataSourcesSettings } from "./PersonalDataSourcesSettings";
import { PersonalAIAssistanceSettings } from "./PersonalAIAssistanceSettings";
import { PersonalAIUsageSettings } from "./PersonalAIUsageSettings";
import { PersonalNotificationsSettings } from "./PersonalNotificationsSettings";
import { PersonalSensitiveBoundaryScreen } from "./PersonalSensitiveBoundaryScreen";
import { MacAppLink } from "./MacAppLink";
import styles from "./PersonalHistoryScreen.module.css";

export type HistoryTab = "activity" | "audit";
const SETTINGS_LABELS: Record<IndividualSettingsTab, string> = {
  "data-sources": "Data Sources",
  "data-control": "Data Control",
  "ai-assistance": "AI Assistance",
  "ai-usage": "AI Usage",
  "notifications": "Notifications",
  "account": "Account & Sharing",
};

const SETTINGS_TABS = INDIVIDUAL_SETTINGS_TABS.map((id) => ({ id, label: SETTINGS_LABELS[id] }));

function pushSettingsTab(tab: IndividualSettingsTab) {
  if (!shouldPushIndividualSettingsTab(window.location.href, tab)) return;
  const url = buildIndividualSettingsUrl(window.location.href, tab);
  window.history.pushState(null, "", url);
}

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
      <MacAppLink className="button button-primary">Get Weekform for Mac</MacAppLink>
    </div>
  );
}

export function IndividualSensitiveBoundaryView() {
  return (
    <>
      <span className="visually-hidden" role="status">
        Flagged captures remain on your Mac. Web cannot display or manage them.
      </span>
      <PersonalSensitiveBoundaryScreen />
    </>
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
  const activitySearchInputRef = useRef<HTMLInputElement>(null);
  const auditSearchInputRef = useRef<HTMLInputElement>(null);
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
  const displayedActivity = query.trim() ? visibleActivity : visibleActivity.slice(1);

  return (
    <section className={`web-desktop-screen ${tab === "activity" ? "ledger-screen" : "audit-screen"} ${styles.historyScreen}`} aria-labelledby={`web-history-${initialTab}-title`}>
      <header className={`web-screen-heading screen-header compact ${styles.screenHeader} ${tab === "activity" ? styles.activityHeader : ""}`}>
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
        {tab === "activity" ? (
          <label className={`search-box ${styles.searchBox}`}>
            <Search aria-hidden className={styles.searchGlyph} />
            <input
              ref={activitySearchInputRef}
              aria-label="Search review-safe activity"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }}
              placeholder="Search category, mode, week, or review state"
            />
            {query ? <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); activitySearchInputRef.current?.focus(); }}><X aria-hidden /></button> : null}
          </label>
        ) : (
          <div className={styles.summaryScore} title={error ? "Web receipt count unavailable" : "Successful derived replica syncs available in Web"}>
            <span>Web receipts</span>
            <strong>{error ? "—" : auditEntries.length}</strong>
            <span className={styles.srOnly}>{error ? "Web receipt count unavailable" : "Successful derived replica syncs"}</span>
          </div>
        )}
      </header>

      {showTabs ? <nav className="context-navigation" aria-label="History views">
        <button type="button" className={tab === "activity" ? "is-active" : ""} aria-current={tab === "activity" ? "page" : undefined} onClick={() => setTab("activity")}>Activity ledger</button>
        <button type="button" className={tab === "audit" ? "is-active" : ""} aria-current={tab === "audit" ? "page" : undefined} onClick={() => setTab("audit")}>Audit log</button>
      </nav> : null}

      {error ? (
        <div className="form-alert" role="alert">History could not be loaded. Reload the page to try again.</div>
      ) : tab === "activity" ? (
        <>
          {!query.trim() && current ? (
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
          {activity.length === 0 ? (
            <MacBoundary><h2>No review-safe work blocks yet</h2><p>Connect Private Web workspace from the desktop app to publish a derived weekly replica.</p></MacBoundary>
          ) : visibleActivity.length === 0 ? (
            <div className="panel web-screen-empty"><h2>No blocks match</h2><p>Try a category, mode, week, or review state.</p><button type="button" className="button button-secondary" onClick={() => setQuery("")}>Clear search</button></div>
          ) : displayedActivity.length > 0 ? (
            <section className={styles.ledgerSection} aria-labelledby="history-block-list-title">
              <header className={styles.ledgerHeading}>
                <div>
                  <span className={styles.eyebrow}>{query.trim() ? "Search results" : "Activity history"}</span>
                  <h2 id="history-block-list-title">{query.trim() ? "Matching blocks" : "Earlier blocks"}</h2>
                </div>
                <span role="status">{displayedActivity.length} {displayedActivity.length === 1 ? "block" : "blocks"}</span>
              </header>
              <div className={styles.ledgerList}>
                {displayedActivity.map((row) => (
                  <article className={`${styles.blockCard} ${row.reviewStatus === "Reviewed" ? styles.reviewedCard : ""}`} key={`${row.weekId}-${row.blockId}`}>
                    <div className={styles.blockMain}>
                      <div className={styles.blockIdentity}>
                        <div className={styles.blockTopline}>
                          <span>{row.weekId}</span>
                          <span className={row.reviewStatus === "Reviewed" ? styles.reviewed : styles.needsReview}>{row.reviewStatus}</span>
                        </div>
                        <h3>{row.category}</h3>
                        <p>{row.mode} · {row.plannedStatus}</p>
                      </div>
                      <div className={styles.blockDuration}>
                        <strong>{formatHistoryDuration(row.durationMinutes)}</strong>
                        <span>Duration</span>
                      </div>
                    </div>
                    <div className={styles.blockMeta}>
                      <time dateTime={row.startTime}>{formatDateTime(row.startTime)}</time>
                      <span>{row.confidencePct}% confidence</span>
                      <span>{Math.round(row.estimatedCapacityPct)}% of week</span>
                      {row.blockerFlag ? <span className={styles.blocker}>Blocker flagged</span> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <>
          <div className={styles.auditToolbar}>
            <div className={styles.auditFilters} role="group" aria-label="Audit scope">
              <button type="button" className={auditFilter === "receipts" ? styles.activeFilter : ""} aria-pressed={auditFilter === "receipts"} onClick={() => setAuditFilter("receipts")}>Web receipts</button>
              <button type="button" className={auditFilter === "local" ? styles.activeFilter : ""} aria-pressed={auditFilter === "local"} onClick={() => setAuditFilter("local")}>Local history</button>
            </div>
            {auditFilter === "receipts" ? (
              <label className={`search-box ${styles.searchBox}`}>
                <span className="visually-hidden">Search sync receipts</span>
                <Search aria-hidden className={styles.searchGlyph} />
                <input
                  ref={auditSearchInputRef}
                  aria-label="Search sync receipts"
                  value={auditQuery}
                  onChange={(event) => setAuditQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Escape") setAuditQuery(""); }}
                  placeholder="Search sync receipts"
                />
                {auditQuery ? <button type="button" aria-label="Clear search" onClick={() => { setAuditQuery(""); auditSearchInputRef.current?.focus(); }}><X aria-hidden /></button> : null}
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
            <MacAppLink>Get Weekform for Mac</MacAppLink>
          </aside>
        </>
      )}
    </section>
  );
}

export function IndividualSettingsView({
  accountEmail,
  accountAndSharing,
  dataControl,
  initialTab = "data-sources",
}: {
  accountEmail: string;
  accountAndSharing?: ReactNode;
  dataControl?: ReactNode;
  initialTab?: IndividualSettingsTab;
}) {
  const [tab, setTab] = useState<IndividualSettingsTab>(initialTab);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const isAccountSettings = tab === "account";

  const focusSettingsTab = (value: unknown) => {
    const nextTab = resolveIndividualSettingsTab(value);
    setTab(nextTab);
    const nextIndex = SETTINGS_TABS.findIndex((item) => item.id === nextTab);
    window.requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  };

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const handlePopState = () => {
      const routeTab = new URL(window.location.href).searchParams.get("settings_tab");
      focusSettingsTab(routeTab);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const selectTab = (index: number) => {
    const item = SETTINGS_TABS[index];
    if (!item) return;
    setTab(item.id);
    pushSettingsTab(item.id);
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
        <div>
          <span>Settings</span>
          <h1 id="web-settings-title">{isAccountSettings ? "Account & sharing" : "Privacy and data sources"}</h1>
          <p>
            {isAccountSettings
              ? "Review your Weekform Web account and the sharing controls available to your membership."
              : "Web receives only the review-safe data you approve. Capture and local controls stay on your Mac."}
          </p>
        </div>
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
            onClick={() => selectTab(index)}
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
          {item.id === "data-control" ? dataControl ?? <MacBoundary><h2>Data control follows the local source of truth</h2><p>Pause capture, change retention, export a full backup, or reset local data from the desktop app. Web account and team records follow their existing server controls.</p></MacBoundary> : null}
          {item.id === "ai-assistance" ? <PersonalAIAssistanceSettings /> : null}
          {item.id === "ai-usage" ? <PersonalAIUsageSettings /> : null}
          {item.id === "notifications" ? <PersonalNotificationsSettings /> : null}
          {item.id === "account" ? (
            <div className="settings-section account-sharing-page web-account-sharing">
              <div className="settings-section-heading account-sharing-heading">
                <div className="account-sharing-heading-copy">
                  <span className="account-sharing-eyebrow">Account</span>
                  <h2>Weekform Web</h2>
                  <p>Signed in as {accountEmail}. Sharing stays limited to fields you approved from Weekform for Mac.</p>
                </div>
              </div>
              <div className="web-account-sharing-content">
                {accountAndSharing ?? <div className="panel"><h3>No additional sharing controls</h3><p>Your account is active. Manager Access appears only when your membership allows it.</p></div>}
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}
