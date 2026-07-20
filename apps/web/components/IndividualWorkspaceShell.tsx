"use client";

import Link from "next/link";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { WeekformMark } from "@/components/WeekformMark";

type IndividualDestination = "today" | "week" | "agent" | "history" | "settings";
type IndividualSubview =
  | "today"
  | "capacity"
  | "forecast"
  | "review"
  | "usage"
  | "summary"
  | "agent"
  | "accelerate"
  | "skills"
  | "activity"
  | "audit"
  | "settings";

const DESTINATIONS: Array<{
  id: IndividualDestination;
  label: string;
  description: string;
}> = [
  { id: "today", label: "Today", description: "Daily review queue" },
  { id: "week", label: "Week", description: "Capacity and summary" },
  { id: "agent", label: "Agent", description: "Ask, plan, and understand" },
  { id: "history", label: "History", description: "Ledger and audit trail" },
  { id: "settings", label: "Settings", description: "Account and sharing" },
];
const SETTINGS_DESTINATION = DESTINATIONS[4]!;

const DEFAULT_SUBVIEW: Record<IndividualDestination, IndividualSubview> = {
  today: "today",
  week: "capacity",
  agent: "agent",
  history: "activity",
  settings: "settings",
};

const CONTEXT_VIEWS: Partial<Record<IndividualDestination, Array<{ id: IndividualSubview; label: string }>>> = {
  week: [
    { id: "capacity", label: "Capacity" },
    { id: "forecast", label: "Forecast" },
    { id: "review", label: "Review" },
    { id: "usage", label: "AI Usage" },
    { id: "summary", label: "Summary" },
  ],
  agent: [
    { id: "agent", label: "Ask" },
    { id: "accelerate", label: "Accelerate" },
    { id: "skills", label: "Skills" },
  ],
  history: [
    { id: "activity", label: "Activity" },
    { id: "audit", label: "Audit" },
  ],
};

function NavIcon({ id }: { id: IndividualDestination | "manager" }) {
  const paths: Record<typeof id, ReactNode> = {
    today: <><path d="M5 4v3M19 4v3M4 9h16" /><path d="m9 16 2 2 4-5" /><rect x="3" y="5" width="18" height="16" rx="2" /></>,
    week: <><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /><path d="M2 19h22" /></>,
    agent: <><path d="M12 3 9.8 9.8 3 12l6.8 2.2L12 21l2.2-6.8L21 12l-6.8-2.2Z" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    manager: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 2.4-5 6-5s6 2 6 5M16 6h5M18.5 3.5v5" /></>,
  };
  return <svg className="web-nav-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[id]}</svg>;
}

