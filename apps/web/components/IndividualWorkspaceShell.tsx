"use client";

import Link from "next/link";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { WeekformMark } from "@/components/WeekformMark";
import { MacAppLink } from "@/components/MacAppLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WebCompactWindowHandoff } from "@/components/WebCompactWindowHandoff";
import { WebCompactWorkspace } from "@/components/WebCompactWorkspace";
import { WebEditionLabel } from "@/components/WebEditionLabel";
import { WorkspaceModeToggle } from "@/components/WorkspaceModeToggle";
import {
  resolveIndividualWorkspaceRoute,
  screenForIndividualWorkspaceRoute,
  type IndividualDestination,
  type IndividualSubview,
  type IndividualWorkspaceRoute,
} from "@/lib/individualWorkspaceRoute";
import { resolveMobileNavigationFocusAction } from "@/lib/mobileNavigationFocus";
import {
  expandCurrentWebWindow,
  openCompactWebWindow,
  restoreFullWebWindowFromHandoff,
  type WebWindowSurface,
} from "@/lib/webCompactWindow";

const DESTINATIONS: Array<{
  id: IndividualDestination;
  label: string;
  description: string;
  shortcutKey: "Meta+1" | "Meta+2" | "Meta+3" | "Meta+4" | "Meta+9";
}> = [
  { id: "today", label: "Today", description: "Daily review queue", shortcutKey: "Meta+1" },
  { id: "week", label: "Week", description: "Capacity and summary", shortcutKey: "Meta+2" },
  { id: "agent", label: "Agent", description: "Ask, plan, and understand", shortcutKey: "Meta+3" },
  { id: "history", label: "History", description: "Ledger and audit trail", shortcutKey: "Meta+4" },
  { id: "settings", label: "Settings", description: "Account and sharing", shortcutKey: "Meta+9" },
];
const SETTINGS_DESTINATION = DESTINATIONS[4]!;
const WEEKFORM_START_TRACKING_URL =
  "weekform://open?source=weekform.dev&action=start-tracking&view=compact";

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

const MOBILE_NAVIGATION_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function mobileNavigationFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(MOBILE_NAVIGATION_FOCUSABLE_SELECTOR))
    .filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
}

function pushWorkspaceRoute(route: IndividualWorkspaceRoute) {
  const screen = screenForIndividualWorkspaceRoute(route);
  const url = new URL(window.location.href);
  if (url.searchParams.get("screen") === screen) return;
  url.searchParams.set("screen", screen);
  window.history.pushState(null, "", url);
}

function workspaceHref(baseHref: string, route: IndividualWorkspaceRoute): string {
  const separator = baseHref.includes("?") ? "&" : "?";
  return `${baseHref}${separator}screen=${encodeURIComponent(screenForIndividualWorkspaceRoute(route))}`;
}

function formatActiveWeekLabel(weekId: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!match) return weekId;
  return `Week ${Number(match[2])}, ${match[1]}`;
}

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

function CompactWindowIcon() {
  return (
    <svg className="web-window-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16v16H4zM14 4v6h6M4 14h6v6" />
    </svg>
  );
}

function StartTrackingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 7 8 5-8 5Z" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function IndividualWorkspaceShell({
  children,
  greetingName,
  reliableCapacity,
  reviewCount,
  activeWeekLabel,
  teamAvailable,
  teamHref,
  teamRole,
  workspaceMode = "individual",
  accountActions,
  initialScreen,
  initialWindowSurface,
}: {
  children: ReactNode;
  greetingName: string;
  reliableCapacity: number | null;
  reviewCount: number;
  activeWeekLabel: string | null;
  teamAvailable: boolean;
  teamHref: string;
  teamRole?: "member" | "manager" | "owner";
  workspaceMode?: "individual" | "manager";
  accountActions: ReactNode;
  initialScreen: string | undefined;
  initialWindowSurface: WebWindowSurface;
}) {
  const initialRoute = resolveIndividualWorkspaceRoute(initialScreen);
  const [active, setActive] = useState<IndividualDestination>(initialRoute.destination);
  const [activeSubview, setActiveSubview] = useState<IndividualSubview>(initialRoute.subview);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [viewportResolved, setViewportResolved] = useState(false);
  const [windowSurface, setWindowSurface] = useState<WebWindowSurface>(initialWindowSurface);
  const [inlineCompactFallback, setInlineCompactFallback] = useState(false);
  const contextTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mobileNavigationRef = useRef<HTMLElement | null>(null);
  const mobileNavigationCloseRef = useRef<HTMLButtonElement | null>(null);
  const sidebarOpenerRef = useRef<HTMLButtonElement | null>(null);
  const restoreSidebarFocusRef = useRef(false);
  const mobileNavigationOpen = isNarrowViewport && !sidebarCollapsed;
  const activeRoute = { destination: active, subview: activeSubview } satisfies IndividualWorkspaceRoute;
  const individualHref = workspaceHref("/app", activeRoute);
  const activeTeamHref = workspaceHref(teamHref, activeRoute);
  const managerWorkspace = workspaceMode === "manager";
  const teamModeLabel = teamRole === "member" ? "Team" : "Manager mode";

  const closeMobileNavigation = () => {
    if (!mobileNavigationOpen) return;
    restoreSidebarFocusRef.current = true;
    setSidebarCollapsed(true);
  };

  useEffect(() => {
    const route = resolveIndividualWorkspaceRoute(initialScreen);
    setActive(route.destination);
    setActiveSubview(route.subview);
  }, [initialScreen]);

  useEffect(() => {
    const applyRoute = (route: IndividualWorkspaceRoute) => {
      setActive(route.destination);
      setActiveSubview(route.subview);
    };
    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ destination?: IndividualDestination; subview?: IndividualSubview }>).detail;
      const route = resolveIndividualWorkspaceRoute(detail);
      applyRoute(route);
      pushWorkspaceRoute(route);
    };
    const handlePopState = () => {
      const screen = new URL(window.location.href).searchParams.get("screen");
      const shouldRestoreContextFocus = document.activeElement instanceof HTMLElement
        && document.activeElement.closest(".page-context-navigation") !== null;
      const route = resolveIndividualWorkspaceRoute(screen);
      applyRoute(route);
      const baseViews = CONTEXT_VIEWS[route.destination] ?? [];
      const views = route.destination === "history" && route.subview === "sensitive"
        ? [...baseViews, { id: "sensitive" as const, label: "Flagged" }]
        : baseViews;
      const index = views.findIndex((view) => view.id === route.subview);
      if (shouldRestoreContextFocus && index >= 0) {
        window.requestAnimationFrame(() => contextTabRefs.current[index]?.focus());
      }
    };
    window.addEventListener("weekform:web-navigate", handleNavigate);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("weekform:web-navigate", handleNavigate);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    const narrowViewport = window.matchMedia("(max-width: 820px)");
    const collapseForNarrowViewport = (matches: boolean) => {
      setIsNarrowViewport(matches);
      setSidebarCollapsed(matches);
      setViewportResolved(true);
    };
    collapseForNarrowViewport(narrowViewport.matches);
    const handleChange = (event: MediaQueryListEvent) => collapseForNarrowViewport(event.matches);
    narrowViewport.addEventListener("change", handleChange);
    return () => narrowViewport.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (mobileNavigationOpen) {
      const previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const frame = window.requestAnimationFrame(() => mobileNavigationCloseRef.current?.focus());
      return () => {
        window.cancelAnimationFrame(frame);
        document.body.style.overflow = previousBodyOverflow;
      };
    }

    if (!restoreSidebarFocusRef.current) return;
    restoreSidebarFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => sidebarOpenerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [mobileNavigationOpen]);

  const handleMobileNavigationKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!mobileNavigationOpen || !mobileNavigationRef.current) return;
    const focusableElements = mobileNavigationFocusableElements(mobileNavigationRef.current);
    const activeIndex = focusableElements.findIndex((element) => element === document.activeElement);
    const action = resolveMobileNavigationFocusAction({
      key: event.key,
      shiftKey: event.shiftKey,
      activeIndex,
      itemCount: focusableElements.length,
    });
    if (action === "none") return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "close") {
      closeMobileNavigation();
      return;
    }
    const target = action === "first" ? focusableElements[0] : focusableElements.at(-1);
    target?.focus();
  };

  const navigateToRoute = (route: IndividualWorkspaceRoute) => {
    setActive(route.destination);
    setActiveSubview(route.subview);
    pushWorkspaceRoute(route);
    closeMobileNavigation();
  };

  const navigate = (destination: (typeof DESTINATIONS)[number]) => {
    navigateToRoute({
      destination: destination.id,
      subview: DEFAULT_SUBVIEW[destination.id],
    });
  };

  useEffect(() => {
    const handlePrimaryShortcut = (event: globalThis.KeyboardEvent) => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey || event.repeat) return;
      const destination = DESTINATIONS.find((item) => item.shortcutKey === `Meta+${event.key}`);
      if (!destination) return;
      event.preventDefault();
      navigate(destination);
    };
    window.addEventListener("keydown", handlePrimaryShortcut);
    return () => window.removeEventListener("keydown", handlePrimaryShortcut);
  });

  const baseContextViews = managerWorkspace ? [] : (CONTEXT_VIEWS[active] ?? []);
  const contextViews = active === "history" && activeSubview === "sensitive"
    ? [...baseContextViews, { id: "sensitive" as const, label: "Flagged" }]
    : baseContextViews;
  const activeContextTabId = contextViews.some((view) => view.id === activeSubview)
    ? `web-tab-${activeSubview}`
    : undefined;
  const selectContextView = (index: number) => {
    const view = contextViews[index];
    if (!view) return;
    navigateToRoute({ destination: active, subview: view.id });
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

  const activateCompactWindow = () => {
    if (openCompactWebWindow()) return;
    setInlineCompactFallback(true);
    setWindowSurface("compact");
  };

  const expandFromCompact = () => {
    if (inlineCompactFallback) {
      setInlineCompactFallback(false);
      setWindowSurface("full");
      return;
    }
    expandCurrentWebWindow();
  };

  const openFromCompact = (route: IndividualWorkspaceRoute) => {
    if (inlineCompactFallback) {
      setInlineCompactFallback(false);
      setWindowSurface("full");
      navigateToRoute(route);
      return;
    }
    expandCurrentWebWindow(screenForIndividualWorkspaceRoute(route));
  };

  if (windowSurface === "handoff") {
    return (
      <WebCompactWindowHandoff
        onRestore={() => restoreFullWebWindowFromHandoff()}
      />
    );
  }

  if (windowSurface === "compact") {
    return (
      <WebCompactWorkspace
        greetingName={greetingName}
        reliableCapacity={reliableCapacity}
        reviewCount={reviewCount}
        inlineFallback={inlineCompactFallback}
        onExpand={expandFromCompact}
        onOpenToday={() => openFromCompact({ destination: "today", subview: "today" })}
        onOpenCapacity={() => openFromCompact({ destination: "week", subview: "capacity" })}
        onOpenAgent={() => openFromCompact({ destination: "agent", subview: "agent" })}
        onOpenSettings={() => openFromCompact({ destination: "settings", subview: "settings" })}
      />
    );
  }

  return (
    <div
      className={`app web-individual-app${managerWorkspace ? " web-manager-app" : ""}${viewportResolved ? " viewport-resolved" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}${mobileNavigationOpen ? " mobile-navigation-open" : ""}`}
      data-active-view={active}
      data-active-subview={activeSubview}
      data-workspace-mode={workspaceMode}
    >
      <header
        className="web-app-toolbar"
        inert={mobileNavigationOpen ? true : undefined}
        aria-hidden={mobileNavigationOpen ? true : undefined}
      >
        <div className="web-toolbar-title">
          <strong>{managerWorkspace ? "Your team, ready to coordinate" : "Your week, ready to review"}</strong>
          <span>{managerWorkspace ? "Member-approved signals only" : "Private evidence stays on your Mac"}</span>
        </div>
        <div className="web-toolbar-state" role="status">
          <i aria-hidden="true" /> {managerWorkspace ? "Synced team summaries" : "API-connected · no workload cache"}
        </div>
        <div className="web-toolbar-actions">
          <div
            className="web-toolbar-display-controls"
            role="group"
            aria-label="Display controls"
          >
            <ThemeToggle
              className="web-toolbar-button web-display-button web-theme-toggle-button"
              showLabel
            />
            <button
              className="web-toolbar-button web-display-button web-window-button"
              type="button"
              aria-label="Open compact Web window"
              title="Open compact Web window"
              onClick={activateCompactWindow}
            >
              <CompactWindowIcon />
              <span>Compact</span>
            </button>
          </div>
          <div className="web-toolbar-account-actions">
            {accountActions}
          </div>
        </div>
        <div className="web-toolbar-product" aria-label="Weekform Web">
          <strong>Weekform</strong>
          <WebEditionLabel />
        </div>
      </header>

      <aside
        className="sidebar"
        id="web-primary-sidebar"
        ref={mobileNavigationRef}
        role={mobileNavigationOpen ? "dialog" : undefined}
        aria-modal={mobileNavigationOpen ? true : undefined}
        aria-label={mobileNavigationOpen ? "Weekform navigation" : undefined}
        onKeyDown={handleMobileNavigationKeyDown}
      >
        <button
          className="web-sidebar-dialog-close"
          type="button"
          aria-label="Close navigation"
          hidden={!mobileNavigationOpen}
          ref={mobileNavigationCloseRef}
          onClick={closeMobileNavigation}
        >
          <span aria-hidden="true">×</span>
        </button>
        <Link href="/app" className="brand" aria-label="Weekform Web home" onClick={closeMobileNavigation}>
          <WeekformMark className="brand-mark" />
          <span className="brand-lockup">
            <strong className="brand-name">Weekform</strong>
            <WebEditionLabel />
          </span>
        </Link>
        <nav className="nav-list" aria-label="Primary navigation">
          {DESTINATIONS.map((destination) => (
            <button
              className={`nav-item${destination.id === "settings" ? " nav-item-settings" : ""}${active === destination.id ? " is-active" : ""}`}
              key={destination.id}
              onClick={() => navigate(destination)}
              type="button"
              aria-keyshortcuts={destination.shortcutKey}
              title={`${destination.label} shortcut (⌘${destination.shortcutKey.at(-1)})`}
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
        {teamAvailable && (
          <Link
            className={`nav-item team-access-entry${managerWorkspace ? " is-active" : ""}`}
            href={activeTeamHref}
            aria-current={managerWorkspace ? "page" : undefined}
            onClick={closeMobileNavigation}
          >
            <NavIcon id="manager" />
            <span>
              <strong>Team</strong>
              <small>{teamRole === "member" ? "Membership and sharing" : "Workload and coordination"}</small>
            </span>
          </Link>
        )}
        <div className="sidebar-intelligence">
          <div className="side-metric-heading"><span>{managerWorkspace ? "Team signals" : "Reliable capacity"}</span><span aria-hidden="true">◌</span></div>
          <div className="side-metric-value">
            <strong>{reliableCapacity === null ? "—" : `${Math.round(reliableCapacity)}%`}</strong>
            <small>{managerWorkspace ? "Approved only" : reliableCapacity === null ? "Needs signal" : "This week"}</small>
          </div>
          <div className="side-capacity-track" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, reliableCapacity ?? 0))}%` }} />
          </div>
          <div className="web-private-state"><i aria-hidden="true" /> {managerWorkspace ? "No raw activity" : "Review-safe fields only"}</div>
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
        ref={sidebarOpenerRef}
        aria-controls="web-primary-sidebar"
        aria-expanded={viewportResolved ? (isNarrowViewport ? mobileNavigationOpen : !sidebarCollapsed) : undefined}
        aria-haspopup={isNarrowViewport ? "dialog" : undefined}
        aria-label={sidebarCollapsed ? (isNarrowViewport ? "Open navigation" : "Show sidebar") : (isNarrowViewport ? "Close navigation" : "Hide sidebar")}
        className="web-sidebar-toggle"
        type="button"
        onClick={() => {
          if (mobileNavigationOpen) {
            closeMobileNavigation();
          } else {
            setSidebarCollapsed((value) => !value);
          }
        }}
      >
        <span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
      </button>

      <main
        className="main-panel"
        inert={mobileNavigationOpen ? true : undefined}
        aria-hidden={mobileNavigationOpen ? true : undefined}
      >
        <div className="web-workspace-mode-row">
          {!managerWorkspace && (active === "today" || active === "week") ? (
            <MacAppLink
              openUrl={WEEKFORM_START_TRACKING_URL}
              fallbackHref="/download"
              className="button button-primary web-start-tracking-action"
              title="Open compact Weekform Desktop and start local tracking"
            >
              <StartTrackingIcon />
              Start Tracking
            </MacAppLink>
          ) : null}
          <WorkspaceModeToggle
            individualHref={individualHref}
            teamAvailable={teamAvailable}
            teamHref={activeTeamHref}
            mode={workspaceMode}
            teamLabel={teamModeLabel}
          />
        </div>
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
                  onClick={() => navigateToRoute({ destination: active, subview: view.id })}
                  onKeyDown={(event) => handleContextKeyDown(event, index)}
                >
                  {view.label}
                </button>
              ))}
            </nav>
            {active === "week" && activeWeekLabel ? (
              <p className="page-week-context">
                <span className="visually-hidden">Viewing week </span>
                {formatActiveWeekLabel(activeWeekLabel)}
              </p>
            ) : null}
          </div>
        ) : null}
        <div
          id="web-individual-tabpanel"
          role={activeContextTabId ? "tabpanel" : undefined}
          aria-labelledby={activeContextTabId}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
