"use client";

import Link from "next/link";
import { BarChart3, CalendarCheck, History, Settings, Waypoints } from "lucide-react";
import type { KeyboardEvent, ReactNode, SVGProps } from "react";
import { useEffect, useRef, useState } from "react";

import { WeekformMark } from "@/components/WeekformMark";
import { DesktopStartTrackingButton } from "@/components/DesktopStartTrackingButton";
import { MacAppLink } from "@/components/MacAppLink";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WebEditionLabel } from "@/components/WebEditionLabel";
import { WorkspaceModeToggle } from "@/components/WorkspaceModeToggle";
import {
  resolveIndividualWorkspaceRoute,
  screenForIndividualWorkspaceRoute,
  type IndividualDestination,
  type IndividualSubview,
  type IndividualWorkspaceRoute,
} from "@/lib/individualWorkspaceRoute";
import { desktopPageHandoffUrl } from "@/lib/desktopPageHandoff";
import { resolveMobileNavigationFocusAction } from "@/lib/mobileNavigationFocus";
import {
  INDIVIDUAL_TOOLBAR_SLOGANS,
  TOOLBAR_SLOGAN_INTERVAL_MS,
  nextToolbarSloganIndex,
} from "@/lib/toolbarSlogans";

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

function AgentMark({ size = 18, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      {...props}
    >
      <path d="M2.5 12c1.6-4.8 3.15-4.8 4.75 0s3.15 4.8 4.75 0 3.15-4.8 4.75 0 3.15 4.8 4.75 0" />
    </svg>
  );
}

const NAV_ICONS = {
  today: CalendarCheck,
  week: BarChart3,
  agent: AgentMark,
  history: History,
  settings: Settings,
  manager: Waypoints,
} as const;

function NavIcon({ id }: { id: IndividualDestination | "manager" }) {
  const Icon = NAV_ICONS[id];
  return <Icon className="web-nav-glyph" size={18} aria-hidden="true" />;
}

function StartTrackingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 7 8 5-8 5Z" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function ManagerWindowIcon() {
  return (
    <svg className="web-window-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="5" r="2" />
      <circle cx="19" cy="12" r="2" />
      <path d="M6.7 10.9 10.3 6.2M13.7 6.2l3.6 4.7M7 12h10" />
      <path d="M12 14v6" />
    </svg>
  );
}

