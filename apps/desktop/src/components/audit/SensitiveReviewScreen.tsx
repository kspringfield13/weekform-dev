import { useState } from "react";
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

  const flagged = visualContextInsights
    .filter((insight) => insight.sensitive_content_detected)
    .sort((left, right) => new Date(right.captured_at).getTime() - new Date(left.captured_at).getTime());

  const pendingInsight = pendingDiscardId
    ? flagged.find((insight) => insight.insight_id === pendingDiscardId) ?? null
    : null;

  return (
    <section className="screen sensitive-screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">Flagged captures</p>
          <h1>Review and purge visual captures flagged as sensitive.</h1>
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

      <div className="sensitive-list">
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
            onDiscardInsight(pendingInsight.insight_id);
            setPendingDiscardId(null);
          }}
          onCancel={() => setPendingDiscardId(null)}
        />
      )}
    </section>
  );
}
