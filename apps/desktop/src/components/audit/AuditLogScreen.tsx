import { useRef, useState } from "react";
import { FileDown, Search, ScrollText, X } from "lucide-react";
import type { AuditEvent } from "../../../../../packages/domain/src/models";
import { formatAuditTime, formatCount } from "../../lib/format";
import {
  downloadTextFile,
  exportFilename,
  exportMimeType,
  serializeConsentReceipts,
  type ExportFormat,
} from "../../lib/dataExport";
import type { ConsentReceiptV1 } from "../../services/consentReceipt";
import { AuditEventRow } from "./AuditEventRow";
import { EmptyState } from "../common/EmptyState";
import type { PushToast } from "../../hooks/useToasts";

/**
 * One durable consent receipt: what an approved share actually contained. The
 * shared-fields list is rendered verbatim — it is the byte-exact allowlist the
 * receipt was built from (consentReceipt.ts), so the screen cannot summarize it
 * into something friendlier-but-vaguer than what left the device.
 */
function ConsentReceiptRow({ receipt }: { receipt: ConsentReceiptV1 }) {
  return (
    <details className="audit-row">
      <summary>
        <div>
          <span className="audit-badge cloud_sharing">Receipt</span>
          <time dateTime={receipt.recorded_at}>{formatAuditTime(receipt.recorded_at)}</time>
        </div>
        <div>
          <strong>
            Week {receipt.week_id} shared at the &quot;{receipt.share_level}&quot; level with team {receipt.destination.team_id}
          </strong>
          <small>
            {receipt.trigger === "auto" ? "Automatic sync" : "Manual sync"} · {formatCount(receipt.shared_fields.length)} shared fields · snapshot {receipt.client_snapshot_id}
          </small>
        </div>
      </summary>
      <div className="audit-detail">
        <div className="audit-detail-header">
          <span>Exact field allowlist of the uploaded payload (field names only, never values)</span>
        </div>
        <pre>
          {JSON.stringify(
            {
              recorded_at: receipt.recorded_at,
              destination: receipt.destination,
              client_snapshot_id: receipt.client_snapshot_id,
              content_fingerprint: receipt.content_fingerprint,
              shared_fields: receipt.shared_fields,
            },
            null,
            2
          )}
        </pre>
      </div>
    </details>
  );
}

export function AuditLogScreen({
  auditEvents,
  consentReceipts,
  pushToast,
}: {
  auditEvents: AuditEvent[];
  consentReceipts: ConsentReceiptV1[];
  pushToast: PushToast;
}) {
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
    { id: "privacy", label: "Privacy", hint: "Pause/resume, retention, and cloud-sharing changes" },
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
      event.type === "usage_settings" ||
      event.type === "cloud_sharing",
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

  const sortedReceipts = [...consentReceipts].sort(
    (left, right) => new Date(right.recorded_at).getTime() - new Date(left.recorded_at).getTime()
  );

  function exportReceipts(format: ExportFormat) {
    downloadTextFile(
      exportFilename("consent_receipts", format),
      serializeConsentReceipts(sortedReceipts, format),
      exportMimeType(format)
    );
    pushToast({ tone: "success", message: `Consent receipts exported as ${format.toUpperCase()}` });
  }

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

      <details className="consent-receipts">
        <summary>
          Consent receipts <span className="consent-receipts-count">{formatCount(consentReceipts.length)}</span>
        </summary>
        <p className="consent-receipts-intro">
          One durable receipt per approved cloud share: when it happened, the exact field
          allowlist that left this device, the share level, and the destination team.
          Receipts record field names only — never metric values or tokens — and are
          written only when an upload actually succeeds.
        </p>
        {consentReceipts.length === 0 ? (
          <p className="consent-receipts-intro">
            No consent receipts yet. Nothing has been shared to Weekform Web from this device.
          </p>
        ) : (
          <>
            <div className="consent-receipts-actions">
              <button type="button" className="secondary-action" onClick={() => exportReceipts("json")}>
                <FileDown size={15} aria-hidden /> Export JSON
              </button>
              <button type="button" className="secondary-action" onClick={() => exportReceipts("csv")}>
                <FileDown size={15} aria-hidden /> Export CSV
              </button>
            </div>
            <div className="audit-list consent-receipts-list">
              {sortedReceipts.map((receipt) => (
                <ConsentReceiptRow receipt={receipt} key={receipt.receipt_id} />
              ))}
            </div>
          </>
        )}
      </details>

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