function RotatingIndividualToolbarSlogan() {
  const [sloganIndex, setSloganIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const interval = window.setInterval(() => {
      setSloganIndex((currentIndex) => nextToolbarSloganIndex(currentIndex));
    }, TOOLBAR_SLOGAN_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, []);

  const slogan = INDIVIDUAL_TOOLBAR_SLOGANS[sloganIndex] ?? INDIVIDUAL_TOOLBAR_SLOGANS[0];
  return <strong className="web-toolbar-slogan" key={slogan}>{slogan}</strong>;
}

export function IndividualWorkspaceShell({
  children,
  reliableCapacity,
  reviewCount,
  activeWeekLabel,
  teamAvailable,
  teamHref,
  teamRole,
  workspaceMode = "individual",
  accountActions,
  initialScreen,
  individualHrefBase = "/app",
  demoReadOnly = false,
}: {
  children: ReactNode;
  reliableCapacity: number | null;
  reviewCount: number;
  activeWeekLabel: string | null;
  teamAvailable: boolean;
  teamHref: string;
  teamRole?: "member" | "manager" | "owner";
  workspaceMode?: "individual" | "manager" | "team";
  accountActions: ReactNode;
  initialScreen: string | undefined;
  individualHrefBase?: string;
  demoReadOnly?: boolean;
}) {
  const initialRoute = resolveIndividualWorkspaceRoute(initialScreen);
  const [active, setActive] = useState<IndividualDestination>(initialRoute.destination);
  const [activeSubview, setActiveSubview] = useState<IndividualSubview>(initialRoute.subview);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [viewportResolved, setViewportResolved] = useState(false);
  const contextTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mobileNavigationRef = useRef<HTMLElement | null>(null);
  const mobileNavigationCloseRef = useRef<HTMLButtonElement | null>(null);
  const sidebarOpenerRef = useRef<HTMLButtonElement | null>(null);
  const restoreSidebarFocusRef = useRef(false);
  const mobileNavigationOpen = isNarrowViewport && !sidebarCollapsed;
  const activeRoute = { destination: active, subview: activeSubview } satisfies IndividualWorkspaceRoute;
  const desktopHandoffUrl = desktopPageHandoffUrl(activeRoute, workspaceMode);
  const individualHref = workspaceHref(individualHrefBase, activeRoute);
  const activeTeamHref = workspaceHref(teamHref, activeRoute);
  const teamDestinationHref = teamHref;
  const managerWorkspace = workspaceMode === "manager";
  const memberTeamWorkspace = workspaceMode === "team";
  const teamWorkspace = managerWorkspace || memberTeamWorkspace;
  const teamModeLabel = teamRole === "member" ? "Team" : "Manager mode";
  const toolbarStateLabel = demoReadOnly
    ? "Synthetic local demo · read-only"
    : managerWorkspace
      ? "Manager · synced summaries"
      : memberTeamWorkspace
        ? "Team member · your data only"
        : null;
  const settingsHref = workspaceHref(
    managerWorkspace ? teamHref : individualHrefBase,
    { destination: "settings", subview: "settings" },
  );

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
    if (route.destination === "settings") {
      closeMobileNavigation();
      window.location.assign(settingsHref);
      return;
    }
    if (memberTeamWorkspace) {
      window.location.assign(workspaceHref(individualHrefBase, route));
      return;
    }
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

  const baseContextViews = teamWorkspace ? [] : (CONTEXT_VIEWS[active] ?? []);
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

  return (
    <div
      className={`app web-individual-app${managerWorkspace ? " web-manager-app" : ""}${viewportResolved ? " viewport-resolved" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}${mobileNavigationOpen ? " mobile-navigation-open" : ""}`}
      data-active-view={active}
      data-active-subview={activeSubview}
      data-workspace-mode={workspaceMode}
    >
      <header
        className={`web-app-toolbar${toolbarStateLabel ? "" : " is-statusless"}`}
        inert={mobileNavigationOpen ? true : undefined}
        aria-hidden={mobileNavigationOpen ? true : undefined}
      >
        <div className="web-toolbar-title">
          {managerWorkspace
            ? <strong>Your team, ready to lead</strong>
            : memberTeamWorkspace
              ? <strong>Your team connection</strong>
              : <RotatingIndividualToolbarSlogan />}
        </div>
        {toolbarStateLabel ? (
          <div className="web-toolbar-state" role="status">
            {managerWorkspace ? <ManagerWindowIcon /> : <i aria-hidden="true" />} {toolbarStateLabel}
          </div>
        ) : null}
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
        <Link href={individualHrefBase} className="brand" aria-label="Weekform Web home" onClick={closeMobileNavigation}>
          <WeekformMark className="brand-mark" />
          <span className="brand-lockup">
            <strong className="brand-name">Weekform</strong>
            <WebEditionLabel />
          </span>
        </Link>
        <nav className="nav-list" aria-label="Primary navigation">
          {DESTINATIONS.map((destination) => (
            <button
              className={`nav-item${destination.id === "settings" ? " nav-item-settings" : ""}${!teamWorkspace && active === destination.id ? " is-active" : ""}`}
              key={destination.id}
              onClick={() => navigate(destination)}
              type="button"
              aria-keyshortcuts={destination.shortcutKey}
              title={`${destination.label} shortcut (⌘${destination.shortcutKey.at(-1)})`}
              aria-current={!teamWorkspace && active === destination.id ? "page" : undefined}
            >
              <NavIcon id={destination.id} />
              <span className="nav-item-copy">
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
            className={`nav-item team-access-entry${teamWorkspace ? " is-active" : ""}`}
            href={teamDestinationHref}
            aria-current={teamWorkspace ? "page" : undefined}
            onClick={closeMobileNavigation}
          >
            <NavIcon id="manager" />
            <span className="nav-item-copy">
              <strong>Team</strong>
              <small>{teamRole === "member" ? "Membership and sharing" : "Workload and coordination"}</small>
            </span>
          </Link>
        )}
        <div className="sidebar-intelligence">
          <div className="side-metric-heading"><span>{teamWorkspace ? "Team signals" : "Reliable capacity"}</span><span aria-hidden="true">◌</span></div>
          <div className="side-metric-value">
            <strong>{reliableCapacity === null ? "—" : `${Math.round(reliableCapacity)}%`}</strong>
            <small>{teamWorkspace ? "Approved only" : reliableCapacity === null ? "Needs signal" : "This week"}</small>
          </div>
          <div className="side-capacity-track" aria-hidden="true">
            <span style={{ width: `${Math.max(0, Math.min(100, reliableCapacity ?? 0))}%` }} />
          </div>
          <div className="web-private-state"><i aria-hidden="true" /> {teamWorkspace ? "No raw activity" : "Review-safe fields only"}</div>
        </div>
        <div className="web-sidebar-footer-actions">
          <MacAppLink
            attemptAppOpen
            openUrl={desktopHandoffUrl}
            fallbackHref="/download"
            className="web-open-desktop-button"
            aria-label="Open current page in Weekform Desktop"
            title="Open current page in Weekform Desktop"
          >
            <WeekformMark className="web-open-desktop-mark" />
          </MacAppLink>
          <button
            className={!teamWorkspace && active === "settings" ? "settings-button is-active" : "settings-button"}
            type="button"
            aria-current={!teamWorkspace && active === "settings" ? "page" : undefined}
            onClick={() => navigate(SETTINGS_DESTINATION)}
          >
            <NavIcon id="settings" />
            <span>Settings</span>
          </button>
        </div>
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
          {!demoReadOnly && !teamWorkspace && (active === "today" || active === "week") ? (
            <DesktopStartTrackingButton>
              <StartTrackingIcon />
              Start Tracking
            </DesktopStartTrackingButton>
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
