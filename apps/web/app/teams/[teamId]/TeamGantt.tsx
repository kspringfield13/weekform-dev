"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CalendarRange,
  ChartNoAxesGantt,
  CheckCircle2,
  Crosshair,
  LockKeyhole,
  Maximize2,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import {
  buildTeamCalendar,
  buildTeamCalendarWeeks,
  defaultTeamCalendarEvidenceDate,
  type TeamCalendarEvidenceDay,
  type TeamCalendarWeek,
  type TeamTimelinePoint,
  type TeamTimelineZoom,
} from "../../../../../packages/inference/src/teamTimeline";
import type { TeamCapacityForecast } from "@/lib/forecast";
import { formatEvidenceCount } from "@/lib/teamGanttEvidencePresentation";

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

interface TeamGanttEvidenceSources {
  calendar: string;
  chat: string;
}

const ZOOM_LABELS: Array<{ id: TeamTimelineZoom; label: string }> = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
];

const EVIDENCE_HORIZON_LABELS: Record<TeamTimelineZoom, string> = {
  week: "Your week, with the signal turned on",
  month: "Your month, with the signal turned on",
  quarter: "Your quarter, with the signal turned on",
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EMPTY_EVIDENCE: TeamCalendarEvidenceDay[] = [];
const GENERIC_EVIDENCE_SOURCES: TeamGanttEvidenceSources = { calendar: "Calendar", chat: "Chat" };

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
  const last = visible.at(-1);
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
  evidenceSources,
  selectedEvidence,
  selectedPoint,
  selectedWeek,
}: {
  forecast?: TeamCapacityForecast;
  forecastSelected: boolean;
  evidenceSources: TeamGanttEvidenceSources;
  selectedEvidence: TeamCalendarEvidenceDay | null;
  selectedPoint: TeamTimelinePoint | null;
  selectedWeek: TeamCalendarWeek | null;
}) {
  const reliableForecast = forecast?.verdict === "forecast" ? forecast.metrics.reliableCapacityPct.forecast : null;
  if (forecastSelected && reliableForecast && forecast) {
    return <><span className="team-section-kicker">Forward look · team aggregate</span><h3>{Math.round(reliableForecast.median)}% reliable capacity</h3><p className="web-team-gantt-range">Expected range <strong>{Math.round(reliableForecast.min)}–{Math.round(reliableForecast.max)}%</strong></p><dl><div><dt>Coverage</dt><dd>{forecast.sharedCount}/{forecast.memberCount}</dd></div><div><dt>History used</dt><dd>{forecast.metrics.reliableCapacityPct.weekCount} weeks</dd></div><div><dt>Forecast type</dt><dd>Team median</dd></div></dl><p>{forecast.basisLabel} Prototype heuristic, not a commitment.</p></>;
  }
  if (selectedEvidence) {
    const insight = evidenceInsightLabel(selectedEvidence.insight);
    return <><span className="team-section-kicker">Your private connected facts · {selectedEvidence.dateId}</span><h3>{insight ?? "Reviewed activity context"}</h3><dl><div><dt>{evidenceSources.calendar}</dt><dd>{selectedEvidence.calendarEventCount ? `${selectedEvidence.calendarEventCount} · ${formatMinutes(selectedEvidence.calendarMinutes)}` : "No event fact"}</dd></div><div><dt>{evidenceSources.chat} episodes</dt><dd>{selectedEvidence.chatEpisodeCount || "No episode fact"}</dd></div><div><dt>Directed triggers</dt><dd>{selectedEvidence.directedChatCount || "None observed"}</dd></div><div><dt>Reviewed blocks</dt><dd>{selectedEvidence.reviewedBlockCount || "None reviewed"}</dd></div></dl><p>Counts and unioned time only. Titles, people, message content, and connector identifiers stay out of the team snapshot.</p></>;
  }
  if (selectedPoint) {
    return <><span className="team-section-kicker">Approved snapshot · {selectedPoint.weekId}</span><h3>{selectedPoint.displayName}</h3><dl><div><dt>Reliable capacity</dt><dd>{formatMetric(selectedPoint.reliableCapacityPct)}</dd></div><div><dt>Reactive load</dt><dd>{formatMetric(selectedPoint.reactivePct)}</dd></div><div><dt>Meetings</dt><dd>{formatMetric(selectedPoint.meetingPct)}</dd></div><div><dt>Fragmented work</dt><dd>{formatMetric(selectedPoint.fragmentedPct)}</dd></div><div><dt>Review coverage</dt><dd>{selectedPoint.reviewedBlocks}/{selectedPoint.eligibleBlocks}</dd></div></dl><p>Synced {new Date(selectedPoint.syncedAt).toLocaleString()}</p></>;
  }
  if (selectedWeek) {
    return <><span className="team-section-kicker">Team pattern · {selectedWeek.weekId}</span><h3>{weekRangeLabel(selectedWeek)}</h3><dl><div><dt>Reliable capacity</dt><dd>{formatMetric(selectedWeek.reliableCapacityPct)}</dd></div><div><dt>Reactive load</dt><dd>{formatMetric(selectedWeek.reactivePct)}</dd></div><div><dt>Meetings</dt><dd>{formatMetric(selectedWeek.meetingPct)}</dd></div><div><dt>Fragmented work</dt><dd>{formatMetric(selectedWeek.fragmentedPct)}</dd></div><div><dt>Approved coverage</dt><dd>{selectedWeek.sharedCount} shared</dd></div><div><dt>Review coverage</dt><dd>{selectedWeek.reviewedBlocks}/{selectedWeek.eligibleBlocks}</dd></div></dl><p>Team medians from approved weekly summaries. Unknown values are excluded, never treated as zero.</p></>;
  }
  return <><ShieldCheck aria-hidden="true" /><h3>Inspect a week</h3><p>Select an approved summary in the calendar or a runway segment to understand the workload pattern.</p><div className="web-team-gantt-trust"><span>Weekly summaries</span><span>No raw activity</span><span>No ranking</span></div></>;
}

