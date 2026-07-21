import { useEffect, useRef, useState } from "react";
import { ClipboardCopy, Download, Pencil, RefreshCw, FileText } from "lucide-react";
import type { PersistedNarrativeRecord } from "../../services/localStore";
import { generateWeeklyNarrative } from "../../../../../packages/inference/src/capacity";
import { displaySafeNarrative } from "../../lib/date";
import { formatAuditTime } from "../../lib/format";
import { downloadTextFile } from "../../lib/dataExport";
import type { PushToast } from "../../hooks/useToasts";
import { EmptyState } from "../common/EmptyState";
import { InlineError } from "../common/InlineError";
import { AI_UNAVAILABLE_HINT } from "../../lib/constants";

export function NarrativeScreen({
  aiAvailable,
  narrative,
  generatedNarrative,
  weekRangeLabel,
  hasNarrativeEvidence,
  generationStatus,
  generationError,
  managerSummaryText,
  onManagerSummaryChange,
  onRegenerate,
  pushToast
}: {
  aiAvailable: boolean;
  narrative: ReturnType<typeof generateWeeklyNarrative>;
  generatedNarrative: PersistedNarrativeRecord | null;
  weekRangeLabel: string;
  hasNarrativeEvidence: boolean;
  generationStatus: "idle" | "generating" | "error";
  generationError: string | null;
  managerSummaryText: string | null;
  onManagerSummaryChange: (value: string) => void;
  onRegenerate: () => void;
  pushToast: PushToast;
}) {
  const [copied, setCopied] = useState(false);
  const [isRevealingNarrative, setIsRevealingNarrative] = useState(false);
  const wasGeneratingRef = useRef(false);
  const revealTimeoutRef = useRef<number | null>(null);
  const displayNarrative = displaySafeNarrative(generatedNarrative?.narrative ?? narrative, weekRangeLabel);
  const generatedManagerText = `${displayNarrative.headline}\n\n${displayNarrative.manager_ready_summary}`;
  // `managerText` is the controlled value of an editable <textarea>, so it must echo the stored
  // value verbatim — do NOT re-run replaceIsoWeekIds here (it would rewrite any ISO-week token the
  // user types mid-edit). Both branches are already display-safe: generatedManagerText comes from
  // displaySafeNarrative above, and managerSummaryText is only ever stored already-humanized.
  const managerText = managerSummaryText ?? generatedManagerText;

  const firstBreak = managerText.indexOf('\n\n');
  const markdownContent = firstBreak > -1
    ? `# Capacity Narrative — ${weekRangeLabel}\n\n## ${managerText.slice(0, firstBreak).trim()}\n\n${managerText.slice(firstBreak + 2).trim()}`
    : `# Capacity Narrative — ${weekRangeLabel}\n\n${managerText.trim()}`;

  useEffect(() => {
    if (generationStatus === "generating") {
      wasGeneratingRef.current = true;
      setIsRevealingNarrative(false);
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
        revealTimeoutRef.current = null;
      }
      return;
    }

    if (generationStatus !== "idle") {
      wasGeneratingRef.current = false;
      return;
    }

    if (!wasGeneratingRef.current || !generatedNarrative) return;
    wasGeneratingRef.current = false;
    setIsRevealingNarrative(true);
    revealTimeoutRef.current = window.setTimeout(() => {
      setIsRevealingNarrative(false);
      revealTimeoutRef.current = null;
    }, 1800);
  }, [generatedNarrative, generationStatus]);

  useEffect(
    () => () => {
      if (revealTimeoutRef.current !== null) {
        window.clearTimeout(revealTimeoutRef.current);
      }
    },
    []
  );

  function handleDownload() {
    const header = `Capacity Narrative — ${weekRangeLabel}\n${"─".repeat(48)}\n\n`;
    const slug = weekRangeLabel.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    downloadTextFile(`capacity-narrative-${slug}.txt`, header + managerText, "text/plain");
  }

  async function handleCopyMarkdown() {
    try {
      // Non-optional so a missing clipboard (insecure webview) throws into the catch
      // rather than silently no-op'ing while we falsely announce success.
      await navigator.clipboard.writeText(markdownContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
      pushToast({ tone: "success", message: "Copied to clipboard" });
    } catch {
      pushToast({ tone: "error", message: "Couldn't copy to the clipboard" });
    }
  }

  if (!hasNarrativeEvidence) {
    return (
      <section className="screen narrative-screen">
        <div className="screen-header">
          <div>
            <p className="eyebrow">Weekly summary</p>
            <h1>No manager summary until the week has local evidence.</h1>
          </div>
        </div>
        <EmptyState
          icon={FileText}
          title="Narrative generation is waiting."
          description="Weekform will generate analyst and manager-ready text after calendar imports or active-window-derived work blocks create enough explainable workload evidence."
        />
      </section>
    );
  }

  if (!generatedNarrative) {
    return (
      <section className="screen narrative-screen">
        <div className="screen-header">
          <div>
            <p className="eyebrow">Weekly summary</p>
            <h1>{generationStatus === "generating" ? "Generating your narrative…" : "Generate an AI-backed weekly narrative."}</h1>
          </div>
          <button
            className={`primary-action narrative-generate-action${generationStatus === "generating" ? " is-generating" : ""}`}
            type="button"
            disabled={generationStatus === "generating" || !aiAvailable}
            aria-busy={generationStatus === "generating"}
            onClick={onRegenerate}
            title={aiAvailable ? undefined : AI_UNAVAILABLE_HINT}
          >
            <RefreshCw
              key={generationStatus === "generating" ? "generating" : "idle"}
              className="narrative-generate-icon"
              size={18}
              aria-hidden
            />
            <span>{generationStatus === "generating" ? "Generating…" : "Generate Narrative"}</span>
          </button>
        </div>
        {generationStatus === "generating" ? (
          <div className="narrative-skeleton" role="status">
            <span className="sr-only">Generating weekly narrative…</span>
            <div className="narrative-skeleton-panel">
              <span className="skeleton-line" style={{ height: 11, width: "35%" }} />
              <span className="skeleton-line" style={{ height: 20, width: "55%" }} />
              <span className="skeleton-line" style={{ height: 12, width: "90%", marginTop: 8 }} />
              <span className="skeleton-line" style={{ height: 12, width: "80%" }} />
              <span className="skeleton-line" style={{ height: 12, width: "85%" }} />
              <span className="skeleton-line" style={{ height: 12, width: "60%" }} />
              <span className="skeleton-line" style={{ height: 11, width: "30%", marginTop: 12 }} />
              {[0, 1, 2].map((i) => (
                <span className="skeleton-line" key={i} style={{ height: 11, width: `${70 + i * 7}%` }} />
              ))}
            </div>
            <div className="narrative-skeleton-panel">
              <span className="skeleton-line" style={{ height: 11, width: "40%" }} />
              <span className="skeleton-line" style={{ height: 20, width: "65%" }} />
              <span className="skeleton-line" style={{ height: 80, width: "100%", marginTop: 8, borderRadius: 8 }} />
              <span className="skeleton-line" style={{ height: 12, width: "75%", marginTop: 4 }} />
              <span className="skeleton-line" style={{ height: 12, width: "55%" }} />
            </div>
          </div>
        ) : (
          <>
            <EmptyState
              icon={FileText}
              title="Ready to generate."
              description="The prompt will include the current ledger, daily review corrections, weekly capacity metrics, calendar imports, and active-window session context. It is sent to your configured AI provider only when generation runs."
            >
              <button
                type="button"
                className="primary-action narrative-generate-action"
                onClick={onRegenerate}
                disabled={!aiAvailable}
                title={aiAvailable ? undefined : AI_UNAVAILABLE_HINT}
              >
                <RefreshCw className="narrative-generate-icon" size={18} aria-hidden />
                <span>Generate Narrative</span>
              </button>
            </EmptyState>
            {generationError && <InlineError message={generationError} onRetry={aiAvailable ? onRegenerate : undefined} />}
          </>
        )}
      </section>
    );
  }

  return (
    <section className="screen narrative-screen">
      <div className={`narrative-result${isRevealingNarrative ? " is-newly-generated" : ""}`}>
        <div className="screen-header narrative-hero">
          <div className="narrative-hero-copy">
            <p className="eyebrow">Weekly summary</p>
            <h1>{displayNarrative.headline}</h1>
          </div>
          <div className="narrative-hero-footer">
            <div className="narrative-status">
              <span>Generated <time dateTime={generatedNarrative.generated_at}>{formatAuditTime(generatedNarrative.generated_at)}</time></span>
              <span>{generatedNarrative.model}</span>
              <span>{generatedNarrative.trigger === "auto" ? "Daily automatic run" : "Manual regeneration"}</span>
            </div>
            <div className="narrative-actions">
              <button
                className={`secondary-action narrative-generate-action${generationStatus === "generating" ? " is-generating" : ""}`}
                type="button"
                disabled={generationStatus === "generating" || !aiAvailable}
                aria-busy={generationStatus === "generating"}
                onClick={onRegenerate}
                title={aiAvailable ? undefined : AI_UNAVAILABLE_HINT}
              >
                <RefreshCw
                  key={generationStatus === "generating" ? "generating" : "idle"}
                  className="narrative-generate-icon"
                  size={17}
                  aria-hidden
                />
                <span>{generationStatus === "generating" ? "Generating…" : "Regenerate Narrative"}</span>
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={handleDownload}
              >
                <Download size={17} aria-hidden />
                <span>Download .txt</span>
              </button>
              <button
                className="primary-action"
                type="button"
                onClick={() => void handleCopyMarkdown()}
              >
                <ClipboardCopy size={18} aria-hidden />
                <span>{copied ? "Copied!" : "Copy as Markdown"}</span>
              </button>
            </div>
          </div>
        </div>
        {generationError && <InlineError message={generationError} onRetry={aiAvailable ? onRegenerate : undefined} />}

        <div className="narrative-layout">
          <section className="narrative-panel analyst-narrative">
            <div className="narrative-panel-header">
              <div>
                <span className="narrative-panel-kicker">Internal assessment</span>
                <h2>Analyst view</h2>
              </div>
              <span className="narrative-panel-purpose">For 1:1 prep</span>
            </div>
            <div className="narrative-copy">
              <span>Weekly assessment</span>
              <p>{displayNarrative.summary_text}</p>
            </div>
            <div className="driver-heading">
              <div>
                <span>Evidence considered</span>
                <small>{displayNarrative.key_drivers.length} signal{displayNarrative.key_drivers.length === 1 ? "" : "s"}</small>
              </div>
            </div>
            <div className="driver-list">
              {displayNarrative.key_drivers.map((driver, index) => (
                <div key={driver}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  <span>{driver}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="narrative-panel manager">
            <div className="narrative-panel-header">
              <div>
                <span className="narrative-panel-kicker">Shareable draft</span>
                <h2>Manager-ready version</h2>
              </div>
              <span className="narrative-panel-purpose">Review before sharing</span>
            </div>
            <div className="textarea-toolbar">
              <div>
                <Pencil size={15} aria-hidden />
                <span>Editable draft</span>
              </div>
              <small>Changes save locally</small>
            </div>
            <textarea
              aria-label="Editable manager summary"
              className="narrative-editor"
              value={managerText}
              onChange={(event) => onManagerSummaryChange(event.target.value)}
            />
            <p className="manager-editor-note">
              This version is formatted for sharing. Validate the underlying work blocks before using it for planning.
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}
