import { ArrowRight, Check, CheckCircle2, Circle, RotateCcw } from "lucide-react";
import type { Screen, SettingsTab } from "../../lib/types";
import type { WeeklyReviewItem, WeeklyReviewState } from "../../services/weeklyReview";

function openReviewItem(
  item: WeeklyReviewItem,
  onOpenScreen: (screen: Screen) => void,
  onOpenSettingsTab: (tab: SettingsTab) => void
) {
  if (item.id === "cloud_share") {
    onOpenSettingsTab("account");
    return;
  }
  onOpenScreen(item.target);
}

export function WeeklyReviewScreen({
  state,
  completionRecorded,
  onOpenScreen,
  onOpenSettingsTab,
  onComplete
}: {
  state: WeeklyReviewState;
  completionRecorded: boolean;
  onOpenScreen: (screen: Screen) => void;
  onOpenSettingsTab: (tab: SettingsTab) => void;
  onComplete: () => void;
}) {
  const canComplete = state.isComplete && !completionRecorded;

  return (
    <section className="screen weekly-review-screen">
      <div className="screen-header compact weekly-review-header">
        <div>
          <p className="eyebrow">Weekly review</p>
          <h1>{completionRecorded ? "Weekly review completed." : "Close the loop on your week."}</h1>
          <p className="screen-subhead">
            Follow the local evidence in order. You can leave at any time and come back whenever it helps.
          </p>
        </div>
        <div className="weekly-review-summary" role="status" aria-live="polite">
          <strong>{state.doneCount}</strong>
          <span>of {state.items.length} checks ready</span>
        </div>
      </div>

      <ol className="weekly-review-list" aria-label="Weekly close-out checks">
        {state.items.map((item, index) => {
          const done = item.status === "done";
          const Icon = done ? CheckCircle2 : Circle;
          return (
            <li className={`weekly-review-item${done ? " is-done" : ""}`} key={item.id}>
              <div className="weekly-review-step" aria-hidden>{index + 1}</div>
              <Icon className="weekly-review-status-icon" size={21} aria-hidden />
              <div className="weekly-review-copy">
                <div className="weekly-review-item-heading">
                  <h2>{item.title}</h2>
                  <span className={`status-chip ${done ? "status-chip--success" : "status-chip--neutral"}`}>
                    {done ? "Ready" : "Needs attention"}
                  </span>
                </div>
                <p>{item.description}</p>
                {(item.id === "work_blocks" || item.id === "sensitive_captures") && item.count !== null && item.count > 0 && (
                  <small>{item.count} item{item.count === 1 ? "" : "s"}</small>
                )}
              </div>
              <button
                className="secondary-action weekly-review-item-action"
                type="button"
                onClick={() => openReviewItem(item, onOpenScreen, onOpenSettingsTab)}
                aria-label={`${done ? "Review" : "Open"} ${item.title}`}
              >
                <span>{done ? "Review" : "Open"}</span>
                <ArrowRight size={15} aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>

      <footer className="weekly-review-footer">
        <div>
          {completionRecorded ? <Check size={18} aria-hidden /> : <RotateCcw size={18} aria-hidden />}
          <p>
            <strong>{completionRecorded ? "Review completed" : state.isComplete ? "Everything is ready" : "Nothing is forced"}</strong>
            <span>
              {completionRecorded
                ? "The completion event is stored in your local audit history. New evidence can still make a check worth revisiting."
                : state.isComplete
                  ? "Finish when this review reflects the week you want to carry forward."
                  : "Resolve only the checks that are useful; this ritual has no streak or deadline."}
            </span>
          </p>
        </div>
        <button
          className="primary-action"
          type="button"
          disabled={!canComplete}
          onClick={onComplete}
        >
          <Check size={17} aria-hidden />
          <span>{completionRecorded ? "Review completed" : "Finish weekly review"}</span>
        </button>
      </footer>
    </section>
  );
}
