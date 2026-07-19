import { AgentMark } from "../common/AgentMark";
import type { ReviewCopilotSuggestion } from "../../../../../packages/domain/src/models";
import { reviewActionLabel } from "../../lib/format";
import { InlineError } from "../common/InlineError";

// Build the "which block(s) will this change" caption from the suggestion's
// affected ids + a work_block_id → title lookup, so the proposed change is
// reviewable in line with the app's cite-your-evidence convention. Names are
// deduped (a merge can touch several blocks sharing one project_name) and
// collapsed to the first two + "+K more" beyond that; `full` lists every name
// for the hover `title`.
function affectedBlocksLabel(
  ids: string[],
  blockTitles: Map<string, string>
): { count: string; names: string; full: string } {
  const count = `${ids.length} block${ids.length === 1 ? "" : "s"}`;
  const names = Array.from(
    new Set(ids.map((id) => blockTitles.get(id)).filter((t): t is string => Boolean(t)))
  );
  if (names.length === 0) {
    return { count, names: "", full: count };
  }
  const shown =
    names.length > 2 ? `${names.slice(0, 2).join(", ")}, +${names.length - 2} more` : names.join(", ");
  return { count, names: shown, full: `${count} · ${names.join(", ")}` };
}

export function ReviewCopilotPanel({
  suggestions,
  blockTitles,
  status,
  error,
  onGenerate,
  onApply,
  onDismiss
}: {
  suggestions: ReviewCopilotSuggestion[];
  blockTitles: Map<string, string>;
  status: "idle" | "generating" | "error";
  error: string | null;
  onGenerate: () => void;
  onApply: (suggestion: ReviewCopilotSuggestion) => void;
  onDismiss: (suggestionId: string) => void;
}) {
  const isGenerating = status === "generating";

  // The trigger lives in the screen header — this panel only renders results,
  // and stays out of the way entirely until there's something to show.
  if (!isGenerating && suggestions.length === 0 && !error) {
    return null;
  }

  return (
    <section className="copilot-inline">
      <div className="copilot-inline-head">
        <AgentMark size={15} animated={isGenerating} aria-hidden />
        <strong>Suggested cleanup</strong>
        <span className="copilot-inline-sub">AI-proposed — you approve every change.</span>
      </div>
      {error && <InlineError message={error} onRetry={onGenerate} />}
      {isGenerating && suggestions.length === 0 ? (
        <div className="copilot-skeleton" role="status">
          <span className="sr-only">Generating suggestions…</span>
          {[0, 1, 2].map((i) => (
            <div className="copilot-skeleton-item" key={i}>
              <span className="skeleton-line" style={{ height: 14, width: "60%" }} />
              <span className="skeleton-line" style={{ height: 11, width: "40%" }} />
              <span className="skeleton-line" style={{ height: 11, width: "85%" }} />
              <span className="skeleton-line" style={{ height: 11, width: "70%" }} />
            </div>
          ))}
        </div>
      ) : suggestions.length > 0 ? (
        <ol className="copilot-list">
          {suggestions.map((suggestion) => {
            const affected = affectedBlocksLabel(suggestion.work_block_ids, blockTitles);
            return (
            <li key={suggestion.suggestion_id}>
              <div>
                <strong>{suggestion.title}</strong>
                <span>
                  {reviewActionLabel(suggestion.action)} ·{" "}
                  <span title="How confident the AI is in this suggested cleanup action">
                    {Math.round(suggestion.confidence * 100)}% confidence
                    <span className="sr-only"> — how confident the AI is in this suggested cleanup action</span>
                  </span>
                </span>
              </div>
              <p>{suggestion.rationale}</p>
              <small title={affected.full}>
                {affected.names ? `${affected.count} · ${affected.names}` : affected.count}
              </small>
              <div className="copilot-actions">
                <button type="button" aria-label={`Apply suggestion: ${suggestion.title}`} onClick={() => onApply(suggestion)}>Apply suggestion</button>
                <button type="button" aria-label={`Dismiss suggestion: ${suggestion.title}`} onClick={() => onDismiss(suggestion.suggestion_id)}>Dismiss suggestion</button>
              </div>
            </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
