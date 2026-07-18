import { useEffect, useRef, useState } from "react";
import { ShieldAlert, Trash2 } from "lucide-react";
import type { VisualContextInsight } from "../../../../../packages/domain/src/models";
import { formatAuditTime, formatCount, privacyLevelLabel } from "../../lib/format";
import { EmptyState } from "../common/EmptyState";
import { ConfirmDialog } from "../common/ConfirmDialog";

export function SensitiveReviewScreen({
  visualContextInsights,
  onDiscardInsight
}: {
  visualContextInsights: VisualContextInsight[];
  onDiscardInsight: (insightId: string) => void;
}) {
  const [pendingDiscardId, setPendingDiscardId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Set to the discarded item's list index in onConfirm; the effect below then
  // moves focus off the (now-unmounted) Discard trigger onto a stable target.
  const focusAfterDiscardIndex = useRef<number | null>(null);

  const flagged = visualContextInsights
    .filter((insight) => insight.sensitive_content_detected)
    .sort((left, right) => new Date(right.captured_at).getTime() - new Date(left.captured_at).getTime());

  const pendingInsight = pendingDiscardId
    ? flagged.find((insight) => insight.insight_id === pendingDiscardId) ?? null
    : null;

  // After a discard, keep the keyboard/SR user on the list instead of letting
  // focus fall to <body>. ConfirmDialog's unmount cleanup restores focus to the
  // Discard button it captured — but that button just unmounted, so its restore
  // is a no-op. React flushes all passive-effect destroys (that restore) before
  // any creates, so this effect (keyed on the shrinking list) runs afterward and
  // wins: it lands focus on the item that slid into the discarded slot, or the
  // heading when the list is now empty.
  useEffect(() => {
    const index = focusAfterDiscardIndex.current;
    if (index === null) return;
    focusAfterDiscardIndex.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button.sensitive-discard");
    if (buttons && buttons.length > 0) {
      buttons[Math.min(index, buttons.length - 1)].focus();
    } else {
      headingRef.current?.focus();
    }
  }, [flagged.length]);

  return (
    <section className="screen sensitive-screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">Flagged captures</p>
          <h1 ref={headingRef} tabIndex={-1}>Review and purge visual captures flagged as sensitive.</h1>
        </div>
        <div className="summary-score" title="Visual captures flagged as potentially sensitive and awaiting review">
          <span>Flagged</span>
          <strong>{formatCount(flagged.length)}</strong>
          <span className="sr-only">Visual captures flagged as potentially sensitive and awaiting review</span>
        </div>
      </div>

      <p className="sensitive-intro">
        These derived insights were flagged because the screen may have contained confidential content. Discarding
        an insight removes it from local storage and records the action in your audit history.
      </p>

      <div className="sensitive-list" ref={listRef}>
        {flagged.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="No flagged captures."
            description="Visual captures detected as potentially sensitive will appear here for review and removal."
          />
        ) : (
          flagged.map((insight) => (
            <article className="sensitive-item" key={insight.insight_id}>
              <div className="sensitive-item-main">
                <div className="sensitive-item-head">
                  <strong>{insight.app_name}</strong>
                  <span className="sensitive-flag">Sensitive</span>
                </div>
                <p className="sensitive-summary">{insight.activity_summary}</p>
                <div className="sensitive-meta">
                  <time dateTime={insight.captured_at}>{formatAuditTime(insight.captured_at)}</time>
                  {insight.project_hint && <span>{insight.project_hint}</span>}
                  <span>{privacyLevelLabel(insight.privacy_level)}</span>
                  {insight.raw_screenshot_retained && <span className="sensitive-retained">Screenshot retained</span>}
                </div>
              </div>
              <button
                type="button"
                className="secondary-action sensitive-discard"
                onClick={() => setPendingDiscardId(insight.insight_id)}
                aria-label={`Discard flagged capture from ${insight.app_name}`}
              >
                <Trash2 size={15} aria-hidden />
                <span>Discard</span>
              </button>
            </article>
          ))
        )}
      </div>

      {pendingInsight && (
        <ConfirmDialog
          title="Discard this flagged capture?"
          description={`This permanently removes the flagged ${pendingInsight.app_name} capture ("${pendingInsight.activity_summary}") from local storage and records the action in your audit history. It can't be undone.`}
          confirmLabel="Discard capture"
          onConfirm={() => {
            focusAfterDiscardIndex.current = flagged.findIndex(
              (insight) => insight.insight_id === pendingInsight.insight_id
            );
            onDiscardInsight(pendingInsight.insight_id);
            setPendingDiscardId(null);
          }}
          onCancel={() => setPendingDiscardId(null)}
        />
      )}
    </section>
  );
}
