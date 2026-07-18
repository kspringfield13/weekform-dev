import { ChevronRight } from "lucide-react";
import type { ActivitySession } from "../../../../../packages/domain/src/models";
import { formatDurationMinutes, formatHourA11y, formatHourCompact, formatRelativeDayLabel } from "../../lib/format";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

function buildGrid(sessions: ActivitySession[]): number[][] {
  // grid[dayOffset][hour] = active minutes in that hour; dayOffset 0 = today, 6 = oldest
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (const session of sessions) {
    const d = new Date(session.start_time);
    // Skip a corrupt/unparseable persisted start_time: an Invalid Date makes
    // getFullYear()/getMonth()/getDate() NaN, so diffDays is NaN, the `< 0 || >= 7`
    // guard is false for both comparisons, and `grid[NaN][…] += …` throws
    // (grid[NaN] is undefined) — crashing the whole Ledger render. Mirrors the
    // Number.isFinite(start_time) guard useDerived.ts applies to recentSessions.
    if (!Number.isFinite(d.getTime())) continue;
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((todayStart.getTime() - dayStart.getTime()) / 86_400_000);
    if (diffDays < 0 || diffDays >= 7) continue;
    // Each cell means "minutes active in that hour", so a multi-hour session must be
    // spread across the hours it actually spans — not summed into its start hour alone
    // (which would render an impossible >60-min cell, e.g. a 3h call as "3h" in one 1-hour
    // box, leave the covered hours reading idle, and skew the max/color scale). Walk from
    // the start minute, filling each hour bucket with the minutes spent in it (clipped to
    // 60) and clip at the day's last hour — a session crossing midnight keeps the existing
    // start-day bucketing, so its post-midnight tail (which belongs to the next day) is
    // dropped rather than crammed into hour 23. `remaining > 0` also makes a NaN/negative
    // duration a no-op instead of poisoning a cell, and `hour < 24` bounds the loop.
    let remaining = session.duration_minutes;
    let hour = d.getHours();
    let minuteInHour = d.getMinutes();
    while (remaining > 0 && hour < 24) {
      const put = Math.min(remaining, 60 - minuteInHour);
      grid[diffDays][hour] += put;
      remaining -= put;
      hour += 1;
      minuteInHour = 0;
    }
  }

  return grid;
}

export function ActivityHeatmap({ sessions }: { sessions: ActivitySession[] }) {
  if (sessions.length === 0) return null;

  const grid = buildGrid(sessions);
  const daysWithActivity = grid.reduce((acc, row) => acc + (row.some(v => v > 0) ? 1 : 0), 0);

  if (daysWithActivity < 2) {
    return (
      <details className="activity-heatmap">
        <summary className="ledger-disclosure-summary">
          <div className="ledger-disclosure-main">
            <ChevronRight className="ledger-disclosure-caret" size={16} aria-hidden="true" />
            <div className="ledger-disclosure-heading">
              <span className="ledger-disclosure-title">7-day activity pattern</span>
              <span className="ledger-disclosure-subtitle">Hourly tracking density across recent days</span>
            </div>
          </div>
        </summary>
        <p className="heatmap-sparse-caption">Limited activity so far — the pattern fills in as you keep tracking.</p>
      </details>
    );
  }

  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;

  const peakLabel = formatDurationMinutes(max);

  return (
    <details className="activity-heatmap">
      <summary className="ledger-disclosure-summary">
        <div className="ledger-disclosure-main">
          <ChevronRight className="ledger-disclosure-caret" size={16} aria-hidden="true" />
          <div className="ledger-disclosure-heading">
            <span className="ledger-disclosure-title">7-day activity pattern</span>
            <span className="ledger-disclosure-subtitle">Hourly tracking density across recent days</span>
          </div>
        </div>
      </summary>
      <div
        className="heatmap-grid"
        role="group"
        aria-label={`7-day activity heatmap, peak ${peakLabel}`}
      >
        <div className="heatmap-hour-axis" aria-hidden="true">
          <div className="heatmap-day-label" />
          {HOURS.map(h => (
            <div key={h} className="heatmap-hour-label">
              {h % 6 === 0 ? formatHourCompact(h) : ""}
            </div>
          ))}
        </div>
        {[6, 5, 4, 3, 2, 1, 0].map(diffDays => (
          <div key={diffDays} className="heatmap-day-col">
            <div className="heatmap-day-label" aria-hidden="true">{formatRelativeDayLabel(diffDays)}</div>
            {HOURS.map(h => {
              const minutes = grid[diffDays][h];
              const level = max > 0 ? Math.ceil((minutes / max) * 5) : 0;
              const tip = minutes > 0
                ? `${formatRelativeDayLabel(diffDays)} ${formatHourCompact(h)}–${formatHourCompact(h + 1)} · ${formatDurationMinutes(minutes)}`
                : undefined;
              const cellLabel = minutes > 0
                ? `${formatRelativeDayLabel(diffDays, { long: true })} ${formatHourA11y(h)}–${formatHourA11y((h + 1) % 24)}, ${formatDurationMinutes(minutes)}`
                : undefined;
              return (
                <div
                  key={h}
                  className="heatmap-cell"
                  data-level={level}
                  title={tip}
                  role={minutes > 0 ? "img" : undefined}
                  aria-label={cellLabel}
                  aria-hidden={minutes === 0 ? true : undefined}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="heatmap-legend" aria-hidden="true">
        <span className="heatmap-legend-label">Less</span>
        {[1, 2, 3, 4, 5].map(level => (
          <div key={level} className="heatmap-cell" data-level={level} />
        ))}
        <span className="heatmap-legend-label">More</span>
      </div>
    </details>
  );
}
