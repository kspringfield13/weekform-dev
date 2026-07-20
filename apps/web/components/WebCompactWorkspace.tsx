"use client";

import { useEffect } from "react";

import { WeekformMark } from "@/components/WeekformMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WebEditionBadge } from "@/components/WebEditionBadge";
import { positionCompactWebWindow } from "@/lib/webCompactWindow";

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function WebCompactWorkspace({
  greetingName,
  reliableCapacity,
  reviewCount,
  inlineFallback,
  onExpand,
  onOpenToday,
  onOpenCapacity,
  onOpenAgent,
  onOpenSettings,
}: {
  greetingName: string;
  reliableCapacity: number | null;
  reviewCount: number;
  inlineFallback: boolean;
  onExpand: () => void;
  onOpenToday: () => void;
  onOpenCapacity: () => void;
  onOpenAgent: () => void;
  onOpenSettings: () => void;
}) {
  useEffect(() => {
    if (!inlineFallback) positionCompactWebWindow();
  }, [inlineFallback]);

  const capacity = reliableCapacity === null
    ? "—"
    : `${Math.round(Math.max(0, Math.min(100, reliableCapacity)))}%`;

  return (
    <section className={`web-compact-shell${inlineFallback ? " is-inline-fallback" : ""}`} aria-label="Weekform compact view">
      <header className="web-compact-toolbar">
        <div className="web-compact-brand">
          <WeekformMark className="web-compact-mark" />
          <span><strong>Weekform</strong><WebEditionBadge /></span>
        </div>
        <div className="web-compact-toolbar-actions">
          <ThemeToggle className="web-compact-theme-toggle" />
          <button type="button" onClick={onExpand} aria-label="Expand to full Web App" title="Expand to full Web App">
            <ExpandIcon />
          </button>
        </div>
      </header>

      <div className="web-compact-content">
        {inlineFallback ? (
          <p className="web-compact-fallback" role="status">
            Your browser blocked the popup. Compact view is open in this tab.
          </p>
        ) : null}

        <button className="web-compact-capacity" type="button" onClick={onOpenCapacity}>
          <span>Reliable capacity</span>
          <strong>{capacity}</strong>
          <small>{reliableCapacity === null ? "Needs a synced signal" : "Available for new work this week"}</small>
        </button>

        <button className={`web-compact-review${reviewCount > 0 ? " has-items" : ""}`} type="button" onClick={onOpenToday}>
          <span>
            <small>Today’s review</small>
            <strong>{reviewCount > 0 ? `${reviewCount} item${reviewCount === 1 ? " needs" : "s need"} attention` : "You’re all caught up"}</strong>
          </span>
          <ArrowIcon />
        </button>

        <div className="web-compact-actions" aria-label="Open full Web App section">
          <button className="web-compact-action" type="button" onClick={onOpenCapacity}>Capacity</button>
          <button className="web-compact-action" type="button" onClick={onOpenAgent}>Agent</button>
          <button className="web-compact-action" type="button" onClick={onOpenSettings}>Settings</button>
        </div>
      </div>

      <footer className="web-compact-footer">
        <span><i aria-hidden="true" /> Review-safe Web data</span>
        <small title={greetingName}>{greetingName}</small>
      </footer>
    </section>
  );
}
