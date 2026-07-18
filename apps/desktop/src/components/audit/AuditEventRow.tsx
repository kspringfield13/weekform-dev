import { useState } from "react";
import { ClipboardCopy } from "lucide-react";
import type { AuditEvent } from "../../../../../packages/domain/src/models";
import { auditTypeLabel, formatAuditTime, privacyLevelLabel, privacyLevelTooltip, sourceLabel } from "../../lib/format";
import type { PushToast } from "../../hooks/useToasts";

export function AuditEventRow({ event, pushToast }: { event: AuditEvent; pushToast: PushToast }) {
  const [copied, setCopied] = useState(false);
  const detailsJson = JSON.stringify(event.details, null, 2);

  async function handleCopyJson() {
    try {
      // Non-optional so a missing clipboard (insecure webview) throws into the catch
      // rather than silently no-op'ing while we falsely announce success.
      await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
      pushToast({ tone: "success", message: "Copied to clipboard" });
    } catch {
      pushToast({ tone: "error", message: "Couldn't copy to the clipboard" });
    }
  }

  return (
    <details className="audit-row">
      <summary>
        <div>
          <span className={`audit-badge ${event.type}`}>{auditTypeLabel(event.type)}</span>
          <time dateTime={event.timestamp}>{formatAuditTime(event.timestamp)}</time>
        </div>
        <div>
          <strong title={event.title}>{event.title}</strong>
          <small title={event.summary}>{event.summary}</small>
        </div>
        <span
          className={`audit-privacy audit-privacy--${event.privacy_level}`}
          title={privacyLevelTooltip(event.privacy_level)}
        >
          {privacyLevelLabel(event.privacy_level)}
        </span>
      </summary>
      <div className="audit-detail">
        <div className="audit-detail-header">
          <span>{sourceLabel(event.source)}</span>
          <button
            type="button"
            onClick={() => void handleCopyJson()}
            aria-label={copied ? `JSON Copied for ${event.title}` : `Copy JSON for ${event.title}`}
          >
            <ClipboardCopy size={15} aria-hidden />
            {copied ? "JSON Copied" : "Copy JSON"}
          </button>
        </div>
        <pre>{detailsJson}</pre>
      </div>
    </details>
  );
}