export function TeamGantt({
  anchorWeekId,
  evidence = EMPTY_EVIDENCE,
  evidenceSources,
  forecast,
  history,
  identities,
  teamRole,
  todayIso,
  viewerId,
}: {
  anchorWeekId: string;
  evidence?: TeamCalendarEvidenceDay[];
  evidenceSources?: TeamGanttEvidenceSources;
  forecast?: TeamCapacityForecast;
  history: TeamGanttSnapshot[];
  identities: Array<{ userId: string; name: string }>;
  teamRole: "member" | "manager";
  todayIso: string;
  viewerId: string;
}) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<TeamTimelineZoom>("month");
  const [selectedPoint, setSelectedPoint] = useState<TeamTimelinePoint | null>(null);
  const [selectedEvidenceDate, setSelectedEvidenceDate] = useState<string | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [forecastSelected, setForecastSelected] = useState(false);
  const launchRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const points = useMemo<TeamTimelinePoint[]>(() => {
    const identityByUser = new Map(identities.map((identity) => [identity.userId, identity.name]));
    return history.filter((snapshot) => teamRole === "manager" || snapshot.userId === viewerId).map((snapshot) => ({
      userId: snapshot.userId,
      displayName: snapshot.userId === viewerId ? (identityByUser.get(snapshot.userId) ?? "You") : (identityByUser.get(snapshot.userId) ?? "Team member"),
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
  }, [history, identities, teamRole, viewerId]);
  const calendar = useMemo(() => buildTeamCalendar(points, todayIso, zoom, identities.map((identity) => ({ userId: identity.userId, displayName: identity.name, isSelf: identity.userId === viewerId }))), [identities, points, todayIso, viewerId, zoom]);
  const weeks = useMemo(() => buildTeamCalendarWeeks(calendar), [calendar]);
  const hasEvidence = evidence.length > 0;
  const sourceLabels = {
    calendar: evidenceSources?.calendar.trim() || GENERIC_EVIDENCE_SOURCES.calendar,
    chat: evidenceSources?.chat.trim() || GENERIC_EVIDENCE_SOURCES.chat,
  };
  const visibleDateIds = useMemo(() => new Set(calendar.days.map((day) => day.dateId)), [calendar]);
  const visibleEvidence = useMemo(() => evidence.filter((day) => visibleDateIds.has(day.dateId)), [evidence, visibleDateIds]);
  const evidenceByDate = useMemo(() => new Map(visibleEvidence.map((day) => [day.dateId, day])), [visibleEvidence]);
  const defaultEvidenceDate = useMemo(() => defaultTeamCalendarEvidenceDate(visibleEvidence, todayIso), [todayIso, visibleEvidence]);
  const selectedEvidence = selectedEvidenceDate ? evidenceByDate.get(selectedEvidenceDate) ?? null : null;
  const evidenceTotals = useMemo(() => visibleEvidence.reduce((totals, day) => ({
    calendarEvents: totals.calendarEvents + day.calendarEventCount,
    calendarMinutes: totals.calendarMinutes + day.calendarMinutes,
    chatEpisodes: totals.chatEpisodes + day.chatEpisodeCount,
    reviewedBlocks: totals.reviewedBlocks + day.reviewedBlockCount,
  }), { calendarEvents: 0, calendarMinutes: 0, chatEpisodes: 0, reviewedBlocks: 0 }), [visibleEvidence]);
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
  const selectedWeek = weeks.find((week) => week.weekId === selectedWeekId) ?? null;
  const reliableForecast = forecast?.verdict === "forecast" ? forecast.metrics.reliableCapacityPct.forecast : null;
  const forecastStartWeekId = calendar.days[calendar.forecastStartIndex]?.weekId ?? null;
  const forecastRunwayWeekId = weeks.find((week) => {
    const visibleDays = week.days.filter((day) => day !== null);
    return visibleDays.length > 0 && visibleDays.every((day) => day.kind === "forecast");
  })?.weekId ?? forecastStartWeekId;
  const runwayStyle = { gridTemplateColumns: `minmax(138px, 0.9fr) repeat(${weeks.length}, minmax(${zoom === "quarter" ? 80 : 100}px, 1fr))` };
  const activePressureDays = visibleEvidence.filter((day) => day.insight !== null).length;

  const scrollToToday = useCallback(() => {
    const viewport = scrollRef.current;
    const today = viewport?.querySelector<HTMLElement>("[data-today-marker='true']");
    if (!viewport || !today) return;
    const viewportTop = viewport.getBoundingClientRect().top;
    const todayTop = today.getBoundingClientRect().top;
    viewport.scrollTo({ top: Math.max(0, viewport.scrollTop + todayTop - viewportTop - 88), behavior: "smooth" });
  }, []);

  const selectPoint = (point: TeamTimelinePoint) => { setSelectedPoint(point); setSelectedEvidenceDate(null); setSelectedWeekId(null); setForecastSelected(false); };
  const selectWeek = (weekId: string) => { setSelectedWeekId(weekId); setSelectedPoint(null); setSelectedEvidenceDate(null); setForecastSelected(false); };
  const selectForecast = () => { setForecastSelected(true); setSelectedPoint(null); setSelectedEvidenceDate(null); setSelectedWeekId(null); };
  const selectEvidence = (dateId: string) => { setSelectedEvidenceDate(dateId); setSelectedPoint(null); setSelectedWeekId(null); setForecastSelected(false); };

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
      const last = focusable.at(-1);
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

  useEffect(() => {
    if (!open || !hasEvidence || selectedEvidenceDate || selectedPoint || selectedWeekId || forecastSelected) return;
    setSelectedEvidenceDate(defaultEvidenceDate);
  }, [defaultEvidenceDate, forecastSelected, hasEvidence, open, selectedEvidenceDate, selectedPoint, selectedWeekId]);

  return <>
    <section className="web-team-gantt-launch" aria-labelledby={`team-gantt-launch-${teamRole}`}>
      <div className="web-team-gantt-launch-visual" aria-hidden="true"><span /><span /><span /><span /><i /></div>
      <div><span className="team-section-kicker">{hasEvidence ? "Integrated workload calendar" : "Workload calendar"}</span><h2 id={`team-gantt-launch-${teamRole}`}>{hasEvidence ? "See the facts behind the week" : "See the week before you commit it"}</h2><p>{hasEvidence ? `Your private ${sourceLabels.calendar} and ${sourceLabels.chat} context sits beside team-approved workload summaries and a planning runway—without ranking people.` : "Calendar context, approved workload signals, and a planning runway—without ranking people."}</p></div>
      <button ref={launchRef} className="button button-primary" type="button" onClick={() => setOpen(true)}><CalendarRange aria-hidden="true" /> Open calendar <Maximize2 aria-hidden="true" /></button>
    </section>

    {open ? <div className="web-team-gantt-overlay" role="dialog" aria-modal="true" aria-labelledby="web-team-gantt-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section ref={dialogRef} className="web-team-gantt-dialog">
        <header className="web-team-gantt-header">
          <div><span className="team-section-kicker">{hasEvidence ? "Your private evidence horizon · team-approved weekly summaries" : teamRole === "manager" ? "Team-wide approved signals" : "Your approved signals"} · through {anchorWeekId}</span><h2 id="web-team-gantt-title">Team workload calendar</h2><p>{hasEvidence ? `Your daily ${sourceLabels.calendar} and ${sourceLabels.chat} facts stay visible only to you. Team-approved weekly summaries remain the shared layer.` : "A real calendar for weekly evidence, with team-level workload analytics below."}</p></div>
          <div className="web-team-gantt-header-actions">
            <button className="web-team-gantt-today" type="button" onClick={() => { scrollToToday(); if (evidenceByDate.has(todayIso.slice(0, 10))) selectEvidence(todayIso.slice(0, 10)); }}><Crosshair aria-hidden="true" />Today</button>
            <div className="web-team-gantt-zoom" role="group" aria-label="Calendar time scale">{ZOOM_LABELS.map(({ id, label }) => <button key={id} className={zoom === id ? "is-active" : ""} type="button" aria-pressed={zoom === id} onClick={() => { setZoom(id); setSelectedPoint(null); setSelectedEvidenceDate(null); setSelectedWeekId(null); setForecastSelected(false); }}>{label}</button>)}</div>
            <button ref={closeRef} className="web-team-gantt-close" type="button" aria-label="Close calendar" onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
          </div>
        </header>

        <div className="web-team-gantt-legend" role="group" aria-label="Calendar legend"><span><i className="is-observed" />Observed history</span>{hasEvidence ? <><span><i className="is-calendar" />Your {sourceLabels.calendar}</span><span><i className="is-chat" />Your {sourceLabels.chat} metadata</span><span><i className="is-reviewed" />Your reviewed fact</span></> : null}<span><i className="is-today" />Today</span><span><i className="is-forecast" />Team forecast</span><span><i className="is-unknown" />Not shared</span><em>{calendar.todayIndex + 1} days through today · 7-day forecast window</em></div>

        <div className="web-team-gantt-body">
          <main ref={scrollRef} className={`web-team-gantt-scroll is-${zoom}`} role="region" tabIndex={0} aria-label="Scrollable team workload calendar">
            {hasEvidence ? <section className="web-team-gantt-flight-strip" aria-label="Your private connected workload evidence summary">
              <div className="web-team-gantt-flight-intro"><span className="team-section-kicker">Your private evidence horizon</span><strong>{activePressureDays ? `${activePressureDays} pressure ${activePressureDays === 1 ? "day" : "days"} surfaced` : "A calm evidence horizon"}</strong><small>Select an active date to inspect your facts.</small></div>
              <div className="web-team-gantt-flight-stat is-calendar"><CalendarDays aria-hidden="true" /><span><strong>{evidenceTotals.calendarEvents}</strong><small>{sourceLabels.calendar} events</small></span><em>{formatMinutes(evidenceTotals.calendarMinutes)}</em></div>
              <div className="web-team-gantt-flight-stat is-chat"><MessageSquareText aria-hidden="true" /><span><strong>{evidenceTotals.chatEpisodes}</strong><small>{sourceLabels.chat} episodes</small></span><em>metadata only</em></div>
              <div className="web-team-gantt-flight-stat is-reviewed"><CheckCircle2 aria-hidden="true" /><span><strong>{evidenceTotals.reviewedBlocks}</strong><small>Reviewed blocks</small></span><em>correctable truth</em></div>
              <div className="web-team-gantt-flight-privacy"><LockKeyhole aria-hidden="true" /><span><strong>Private by design</strong><small>Daily facts never enter team sync</small></span></div>
            </section> : null}
            <section className="web-team-gantt-calendar-panel" aria-labelledby="web-team-calendar-panel-title">
              <div className="web-team-gantt-panel-heading"><div><span className="team-section-kicker"><CalendarDays aria-hidden="true" /> {hasEvidence ? "Workload field" : "Calendar"}</span><h3 id="web-team-calendar-panel-title">{hasEvidence ? EVIDENCE_HORIZON_LABELS[zoom] : "Approved workload by week"}</h3></div><p>{hasEvidence ? <><strong>Daily:</strong> your private connected facts · <strong>Weekly:</strong> team-approved summaries</> : "Summaries sit on their real ISO week. Daily cells provide context; they do not imply daily observation."}</p></div>
              <div className="web-team-gantt-weekdays" aria-hidden="true">{WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
              <div className="web-team-gantt-calendar-weeks">
                {weeks.map((week) => <article className={`web-team-gantt-calendar-week${week.hasToday ? " is-current" : ""}${week.hasForecast ? " has-forecast" : ""}`} key={week.weekId}>
                  <div className="web-team-gantt-calendar-days">
                    {WEEKDAY_LABELS.map((weekdayLabel, index) => {
                      const day = week.days[index];
                      if (!day) return <div className="web-team-gantt-calendar-day is-outside" key={`${week.weekId}:${weekdayLabel}`} />;
                      if (!hasEvidence) return <div className={`web-team-gantt-calendar-day is-${day.kind}${day.isWeekend ? " is-weekend" : ""}`} data-today-marker={day.kind === "today" ? "true" : undefined} key={day.dateId} title={day.dateId}><span>{day.monthLabel}</span><strong>{day.dayLabel}</strong>{day.kind === "today" ? <em>Today</em> : null}</div>;
                      const dayEvidence = evidenceByDate.get(day.dateId);
                      return <button
                        className={`web-team-gantt-calendar-day is-${day.kind}${day.isWeekend ? " is-weekend" : ""}${selectedEvidenceDate === day.dateId ? " is-selected" : ""}`}
                        data-today-marker={day.kind === "today" ? "true" : undefined}
                        disabled={!dayEvidence}
                        key={day.dateId}
                        onClick={() => dayEvidence && selectEvidence(day.dateId)}
                        title={dayEvidence ? `Inspect connected facts for ${day.dateId}` : day.dateId}
                        type="button"
                      >
                        <span>{day.monthLabel}</span><strong>{day.dayLabel}</strong>
                        {dayEvidence ? <span className="web-team-gantt-day-facts" aria-label={`Your private facts: ${formatEvidenceCount(dayEvidence.calendarEventCount, `${sourceLabels.calendar} event`)}, ${formatEvidenceCount(dayEvidence.chatEpisodeCount, `${sourceLabels.chat} episode`)}, ${formatEvidenceCount(dayEvidence.reviewedBlockCount, "reviewed block")}`}>
                          {dayEvidence.calendarEventCount > 0 ? <i className="is-calendar" title={`Your ${formatEvidenceCount(dayEvidence.calendarEventCount, `${sourceLabels.calendar} event`)}, ${formatMinutes(dayEvidence.calendarMinutes)}`}><CalendarDays aria-hidden="true" /><b>{dayEvidence.calendarEventCount}</b><small>{formatMinutes(dayEvidence.calendarMinutes)}</small></i> : null}
                          {dayEvidence.chatEpisodeCount > 0 ? <i className="is-chat" title={`Your ${formatEvidenceCount(dayEvidence.chatEpisodeCount, `${sourceLabels.chat} metadata episode`)}`}><MessageSquareText aria-hidden="true" /><b>{dayEvidence.chatEpisodeCount}</b></i> : null}
                          {dayEvidence.reviewedBlockCount > 0 ? <i className="is-reviewed" title={formatEvidenceCount(dayEvidence.reviewedBlockCount, "reviewed work block")}><CheckCircle2 aria-hidden="true" /><b>{dayEvidence.reviewedBlockCount}</b></i> : null}
                        </span> : null}
                        {dayEvidence?.insight ? <small className={`web-team-gantt-day-insight is-${dayEvidence.insight}`} title={evidenceInsightLabel(dayEvidence.insight) ?? undefined}><i />{evidenceInsightLabel(dayEvidence.insight)}</small> : null}
                        {day.kind === "today" ? <em>Today</em> : null}
                      </button>;
                    })}
                  </div>
                  <div className="web-team-gantt-week-band">
                    <div className="web-team-gantt-week-meta"><strong>{week.weekId.replace("-", " ")}</strong><span>{weekRangeLabel(week)}</span></div>
                    <div className="web-team-gantt-week-events">
                      {week.points.slice(0, zoom === "quarter" ? 2 : 4).map((point) => <button className={`web-team-gantt-week-event${selectedPoint === point ? " is-selected" : ""}`} type="button" key={`${point.userId}:${point.weekId}`} onClick={() => selectPoint(point)} aria-label={`${point.displayName}, ${point.weekId}, reliable capacity ${formatMetric(point.reliableCapacityPct)}`}><span>{point.displayName}</span><strong>{formatMetric(point.reliableCapacityPct)}</strong><small>{point.reviewedBlocks}/{point.eligibleBlocks} reviewed</small></button>)}
                      {week.points.length > (zoom === "quarter" ? 2 : 4) ? <span className="web-team-gantt-event-overflow">+{week.points.length - (zoom === "quarter" ? 2 : 4)} summaries</span> : null}
                      {week.points.length === 0 && !(week.hasForecast && week.weekId === forecastStartWeekId) ? <span className="web-team-gantt-week-empty">No approved summary</span> : null}
                      {teamRole === "manager" && week.hasForecast && week.weekId === forecastStartWeekId ? (reliableForecast ? <button className={`web-team-gantt-week-event is-forecast${forecastSelected ? " is-selected" : ""}`} type="button" onClick={selectForecast}><span><Sparkles aria-hidden="true" /> Team forecast</span><strong>{Math.round(reliableForecast.median)}%</strong><small>{Math.round(reliableForecast.min)}–{Math.round(reliableForecast.max)}% range</small></button> : <span className="web-team-gantt-week-empty is-forecast">Forecast withheld · insufficient coverage</span>) : null}
                    </div>
                  </div>
                </article>)}
              </div>
            </section>

            {hasEvidence ? <section className="web-team-gantt-activity" aria-labelledby="web-team-connected-activity-title">
              <div className="web-team-gantt-rhythm-heading"><div><span className="team-section-kicker"><MessageSquareText aria-hidden="true" /> Your evidence rhythm</span><h3 id="web-team-connected-activity-title">How your private horizon changes week to week</h3></div><div className="web-team-gantt-rhythm-key"><span className="is-calendar">{sourceLabels.calendar}</span><span className="is-chat">{sourceLabels.chat}</span></div></div>
              <div className="web-team-gantt-activity-grid">
                {weeklyEvidence.map((week) => {
                  const firstEvidence = week.days[0];
                  return <button className={`web-team-gantt-activity-week${week.pressureDays ? " has-pressure" : ""}`} data-anchor-week={week.weekId === anchorWeekId ? "true" : undefined} disabled={!firstEvidence} key={week.weekId} onClick={() => firstEvidence && selectEvidence(firstEvidence.dateId)} type="button">
                    <span className="web-team-gantt-activity-week-label">{week.weekId.replace(/^\d{4}-/, "")}</span>
                    <div className="web-team-gantt-activity-track is-calendar"><span style={{ width: `${(week.calendarMinutes / maxWeeklyCalendarMinutes) * 100}%` }} /><strong>{week.calendarEvents ? `${week.calendarEvents} cal · ${formatMinutes(week.calendarMinutes)}` : "No calendar fact"}</strong></div>
                    <div className="web-team-gantt-activity-track is-chat"><span style={{ width: `${(week.chatEpisodes / maxWeeklyChatEpisodes) * 100}%` }} /><strong>{week.chatEpisodes ? `${week.chatEpisodes} ${sourceLabels.chat} episodes` : `No ${sourceLabels.chat} fact`}</strong></div>
                    <small><CheckCircle2 aria-hidden="true" /> {week.reviewedBlocks} reviewed{week.pressureDays ? ` · ${week.pressureDays} pressure ${week.pressureDays === 1 ? "day" : "days"}` : ""}</small>
                  </button>;
                })}
              </div>
            </section> : null}

            <section className="web-team-gantt-runway" aria-labelledby="web-team-runway-title">
              <div className="web-team-gantt-panel-heading"><div><span className="team-section-kicker"><ChartNoAxesGantt aria-hidden="true" /> Analytics</span><h3 id="web-team-runway-title">Workload runway</h3></div><p>Team medians across approved summaries. Select a segment for evidence and coverage.</p></div>
              <div className="web-team-gantt-runway-scroll">
                <div className="web-team-gantt-runway-grid" style={runwayStyle}>
                  <div className="web-team-gantt-runway-corner">Signal</div>{weeks.map((week) => <div className={`web-team-gantt-runway-week${week.hasToday ? " is-current" : ""}`} key={`head:${week.weekId}`}><strong>{week.weekId.replace(/^\d{4}-/, "")}</strong><span>{weekRangeLabel(week)}</span></div>)}
                  {METRIC_LANES.map((lane) => <div className={`web-team-gantt-runway-row is-${lane.tone}`} key={lane.key} style={runwayStyle}><div className="web-team-gantt-runway-label"><span>{lane.label}</span><small>Team median</small></div>{weeks.map((week) => { const value = week[lane.key]; const isForecastCell = lane.key === "reliableCapacityPct" && week.weekId === forecastRunwayWeekId && reliableForecast !== null; const shownValue = isForecastCell ? reliableForecast.median : value; return <button className={`web-team-gantt-runway-cell${shownValue === null ? " is-empty" : ""}${isForecastCell ? " is-forecast" : ""}${selectedWeekId === week.weekId ? " is-selected" : ""}`} type="button" key={`${lane.key}:${week.weekId}`} onClick={() => isForecastCell ? selectForecast() : selectWeek(week.weekId)} aria-label={`${lane.label}, ${week.weekId}, ${formatMetric(shownValue)}`}><span style={{ width: `${Math.max(0, Math.min(100, shownValue ?? 0))}%` }} /><strong>{formatMetric(shownValue)}</strong></button>; })}</div>)}
                </div>
              </div>
            </section>
          </main>

          <aside className="web-team-gantt-detail" aria-live="polite"><CalendarInspector evidenceSources={sourceLabels} forecast={forecast} forecastSelected={forecastSelected} selectedEvidence={selectedEvidence} selectedPoint={selectedPoint} selectedWeek={selectedWeek} /></aside>
        </div>
      </section>
    </div> : null}
  </>;
}
