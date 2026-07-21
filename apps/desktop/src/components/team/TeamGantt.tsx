import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CalendarRange,
  ChartNoAxesGantt,
  CheckCircle2,
  Crosshair,
  LockKeyhole,
  Mail,
  Maximize2,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  buildTeamCalendar,
  buildTeamCalendarWeeks,
  buildTeamTimelineCapacityForecast,
  defaultTeamCalendarEvidenceDate,
  type TeamCalendarEvidenceDay,
  type TeamCalendarWeek,
  type TeamTimelineIdentity,
  type TeamTimelinePoint,
  type TeamTimelineZoom,
} from "../../../../../packages/inference/src/teamTimeline";

type TeamEvidenceSourceStatus = "connected" | "imported" | "not-connected" | "unavailable";

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

function formatMinutes(value: number): string {
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function evidenceInsightLabel(insight: TeamCalendarEvidenceDay["insight"]): string | null {
  if (insight === "blended-pressure") return "Meeting + communication pressure";
  if (insight === "meeting-dense") return "Meeting-dense day";
  if (insight === "communication-burst") return "Communication burst";
  return null;
}

function CalendarInspector({
  forecast,
  forecastSelected,
  selectedEvidence,
  selectedPoint,
  selectedWeek,
}: {
  forecast: ReturnType<typeof buildTeamTimelineCapacityForecast>;
  forecastSelected: boolean;
  selectedEvidence: TeamCalendarEvidenceDay | null;
  selectedPoint: TeamTimelinePoint | null;
  selectedWeek: TeamCalendarWeek | null;
}) {
  if (forecastSelected && forecast.median !== null && forecast.min !== null && forecast.max !== null) {
    return <><span className="team-card-kicker">Forward look · team aggregate</span><h3>{Math.round(forecast.median)}% reliable capacity</h3><p className="team-gantt-range">Expected range <strong>{Math.round(forecast.min)}–{Math.round(forecast.max)}%</strong></p><dl><div><dt>Coverage</dt><dd>{forecast.sharedCount}/{forecast.memberCount}</dd></div><div><dt>History used</dt><dd>{forecast.weekCount} weeks</dd></div><div><dt>Forecast type</dt><dd>Team median</dd></div></dl><p>Derived from approved summary history only. Prototype heuristic, not a commitment.</p></>;
  }
  if (selectedEvidence) {
    const insight = evidenceInsightLabel(selectedEvidence.insight);
    return <><span className="team-card-kicker">Private connected facts · {selectedEvidence.dateId}</span><h3>{insight ?? "Reviewed activity context"}</h3><dl><div><dt>Calendar</dt><dd>{selectedEvidence.calendarEventCount ? `${selectedEvidence.calendarEventCount} · ${formatMinutes(selectedEvidence.calendarMinutes)}` : "No event fact"}</dd></div><div><dt>Chat episodes</dt><dd>{selectedEvidence.chatEpisodeCount || "No episode fact"}</dd></div><div><dt>Directed triggers</dt><dd>{selectedEvidence.directedChatCount || "None observed"}</dd></div><div><dt>Reviewed blocks</dt><dd>{selectedEvidence.reviewedBlockCount || "None reviewed"}</dd></div></dl><p>Counts and unioned time only. Titles, people, message content, and provider identifiers stay out of this view and are never added to the team snapshot.</p></>;
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
  evidence,
  identities,
  points,
  sourceStatus,
  teamRole,
}: {
  anchorWeekId: string;
  evidence: TeamCalendarEvidenceDay[];
  identities: TeamTimelineIdentity[];
  points: TeamTimelinePoint[];
  sourceStatus: { calendar: TeamEvidenceSourceStatus; chat: TeamEvidenceSourceStatus; email: TeamEvidenceSourceStatus };
  teamRole: "member" | "manager";
}) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<TeamTimelineZoom>("month");
  const [selectedPoint, setSelectedPoint] = useState<TeamTimelinePoint | null>(null);
  const [selectedEvidenceDate, setSelectedEvidenceDate] = useState<string | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [forecastSelected, setForecastSelected] = useState(false);
  const [todayIso] = useState(() => new Date().toISOString());
  const launchRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const calendar = useMemo(() => buildTeamCalendar(points, todayIso, zoom, identities), [identities, points, todayIso, zoom]);
  const weeks = useMemo(() => buildTeamCalendarWeeks(calendar), [calendar]);
  const evidenceByDate = useMemo(() => new Map(evidence.map((day) => [day.dateId, day])), [evidence]);
  const defaultEvidenceDate = useMemo(() => defaultTeamCalendarEvidenceDate(evidence, todayIso), [evidence, todayIso]);
  const selectedEvidence = selectedEvidenceDate ? evidenceByDate.get(selectedEvidenceDate) ?? null : null;
  const evidenceTotals = useMemo(() => evidence.reduce((totals, day) => ({
    calendarEvents: totals.calendarEvents + day.calendarEventCount,
    calendarMinutes: totals.calendarMinutes + day.calendarMinutes,
    chatEpisodes: totals.chatEpisodes + day.chatEpisodeCount,
    reviewedBlocks: totals.reviewedBlocks + day.reviewedBlockCount,
  }), { calendarEvents: 0, calendarMinutes: 0, chatEpisodes: 0, reviewedBlocks: 0 }), [evidence]);
  const weeklyEvidence = useMemo(() => weeks.map((week) => {
    const days = week.days.flatMap((day) => day ? [evidenceByDate.get(day.dateId)].filter((value): value is TeamCalendarEvidenceDay => Boolean(value)) : []);
    return {
      weekId: week.weekId,
      days,
      calendarEvents: days.reduce((total, day) => total + day.calendarEventCount, 0),
      calendarMinutes: days.reduce((total, day) => total + day.calendarMinutes, 0),
      chatEpisodes: days.reduce((total, day) => total + day.chatEpisodeCount, 0),
      reviewedBlocks: days.reduce((total, day) => total + day.reviewedBlockCount, 0),
      pressureDays: days.filter((day) => day.insight !== null).length,
    };
  }), [evidenceByDate, weeks]);
  const maxWeeklyCalendarMinutes = Math.max(1, ...weeklyEvidence.map((week) => week.calendarMinutes));
  const maxWeeklyChatEpisodes = Math.max(1, ...weeklyEvidence.map((week) => week.chatEpisodes));
  const forecast = useMemo(() => buildTeamTimelineCapacityForecast(points, identities.length, todayIso), [identities.length, points, todayIso]);
  const selectedWeek = weeks.find((week) => week.weekId === selectedWeekId) ?? null;
  const forecastStartWeekId = calendar.days[calendar.forecastStartIndex]?.weekId ?? null;
  const forecastRunwayWeekId = weeks.find((week) => {
    const visibleDays = week.days.filter((day) => day !== null);
    return visibleDays.length > 0 && visibleDays.every((day) => day.kind === "forecast");
  })?.weekId ?? forecastStartWeekId;
  const runwayStyle = { gridTemplateColumns: `minmax(132px, 0.9fr) repeat(${weeks.length}, minmax(${zoom === "quarter" ? 78 : 96}px, 1fr))` };
  const activePressureDays = evidence.filter((day) => day.insight !== null).length;

  const scrollToToday = useCallback((revealDay = true) => {
    const viewport = scrollRef.current;
    const today = viewport?.querySelector<HTMLElement>("[data-today-marker='true']");
    if (!viewport || !today) return;
    const viewportTop = viewport.getBoundingClientRect().top;
    const todayTop = today.getBoundingClientRect().top;
    viewport.scrollTo({
      top: revealDay ? Math.max(0, viewport.scrollTop + todayTop - viewportTop - 106) : 0,
      behavior: "smooth",
    });
    for (const target of viewport.querySelectorAll<HTMLElement>("[data-anchor-week='true']")) {
      let scroller = target.parentElement;
      while (scroller && scroller !== viewport && scroller.scrollWidth <= scroller.clientWidth) {
        scroller = scroller.parentElement;
      }
      if (!scroller || scroller === viewport || scroller.scrollWidth <= scroller.clientWidth) continue;
      scroller.scrollTo({
        left: Math.max(0, target.offsetLeft - ((scroller.clientWidth - target.offsetWidth) / 2)),
        behavior: "smooth",
      });
    }
  }, []);

  const selectPoint = (point: TeamTimelinePoint) => {
    setSelectedPoint(point);
    setSelectedEvidenceDate(null);
    setSelectedWeekId(null);
    setForecastSelected(false);
  };

  const selectWeek = (weekId: string) => {
    setSelectedWeekId(weekId);
    setSelectedPoint(null);
    setSelectedEvidenceDate(null);
    setForecastSelected(false);
  };

  const selectForecast = () => {
    setForecastSelected(true);
    setSelectedPoint(null);
    setSelectedEvidenceDate(null);
    setSelectedWeekId(null);
  };

  const selectEvidence = (dateId: string) => {
    setSelectedEvidenceDate(dateId);
    setSelectedPoint(null);
    setSelectedWeekId(null);
    setForecastSelected(false);
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
    const frame = window.requestAnimationFrame(() => scrollToToday(false));
    return () => window.cancelAnimationFrame(frame);
  }, [open, scrollToToday, zoom]);

  useEffect(() => {
    if (!open || selectedEvidenceDate || selectedPoint || selectedWeekId || forecastSelected) return;
    setSelectedEvidenceDate(defaultEvidenceDate);
  }, [defaultEvidenceDate, forecastSelected, open, selectedEvidenceDate, selectedPoint, selectedWeekId]);

  return <>
    <section className="team-gantt-launch">
      <div className="team-gantt-launch-visual" aria-hidden="true"><span /><span /><span /><span /><i /></div>
      <div><span className="team-card-kicker">Integrated workload calendar</span><h2>See the facts behind the week</h2><p>Private Calendar and Chat context meets approved team signals and a planning runway—without ranking people.</p></div>
      <button ref={launchRef} className="primary-action" type="button" onClick={() => setOpen(true)}><CalendarRange size={16} aria-hidden /> Open calendar <Maximize2 size={14} aria-hidden /></button>
    </section>

    {open ? <div className="team-gantt-overlay" role="dialog" aria-modal="true" aria-labelledby="desktop-team-gantt-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section ref={dialogRef} className="team-gantt-dialog">
        <header className="team-gantt-header">
          <div><span className="team-card-kicker">{teamRole === "manager" ? "Team-wide approved signals" : "Your approved signals"} · through {anchorWeekId}</span><h2 id="desktop-team-gantt-title">Team workload calendar</h2><p>Daily connected facts stay private to you; approved weekly summaries form the shared team layer.</p></div>
          <div className="team-gantt-header-actions">
            <button className="team-gantt-today" type="button" onClick={() => { scrollToToday(); if (evidenceByDate.has(todayIso.slice(0, 10))) selectEvidence(todayIso.slice(0, 10)); }}><Crosshair size={14} aria-hidden />Today</button>
            <div className="team-gantt-zoom" role="group" aria-label="Calendar time scale">{ZOOM_LABELS.map(({ id, label }) => <button key={id} className={zoom === id ? "is-active" : ""} type="button" aria-pressed={zoom === id} onClick={() => setZoom(id)}>{label}</button>)}</div>
            <button ref={closeRef} className="team-gantt-close" type="button" aria-label="Close calendar" onClick={() => setOpen(false)}><X size={17} aria-hidden /></button>
          </div>
        </header>

        <div className="team-gantt-legend" role="group" aria-label="Calendar legend"><span><i className="is-observed" />Observed history</span><span><i className="is-calendar" />Calendar fact</span><span><i className="is-chat" />Chat fact</span><span><i className="is-reviewed" />Reviewed fact</span><span><i className="is-today" />Today</span><span><i className="is-forecast" />Forecast window</span><em>{calendar.todayIndex + 1} days through today · 7-day forecast</em></div>

        <div className="team-gantt-body">
          <main ref={scrollRef} className={`team-gantt-scroll is-${zoom}`} role="region" tabIndex={0} aria-label="Scrollable team workload calendar">
            <section className="team-gantt-flight-strip" aria-label="Workload signal summary">
              <div className="team-gantt-flight-intro"><span className="team-card-kicker">Live evidence horizon</span><strong>{activePressureDays ? `${activePressureDays} pressure ${activePressureDays === 1 ? "day" : "days"} surfaced` : "A calm evidence horizon"}</strong><small>Select any active date to inspect the facts.</small></div>
              <div className={`team-gantt-flight-stat is-calendar is-${sourceStatus.calendar}`}><CalendarDays size={16} aria-hidden /><span><strong>{evidenceTotals.calendarEvents}</strong><small>Calendar events</small></span><em>{formatMinutes(evidenceTotals.calendarMinutes)}</em></div>
              <div className={`team-gantt-flight-stat is-chat is-${sourceStatus.chat}`}><MessageSquareText size={16} aria-hidden /><span><strong>{evidenceTotals.chatEpisodes}</strong><small>Chat episodes</small></span><em>metadata only</em></div>
              <div className="team-gantt-flight-stat is-reviewed"><CheckCircle2 size={16} aria-hidden /><span><strong>{evidenceTotals.reviewedBlocks}</strong><small>Reviewed blocks</small></span><em>correctable truth</em></div>
              <div className="team-gantt-flight-privacy"><LockKeyhole size={14} aria-hidden /><span><strong>Private by design</strong><small>Daily facts never enter team sync</small></span><span className="team-gantt-email-state"><Mail size={11} aria-hidden /> Email unavailable</span></div>
            </section>
            <section className="team-gantt-calendar-panel" aria-labelledby="team-calendar-panel-title">
              <div className="team-gantt-panel-heading"><div><span className="team-card-kicker"><CalendarDays size={13} aria-hidden /> Workload field</span><h3 id="team-calendar-panel-title">Your month, with the signal turned on</h3></div><p><strong>Daily:</strong> private connected facts · <strong>Weekly:</strong> approved team context</p></div>
              <div className="team-gantt-weekdays" aria-hidden="true">{WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
              <div className="team-gantt-calendar-weeks">
                {weeks.map((week) => <article className={`team-gantt-calendar-week${week.hasToday ? " is-current" : ""}${week.hasForecast ? " has-forecast" : ""}`} key={week.weekId}>
                  <div className="team-gantt-calendar-days">
                    {WEEKDAY_LABELS.map((weekdayLabel, index) => {
                      const day = week.days[index];
                      if (!day) return <div className="team-gantt-calendar-day is-outside" key={`${week.weekId}:${weekdayLabel}`} />;
                      const dayEvidence = evidenceByDate.get(day.dateId);
                      return <button
                        className={`team-gantt-calendar-day is-${day.kind}${day.isWeekend ? " is-weekend" : ""}${selectedEvidenceDate === day.dateId ? " is-selected" : ""}`}
                        data-today-marker={day.kind === "today" ? "true" : undefined}
                        disabled={!dayEvidence}
                        key={day.dateId}
                        onClick={() => dayEvidence && selectEvidence(day.dateId)}
                        title={dayEvidence ? `Inspect connected facts for ${day.dateId}` : day.dateId}
                        type="button"
                      >
                        <span>{day.monthLabel}</span><strong>{day.dayLabel}</strong>
                        {dayEvidence ? <span className="team-gantt-day-facts" aria-label={`${dayEvidence.calendarEventCount} calendar events, ${dayEvidence.chatEpisodeCount} chat episodes, ${dayEvidence.reviewedBlockCount} reviewed blocks`}>
                          {dayEvidence.calendarEventCount > 0 ? <i className="is-calendar" title={`${dayEvidence.calendarEventCount} calendar events, ${formatMinutes(dayEvidence.calendarMinutes)}`}><CalendarDays size={10} aria-hidden /><b>{dayEvidence.calendarEventCount}</b><small>{formatMinutes(dayEvidence.calendarMinutes)}</small></i> : null}
                          {dayEvidence.chatEpisodeCount > 0 ? <i className="is-chat" title={`${dayEvidence.chatEpisodeCount} observed chat episodes`}><MessageSquareText size={10} aria-hidden /><b>{dayEvidence.chatEpisodeCount}</b></i> : null}
                          {dayEvidence.reviewedBlockCount > 0 ? <i className="is-reviewed" title={`${dayEvidence.reviewedBlockCount} reviewed work blocks`}><CheckCircle2 size={10} aria-hidden /><b>{dayEvidence.reviewedBlockCount}</b></i> : null}
                        </span> : null}
                        {dayEvidence?.insight ? <small className={`team-gantt-day-insight is-${dayEvidence.insight}`} title={evidenceInsightLabel(dayEvidence.insight) ?? undefined}><i />{evidenceInsightLabel(dayEvidence.insight)}</small> : null}
                        {day.kind === "today" ? <em>Today</em> : null}
                      </button>;
                    })}
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

            <section className="team-gantt-activity" aria-labelledby="team-connected-activity-title">
              <div className="team-gantt-rhythm-heading"><div><span className="team-card-kicker"><MessageSquareText size={13} aria-hidden /> Evidence rhythm</span><h3 id="team-connected-activity-title">How the horizon changes week to week</h3></div><div className="team-gantt-rhythm-key"><span className="is-calendar">Calendar</span><span className="is-chat">Chat</span></div></div>
              <div className="team-gantt-activity-grid">
                {weeklyEvidence.map((week) => {
                  const firstEvidence = week.days[0];
                  return <button className={`team-gantt-activity-week${week.pressureDays ? " has-pressure" : ""}`} data-anchor-week={week.weekId === anchorWeekId ? "true" : undefined} disabled={!firstEvidence} key={week.weekId} onClick={() => firstEvidence && selectEvidence(firstEvidence.dateId)} type="button">
                    <span className="team-gantt-activity-week-label">{week.weekId.replace(/^\d{4}-/, "")}</span>
                    <div className="team-gantt-activity-track is-calendar"><span style={{ width: `${(week.calendarMinutes / maxWeeklyCalendarMinutes) * 100}%` }} /><strong>{week.calendarEvents ? `${week.calendarEvents} cal · ${formatMinutes(week.calendarMinutes)}` : "No calendar fact"}</strong></div>
                    <div className="team-gantt-activity-track is-chat"><span style={{ width: `${(week.chatEpisodes / maxWeeklyChatEpisodes) * 100}%` }} /><strong>{week.chatEpisodes ? `${week.chatEpisodes} chat episodes` : "No chat fact"}</strong></div>
                    <small><CheckCircle2 size={11} aria-hidden /> {week.reviewedBlocks} reviewed{week.pressureDays ? ` · ${week.pressureDays} pressure ${week.pressureDays === 1 ? "day" : "days"}` : ""}</small>
                  </button>;
                })}
              </div>
            </section>

            <section className="team-gantt-runway" aria-labelledby="team-runway-title">
              <div className="team-gantt-panel-heading"><div><span className="team-card-kicker"><ChartNoAxesGantt size={13} aria-hidden /> Analytics</span><h3 id="team-runway-title">Workload runway</h3></div><p>Team medians across approved summaries. Select a segment for evidence and coverage.</p></div>
              <div className="team-gantt-runway-scroll">
                <div className="team-gantt-runway-grid" style={runwayStyle}>
                  <div className="team-gantt-runway-corner">Signal</div>{weeks.map((week) => <div className={`team-gantt-runway-week${week.hasToday ? " is-current" : ""}`} data-anchor-week={week.weekId === anchorWeekId ? "true" : undefined} key={`head:${week.weekId}`}><strong>{week.weekId.replace(/^\d{4}-/, "")}</strong><span>{weekRangeLabel(week)}</span></div>)}
                  {METRIC_LANES.map((lane) => <div className={`team-gantt-runway-row is-${lane.tone}`} key={lane.key} style={runwayStyle}><div className="team-gantt-runway-label"><span>{lane.label}</span><small>Team median</small></div>{weeks.map((week) => { const value = week[lane.key]; const isForecastCell = lane.key === "reliableCapacityPct" && week.weekId === forecastRunwayWeekId && forecast.verdict === "forecast" && forecast.median !== null; const shownValue = isForecastCell ? forecast.median : value; return <button className={`team-gantt-runway-cell${shownValue === null ? " is-empty" : ""}${isForecastCell ? " is-forecast" : ""}${selectedWeekId === week.weekId ? " is-selected" : ""}`} type="button" key={`${lane.key}:${week.weekId}`} onClick={() => isForecastCell ? selectForecast() : selectWeek(week.weekId)} aria-label={`${lane.label}, ${week.weekId}, ${formatMetric(shownValue)}`}><span style={{ width: `${Math.max(0, Math.min(100, shownValue ?? 0))}%` }} /><strong>{formatMetric(shownValue)}</strong></button>; })}</div>)}
                </div>
              </div>
            </section>
          </main>

          <aside className="team-gantt-detail" aria-live="polite"><CalendarInspector forecast={forecast} forecastSelected={forecastSelected} selectedEvidence={selectedEvidence} selectedPoint={selectedPoint} selectedWeek={selectedWeek} /></aside>
        </div>
      </section>
    </div> : null}
  </>;
}
