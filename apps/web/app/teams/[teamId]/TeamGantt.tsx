"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarRange,
  Maximize2,
  ShieldCheck,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import {
  buildTeamTimeline,
  type TeamTimelinePoint,
  type TeamTimelineZoom,
} from "../../../../../packages/inference/src/teamTimeline";

interface TeamGanttSnapshot {
  userId: string;
  weekId: string;
  observedAt: string;
  reliableCapacityPct: number | null;
  reactivePct: number | null;
  meetingPct: number | null;
  fragmentedPct: number | null;
  reviewedBlocks: number;
  eligibleBlocks: number;
}

const ZOOM_LABELS: Array<{ id: TeamTimelineZoom; label: string }> = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
];

function formatMetric(value: number | null): string {
  return value === null ? "Not shared" : `${Math.round(value)}%`;
}

export function TeamGantt({
  anchorWeekId,
  history,
  identities,
  role,
  viewerId,
}: {
  anchorWeekId: string;
  history: TeamGanttSnapshot[];
  identities: Array<{ userId: string; name: string }>;
  role: "member" | "manager";
  viewerId: string;
}) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<TeamTimelineZoom>("month");
  const [selectedPoint, setSelectedPoint] = useState<TeamTimelinePoint | null>(null);
  const launchRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const points = useMemo<TeamTimelinePoint[]>(() => {
    const identityByUser = new Map(identities.map((identity) => [identity.userId, identity.name]));
    return history
      .filter((snapshot) => role === "manager" || snapshot.userId === viewerId)
      .map((snapshot) => ({
        userId: snapshot.userId,
        displayName: snapshot.userId === viewerId
          ? (identityByUser.get(snapshot.userId) ?? "You")
          : (identityByUser.get(snapshot.userId) ?? "Team member"),
        isSelf: snapshot.userId === viewerId,
        weekId: snapshot.weekId,
        syncedAt: snapshot.observedAt,
        reliableCapacityPct: snapshot.reliableCapacityPct,
        reactivePct: snapshot.reactivePct,
        meetingPct: snapshot.meetingPct,
        fragmentedPct: snapshot.fragmentedPct,
        reviewedBlocks: snapshot.reviewedBlocks,
        eligibleBlocks: snapshot.eligibleBlocks,
      }));
  }, [history, identities, role, viewerId]);
  const timeline = useMemo(
    () => buildTeamTimeline(
      points,
      anchorWeekId,
      zoom,
      identities.map((identity) => ({
        userId: identity.userId,
        displayName: identity.name,
        isSelf: identity.userId === viewerId,
      })),
    ),
    [anchorWeekId, identities, points, viewerId, zoom],
  );

  useEffect(() => {
    if (!open) return;
    const returnFocusTo = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : launchRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      returnFocusTo?.focus();
    };
  }, [open]);

  return (
    <>
      <section className="web-team-gantt-launch" aria-labelledby={`team-gantt-launch-${role}`}>
        <div>
          <span className="team-section-kicker">Workload horizon</span>
          <h2 id={`team-gantt-launch-${role}`}>Explore approved work from week to quarter</h2>
          <p>
            Open a large workload Gantt, zoom across one to thirteen weeks, and inspect the shared evidence behind any period.
          </p>
        </div>
        <button ref={launchRef} className="button button-primary" type="button" onClick={() => setOpen(true)}>
          <CalendarRange aria-hidden="true" /> Open Gantt mode <Maximize2 aria-hidden="true" />
        </button>
      </section>

      {open ? (
        <div className="web-team-gantt-overlay" role="dialog" aria-modal="true" aria-labelledby="web-team-gantt-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section ref={dialogRef} className="web-team-gantt-dialog">
            <header className="web-team-gantt-header">
              <div>
                <span className="team-section-kicker">{role === "manager" ? "Team-wide approved history" : "Your approved history"}</span>
                <h2 id="web-team-gantt-title">Workload Gantt</h2>
                <p>Bars represent synced weekly snapshots, never invented tasks, deadlines, or activity scores.</p>
              </div>
              <div className="web-team-gantt-header-actions">
                <div className="web-team-gantt-zoom" aria-label="Gantt time scale">
                  <ZoomIn aria-hidden="true" />
                  {ZOOM_LABELS.map(({ id, label }) => (
                    <button key={id} className={zoom === id ? "is-active" : ""} type="button" aria-pressed={zoom === id} onClick={() => { setZoom(id); setSelectedPoint(null); }}>
                      {label}
                    </button>
                  ))}
                  <ZoomOut aria-hidden="true" />
                </div>
                <button ref={closeRef} className="web-team-gantt-close" type="button" aria-label="Close Gantt mode" onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
              </div>
            </header>

            <div className="web-team-gantt-body">
              <div className="web-team-gantt-scroll" tabIndex={0} aria-label="Scrollable workload Gantt chart">
                <div className="web-team-gantt-grid" style={{ gridTemplateColumns: `minmax(160px, 210px) repeat(${timeline.weeks.length}, minmax(${zoom === "quarter" ? 76 : 126}px, 1fr))` }}>
                  <div className="web-team-gantt-corner">{role === "manager" ? "Team member" : "Signal"}</div>
                  {timeline.weeks.map((week) => <div className="web-team-gantt-week" key={week}>{week.replace("-", " ")}</div>)}
                  {timeline.rows.map((row) => (
                    <div className="web-team-gantt-row" key={row.userId} style={{ gridColumn: `1 / span ${timeline.weeks.length + 1}`, gridTemplateColumns: "subgrid" }}>
                      <div className="web-team-gantt-person"><strong>{row.displayName}</strong><small>{row.isSelf ? "Signed-in account" : "Approved summary"}</small></div>
                      {row.cells.map((point, index) => point ? (
                        <button
                          className={`web-team-gantt-cell${selectedPoint === point ? " is-selected" : ""}`}
                          key={`${row.userId}:${timeline.weeks[index]}`}
                          type="button"
                          aria-label={`${row.displayName}, ${point.weekId}, reliable capacity ${formatMetric(point.reliableCapacityPct)}`}
                          onClick={() => setSelectedPoint(point)}
                        >
                          <span style={{ width: `${Math.max(10, Math.min(100, point.reliableCapacityPct ?? 18))}%` }} />
                          <strong>{formatMetric(point.reliableCapacityPct)}</strong>
                          <small>{point.reviewedBlocks}/{point.eligibleBlocks} reviewed</small>
                        </button>
                      ) : (
                        <div className="web-team-gantt-cell is-empty" key={`${row.userId}:${timeline.weeks[index]}`}><span>Not shared</span></div>
                      ))}
                    </div>
                  ))}
                </div>
                {timeline.rows.length === 0 ? <div className="web-team-gantt-empty">No approved snapshots fall inside this horizon.</div> : null}
              </div>

              <aside className="web-team-gantt-detail" aria-live="polite">
                {selectedPoint ? (
                  <>
                    <span className="team-section-kicker">Drill-down · {selectedPoint.weekId}</span>
                    <h3>{selectedPoint.displayName}</h3>
                    <dl>
                      <div><dt>Reliable capacity</dt><dd>{formatMetric(selectedPoint.reliableCapacityPct)}</dd></div>
                      <div><dt>Reactive load</dt><dd>{formatMetric(selectedPoint.reactivePct)}</dd></div>
                      <div><dt>Meetings</dt><dd>{formatMetric(selectedPoint.meetingPct)}</dd></div>
                      <div><dt>Fragmented work</dt><dd>{formatMetric(selectedPoint.fragmentedPct)}</dd></div>
                      <div><dt>Review coverage</dt><dd>{selectedPoint.reviewedBlocks}/{selectedPoint.eligibleBlocks}</dd></div>
                    </dl>
                    <p>Synced {new Date(selectedPoint.syncedAt).toLocaleString()}</p>
                  </>
                ) : (
                  <>
                    <ShieldCheck aria-hidden="true" />
                    <h3>Select a weekly bar</h3>
                    <p>Drill into approved metrics and review coverage. Empty periods stay unknown.</p>
                  </>
                )}
              </aside>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
