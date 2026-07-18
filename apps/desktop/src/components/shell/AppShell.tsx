import { Settings, CalendarCheck, BarChart3, History, Bot, Radio, Gauge } from "lucide-react";
import type { ReactNode } from "react";
import type { WeeklyCapacitySnapshot } from "../../../../../packages/domain/src/models";
import type { Screen } from "../../lib/types";
import { AppToolbar } from "./AppToolbar";
import { ContextNavigation } from "./ContextNavigation";
import { ToastHost } from "../common/ToastHost";
import type { Toast } from "../../hooks/useToasts";
import { MAIN_TABPANEL_ID, primarySectionForScreen, sectionViews, tabId } from "../../lib/ui";
import { pct } from "../../lib/format";

export function AppShell({
  active,
  setActive,
  toolbarStatus,
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
  demoMode,
  toasts,
  onDismissToast,
  children
}: {
  active: Screen;
  setActive: (screen: Screen) => void;
  toolbarStatus: string;
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
  demoMode: boolean;
  toasts: Toast[];
  onDismissToast: (id: string) => void;
  children: ReactNode;
}) {
  // Mirror ContextNavigation's own visibility test: the tablist only renders in
  // large-window mode, off the Settings screen, and when the active section
  // actually has sub-tabs (Today has none, so sectionViews returns []). When it
  // does render, the screen content below becomes its tabpanel; otherwise the
  // content stays a bare child so the setup/compact layout is byte-identical.
  const sectionTabCount = sectionViews(primarySectionForScreen(active), {
    includeFlagged: showFlaggedTab || active === "sensitive"
  }).length;
  const showContextNav = windowMode === "large" && active !== "setup" && sectionTabCount > 0;
  return (
    <div className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${windowMode === "compact" ? "is-compact-widget" : ""} ${active === "agent" ? "agent-active" : ""}`}>
      <AppToolbar
        active={active}
        status={toolbarStatus}
        paused={paused}
        setPaused={setPaused}
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        windowMode={windowMode}
        setWindowMode={setWindowMode}
        theme={theme}
        setTheme={setTheme}
        demoMode={demoMode}
      />
      {windowMode === "large" && (
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark">cc</div>
          <div>
            <strong>ClearCapacity</strong>
            <span>Explainable Workload Intelligence</span>
          </div>
        </div>
        <nav className="nav-list">
          {[
            // `shortcut`/`shortcutKey` mirror the SCREEN_KEYS map in App.tsx so the
            // power-user jump shortcuts are discoverable (title hint + aria-keyshortcuts).
            // Sections bind contiguously to ⌘1–4; Settings keeps ⌘9 by convention.
            { id: "today", label: "Today", description: "Daily review queue", screen: "daily" as const, icon: CalendarCheck, shortcut: "⌘1", shortcutKey: "Meta+1" },
            { id: "week", label: "Week", description: "Capacity and summary", screen: "weekly" as const, icon: BarChart3, shortcut: "⌘2", shortcutKey: "Meta+2" },
            { id: "agent", label: "Agent", description: "Ask, plan, and understand", screen: "agent" as const, icon: Bot, shortcut: "⌘3", shortcutKey: "Meta+3" },
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
        <div className="sidebar-intelligence">
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
        </div>
        <button className={active === "setup" ? "settings-button is-active" : "settings-button"} type="button" onClick={() => setActive("setup")} title="Settings (⌘9)" aria-keyshortcuts="Meta+9" aria-current={active === "setup" ? "page" : undefined} data-tour="setup">
          <Settings size={17} aria-hidden />
          <span>Settings</span>
        </button>
      </aside>
      )}
      <main className="main-panel">
        {showContextNav ? (
          <>
            <ContextNavigation active={active} setActive={setActive} showFlaggedTab={showFlaggedTab} />
            <div className="main-tabpanel" id={MAIN_TABPANEL_ID} role="tabpanel" aria-labelledby={tabId(active)}>
              {children}
            </div>
          </>
        ) : (
          children
        )}
      </main>
      <ToastHost toasts={toasts} onDismiss={onDismissToast} />
    </div>
  );
}
