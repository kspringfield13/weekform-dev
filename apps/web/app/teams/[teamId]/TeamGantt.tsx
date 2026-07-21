"use client";

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
  type TeamTimelinePoint,
  type TeamTimelineZoom,
} from "../../../../../packages/inference/src/teamTimeline";
import type { TeamCapacityForecast } from "@/lib/forecast";

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
  forecast,
  history,
  identities,
  role,
  todayIso,
  viewerId,
}: {
  anchorWeekId: string;
  forecast?: TeamCapacityForecast;
  history: TeamGanttSnapshot[];
  identities: Array<{ userId: string; name: string }>;
  role: "member" | "manager";
  todayIso: string;
  viewerId: string;
}) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<TeamTimelineZoom>("month");
  const [selectedPoint, setSelectedPoint] = useState<TeamTimelinePoint | null>(null);
  const [forecastSelected, setForecastSelected] = useState(false);
  const launchRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
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
  const calendar = useMemo(
    () => buildTeamCalendar(
      points,
      todayIso,
      zoom,
      identities.map((identity) => ({
        userId: identity.userId,
        displayName: identity.name,
        isSelf: identity.userId === viewerId,
      })),
    ),
    [identities, points, todayIso, viewerId, zoom],
  );
  const dayWidth = zoom === "week" ? 54 : zoom === "month" ? 34 : 24;
  const gridStyle = {
    gridTemplateColumns: `minmax(168px, 208px) repeat(${calendar.days.length}, ${dayWidth}px)`,
  };
  const reliableForecast = forecast?.verdict === "forecast"
    ? forecast.metrics.reliableCapacityPct.forecast
    : null;
  const monthBands = useMemo(() => calendar.days.reduce<Array<{ key: string; label: string; start: number; span: number }>>((bands, day, index) => {
    const key = day.dateId.slice(0, 7);
    const latest = bands.at(-1);
    if (latest?.key === key) latest.span += 1;
    else bands.push({ key, label: day.monthLabel, start: index, span: 1 });
    return bands;
  }, []), [calendar.days]);

  const scrollToToday = () => {
    const viewport = scrollRef.current;
    const today = viewport?.querySelector<HTMLElement>("[data-today-marker='true']");
    if (!viewport || !today) return;
    viewport.scrollTo({
      left: Math.max(0, today.offsetLeft - (viewport.clientWidth * 0.7)),
      behavior: "smooth",
    });
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
      <section className="web-team-gantt-launch" aria-labelledby={`team-gantt-launch-${role}`}>
        <div className="web-team-gantt-launch-visual" aria-hidden="true">
          <span /><span /><span /><i />
        </div>
        <div>
          <span className="team-section-kicker">Workload calendar</span>
          <h2 id={`team-gantt-launch-${role}`}>History, today, and what may fit next</h2>
          <p>
            Read approved weekly signals against real calendar days, then inspect the aggregate forecast without ranking people.
          </p>
        </div>
        <button ref={launchRef} className="button button-primary" type="button" onClick={() => setOpen(true)}>
          <CalendarRange aria-hidden="true" /> Open calendar <Maximize2 aria-hidden="true" />
        </button>
      </section>

      {open ? (
        <div className="web-team-gantt-overlay" role="dialog" aria-modal="true" aria-labelledby="web-team-gantt-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section ref={dialogRef} className="web-team-gantt-dialog">
            <header className="web-team-gantt-header">
              <div>
                <span className="team-section-kicker">{role === "manager" ? "Team-wide approved signals" : "Your approved signals"} · through {anchorWeekId}</span>
                <h2 id="web-team-gantt-title">Team workload calendar</h2>
                <p>Daily calendar context for weekly summaries. Forecasts are aggregate planning ranges, never per-person predictions.</p>
              </div>
              <div className="web-team-gantt-header-actions">
                <button className="web-team-gantt-today" type="button" onClick={scrollToToday}><Crosshair aria-hidden="true" />Today</button>
                <div className="web-team-gantt-zoom" aria-label="Gantt time scale">
                  <ZoomIn aria-hidden="true" />
                  {ZOOM_LABELS.map(({ id, label }) => (
                    <button key={id} className={zoom === id ? "is-active" : ""} type="button" aria-pressed={zoom === id} onClick={() => { setZoom(id); setSelectedPoint(null); setForecastSelected(false); }}>
                      {label}
                    </button>
                  ))}
                  <ZoomOut aria-hidden="true" />
                </div>
                <button ref={closeRef} className="web-team-gantt-close" type="button" aria-label="Close calendar" onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
              </div>
            </header>

            <div className="web-team-gantt-legend" aria-label="Calendar legend">
              <span><i className="is-observed" />Observed history</span>
              <span><i className="is-today" />Today</span>
              <span><i className="is-forecast" />Team forecast</span>
              <span><i className="is-unknown" />Not shared</span>
              <em>{calendar.todayIndex + 1} days through today · 7-day forecast window</em>
            </div>

            <div className="web-team-gantt-body">
              <div ref={scrollRef} className="web-team-gantt-scroll" tabIndex={0} aria-label="Scrollable team workload calendar">
                <div className="web-team-gantt-calendar" style={gridStyle}>
                  <div className="web-team-gantt-corner">{role === "manager" ? "Team member" : "Signal"}<small>Weekly approved summary</small></div>
                  {monthBands.map((band) => <div className="web-team-gantt-month" key={band.key} style={{ gridColumn: `${band.start + 2} / span ${band.span}` }}>{band.label}</div>)}
                  {calendar.days.map((day, index) => (
                    <div
                      className={`web-team-gantt-day is-${day.kind}${day.isWeekend ? " is-weekend" : ""}`}
                      data-today-marker={day.kind === "today" ? "true" : undefined}
                      key={day.dateId}
                      style={{ gridColumn: index + 2 }}
                      title={day.dateId}
                    >
                      <span>{day.weekdayLabel.slice(0, 1)}</span><strong>{day.dayLabel}</strong>
                    </div>
                  ))}

                  {role === "manager" ? (
                    <div className="web-team-gantt-row is-forecast-row" style={gridStyle}>
                      <div className="web-team-gantt-person"><span className="web-team-gantt-avatar is-forecast"><Sparkles aria-hidden="true" /></span><div><strong>Team forecast</strong><small>Aggregate · next week</small></div></div>
                      {calendar.days.map((day, index) => <span className={`web-team-gantt-day-slot is-${day.kind}${day.isWeekend ? " is-weekend" : ""}`} key={day.dateId} style={{ gridColumn: index + 2 }} />)}
                      {reliableForecast ? (
                        <button
                          className={`web-team-gantt-bar is-forecast${forecastSelected ? " is-selected" : ""}`}
                          style={{ gridColumn: `${calendar.forecastStartIndex + 2} / span 7` }}
                          type="button"
                          aria-label={`Team reliable capacity forecast ${Math.round(reliableForecast.median)}%, range ${Math.round(reliableForecast.min)} to ${Math.round(reliableForecast.max)}%`}
                          onClick={() => { setForecastSelected(true); setSelectedPoint(null); }}
                        >
                          <span><Sparkles aria-hidden="true" />Reliable capacity</span><strong>{Math.round(reliableForecast.median)}%</strong><small>{Math.round(reliableForecast.min)}–{Math.round(reliableForecast.max)}% range</small>
                        </button>
                      ) : (
                        <div className="web-team-gantt-forecast-empty" style={{ gridColumn: `${calendar.forecastStartIndex + 2} / span 7` }}>Forecast withheld · insufficient approved coverage</div>
                      )}
                    </div>
                  ) : null}

                  {calendar.rows.map((row) => (
                    <div className="web-team-gantt-row" key={row.userId} style={gridStyle}>
                      <div className="web-team-gantt-person"><span className="web-team-gantt-avatar">{row.displayName.slice(0, 2).toLocaleUpperCase()}</span><div><strong>{row.displayName}</strong><small>{row.isSelf ? "Signed-in account" : "Approved summary"}</small></div></div>
                      {calendar.days.map((day, index) => <span className={`web-team-gantt-day-slot is-${day.kind}${day.isWeekend ? " is-weekend" : ""}`} key={day.dateId} style={{ gridColumn: index + 2 }} />)}
                      {row.bars.map((bar) => (
                        <button
                          className={`web-team-gantt-bar${selectedPoint === bar.point ? " is-selected" : ""}`}
                          key={`${row.userId}:${bar.point.weekId}`}
                          style={{ gridColumn: `${bar.startIndex + 2} / span ${bar.spanDays}` }}
                          type="button"
                          aria-label={`${row.displayName}, ${bar.point.weekId}, reliable capacity ${formatMetric(bar.point.reliableCapacityPct)}`}
                          onClick={() => { setSelectedPoint(bar.point); setForecastSelected(false); }}
                        >
                          <span className="web-team-gantt-bar-fill" style={{ width: `${Math.max(8, Math.min(100, bar.point.reliableCapacityPct ?? 18))}%` }} />
                          <span>{bar.point.weekId.replace("-", " ")}</span><strong>{formatMetric(bar.point.reliableCapacityPct)}</strong><small>{bar.point.reviewedBlocks}/{bar.point.eligibleBlocks} reviewed</small>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                {calendar.rows.length === 0 ? <div className="web-team-gantt-empty">No approved snapshots fall inside this horizon.</div> : null}
              </div>

              <aside className="web-team-gantt-detail" aria-live="polite">
                {forecastSelected && reliableForecast && forecast ? (
                  <>
                    <span className="team-section-kicker">Forward look · team aggregate</span>
                    <h3>{Math.round(reliableForecast.median)}% reliable capacity</h3>
                    <p className="web-team-gantt-range">Expected range <strong>{Math.round(reliableForecast.min)}–{Math.round(reliableForecast.max)}%</strong></p>
                    <dl>
                      <div><dt>Coverage</dt><dd>{forecast.sharedCount}/{forecast.memberCount}</dd></div>
                      <div><dt>History used</dt><dd>{forecast.metrics.reliableCapacityPct.weekCount} weeks</dd></div>
                      <div><dt>Forecast type</dt><dd>Team median</dd></div>
                    </dl>
                    <p>{forecast.basisLabel} Prototype heuristic, not a commitment.</p>
                  </>
                ) : selectedPoint ? (
                  <>
                    <span className="team-section-kicker">Approved snapshot · {selectedPoint.weekId}</span>
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
                    <h3>Select a calendar bar</h3>
                    <p>Inspect approved metrics or the team-level forecast. Empty days stay unknown.</p>
                    <div className="web-team-gantt-trust"><span>Weekly summaries</span><span>No raw activity</span><span>No ranking</span></div>
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
