import {
  Settings,
  CalendarCheck,
  BarChart3,
  History,
  Radio,
  Gauge,
  ChevronLeft,
  Waypoints,
  Play,
  Presentation,
  LogOut,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { WeeklyCapacitySnapshot } from "../../../../../packages/domain/src/models";
import type { Screen } from "../../lib/types";
import { AppToolbar } from "./AppToolbar";
import { ContextNavigation } from "./ContextNavigation";
import { ToastHost } from "../common/ToastHost";
import { WeekformMark } from "../common/WeekformMark";
import { AgentMark } from "../common/AgentMark";
import { CapacityDetailModal } from "../common/CapacityDetailModal";
import type { Toast } from "../../hooks/useToasts";
import { MAIN_TABPANEL_ID, primarySectionForScreen, sectionViews, tabId } from "../../lib/ui";
import { pct } from "../../lib/format";
import { buildIndividualCapacityDetail } from "../../services/capacityDetail";

export function AppShell({
  active,
  setActive,
  snapshot,
  hasWorkBlocks,
  reviewCount,
  showFlaggedTab,
  paused,
  setPaused,
  sidebarCollapsed,
  setSidebarCollapsed,
  windowMode,
  setWindowMode,
  theme,
  setTheme,
  weekRangeLabel,
  demoMode,
  simulationMode,
  showTrackingReminder,
  toasts,
  onDismissToast,
  teamAvailable,
  teamRole,
  children
}: {
  active: Screen;
  setActive: (screen: Screen) => void;
  snapshot: WeeklyCapacitySnapshot;
  hasWorkBlocks: boolean;
  reviewCount: number;
  showFlaggedTab: boolean;
  paused: boolean;
  setPaused: (value: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (value: boolean) => void;
  windowMode: "large" | "compact";
  setWindowMode: (value: "large" | "compact") => void;
  theme: "light" | "dark";
  setTheme: (value: "light" | "dark") => void;
  weekRangeLabel: string;
  demoMode: boolean;
  simulationMode: boolean;
  /** Persistent "tracking is still off" nudge after the getting-started modal was deferred. */
  showTrackingReminder: boolean;
  toasts: Toast[];
  onDismissToast: (id: string) => void;
  teamAvailable: boolean;
  teamRole: "owner" | "manager" | "member" | null;
  children: ReactNode;
}) {
  // Context navigation is shown inside the page column when a primary section
  // has multiple views. Today, Settings, and compact mode stay single-view.
  const [capacityDetailOpen, setCapacityDetailOpen] = useState(false);
  const capacityDetail = buildIndividualCapacityDetail(snapshot, hasWorkBlocks);
  const sectionTabCount = sectionViews(primarySectionForScreen(active), {
    includeFlagged: showFlaggedTab || active === "sensitive"
  }).length;
  const showWeekContext = primarySectionForScreen(active) === "week";
  const showContextNav = windowMode === "large" && active !== "setup" && sectionTabCount > 0;
  return (
    <div
      className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${windowMode === "compact" ? "is-compact-widget" : ""} ${active === "agent" ? "agent-active" : ""}`}
      data-simulation-runtime={simulationMode ? "true" : undefined}
    >
      <AppToolbar
        paused={paused}
        setPaused={setPaused}
        windowMode={windowMode}
        setWindowMode={setWindowMode}
        theme={theme}
        setTheme={setTheme}
      />
      {windowMode === "large" && (
        <>
          <aside className="sidebar" id="primary-sidebar" aria-label="Primary navigation">
        <div className="brand">
          <WeekformMark className="brand-mark" />
          <strong className="brand-name">Weekform</strong>
        </div>
        <nav className="nav-list">
          {[
            // `shortcut`/`shortcutKey` mirror the SCREEN_KEYS map in App.tsx so the
            // power-user jump shortcuts are discoverable (title hint + aria-keyshortcuts).
            // Sections bind contiguously to ⌘1–4; Settings keeps ⌘9 by convention.
            { id: "today", label: "Today", description: "Daily review queue", screen: "daily" as const, icon: CalendarCheck, shortcut: "⌘1", shortcutKey: "Meta+1" },
            { id: "week", label: "Week", description: "Capacity and summary", screen: "weekly" as const, icon: BarChart3, shortcut: "⌘2", shortcutKey: "Meta+2" },
            { id: "agent", label: "Agent", description: "Ask, plan, and understand", screen: "agent" as const, icon: AgentMark, shortcut: "⌘3", shortcutKey: "Meta+3" },
            { id: "history", label: "History", description: "Ledger and audit trail", screen: "ledger" as const, icon: History, shortcut: "⌘4", shortcutKey: "Meta+4" },
            // Narrow-viewport-only: the dedicated `.settings-button` below is hidden at
            // ≤760px, so surface Settings here too (CSS keeps it hidden on desktop).
            { id: "setup", label: "Settings", description: "AI, calendar, retention", screen: "setup" as const, icon: Settings, shortcut: "⌘9", shortcutKey: "Meta+9" }
          ].map((item) => {
            const Icon = item.icon;
            const isSettings = item.id === "setup";
            const selected = isSettings ? active === "setup" : primarySectionForScreen(active) === item.id;
            return (
              <button
                className={`nav-item${isSettings ? " nav-item-settings" : ""}${selected ? " is-active" : ""}`}
                key={item.id}
                onClick={() => setActive(item.screen)}
                title={item.shortcut ? `${item.label} (${item.shortcut})` : undefined}
                aria-keyshortcuts={item.shortcutKey}
                aria-current={selected ? "page" : undefined}
                // Walkthrough anchor. The Settings entry here is hidden on
                // desktop, so its tour highlight lives on the always-visible
                // `.settings-button` below instead.
                data-tour={isSettings ? undefined : item.id}
                type="button"
              >
                <Icon size={18} aria-hidden />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                {item.id === "today" && reviewCount > 0 && (
                  <>
                    <b aria-hidden>{reviewCount}</b>
                    <span className="sr-only">
                      {reviewCount} block{reviewCount === 1 ? "" : "s"} awaiting review
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </nav>
        {teamAvailable && (
          <button
            className={`nav-item manager-access-entry${active === "team" ? " is-active" : ""}`}
            onClick={() => setActive("team")}
            aria-current={active === "team" ? "page" : undefined}
            type="button"
          >
            <Waypoints size={18} aria-hidden />
            <span>
              <strong>Team</strong>
              <small>{teamRole === "member" ? "Membership and sharing" : "Workload and coordination"}</small>
            </span>
          </button>
        )}
        {demoMode && (
          <div className="sidebar-demo-card" role="status">
            <div className="side-metric-heading">
              <span>{simulationMode ? "Simulation" : "Demo mode"}</span>
              <Presentation size={14} aria-hidden />
            </div>
            <p className="sidebar-demo-copy">
              {simulationMode
                ? "This session runs on live synthetic simulation data."
                : "You’re exploring Weekform with simulated data."}
            </p>
            <button
              className="sidebar-demo-exit"
              type="button"
              aria-label={simulationMode ? "Exit the live synthetic simulation and return to Weekform" : "Exit demo and return to your own Weekform data"}
              onClick={() => window.location.assign(window.location.pathname)}
            >
              <LogOut size={13} aria-hidden />
              <span>{simulationMode ? "Exit simulation" : "Exit demo"}</span>
            </button>
          </div>
        )}
        <button
          className="sidebar-intelligence capacity-summary-trigger"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={capacityDetailOpen}
          onClick={() => setCapacityDetailOpen(true)}
        >
          <div className="side-metric-heading">
            <span>Reliable capacity</span>
            <Gauge size={14} aria-hidden />
          </div>
          <div
            className="side-metric-value"
            title="Estimated share of this week that can still absorb new planned work without slippage"
          >
            <strong>{hasWorkBlocks ? pct(snapshot.reliable_new_work_capacity_pct) : "—"}</strong>
            <small>{hasWorkBlocks ? "This week" : "Needs signal"}</small>
            <span className="sr-only">
              Estimated share of this week that can still absorb new planned work without slippage
            </span>
          </div>
          <div className="side-capacity-track" aria-hidden="true">
            <span style={{ width: hasWorkBlocks ? `${Math.max(0, Math.min(100, snapshot.reliable_new_work_capacity_pct || 0))}%` : "0%" }} />
          </div>
          <div className={`tracking-status${paused ? " tracking-status--paused" : ""}`}>
            <Radio size={12} aria-hidden="true" />
            <span>{paused ? "Tracking paused" : "Tracking locally"}</span>
          </div>
        </button>
        <button className={active === "setup" ? "settings-button is-active" : "settings-button"} type="button" onClick={() => setActive("setup")} title="Settings (⌘9)" aria-keyshortcuts="Meta+9" aria-current={active === "setup" ? "page" : undefined} data-tour="setup">
          <Settings size={17} aria-hidden />
          <span>Settings</span>
        </button>
          </aside>
          <button
            aria-controls="primary-sidebar"
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            className="sidebar-edge-toggle"
            data-tooltip={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            type="button"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <ChevronLeft className="sidebar-edge-toggle-icon" size={15} strokeWidth={2} aria-hidden />
          </button>
        </>
      )}
      <main className="main-panel">
        {showTrackingReminder && (
          <div className="tracking-reminder" role="status">
            <Radio size={14} aria-hidden="true" />
            <p>
              <strong>Tracking is off.</strong> Weekform can&rsquo;t build your weekly picture until
              activity tracking is on.
            </p>
            <button className="tracking-reminder-enable" type="button" onClick={() => setPaused(false)}>
              <Play size={13} aria-hidden="true" />
              <span>Enable tracking</span>
            </button>
          </div>
        )}
        {showContextNav ? (
          <>
            <div className="page-context-navigation">
              <ContextNavigation active={active} setActive={setActive} showFlaggedTab={showFlaggedTab} />
              {demoMode && (
                <span
                  className={`demo-badge${simulationMode ? " simulation-runtime-badge" : ""}`}
                  title={simulationMode ? "This embedded session uses synthetic simulation data only" : "You're viewing simulated demo data"}
                >
                  {simulationMode ? "SIMULATED · LIVE" : "Demo"}
                </span>
              )}
              {showWeekContext && (
                <p className="page-week-context">
                  {/* A <p> is role="generic", where aria-label is name-prohibited and dropped by AT
                      (NOTES line 75). Carry the "Viewing week" context in an sr-only text node so it
                      reads reliably in every screen reader (once, no group double-read) with zero
                      visual change, instead of an aria-label AT silently discards. */}
                  <span className="sr-only">Viewing week </span>
                  {weekRangeLabel}
                </p>
              )}
            </div>
            <div className="main-tabpanel" id={MAIN_TABPANEL_ID} role="tabpanel" aria-labelledby={tabId(active)}>
              {children}
            </div>
          </>
        ) : (
          children
        )}
      </main>
      {capacityDetailOpen && (
        <CapacityDetailModal model={capacityDetail} onClose={() => setCapacityDetailOpen(false)} />
      )}
      <ToastHost toasts={toasts} onDismiss={onDismissToast} />
    </div>
  );
}
