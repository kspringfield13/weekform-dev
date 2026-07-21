import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarRange,
  Crosshair,
  Maximize2,
  ShieldCheck,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  buildTeamCalendar,
  buildTeamTimelineCapacityForecast,
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
  const [forecastSelected, setForecastSelected] = useState(false);
  const [todayIso] = useState(() => new Date().toISOString());
  const launchRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const calendar = useMemo(
    () => buildTeamCalendar(points, todayIso, zoom, identities),
    [identities, points, todayIso, zoom],
  );
  const forecast = useMemo(
    () => buildTeamTimelineCapacityForecast(points, identities.length, todayIso),
    [identities.length, points, todayIso],
  );
  const dayWidth = zoom === "week" ? 52 : zoom === "month" ? 33 : 23;
  const gridStyle = {
    gridTemplateColumns: `minmax(158px, 198px) repeat(${calendar.days.length}, ${dayWidth}px)`,
  };
  const monthBands = useMemo(() => calendar.days.reduce<Array<{ key: string; label: string; start: number; span: number }>>((bands, day, index) => {
    const key = day.dateId.slice(0, 7);
    const latest = bands[bands.length - 1];
    if (latest?.key === key) latest.span += 1;
    else bands.push({ key, label: day.monthLabel, start: index, span: 1 });
    return bands;
  }, []), [calendar.days]);

  const scrollToToday = () => {
    const viewport = scrollRef.current;
    const today = viewport?.querySelector<HTMLElement>("[data-today-marker='true']");
    if (!viewport || !today) return;
    viewport.scrollTo({ left: Math.max(0, today.offsetLeft - (viewport.clientWidth * 0.7)), behavior: "smooth" });
  };

  useEffect(() => {
    if (!open) return;
    const returnFocusTo = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : launchRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const frame = window.requestAnimationFrame(scrollToToday);
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
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      returnFocusTo?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(scrollToToday);
    return () => window.cancelAnimationFrame(frame);
  }, [open, zoom]);

  return (
    <>
      <section className="team-gantt-launch">
        <div className="team-gantt-launch-visual" aria-hidden="true"><span /><span /><span /><i /></div>
        <div>
          <span className="team-card-kicker">Workload calendar</span>
          <h2>History, today, and what may fit next</h2>
          <p>Read approved weekly signals against real calendar days, then inspect the aggregate forecast without ranking people.</p>
        </div>
        <button ref={launchRef} className="primary-action" type="button" onClick={() => setOpen(true)}>
          <CalendarRange size={16} aria-hidden /> Open calendar <Maximize2 size={14} aria-hidden />
        </button>
      </section>

      {open ? (
        <div className="team-gantt-overlay" role="dialog" aria-modal="true" aria-labelledby="desktop-team-gantt-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section ref={dialogRef} className="team-gantt-dialog">
            <header className="team-gantt-header">
              <div>
                <span className="team-card-kicker">{role === "manager" ? "Team-wide approved signals" : "Your approved signals"} · through {anchorWeekId}</span>
                <h2 id="desktop-team-gantt-title">Team workload calendar</h2>
                <p>Daily calendar context for weekly summaries. Forecasts are aggregate planning ranges, never per-person predictions.</p>
              </div>
              <div className="team-gantt-header-actions">
                <button className="team-gantt-today" type="button" onClick={scrollToToday}><Crosshair size={14} aria-hidden />Today</button>
                <div className="team-gantt-zoom" aria-label="Gantt time scale">
                  <ZoomIn size={14} aria-hidden />
                  {ZOOM_LABELS.map(({ id, label }) => (
                    <button key={id} className={zoom === id ? "is-active" : ""} type="button" aria-pressed={zoom === id} onClick={() => { setZoom(id); setSelectedPoint(null); setForecastSelected(false); }}>
                      {label}
                    </button>
                  ))}
                  <ZoomOut size={14} aria-hidden />
                </div>
                <button ref={closeRef} className="team-gantt-close" type="button" aria-label="Close calendar" onClick={() => setOpen(false)}><X size={17} aria-hidden /></button>
              </div>
            </header>

            <div className="team-gantt-legend" aria-label="Calendar legend">
              <span><i className="is-observed" />Observed history</span>
              <span><i className="is-today" />Today</span>
              <span><i className="is-forecast" />Forecast window</span>
              <span><i className="is-unknown" />Not shared</span>
              <em>{calendar.todayIndex + 1} days through today · 7-day forecast window</em>
            </div>

            <div className="team-gantt-body">
              <div ref={scrollRef} className="team-gantt-scroll" tabIndex={0} aria-label="Scrollable team workload calendar">
                <div className="team-gantt-calendar" style={gridStyle}>
                  <div className="team-gantt-corner">{role === "manager" ? "Team member" : "Signal"}<small>Weekly approved summary</small></div>
                  {monthBands.map((band) => <div className="team-gantt-month" key={band.key} style={{ gridColumn: `${band.start + 2} / span ${band.span}` }}>{band.label}</div>)}
                  {calendar.days.map((day, index) => <div className={`team-gantt-day is-${day.kind}${day.isWeekend ? " is-weekend" : ""}`} data-today-marker={day.kind === "today" ? "true" : undefined} key={day.dateId} style={{ gridColumn: index + 2 }} title={day.dateId}><span>{day.weekdayLabel.slice(0, 1)}</span><strong>{day.dayLabel}</strong></div>)}

                  {role === "manager" ? (
                    <div className="team-gantt-row is-forecast-row" style={gridStyle}>
                      <div className="team-gantt-person"><span className="team-gantt-avatar is-forecast"><Sparkles size={14} aria-hidden /></span><div><strong>Team forecast</strong><small>Aggregate · next week</small></div></div>
                      {calendar.days.map((day, index) => <span className={`team-gantt-day-slot is-${day.kind}${day.isWeekend ? " is-weekend" : ""}`} key={day.dateId} style={{ gridColumn: index + 2 }} />)}
                      {forecast.verdict === "forecast" && forecast.median !== null && forecast.min !== null && forecast.max !== null ? (
                        <button className={`team-gantt-bar is-forecast${forecastSelected ? " is-selected" : ""}`} style={{ gridColumn: `${calendar.forecastStartIndex + 2} / span 7` }} type="button" aria-label={`Team reliable capacity forecast ${Math.round(forecast.median)}%, range ${Math.round(forecast.min)} to ${Math.round(forecast.max)}%`} onClick={() => { setForecastSelected(true); setSelectedPoint(null); }}>
                          <span><Sparkles size={12} aria-hidden />Reliable capacity</span><strong>{Math.round(forecast.median)}%</strong><small>{Math.round(forecast.min)}–{Math.round(forecast.max)}% range</small>
                        </button>
                      ) : <div className="team-gantt-forecast-empty" style={{ gridColumn: `${calendar.forecastStartIndex + 2} / span 7` }}>Forecast withheld · insufficient approved coverage</div>}
                    </div>
                  ) : null}

                  {calendar.rows.map((row) => (
                    <div className="team-gantt-row" key={row.userId} style={gridStyle}>
                      <div className="team-gantt-person"><span className="team-gantt-avatar">{row.displayName.slice(0, 2).toLocaleUpperCase()}</span><div><strong>{row.displayName}</strong><small>{row.isSelf ? "You" : "Approved summary"}</small></div></div>
                      {calendar.days.map((day, index) => <span className={`team-gantt-day-slot is-${day.kind}${day.isWeekend ? " is-weekend" : ""}`} key={day.dateId} style={{ gridColumn: index + 2 }} />)}
                      {row.bars.map((bar) => (
                        <button className={`team-gantt-bar${selectedPoint === bar.point ? " is-selected" : ""}`} key={`${row.userId}:${bar.point.weekId}`} style={{ gridColumn: `${bar.startIndex + 2} / span ${bar.spanDays}` }} type="button" aria-label={`${row.displayName}, ${bar.point.weekId}, reliable capacity ${formatMetric(bar.point.reliableCapacityPct)}`} onClick={() => { setSelectedPoint(bar.point); setForecastSelected(false); }}>
                          <span className="team-gantt-bar-fill" style={{ width: `${Math.max(8, Math.min(100, bar.point.reliableCapacityPct ?? 18))}%` }} />
                          <span>{bar.point.weekId.replace("-", " ")}</span><strong>{formatMetric(bar.point.reliableCapacityPct)}</strong><small>{bar.point.reviewedBlocks}/{bar.point.eligibleBlocks} reviewed</small>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                {calendar.rows.length === 0 ? <div className="team-gantt-empty">No approved snapshots fall inside this horizon.</div> : null}
              </div>

              <aside className="team-gantt-detail" aria-live="polite">
                {forecastSelected && forecast.median !== null && forecast.min !== null && forecast.max !== null ? (
                  <><span className="team-card-kicker">Forward look · team aggregate</span><h3>{Math.round(forecast.median)}% reliable capacity</h3><p className="team-gantt-range">Expected range <strong>{Math.round(forecast.min)}–{Math.round(forecast.max)}%</strong></p><dl><div><dt>Coverage</dt><dd>{forecast.sharedCount}/{forecast.memberCount}</dd></div><div><dt>History used</dt><dd>{forecast.weekCount} weeks</dd></div><div><dt>Forecast type</dt><dd>Team median</dd></div></dl><p>Derived from approved summary history only. Prototype heuristic, not a commitment.</p></>
                ) : selectedPoint ? (
                  <><span className="team-card-kicker">Approved snapshot · {selectedPoint.weekId}</span><h3>{selectedPoint.displayName}</h3><dl><div><dt>Reliable capacity</dt><dd>{formatMetric(selectedPoint.reliableCapacityPct)}</dd></div><div><dt>Reactive load</dt><dd>{formatMetric(selectedPoint.reactivePct)}</dd></div><div><dt>Meetings</dt><dd>{formatMetric(selectedPoint.meetingPct)}</dd></div><div><dt>Fragmented work</dt><dd>{formatMetric(selectedPoint.fragmentedPct)}</dd></div><div><dt>Review coverage</dt><dd>{selectedPoint.reviewedBlocks}/{selectedPoint.eligibleBlocks}</dd></div></dl><p>Synced {new Date(selectedPoint.syncedAt).toLocaleString()}</p></>
                ) : (
                  <><ShieldCheck size={20} aria-hidden /><h3>Select a calendar bar</h3><p>Inspect approved metrics or the team-level forecast. Empty days stay unknown.</p><div className="team-gantt-trust"><span>Weekly summaries</span><span>No raw activity</span><span>No ranking</span></div></>
                )}
              </aside>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
