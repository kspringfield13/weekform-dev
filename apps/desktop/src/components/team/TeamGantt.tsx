import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CalendarRange,
  ChartNoAxesGantt,
  Crosshair,
  Maximize2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  buildTeamCalendar,
  buildTeamCalendarWeeks,
  buildTeamTimelineCapacityForecast,
  type TeamCalendarWeek,
  type TeamTimelineIdentity,
  type TeamTimelinePoint,
  type TeamTimelineZoom,
} from "../../../../../packages/inference/src/teamTimeline";

const ZOOM_LABELS: Array<{ id: TeamTimelineZoom; label: string }> = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
];

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const METRIC_LANES = [
  { key: "reliableCapacityPct", label: "Reliable capacity", tone: "capacity" },
  { key: "reactivePct", label: "Reactive load", tone: "reactive" },
  { key: "meetingPct", label: "Meetings", tone: "meetings" },
  { key: "fragmentedPct", label: "Fragmented work", tone: "fragmented" },
] as const;

function formatMetric(value: number | null): string {
  return value === null ? "Not shared" : `${Math.round(value)}%`;
}

function weekRangeLabel(week: TeamCalendarWeek): string {
  const visible = week.days.filter((day) => day !== null);
  const first = visible[0];
  const last = visible[visible.length - 1];
  if (!first || !last) return week.weekId.replace("-", " ");
  if (first.monthLabel === last.monthLabel) return `${first.monthLabel} ${first.dayLabel}–${last.dayLabel}`;
  return `${first.monthLabel} ${first.dayLabel}–${last.monthLabel} ${last.dayLabel}`;
}

function CalendarInspector({
  forecast,
  forecastSelected,
  selectedPoint,
  selectedWeek,
}: {
  forecast: ReturnType<typeof buildTeamTimelineCapacityForecast>;
  forecastSelected: boolean;
  selectedPoint: TeamTimelinePoint | null;
  selectedWeek: TeamCalendarWeek | null;
}) {
  if (forecastSelected && forecast.median !== null && forecast.min !== null && forecast.max !== null) {
    return <><span className="team-card-kicker">Forward look · team aggregate</span><h3>{Math.round(forecast.median)}% reliable capacity</h3><p className="team-gantt-range">Expected range <strong>{Math.round(forecast.min)}–{Math.round(forecast.max)}%</strong></p><dl><div><dt>Coverage</dt><dd>{forecast.sharedCount}/{forecast.memberCount}</dd></div><div><dt>History used</dt><dd>{forecast.weekCount} weeks</dd></div><div><dt>Forecast type</dt><dd>Team median</dd></div></dl><p>Derived from approved summary history only. Prototype heuristic, not a commitment.</p></>;
  }
  if (selectedPoint) {
    return <><span className="team-card-kicker">Approved snapshot · {selectedPoint.weekId}</span><h3>{selectedPoint.displayName}</h3><dl><div><dt>Reliable capacity</dt><dd>{formatMetric(selectedPoint.reliableCapacityPct)}</dd></div><div><dt>Reactive load</dt><dd>{formatMetric(selectedPoint.reactivePct)}</dd></div><div><dt>Meetings</dt><dd>{formatMetric(selectedPoint.meetingPct)}</dd></div><div><dt>Fragmented work</dt><dd>{formatMetric(selectedPoint.fragmentedPct)}</dd></div><div><dt>Review coverage</dt><dd>{selectedPoint.reviewedBlocks}/{selectedPoint.eligibleBlocks}</dd></div></dl><p>Synced {new Date(selectedPoint.syncedAt).toLocaleString()}</p></>;
  }
  if (selectedWeek) {
    return <><span className="team-card-kicker">Team pattern · {selectedWeek.weekId}</span><h3>{weekRangeLabel(selectedWeek)}</h3><dl><div><dt>Reliable capacity</dt><dd>{formatMetric(selectedWeek.reliableCapacityPct)}</dd></div><div><dt>Reactive load</dt><dd>{formatMetric(selectedWeek.reactivePct)}</dd></div><div><dt>Meetings</dt><dd>{formatMetric(selectedWeek.meetingPct)}</dd></div><div><dt>Fragmented work</dt><dd>{formatMetric(selectedWeek.fragmentedPct)}</dd></div><div><dt>Approved coverage</dt><dd>{selectedWeek.sharedCount} shared</dd></div><div><dt>Review coverage</dt><dd>{selectedWeek.reviewedBlocks}/{selectedWeek.eligibleBlocks}</dd></div></dl><p>Team medians from approved weekly summaries. Unknown values are excluded, never treated as zero.</p></>;
  }
  return <><ShieldCheck size={20} aria-hidden /><h3>Inspect a week</h3><p>Select an approved summary in the calendar or a runway segment to understand the workload pattern.</p><div className="team-gantt-trust"><span>Weekly summaries</span><span>No raw activity</span><span>No ranking</span></div></>;
}