export function IndividualWorkspaceShell({
  children,
  greetingName,
  reliableCapacity,
  reviewCount,
  managerAccessAvailable,
  managerHref,
  accountActions,
}: {
  children: ReactNode;
  greetingName: string;
  reliableCapacity: number | null;
  reviewCount: number;
  managerAccessAvailable: boolean;
  managerHref: string;
  accountActions: ReactNode;
}) {
  const [active, setActive] = useState<IndividualDestination>("week");
  const [activeSubview, setActiveSubview] = useState<IndividualSubview>("capacity");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const contextTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ destination?: IndividualDestination; subview?: IndividualSubview }>).detail;
      const destination = detail?.destination;
      if (!destination || !DESTINATIONS.some((item) => item.id === destination)) return;
      setActive(destination);
      setActiveSubview(detail.subview ?? DEFAULT_SUBVIEW[destination]);
    };
    window.addEventListener("weekform:web-navigate", handleNavigate);
    return () => window.removeEventListener("weekform:web-navigate", handleNavigate);
  }, []);

  const navigate = (destination: (typeof DESTINATIONS)[number]) => {
    setActive(destination.id);
    setActiveSubview(DEFAULT_SUBVIEW[destination.id]);
  };

  const contextViews = CONTEXT_VIEWS[active] ?? [];
  const selectContextView = (index: number) => {
    const view = contextViews[index];
    if (!view) return;
    setActiveSubview(view.id);
    contextTabRefs.current[index]?.focus();
  };
  const handleContextKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + contextViews.length) % contextViews.length;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % contextViews.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = contextViews.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectContextView(nextIndex);
  };

  return (
    <div
      className={`app web-individual-app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
      data-active-view={active}
      data-active-subview={activeSubview}
    >
      <header className="web-app-toolbar">
        <div className="web-toolbar-title">
          <strong>Weekform Web</strong>
          <span>{greetingName} · Private, review-safe workspace</span>
        </div>
        <div className="web-toolbar-state" role="status">
          <i aria-hidden="true" /> API-connected · no workload cache
        </div>
        <div className="web-toolbar-actions">{accountActions}</div>
      </header>

      <aside className="sidebar" id="web-primary-sidebar" aria-label="Primary navigation">
        <Link href="/app" className="brand" aria-label="Weekform Web home">
          <WeekformMark className="brand-mark" />
          <strong className="brand-name">Weekform</strong>
        </Link>
        <nav className="nav-list">
          {DESTINATIONS.map((destination) => (
            <button
              className={`nav-item${destination.id === "settings" ? " nav-item-settings" : ""}${active === destination.id ? " is-active" : ""}`}
              key={destination.id}
              onClick={() => navigate(destination)}
              type="button"
              aria-current={active === destination.id ? "page" : undefined}
            >
              <NavIcon id={destination.id} />
              <span>
                <strong>{destination.label}</strong>
                <small>{destination.description}</small>
              </span>
              {destination.id === "today" && reviewCount > 0 && (
                <>
                  <b aria-hidden>{reviewCount}</b>
                  <span className="visually-hidden">
                    {reviewCount} block{reviewCount === 1 ? "" : "s"} awaiting review
                  </span>
                </>
              )}
            </button>
          ))}
        </nav>
        {managerAccessAvailable && (
          <Link className="nav-item manager-access-entry" href={managerHref}>
            <NavIcon id="manager" />
            <span><strong>Manager Access</strong><small>Approved team signals</small></span>
          </Link>
        )}
        <div className="sidebar-intelligence">
          <div className="side-metric-heading"><span>Reliable capacity</span><span aria-hidden="true">◌</span></div>
          <div className="side-metric-value">
            <strong>{reliableCapacity === null ? "—" : `${Math.round(reliableCapacity)}%`}</strong>
            <small>{reliableCapacity === null ? "Needs signal" : "This week"}</small>
          </div>
          <div className="side-capacity-track" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, reliableCapacity ?? 0))}%` }} />
          </div>
          <div className="web-private-state"><i aria-hidden="true" /> Review-safe fields only</div>
        </div>
        <button
          className={active === "settings" ? "settings-button is-active" : "settings-button"}
          type="button"
          aria-current={active === "settings" ? "page" : undefined}
          onClick={() => navigate(SETTINGS_DESTINATION)}
        >
          <NavIcon id="settings" />
          <span>Settings</span>
        </button>
      </aside>

      <button
        aria-controls="web-primary-sidebar"
        aria-expanded={!sidebarCollapsed}
        aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        className="web-sidebar-toggle"
        type="button"
        onClick={() => setSidebarCollapsed((value) => !value)}
      >
        <span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
      </button>

      <main className="main-panel">
        {contextViews.length > 0 ? (
          <div className="page-context-navigation">
            <nav className="context-navigation" aria-label={`${active[0]?.toUpperCase()}${active.slice(1)} views`} role="tablist">
              {contextViews.map((view, index) => (
                <button
                  className={activeSubview === view.id ? "is-active" : ""}
                  id={`web-tab-${view.id}`}
                  key={view.id}
                  type="button"
                  role="tab"
                  aria-controls="web-individual-tabpanel"
                  aria-selected={activeSubview === view.id}
                  tabIndex={activeSubview === view.id ? 0 : -1}
                  ref={(element) => { contextTabRefs.current[index] = element; }}
                  onClick={() => setActiveSubview(view.id)}
                  onKeyDown={(event) => handleContextKeyDown(event, index)}
                >
                  {view.label}
                </button>
              ))}
            </nav>
          </div>
        ) : null}
        <div
          id="web-individual-tabpanel"
          role="tabpanel"
          aria-labelledby={contextViews.length > 0 ? `web-tab-${activeSubview}` : undefined}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
