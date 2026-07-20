import { useMemo, useState } from "react";
import { CalendarDays, Link2, LoaderCircle, RefreshCw, Unplug, Upload } from "lucide-react";
import type { CalendarEvent } from "../../../../../packages/domain/src/models";
import {
  CALENDAR_PROVIDERS,
  normalizeCalendarRange,
  type CalendarProviderId,
  type CalendarRangeInput,
} from "../../../../../packages/integrations/src/calendar/calendarSync";
import type { CalendarSourcesController } from "../../hooks/useCalendarSources";
import { formatAuditTime, formatCount } from "../../lib/format";

function initialRange(): CalendarRangeInput {
  const today = new Date();
  const monday = new Date(today);
  const day = monday.getDay() || 7;
  monday.setDate(monday.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const key = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { start_date: key(monday), end_date: key(sunday) };
}

export function CalendarSourcesPanel({
  events,
  controller,
  importError,
  lastSummary,
  onImport,
}: {
  events: CalendarEvent[];
  controller: CalendarSourcesController;
  importError: string | null;
  lastSummary: string | null;
  onImport: (provider: CalendarProviderId, file: File, range: CalendarRangeInput) => void;
}) {
  const [range, setRange] = useState<CalendarRangeInput>(initialRange);
  const rangeResult = useMemo(() => {
    try {
      return { value: normalizeCalendarRange(range), error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Choose a valid calendar range.";
      return { value: null, error: message };
    }
  }, [range]);
  const normalizedRange = rangeResult.value;
  const rangeError = rangeResult.error;

  const updateRange = (field: keyof CalendarRangeInput, value: string) => {
    setRange((current) => ({ ...current, [field]: value }));
  };

  return (
    <section className="calendar-sources" aria-labelledby="calendar-sources-title">
      <div className="calendar-sources-heading">
        <div className="settings-row-icon"><CalendarDays size={18} aria-hidden /></div>
        <div>
          <h3 id="calendar-sources-title">Calendars</h3>
          <p>Connect for automatic metadata sync while Weekform is open, or import a local `.ics` file. Every source feeds the same reviewable workload model.</p>
        </div>
        <div className="calendar-range" aria-label="Calendar date range">
          <label>
            <span>From</span>
            <input type="date" value={range.start_date} onChange={(event) => updateRange("start_date", event.target.value)} />
          </label>
          <span className="calendar-range-arrow" aria-hidden>→</span>
          <label>
            <span>Through</span>
            <input type="date" value={range.end_date} onChange={(event) => updateRange("end_date", event.target.value)} />
          </label>
        </div>
      </div>

      {(rangeError || importError || lastSummary) && (
        <div className="calendar-source-feedback" aria-live="polite">
          {rangeError && <small className="import-error" role="alert">{rangeError}</small>}
          {!rangeError && importError && <small className="import-error" role="alert">{importError}</small>}
          {!rangeError && !importError && lastSummary && <small className="import-delta">{lastSummary}</small>}
        </div>
      )}

      <div className="calendar-provider-list">
        {CALENDAR_PROVIDERS.map((provider) => {
          const status = controller.statuses.find((candidate) => candidate.provider === provider.id);
          const activity = controller.activity[provider.id];
          const count = events.filter((event) => event.source === provider.source).length;
          const busy = activity.phase === "connecting" || activity.phase === "syncing";
          return (
            <article className="calendar-provider" key={provider.id}>
              <div className={`calendar-provider-mark is-${provider.id}`} aria-hidden>
                {provider.label.slice(0, 1)}
              </div>
              <div className="calendar-provider-copy">
                <div className="calendar-provider-title">
                  <h4>{provider.label}</h4>
                  <span className={status?.connected ? "source-status is-active" : "source-status"}>
                    {status?.connected ? <span className="source-status-dot" /> : null}
                    {status?.connected ? "Live" : "Optional"}
                  </span>
                </div>
                <p>{status?.detail ?? provider.privacy}</p>
                <div className="calendar-provider-meta">
                  <span>{formatCount(count)} stored event{count === 1 ? "" : "s"}</span>
                  {activity.last_synced_at && <span>Synced <time dateTime={activity.last_synced_at}>{formatAuditTime(activity.last_synced_at)}</time></span>}
                  {activity.message && <span className="import-error" role="alert">{activity.message}</span>}
                </div>
              </div>
              <div className="calendar-provider-actions">
                {status?.connected ? (
                  <>
                    <button
                      className="settings-control"
                      type="button"
                      disabled={!normalizedRange || busy}
                      onClick={() => normalizedRange && void controller.sync(provider.id, normalizedRange).catch(() => undefined)}
                    >
                      {busy ? <LoaderCircle className="spin" size={15} aria-hidden /> : <RefreshCw size={15} aria-hidden />}
                      <span>{activity.phase === "syncing" ? "Syncing…" : "Sync range"}</span>
                    </button>
                    <button className="icon-button" type="button" title={`Disconnect ${provider.label}`} aria-label={`Disconnect ${provider.label}`} onClick={() => void controller.disconnect(provider.id).catch(() => undefined)}>
                      <Unplug size={15} aria-hidden />
                    </button>
                  </>
                ) : (
                  <button
                    className="settings-control"
                    type="button"
                    disabled={!status?.available || !normalizedRange || busy}
                    title={!status?.available ? status?.detail : undefined}
                    onClick={() => normalizedRange && void controller.connect(provider.id, normalizedRange).catch(() => undefined)}
                  >
                    {busy ? <LoaderCircle className="spin" size={15} aria-hidden /> : <Link2 size={15} aria-hidden />}
                    <span>{activity.phase === "connecting" ? "Connecting…" : "Connect live"}</span>
                  </button>
                )}
                <label className="settings-control" title={`Import ${provider.id === "google" ? "a" : "an"} ${provider.label} .ics export for the selected range`}>
                  <Upload size={15} aria-hidden />
                  <span>Import file</span>
                  <input
                    accept=".ics,text/calendar"
                    type="file"
                    disabled={!normalizedRange}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file && normalizedRange) onImport(provider.id, file, range);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
            </article>
          );
        })}
      </div>
      <p className="calendar-live-note">Live connections refresh a rolling two-weeks-back to six-weeks-ahead window every 15 minutes while Weekform is open. Manual Sync range uses the dates above.</p>
    </section>
  );
}