export function TeamGantt({
  anchorWeekId,
  identities,
  points,
  teamRole,
}: {
  anchorWeekId: string;
  identities: TeamTimelineIdentity[];
  points: TeamTimelinePoint[];
  teamRole: "member" | "manager";
}) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<TeamTimelineZoom>("month");
  const [selectedPoint, setSelectedPoint] = useState<TeamTimelinePoint | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [forecastSelected, setForecastSelected] = useState(false);
  const [todayIso] = useState(() => new Date().toISOString());
  const launchRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const calendar = useMemo(() => buildTeamCalendar(points, todayIso, zoom, identities), [identities, points, todayIso, zoom]);
  const weeks = useMemo(() => buildTeamCalendarWeeks(calendar), [calendar]);
  const forecast = useMemo(() => buildTeamTimelineCapacityForecast(points, identities.length, todayIso), [identities.length, points, todayIso]);
  const selectedWeek = weeks.find((week) => week.weekId === selectedWeekId) ?? null;
  const forecastStartWeekId = calendar.days[calendar.forecastStartIndex]?.weekId ?? null;
  const forecastRunwayWeekId = weeks.find((week) => {
    const visibleDays = week.days.filter((day) => day !== null);
    return visibleDays.length > 0 && visibleDays.every((day) => day.kind === "forecast");
  })?.weekId ?? forecastStartWeekId;
  const runwayStyle = { gridTemplateColumns: `minmax(132px, 0.9fr) repeat(${weeks.length}, minmax(${zoom === "quarter" ? 78 : 96}px, 1fr))` };

  const scrollToToday = useCallback(() => {
    const viewport = scrollRef.current;
    const today = viewport?.querySelector<HTMLElement>("[data-today-marker='true']");
    if (!viewport || !today) return;
    const viewportTop = viewport.getBoundingClientRect().top;
    const todayTop = today.getBoundingClientRect().top;
    viewport.scrollTo({ top: Math.max(0, viewport.scrollTop + todayTop - viewportTop - 86), behavior: "smooth" });
  }, []);

  const selectPoint = (point: TeamTimelinePoint) => {
    setSelectedPoint(point);
    setSelectedWeekId(null);
    setForecastSelected(false);
  };

  const selectWeek = (weekId: string) => {
    setSelectedWeekId(weekId);
    setSelectedPoint(null);
    setForecastSelected(false);
  };

  const selectForecast = () => {
    setForecastSelected(true);
    setSelectedPoint(null);
    setSelectedWeekId(null);
  };

  useEffect(() => {
    if (!open) return;
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : launchRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", handleKeyDown); returnFocusTo?.focus(); };
  }, [open]);

  useEffect(() => {
    const scrollRevision = open ? zoom : null;
    if (scrollRevision === null) return;
    const frame = window.requestAnimationFrame(scrollToToday);
    return () => window.cancelAnimationFrame(frame);
  }, [open, scrollToToday, zoom]);

  return <>
    <section className="team-gantt-launch">
      <div className="team-gantt-launch-visual" aria-hidden="true"><span /><span /><span /><span /><i /></div>
      <div><span className="team-card-kicker">Workload calendar</span><h2>See the week before you commit it</h2><p>Calendar context, approved workload signals, and a planning runway—without ranking people.</p></div>
      <button ref={launchRef} className="primary-action" type="button" onClick={() => setOpen(true)}><CalendarRange size={16} aria-hidden /> Open calendar <Maximize2 size={14} aria-hidden /></button>
    </section>

    {open ? <div className="team-gantt-overlay" role="dialog" aria-modal="true" aria-labelledby="desktop-team-gantt-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section ref={dialogRef} className="team-gantt-dialog">
        <header className="team-gantt-header">
          <div><span className="team-card-kicker">{teamRole === "manager" ? "Team-wide approved signals" : "Your approved signals"} · through {anchorWeekId}</span><h2 id="desktop-team-gantt-title">Team workload calendar</h2><p>A real calendar for weekly evidence, with team-level workload analytics below.</p></div>
          <div className="team-gantt-header-actions">
            <button className="team-gantt-today" type="button" onClick={scrollToToday}><Crosshair size={14} aria-hidden />Today</button>
            <div className="team-gantt-zoom" role="group" aria-label="Calendar time scale">{ZOOM_LABELS.map(({ id, label }) => <button key={id} className={zoom === id ? "is-active" : ""} type="button" aria-pressed={zoom === id} onClick={() => { setZoom(id); setSelectedPoint(null); setSelectedWeekId(null); setForecastSelected(false); }}>{label}</button>)}</div>
            <button ref={closeRef} className="team-gantt-close" type="button" aria-label="Close calendar" onClick={() => setOpen(false)}><X size={17} aria-hidden /></button>
          </div>
        </header>

        <div className="team-gantt-legend" role="group" aria-label="Calendar legend"><span><i className="is-observed" />Observed history</span><span><i className="is-today" />Today</span><span><i className="is-forecast" />Forecast window</span><span><i className="is-unknown" />Not shared</span><em>{calendar.todayIndex + 1} days through today · 7-day forecast window</em></div>

        <div className="team-gantt-body">
          <main ref={scrollRef} className={`team-gantt-scroll is-${zoom}`} role="region" tabIndex={0} aria-label="Scrollable team workload calendar">
            <section className="team-gantt-calendar-panel" aria-labelledby="team-calendar-panel-title">
              <div className="team-gantt-panel-heading"><div><span className="team-card-kicker"><CalendarDays size={13} aria-hidden /> Calendar</span><h3 id="team-calendar-panel-title">Approved workload by week</h3></div><p>Summaries sit on their real ISO week. Daily cells provide context; they do not imply daily observation.</p></div>
              <div className="team-gantt-weekdays" aria-hidden="true">{WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
              <div className="team-gantt-calendar-weeks">
                {weeks.map((week) => <article className={`team-gantt-calendar-week${week.hasToday ? " is-current" : ""}${week.hasForecast ? " has-forecast" : ""}`} key={week.weekId}>
                  <div className="team-gantt-calendar-days">
                    {WEEKDAY_LABELS.map((weekdayLabel, index) => { const day = week.days[index]; return day ? <div className={`team-gantt-calendar-day is-${day.kind}${day.isWeekend ? " is-weekend" : ""}`} data-today-marker={day.kind === "today" ? "true" : undefined} key={day.dateId} title={day.dateId}><span>{day.monthLabel}</span><strong>{day.dayLabel}</strong>{day.kind === "today" ? <em>Today</em> : null}</div> : <div className="team-gantt-calendar-day is-outside" key={`${week.weekId}:${weekdayLabel}`} />; })}
                  </div>
                  <div className="team-gantt-week-band">
                    <div className="team-gantt-week-meta"><strong>{week.weekId.replace("-", " ")}</strong><span>{weekRangeLabel(week)}</span></div>
                    <div className="team-gantt-week-events">
                      {week.points.slice(0, zoom === "quarter" ? 2 : 4).map((point) => <button className={`team-gantt-week-event${selectedPoint === point ? " is-selected" : ""}`} type="button" key={`${point.userId}:${point.weekId}`} onClick={() => selectPoint(point)} aria-label={`${point.displayName}, ${point.weekId}, reliable capacity ${formatMetric(point.reliableCapacityPct)}`}><span>{point.displayName}</span><strong>{formatMetric(point.reliableCapacityPct)}</strong><small>{point.reviewedBlocks}/{point.eligibleBlocks} reviewed</small></button>)}
                      {week.points.length > (zoom === "quarter" ? 2 : 4) ? <span className="team-gantt-event-overflow">+{week.points.length - (zoom === "quarter" ? 2 : 4)} summaries</span> : null}
                      {week.points.length === 0 && !(week.hasForecast && week.weekId === forecastStartWeekId) ? <span className="team-gantt-week-empty">No approved summary</span> : null}
                      {teamRole === "manager" && week.hasForecast && week.weekId === forecastStartWeekId ? (forecast.verdict === "forecast" && forecast.median !== null && forecast.min !== null && forecast.max !== null ? <button className={`team-gantt-week-event is-forecast${forecastSelected ? " is-selected" : ""}`} type="button" onClick={selectForecast}><span><Sparkles size={12} aria-hidden /> Team forecast</span><strong>{Math.round(forecast.median)}%</strong><small>{Math.round(forecast.min)}–{Math.round(forecast.max)}% range</small></button> : <span className="team-gantt-week-empty is-forecast">Forecast withheld · insufficient coverage</span>) : null}
                    </div>
                  </div>
                </article>)}
              </div>
            </section>

            <section className="team-gantt-runway" aria-labelledby="team-runway-title">
              <div className="team-gantt-panel-heading"><div><span className="team-card-kicker"><ChartNoAxesGantt size={13} aria-hidden /> Analytics</span><h3 id="team-runway-title">Workload runway</h3></div><p>Team medians across approved summaries. Select a segment for evidence and coverage.</p></div>
              <div className="team-gantt-runway-scroll">
                <div className="team-gantt-runway-grid" style={runwayStyle}>
                  <div className="team-gantt-runway-corner">Signal</div>{weeks.map((week) => <div className={`team-gantt-runway-week${week.hasToday ? " is-current" : ""}`} key={`head:${week.weekId}`}><strong>{week.weekId.replace(/^\d{4}-/, "")}</strong><span>{weekRangeLabel(week)}</span></div>)}
                  {METRIC_LANES.map((lane) => <div className={`team-gantt-runway-row is-${lane.tone}`} key={lane.key} style={runwayStyle}><div className="team-gantt-runway-label"><span>{lane.label}</span><small>Team median</small></div>{weeks.map((week) => { const value = week[lane.key]; const isForecastCell = lane.key === "reliableCapacityPct" && week.weekId === forecastRunwayWeekId && forecast.verdict === "forecast" && forecast.median !== null; const shownValue = isForecastCell ? forecast.median : value; return <button className={`team-gantt-runway-cell${shownValue === null ? " is-empty" : ""}${isForecastCell ? " is-forecast" : ""}${selectedWeekId === week.weekId ? " is-selected" : ""}`} type="button" key={`${lane.key}:${week.weekId}`} onClick={() => isForecastCell ? selectForecast() : selectWeek(week.weekId)} aria-label={`${lane.label}, ${week.weekId}, ${formatMetric(shownValue)}`}><span style={{ width: `${Math.max(0, Math.min(100, shownValue ?? 0))}%` }} /><strong>{formatMetric(shownValue)}</strong></button>; })}</div>)}
                </div>
              </div>
            </section>
          </main>

          <aside className="team-gantt-detail" aria-live="polite"><CalendarInspector forecast={forecast} forecastSelected={forecastSelected} selectedPoint={selectedPoint} selectedWeek={selectedWeek} /></aside>
        </div>
      </section>
    </div> : null}
  </>;
}
