import { useRef, useState } from "react";
import { Search, ScrollText, X } from "lucide-react";
import type { AuditEvent } from "../../../../../packages/domain/src/models";
import { formatCount } from "../../lib/format";
import { AuditEventRow } from "./AuditEventRow";
import { EmptyState } from "../common/EmptyState";
import type { PushToast } from "../../hooks/useToasts";

export function AuditLogScreen({ auditEvents, pushToast }: { auditEvents: AuditEvent[]; pushToast: PushToast }) {
  // Grouped by who produced the event — a scannable handful of chips instead of
  // one per event type. Search narrows within a group when finer slicing is needed.
  type AuditFilter = "all" | "sources" | "ai" | "correction" | "privacy" | "alerts" | "onboarding";
  const [filter, setFilter] = useState<AuditFilter>("all");
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const filters: Array<{ id: AuditFilter; label: string; hint?: string }> = [
    { id: "all", label: "All" },
    { id: "sources", label: "Sources", hint: "Capture samples, sessions, visual context, calendar, chat, and AI-usage imports" },
    { id: "ai", label: "AI activity", hint: "Classifier, Review Copilot, forecasts, narratives, and the acceleration engine" },
    { id: "correction", label: "Corrections", hint: "Your relabels, confirmations, and exclusions" },
    { id: "privacy", label: "Privacy", hint: "Pause/resume and retention changes" },
    { id: "alerts", label: "Alerts", hint: "Proactive nudges surfaced from your workload" },
    { id: "onboarding", label: "Onboarding" }
  ];
  const filterMatches: Record<AuditFilter, (event: AuditEvent) => boolean> = {
    all: () => true,
    sources: (event) =>
      event.type === "active_window_sample" ||
      event.type === "activity_session" ||
      event.type === "visual_context" ||
      event.type === "calendar_import" ||
      event.type === "chat_import" ||
      event.type === "usage_import",
    ai: (event) =>
      event.type === "work_block_classification" ||
      event.type === "review_copilot" ||
      event.type === "forecast_agent" ||
      event.type === "narrative_generation" ||
      event.type === "acceleration_engine",
    correction: (event) => event.type === "user_correction",
    privacy: (event) =>
      event.type === "privacy_pause" ||
      event.type === "privacy_resume" ||
      event.type === "retention_policy" ||
      event.type === "visual_context_policy" ||
      event.type === "data_reset" ||
      event.type === "data_export" ||
      event.type === "usage_settings",
    alerts: (event) => event.type === "proactive_alert",
    onboarding: (event) => event.type === "onboarding"
  };
  const filteredEvents = auditEvents
    .filter((event) => filterMatches[filter](event))
    .filter((event) => {
      const haystack = `${event.title} ${event.summary} ${event.source} ${JSON.stringify(event.details)}`.toLowerCase();
      return haystack.includes(query.toLowerCase());
    })
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());

  return (
    <section className="screen audit-screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">Audit log</p>
          <h1>Every local signal, inference, correction, and privacy event.</h1>
        </div>
        <div className="summary-score" title="Total local signal, inference, correction, and privacy events recorded on this device">
          <span>Local events</span>
          <strong>{formatCount(auditEvents.length)}</strong>
          <span className="sr-only">Total local signal, inference, correction, and privacy events recorded on this device</span>
        </div>
      </div>

      <div className="audit-toolbar">
        <div className="audit-filters">
          {filters.map((item) => (
            <button
              className={filter === item.id ? "is-active" : ""}
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              title={item.hint}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="search-box">
          <Search size={17} aria-hidden />
          <input
            ref={searchInputRef}
            aria-label="Search audit log"
            placeholder="Search audit events"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); setFilter("all"); } }}
          />
          {query && (
            <button
              type="button"
              className="search-box-clear"
              aria-label="Clear search"
              onClick={() => { setQuery(""); searchInputRef.current?.focus(); }}
            >
              <X size={15} aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div className="audit-list">
        {filteredEvents.length === 0 ? (
          auditEvents.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="No audit events yet."
              description="Capture samples, imports, corrections, and privacy changes will appear here as you use Weekform."
            />
          ) : (
            <EmptyState
              icon={ScrollText}
              title="No events match."
              description="Try a different filter or search term to find what you're looking for."
            >
              <button
                type="button"
                className="secondary-action"
                onClick={() => { setFilter("all"); setQuery(""); }}
              >
                Clear filters
              </button>
            </EmptyState>
          )
        ) : (
          filteredEvents.map((event) => <AuditEventRow event={event} pushToast={pushToast} key={event.event_id} />)
        )}
      </div>
    </section>
  );
}
