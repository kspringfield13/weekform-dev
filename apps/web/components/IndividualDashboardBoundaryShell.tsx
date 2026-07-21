import type { ReactNode } from "react";

import { WeekformMark } from "@/components/WeekformMark";
import { WebEditionLabel } from "@/components/WebEditionLabel";

const DESTINATIONS = [
  { label: "Today", description: "Review and correct" },
  { label: "Week", description: "Capacity and summary" },
  { label: "Agent", description: "Ask and accelerate" },
  { label: "History", description: "Activity and audit" },
  { label: "Settings", description: "Sources and data" },
] as const;

/**
 * Stable, data-free geometry for Next route boundaries. Authentication,
 * workload state, account actions, and Manager Access are intentionally absent
 * because loading/error boundaries cannot establish those facts safely.
 */
export function IndividualDashboardBoundaryShell({ children }: { children: ReactNode }) {
  return (
    <div className="web-individual-app app individual-dashboard-boundary-shell">
      <header className="web-app-toolbar" aria-hidden="true">
        <div className="web-toolbar-title">
          <strong>Your week, ready to take shape</strong>
        </div>
        <div className="web-toolbar-state"><i /> Connecting to your review-safe workspace</div>
        <div className="web-toolbar-actions">
          <span className="dashboard-boundary-control-skeleton" />
          <span className="dashboard-boundary-control-skeleton dashboard-boundary-control-wide" />
        </div>
        <div className="web-toolbar-product"><strong>Weekform</strong><WebEditionLabel /></div>
      </header>

      <aside className="sidebar dashboard-boundary-sidebar" aria-hidden="true" inert>
        <div className="brand">
          <WeekformMark className="brand-mark" />
          <span className="brand-lockup">
            <strong className="brand-name">Weekform</strong>
            <WebEditionLabel />
          </span>
        </div>
        <div className="nav-list">
          {DESTINATIONS.map((destination) => (
            <div className="nav-item" key={destination.label}>
              <span className="dashboard-boundary-nav-glyph" />
              <span className="nav-item-copy"><strong>{destination.label}</strong><small>{destination.description}</small></span>
            </div>
          ))}
        </div>
        <div className="sidebar-intelligence dashboard-boundary-intelligence">
          <div className="side-metric-heading"><span>Reliable capacity</span><span>◌</span></div>
          <div className="side-metric-value"><strong>—</strong><small>Loading</small></div>
          <div className="side-capacity-track" />
          <div className="web-private-state"><i /> Review-safe fields only</div>
        </div>
      </aside>

      <main className="main-panel">
        <div className="page-context-navigation" aria-hidden="true">
          <div className="context-navigation dashboard-boundary-context-navigation">
            {["Capacity", "Forecast", "Review", "AI Usage", "Summary"].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>
        <div className="dashboard-boundary-content">{children}</div>
      </main>
    </div>
  );
}
