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
  type TeamTimelineIdentity,
  type TeamTimelinePoint,
  type TeamTimelineZoom,
} from "../../../../../packages/inference/src/teamTimeline";

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
  identities,
  points,
  role,
}: {
  anchorWeekId: string;
  identities: TeamTimelineIdentity[];
  points: TeamTimelinePoint[];
  role: "member" | "manager";
}) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<TeamTimelineZoom>("month");
  const [selectedPoint, setSelectedPoint] = useState<TeamTimelinePoint | null>(null);
  const launchRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const timeline = useMemo(
    () => buildTeamTimeline(points, anchorWeekId, zoom, identities),
    [anchorWeekId, identities, points, zoom],
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
      const last = focusable[focusable.length - 1];
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
      <section className="team-gantt-launch">
        <div>
          <span className="team-card-kicker">Workload horizon</span>
          <h2>Explore the shape of approved work over time</h2>
          <p>
            Zoom from one week to a thirteen-week quarter and inspect the exact shared signal behind any period.
          </p>
        </div>
        <button ref={launchRef} className="primary-action" type="button" onClick={() => setOpen(true)}>
          <CalendarRange size={16} aria-hidden /> Open Gantt mode <Maximize2 size={14} aria-hidden />
        </button>
      </section>

      {open ? (
        <div className="team-gantt-overlay" role="dialog" aria-modal="true" aria-labelledby="desktop-team-gantt-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section ref={dialogRef} className="team-gantt-dialog">
            <header className="team-gantt-header">
              <div>
                <span className="team-card-kicker">{role === "manager" ? "Team-wide approved history" : "Your approved history"}</span>
                <h2 id="desktop-team-gantt-title">Workload Gantt</h2>
                <p>Each bar is a synced weekly workload snapshot—not a task, deadline, or activity score.</p>
              </div>
              <div className="team-gantt-header-actions">
                <div className="team-gantt-zoom" aria-label="Gantt time scale">
                  <ZoomIn size={14} aria-hidden />
                  {ZOOM_LABELS.map(({ id, label }) => (
                    <button key={id} className={zoom === id ? "is-active" : ""} type="button" aria-pressed={zoom === id} onClick={() => { setZoom(id); setSelectedPoint(null); }}>
                      {label}
                    </button>
                  ))}
                  <ZoomOut size={14} aria-hidden />
                </div>
                <button ref={closeRef} className="team-gantt-close" type="button" aria-label="Close Gantt mode" onClick={() => setOpen(false)}><X size={17} aria-hidden /></button>
              </div>
            </header>

            <div className="team-gantt-body">
              <div className="team-gantt-scroll" tabIndex={0} aria-label="Scrollable workload Gantt chart">
                <div className="team-gantt-grid" style={{ gridTemplateColumns: `minmax(150px, 190px) repeat(${timeline.weeks.length}, minmax(${zoom === "quarter" ? 72 : 118}px, 1fr))` }}>
                  <div className="team-gantt-corner">{role === "manager" ? "Team member" : "Signal"}</div>
                  {timeline.weeks.map((week) => <div className="team-gantt-week" key={week}>{week.replace("-", " ")}</div>)}
                  {timeline.rows.map((row) => (
                    <div className="team-gantt-row" key={row.userId} style={{ gridColumn: `1 / span ${timeline.weeks.length + 1}`, gridTemplateColumns: "subgrid" }}>
                      <div className="team-gantt-person"><strong>{row.displayName}</strong><small>{row.isSelf ? "You" : "Approved summary"}</small></div>
                      {row.cells.map((point, index) => point ? (
                        <button
                          className={`team-gantt-cell${selectedPoint === point ? " is-selected" : ""}`}
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
                        <div className="team-gantt-cell is-empty" key={`${row.userId}:${timeline.weeks[index]}`}><span>Not shared</span></div>
                      ))}
                    </div>
                  ))}
                </div>
                {timeline.rows.length === 0 ? <div className="team-gantt-empty">No approved snapshots fall inside this horizon.</div> : null}
              </div>

              <aside className="team-gantt-detail" aria-live="polite">
                {selectedPoint ? (
                  <>
                    <span className="team-card-kicker">Drill-down · {selectedPoint.weekId}</span>
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
                    <ShieldCheck size={20} aria-hidden />
                    <h3>Select a weekly bar</h3>
                    <p>Inspect only the metrics that member approved for that week. Empty periods remain unknown.</p>
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
