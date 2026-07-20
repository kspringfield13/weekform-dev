"use client";

import { MacAppLink } from "@/components/MacAppLink";

import {
  buildPersonalWeeklyReviewPresentation,
  type PersonalWeeklyReviewItem,
} from "@/lib/personalWeeklyReviewPresentation";
import type { PersonalReplicaView } from "@/lib/personalReplica";

function StatusIcon({ ready }: { ready: boolean }) {
  return (
    <svg className="weekly-review-status-icon" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      {ready ? <path d="m8 12 2.5 2.5L16 9" /> : null}
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function ReviewAction({ item }: { item: PersonalWeeklyReviewItem }) {
  if (item.target !== "mac") {
    const destination = item.target === "today" ? "today" : "week";
    return (
      <button
        className="button button-secondary weekly-review-action"
        type="button"
        aria-label={`${item.actionLabel}: ${item.title}`}
        onClick={() => window.dispatchEvent(new CustomEvent("weekform:web-navigate", {
          detail: { destination, subview: item.target },
        }))}
      >
        <span>{item.actionLabel}</span>
        <ArrowIcon />
      </button>
    );
  }

  return (
    <MacAppLink
      className="button button-secondary weekly-review-action"
      aria-label={`${item.actionLabel}: ${item.title}`}
    >
      <span>{item.actionLabel}</span>
      <ArrowIcon />
    </MacAppLink>
  );
}

export function PersonalWeeklyReviewScreen({
  replicas,
  error,
}: {
  replicas: PersonalReplicaView[];
  error: string | null;
}) {
  const presentation = buildPersonalWeeklyReviewPresentation(replicas);

  return (
    <section className="screen web-desktop-screen weekly-review-screen" aria-labelledby="web-weekly-review-title">
      <header className="screen-header compact weekly-review-header">
        <div>
          <p className="eyebrow">Weekly review</p>
          <h1 id="web-weekly-review-title">Close the loop on your week.</h1>
          <p className="screen-subhead">
            Follow review-safe evidence here. Checks that require private local evidence finish on your Mac.
          </p>
        </div>
        <div className="weekly-review-summary" role="status" aria-live="polite">
          <strong>{error ? "—" : presentation.doneCount}</strong>
          <span>{error ? "checks unavailable" : <>of {presentation.items.length} checks ready</>}</span>
        </div>
      </header>

      {error ? (
        <div className="form-alert web-weekly-review-error" role="alert">
          Weekly review status could not be loaded. Reload the page to try again.
        </div>
      ) : (
        <>
          {presentation.status === "waiting" ? (
            <div className="form-notice web-weekly-review-boundary" role="status">
              No review-safe week is connected. The checklist stays visible, but Web will not infer completion without a replica.
            </div>
          ) : (
            <p className="web-weekly-review-week">{presentation.weekId} · review-safe replica</p>
          )}

          <ol className="weekly-review-list" aria-label="Weekly close-out checks">
            {presentation.items.map((item, index) => {
              const ready = item.status === "ready";
              const macOnly = item.status === "mac_only";
              const statusLabel = ready ? "Ready" : macOnly ? "Mac only" : "Needs attention";
              return (
                <li className={`weekly-review-item${ready ? " is-done" : ""}${macOnly ? " is-mac-only" : ""}`} key={item.id}>
                  <div className="weekly-review-step" aria-hidden="true">{index + 1}</div>
                  <StatusIcon ready={ready} />
                  <div className="weekly-review-copy">
                    <div className="weekly-review-item-heading">
                      <h2>{item.title}</h2>
                      <span className={`status-chip ${ready ? "status-chip--success" : macOnly ? "status-chip--local" : "status-chip--neutral"}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <p>{item.description}</p>
                    {item.count !== null && item.count > 0 ? <small>{item.count} item{item.count === 1 ? "" : "s"}</small> : null}
                  </div>
                  <ReviewAction item={item} />
                </li>
              );
            })}
          </ol>

          <footer className="weekly-review-footer">
            <div>
              <StatusIcon ready={false} />
              <p>
                <strong>Mac remains authoritative</strong>
                <span>Web cannot record the local completion audit event or mark omitted private checks ready.</span>
              </p>
            </div>
            <MacAppLink
              className="button button-primary weekly-review-finish-action"
              title="Get the Mac app to finish with the local audit trail"
            >
              Get Weekform for Mac
            </MacAppLink>
          </footer>
        </>
      )}
    </section>
  );
}
