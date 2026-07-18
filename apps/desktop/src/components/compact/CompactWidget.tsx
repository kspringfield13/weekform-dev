import { Monitor, Check, ChevronRight, Play, Pause, X, AlertTriangle } from "lucide-react";
import type { ActiveWindowSample, ActivitySession, WeeklyCapacitySnapshot, WorkBlock } from "../../../../../packages/domain/src/models";
import type { Screen } from "../../lib/types";
import type { ProactiveAlert } from "../../lib/proactiveAlerts";
import { getLocalDateKey } from "../../lib/date";
import { pct, formatDurationMinutes } from "../../lib/format";

export function CompactWidget({
  paused,
  activeWindowSamples,
  activeWindowSessions,
  blocks,
  snapshot,
  onPauseChange,
  onOpenScreen,
  onConfirm,
  onExclude,
  proactiveAlert,
  onDismissProactiveAlert
}: {
  paused: boolean;
  activeWindowSamples: ActiveWindowSample[];
  activeWindowSessions: ActivitySession[];
  blocks: WorkBlock[];
  snapshot: WeeklyCapacitySnapshot;
  onPauseChange: (paused: boolean) => void;
  onOpenScreen: (screen: Screen) => void;
  onConfirm: (blockId: string) => void;
  onExclude: (blockId: string) => void;
  proactiveAlert: ProactiveAlert | null;
  onDismissProactiveAlert: () => void;
}) {
  const latestSample = activeWindowSamples[activeWindowSamples.length - 1];
  const latestSession = activeWindowSessions[0];
  const reviewQueue = blocks.filter((block) => !block.user_verified);
  const nextReview = reviewQueue[0];
  const today = getLocalDateKey();
  const observedMinutesToday = activeWindowSessions
    .filter((session) => getLocalDateKey(new Date(session.start_time)) === today)
    .reduce((total, session) => total + session.duration_minutes, 0);
  const observedTodayValue = observedMinutesToday > 0 ? formatDurationMinutes(observedMinutesToday) : "—";
  // Match the app-wide reliable-capacity has-signal gate (blocks.length > 0), used by the
  // sidebar / Weekly hero / Forecast / Acceleration. Gating on allocated_pct > 0 diverged: a
  // single short block rounds allocated_pct to 0, so this widget showed "--" while the sidebar
  // showed the real number in the same frame.
  const hasWorkBlocks = blocks.length > 0;
  const reliableCapacityValue = hasWorkBlocks ? pct(snapshot.reliable_new_work_capacity_pct) : "—";

  return (
    <section className="quick-view">
      <header className="quick-view-header">
        <div>
          <span className={paused ? "live-dot is-paused" : "live-dot"} />
          <strong>{paused ? "Tracking paused" : "Tracking"}</strong>
        </div>
      </header>

      {proactiveAlert && (
        <section className={`quick-alert is-${proactiveAlert.severity}`} role="alert">
          <AlertTriangle size={16} aria-hidden />
          <button
            type="button"
            className="quick-alert-body"
            onClick={() => onOpenScreen(proactiveAlert.action)}
          >
            <strong>{proactiveAlert.title}</strong>
            <small>{proactiveAlert.body}</small>
          </button>
          <button
            type="button"
            className="quick-alert-dismiss"
            aria-label="Dismiss alert"
            onClick={onDismissProactiveAlert}
          >
            <X size={14} aria-hidden />
          </button>
        </section>
      )}

      <section className="quick-current">
        <span>Current activity</span>
        <div>
          <Monitor size={18} aria-hidden />
          <div>
            <strong>{paused ? "Tracking paused" : latestSample?.app_name ?? "Waiting for activity"}</strong>
            <small>{paused ? "Resume when you are ready" : latestSample?.window_title ?? "No active-window sample yet"}</small>
          </div>
        </div>
        {latestSession && !paused && <p>{formatDurationMinutes(latestSession.duration_minutes)} in this session</p>}
      </section>

      <section className="quick-stats">
        <button
          type="button"
          title="Open work ledger"
          aria-label={`Observed today: ${observedMinutesToday > 0 ? observedTodayValue : "no activity yet"}. Open work ledger`}
          onClick={() => onOpenScreen("ledger")}
        >
          <span>Observed today</span>
          <strong>{observedTodayValue}</strong>
        </button>
        <button
          type="button"
          title="Open weekly capacity"
          aria-label={`Reliable capacity this week: ${hasWorkBlocks ? reliableCapacityValue : "not yet estimated"}. Open weekly capacity`}
          onClick={() => onOpenScreen("weekly")}
        >
          <span>Reliable capacity</span>
          <strong>{reliableCapacityValue}</strong>
          <small>{hasWorkBlocks ? "This week" : "Needs signal"}</small>
        </button>
      </section>

      <section className={reviewQueue.length > 0 ? "quick-review has-items" : "quick-review"}>
        <div>
          <span>Today’s review</span>
          <strong>{reviewQueue.length > 0 ? `${reviewQueue.length} item${reviewQueue.length === 1 ? " needs" : "s need"} attention` : "You’re all caught up"}</strong>
          <small>{nextReview ? nextReview.project_name : "New inferred work will appear here."}</small>
        </div>
        {nextReview && (
          <div className="quick-review-actions">
            <button type="button" className="quick-review-confirm" aria-label={`Confirm — ${nextReview.project_name}`} onClick={() => onConfirm(nextReview.work_block_id)}>
              <Check size={14} aria-hidden />
              Confirm
            </button>
            <button type="button" className="quick-review-exclude" aria-label={`Exclude — ${nextReview.project_name}`} onClick={() => onExclude(nextReview.work_block_id)}>
              <X size={14} aria-hidden />
              Exclude
            </button>
          </div>
        )}
      </section>

      {reviewQueue.length > 0 && (
        <button className="quick-primary" type="button" onClick={() => onOpenScreen("daily")}>
          Review {reviewQueue.length} item{reviewQueue.length === 1 ? "" : "s"}
          <ChevronRight size={17} aria-hidden />
        </button>
      )}

      <button className="quick-pause" type="button" onClick={() => onPauseChange(!paused)}>
        {paused ? <Play size={16} aria-hidden /> : <Pause size={16} aria-hidden />}
        {paused ? "Resume Tracking" : "Pause Tracking"}
      </button>

      <footer className="quick-footer">
        <button type="button" onClick={() => onOpenScreen("weekly")}>Open weekly summary</button>
        <button type="button" onClick={() => onOpenScreen("setup")}>Settings</button>
      </footer>
    </section>
  );
}
