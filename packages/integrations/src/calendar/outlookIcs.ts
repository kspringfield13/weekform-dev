import type { OutlookCalendarEvent, WorkBlock } from "../../../domain/src/models";
import {
  WEEKLY_BASELINE_MINUTES,
  capacityPctFromMinutes,
  capacityPctFromSpan,
  stableHash
} from "../internal/normalize";

/** Minutes an analyst is assumed to work in a single day (a fifth of the week). */
const WORKDAY_MINUTES = WEEKLY_BASELINE_MINUTES / 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The subset of an RFC 5545 `RRULE` we expand: FREQ + INTERVAL + COUNT + UNTIL + BYDAY. */
interface RecurrenceRule {
  /** Uppercased FREQ token (DAILY/WEEKLY expand; others are skipped with a note). */
  freq: string;
  /** Repeat interval in FREQ units; always >= 1. */
  interval: number;
  /** Total occurrences in the series (inclusive of DTSTART), or null if unbounded. */
  count: number | null;
  /** Inclusive upper bound (epoch ms), or null. */
  until: number | null;
  /**
   * BYDAY weekdays as JS `getDay()` indices (0=Sun..6=Sat), deduped in listed
   * order. Empty when BYDAY is absent. Only consulted for a WEEKLY series (a
   * Mon/Wed/Fri or Tue/Thu meeting that lands on several weekdays per week).
   */
  byDays: number[];
}

interface IcsEventRecord {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string | null;
  organizer: string | null;
  attendeeCount: number;
  /** Parsed RRULE when present, else null. Cleared on expanded occurrences. */
  recurrence: RecurrenceRule | null;
  /** EXDATE instants (epoch ms) to omit from an expanded series. */
  exDates: number[];
  /** Set when a recurrence was detected but not expanded (see `recurrence_note`). */
  recurrenceNote: string | null;
}

function unfoldIcsLines(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .reduce<string[]>((lines, line) => {
      if (/^[ \t]/.test(line) && lines.length > 0) {
        lines[lines.length - 1] += line.slice(1);
      } else {
        lines.push(line);
      }
      return lines;
    }, []);
}

function splitIcsLine(line: string) {
  const separatorIndex = line.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  const nameAndParams = line.slice(0, separatorIndex);
  const [name, ...params] = nameAndParams.split(";");
  return {
    name: name.toUpperCase(),
    params,
    value: line.slice(separatorIndex + 1)
  };
}

// RFC 5545 §3.3.11 text unescaping. Must be a SINGLE left-to-right pass: a
// backslash escapes exactly the next character, so `\\n` is an escaped
// backslash (`\`) followed by a literal `n`, not a newline. Chained
// `.replace()` calls that handle `\\` last would first rewrite the trailing
// `\n` into a newline and corrupt the sequence, so consume each `\<char>` atomically.
function unescapeIcsText(value: string) {
  return value
    .replace(/\\([\\;,nN])/g, (_match, ch: string) =>
      ch === "n" || ch === "N" ? "\n" : ch
    )
    .trim();
}

// Return the offset (tz − UTC, in ms) for `timeZone` at the given instant, or
// null if `timeZone` is not a valid IANA id (so the caller can fall back to
// machine-local time). Uses `Intl.DateTimeFormat` — no new dependency.
function timeZoneOffsetMs(timeZone: string, instant: number): number | null {
  let dtf: Intl.DateTimeFormat;
  try {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return null;
  }

  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(instant))) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    // hourCycle h23 yields 00–23, but guard the odd "24" midnight some engines emit.
    Number(map.hour === "24" ? "0" : map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return Number.isNaN(asUtc) ? null : asUtc - instant;
}

// Interpret a wall-clock time as occurring in `timeZone` and return the matching
// UTC instant. Returns null for an unusable `timeZone`. Refines once so DST
// transitions resolve correctly (the offset depends on the instant we compute).
function zonedWallTimeToUtc(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date | null {
  const wallAsUtc = Date.UTC(year, monthIndex, day, hour, minute, second);
  const offset = timeZoneOffsetMs(timeZone, wallAsUtc);
  if (offset === null) {
    return null;
  }

  let instant = wallAsUtc - offset;
  const refined = timeZoneOffsetMs(timeZone, instant);
  if (refined !== null && refined !== offset) {
    instant = wallAsUtc - refined;
  }
  return new Date(instant);
}

function parseIcsDate(value: string, timeZone?: string | null) {
  const normalized = value.trim();
  const dateTimeMatch = normalized.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/
  );

  if (dateTimeMatch) {
    const [, year, month, day, hour, minute, second, utc] = dateTimeMatch;
    const numericMonth = Number(month) - 1;
    if (utc) {
      return new Date(
        Date.UTC(Number(year), numericMonth, Number(day), Number(hour), Number(minute), Number(second))
      );
    }

    if (timeZone) {
      const zoned = zonedWallTimeToUtc(
        Number(year),
        numericMonth,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        timeZone
      );
      if (zoned) {
        return zoned;
      }
    }

    return new Date(Number(year), numericMonth, Number(day), Number(hour), Number(minute), Number(second));
  }

  const dateMatch = normalized.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    return new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0);
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Parse an RFC 5545 DURATION value (dur-week / dur-date / dur-time forms, e.g.
// `P1W`, `P1D`, `PT1H`, `PT1H30M`, `P1DT2H30M`) into total minutes. Returns null
// for a malformed or empty duration so the caller can leave `end` unset.
function parseIcsDurationMinutes(value: string): number | null {
  const match = value
    .trim()
    .match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) {
    return null;
  }

  const [, sign, weeks, days, hours, minutes, seconds] = match;
  if (!weeks && !days && !hours && !minutes && !seconds) {
    // Bare "P" / "PT" with no components — not a usable duration.
    return null;
  }

  const totalMinutes =
    Number(weeks ?? 0) * 7 * 24 * 60 +
    Number(days ?? 0) * 24 * 60 +
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0) +
    Number(seconds ?? 0) / 60;

  return sign === "-" ? -totalMinutes : totalMinutes;
}

const DAILY_FREQ = "DAILY";
const WEEKLY_FREQ = "WEEKLY";
// Safety valve so a malformed rule (e.g. INTERVAL=0 defensively coerced to 1
// with no COUNT/UNTIL) can never spin the expansion loop unbounded.
const MAX_RECURRENCE_OCCURRENCES = 400;

// RFC 5545 BYDAY 2-letter weekday codes → JS `getDay()` indices (0=Sun..6=Sat).
const WEEKDAY_CODES: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6
};

// Parse an RFC 5545 BYDAY list (`MO,WE,FR`) into deduped JS weekday indices, in
// listed order. Each entry may carry an ordinal prefix (`2TU`, `-1FR`) which is
// meaningless for a WEEKLY series, so strip it and keep only the weekday code.
function parseByDays(value: string): number[] {
  const days: number[] = [];
  for (const token of value.split(",")) {
    const code = token.trim().toUpperCase().replace(/^[+-]?\d+/, "");
    const dow = WEEKDAY_CODES[code];
    if (dow !== undefined && !days.includes(dow)) {
      days.push(dow);
    }
  }
  return days;
}

// Parse an RFC 5545 RRULE value into the subset we expand. Returns null only
// when FREQ is absent; the caller decides whether the FREQ is one we expand
// (DAILY/WEEKLY) or skip with a note.
function parseRecurrenceRule(value: string): RecurrenceRule | null {
  const map: Record<string, string> = {};
  for (const part of value.trim().split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    map[part.slice(0, eq).toUpperCase().trim()] = part.slice(eq + 1).trim();
  }

  const freq = (map.FREQ ?? "").toUpperCase();
  if (!freq) {
    return null;
  }

  let interval = Number.parseInt(map.INTERVAL ?? "1", 10);
  if (!Number.isFinite(interval) || interval < 1) {
    interval = 1;
  }

  let count: number | null = null;
  if (map.COUNT != null) {
    const parsedCount = Number.parseInt(map.COUNT, 10);
    count = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : null;
  }

  let until: number | null = null;
  if (map.UNTIL) {
    // UNTIL is a DATE or (usually UTC) DATE-TIME value; parseIcsDate handles both.
    const rawUntil = map.UNTIL.trim();
    const parsedUntil = parseIcsDate(rawUntil);
    if (parsedUntil) {
      // A date-only UNTIL (`UNTIL=20260624`) parses to LOCAL MIDNIGHT of that day. RFC 5545 treats
      // UNTIL as the series' inclusive last instant, so against a timed DTSTART (09:00) the strict
      // `startMs > until` clip below would drop the UNTIL day's own occurrence (`Jun 24 09:00 >
      // Jun 24 00:00`) — silently losing the final scheduled day. Extend a date-only bound to
      // end-of-day so that occurrence is kept. A DATE-TIME UNTIL keeps its exact instant, so this is
      // byte-identical on the conformant/Outlook path (and on an all-day series, whose occurrences
      // sit at midnight ≤ the extended bound, unchanged too).
      until = /^\d{8}$/.test(rawUntil)
        ? new Date(
            parsedUntil.getFullYear(),
            parsedUntil.getMonth(),
            parsedUntil.getDate(),
            23,
            59,
            59,
            999
          ).getTime()
        : parsedUntil.getTime();
    }
  }

  const byDays = map.BYDAY ? parseByDays(map.BYDAY) : [];

  return { freq, interval, count, until, byDays };
}

// Short human label for an unsupported recurrence FREQ, for the skip note.
function recurrenceFreqLabel(freq: string): string {
  const normalized = freq.toUpperCase();
  const labels: Record<string, string> = {
    MONTHLY: "Monthly",
    YEARLY: "Yearly",
    HOURLY: "Hourly",
    MINUTELY: "Minute-level",
    SECONDLY: "Second-level"
  };
  return labels[normalized] ?? `${normalized.charAt(0)}${normalized.slice(1).toLowerCase()}`;
}

// Shift a date by whole days while preserving its local wall-clock time, so a
// DST transition can't drift a 09:00 meeting to 08:00/10:00 (matches the all-day
// local-midnight default). Millisecond arithmetic would drift across DST.
function addLocalDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
}

// Expand one DAILY/WEEKLY recurring record into concrete occurrences within the
// export window. `windowEnd` is the OUTER authority: occurrences whose start
// falls after it are never emitted, because all imported blocks are attributed
// to the current week downstream — extending a series past the exported range
// would inject phantom load. INTERVAL/COUNT/UNTIL/EXDATE only ever SHORTEN the
// series within that window (COUNT caps the occurrence total, UNTIL clips the
// tail, EXDATE removes specific instances); they never push past `windowEnd`.
// DTSTART is always emitted first (RFC 5545: it is the series' first instance)
// so a malformed UNTIL/window can never drop the real meeting.
function expandRecurringRecord(record: IcsEventRecord, windowEnd: number): IcsEventRecord[] {
  const rule = record.recurrence;
  if (!rule) {
    return [record];
  }

  const stepDays = rule.freq === WEEKLY_FREQ ? rule.interval * 7 : rule.interval;
  const durationMs = record.end.getTime() - record.start.getTime();
  const excluded = new Set(record.exDates);
  const occurrences: IcsEventRecord[] = [];

  const emit = (startMs: number) => {
    // EXDATE-excluded occurrences still consume a COUNT slot (via the loop index)
    // but produce no event. Matching is exact-instant: an EXDATE reliably cancels
    // an occurrence when the series' zone matches the machine zone (the common
    // case) or both are UTC; a cross-zone series spanning a DST change is the one
    // gap, consistent with this file's machine-local handling of non-TZID times.
    if (excluded.has(startMs)) {
      return;
    }
    occurrences.push({
      ...record,
      start: new Date(startMs),
      end: new Date(startMs + durationMs),
      recurrence: null,
      exDates: [],
      recurrenceNote: null
    });
  };

  emit(record.start.getTime());

  // WEEKLY + BYDAY: the series lands on several weekdays per active week (e.g.
  // Mon/Wed/Fri or Tue/Thu), so a single `interval*7` step from DTSTART would
  // emit only ONE weekday/week and undercount meeting load. Walk day-by-day and
  // emit each listed weekday that falls in a week whose Monday-anchored index is
  // a multiple of INTERVAL. Preserves the same DTSTART-first / windowEnd / UNTIL
  // / COUNT-slot / EXDATE invariants as the plain step below.
  if (rule.freq === WEEKLY_FREQ && rule.byDays.length > 0) {
    const byDaySet = new Set(rule.byDays);
    // Days from the Monday of DTSTART's week to DTSTART (Monday-first: 0=Mon..6=Sun),
    // so `weekIndex` counts whole Monday-started weeks since DTSTART's own week (0).
    const dtStartMondayOffset = (record.start.getDay() + 6) % 7;
    // DTSTART is the series' first instance and already consumed slot 1 above;
    // later qualifying occurrences take slots 2, 3, … (EXDATE-excluded ones still
    // consume a slot, matching the plain branch's per-index accounting).
    let slot = 1;
    // Bound the day walk by MAX_RECURRENCE_OCCURRENCES weeks as a safety valve;
    // windowEnd/UNTIL/COUNT break far earlier on any real export.
    const maxDays = MAX_RECURRENCE_OCCURRENCES * 7;
    for (let dayOffset = 1; dayOffset < maxDays; dayOffset += 1) {
      const day = addLocalDays(record.start, dayOffset);
      const startMs = day.getTime();
      if (startMs >= windowEnd) {
        break;
      }
      if (rule.until !== null && startMs > rule.until) {
        break;
      }
      const weekIndex = Math.floor((dtStartMondayOffset + dayOffset) / 7);
      if (weekIndex % rule.interval !== 0 || !byDaySet.has(day.getDay())) {
        continue;
      }
      slot += 1;
      if (rule.count !== null && slot > rule.count) {
        break;
      }
      emit(startMs);
    }
    return occurrences;
  }

  for (let index = 1; index < MAX_RECURRENCE_OCCURRENCES; index += 1) {
    if (rule.count !== null && index >= rule.count) {
      break;
    }
    const startMs = addLocalDays(record.start, stepDays * index).getTime();
    // `windowEnd` is an EXCLUSIVE end instant (an event's DTEND), so the window
    // is half-open [.., windowEnd). Use `>=` so an occurrence starting exactly at
    // windowEnd is excluded — otherwise a lone all-day daily series (whose next
    // start lands precisely on its own DTEND) would emit one phantom day past
    // the exported range.
    if (startMs >= windowEnd) {
      break;
    }
    if (rule.until !== null && startMs > rule.until) {
      break;
    }
    emit(startMs);
  }

  return occurrences;
}

// Look up an ICS property parameter (e.g. `TZID`) from the `name;PARAM=value`
// prefix, stripping the RFC 5545 optional double-quotes around the value.
function getIcsParam(params: string[], key: string): string | null {
  const upperKey = key.toUpperCase();
  for (const param of params) {
    const eq = param.indexOf("=");
    if (eq === -1) {
      continue;
    }
    if (param.slice(0, eq).toUpperCase() === upperKey) {
      return param.slice(eq + 1).replace(/^"(.*)"$/, "$1");
    }
  }
  return null;
}

// An RFC 5545 all-day event carries `DTSTART;VALUE=DATE:20260622` (date-only,
// no time). Detect it from the explicit VALUE param or the bare 8-digit value.
function isAllDayValue(value: string, params: string[]): boolean {
  if ((getIcsParam(params, "VALUE") ?? "").toUpperCase() === "DATE") {
    return true;
  }
  return /^\d{8}$/.test(value.trim());
}

function parseOrganizer(value: string) {
  const mailto = value.match(/mailto:([^;,\s]+)/i);
  return unescapeIcsText(mailto?.[1] ?? value);
}

function parseIcsEvent(lines: string[]): IcsEventRecord | null {
  let uid = "";
  let title = "Outlook meeting";
  let start: Date | null = null;
  let end: Date | null = null;
  let allDay = false;
  let location: string | null = null;
  let organizer: string | null = null;
  let attendeeCount = 0;
  let recurrence: RecurrenceRule | null = null;
  const exDates: number[] = [];

  for (const line of lines) {
    const parsed = splitIcsLine(line);
    if (!parsed) {
      continue;
    }

    switch (parsed.name) {
      case "UID":
        uid = unescapeIcsText(parsed.value);
        break;
      case "SUMMARY":
        title = unescapeIcsText(parsed.value) || title;
        break;
      case "DTSTART":
        start = parseIcsDate(parsed.value, getIcsParam(parsed.params, "TZID"));
        allDay = isAllDayValue(parsed.value, parsed.params);
        break;
      case "DTEND":
        end = parseIcsDate(parsed.value, getIcsParam(parsed.params, "TZID"));
        break;
      case "DURATION":
        if (start && !end) {
          const minutes = parseIcsDurationMinutes(parsed.value);
          if (minutes !== null && minutes > 0) {
            end = new Date(start.getTime() + minutes * 60_000);
          }
        }
        break;
      case "LOCATION":
        location = unescapeIcsText(parsed.value) || null;
        break;
      case "ORGANIZER":
        organizer = parseOrganizer(parsed.value) || null;
        break;
      case "ATTENDEE":
        attendeeCount += 1;
        break;
      case "RRULE":
        recurrence = parseRecurrenceRule(parsed.value);
        break;
      case "EXDATE": {
        const exTimeZone = getIcsParam(parsed.params, "TZID");
        for (const raw of parsed.value.split(",")) {
          const excluded = parseIcsDate(raw, exTimeZone);
          if (excluded) {
            exDates.push(excluded.getTime());
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // RFC 5545: an all-day VEVENT with no DTEND/DURATION occupies exactly one day.
  // Default it here so the event isn't dropped by the `!end` guard below.
  if (start && !end && allDay) {
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, 0, 0, 0);
  }

  if (!start || !end || end <= start) {
    return null;
  }

  const stableUid = uid || `${title}-${start.toISOString()}`;
  return {
    uid: stableUid,
    title,
    start,
    end,
    allDay,
    location,
    organizer,
    attendeeCount,
    recurrence,
    exDates,
    recurrenceNote: null
  };
}

export function parseOutlookIcs(content: string, importedAt = new Date().toISOString()) {
  const lines = unfoldIcsLines(content);
  const records: IcsEventRecord[] = [];
  let currentEventLines: string[] | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      currentEventLines = [];
      continue;
    }

    if (line === "END:VEVENT") {
      if (currentEventLines) {
        const record = parseIcsEvent(currentEventLines);
        if (record) {
          records.push(record);
        }
      }
      currentEventLines = null;
      continue;
    }

    if (currentEventLines) {
      currentEventLines.push(line);
    }
  }

  // Recurrence expansion window: the span the export actually covers (the latest
  // event end across all VEVENTs). All imported blocks are attributed to the
  // current week downstream, so we bound expansion by the export's own range —
  // never by a rule's UNTIL, which can run years past the exported window.
  const windowEnd = records.length
    ? Math.max(...records.map((record) => record.end.getTime()))
    : 0;

  const expanded: IcsEventRecord[] = [];
  records.forEach((record) => {
    if (!record.recurrence) {
      expanded.push(record);
      return;
    }
    if (record.recurrence.freq === DAILY_FREQ || record.recurrence.freq === WEEKLY_FREQ) {
      expanded.push(...expandRecurringRecord(record, windowEnd));
      return;
    }
    // Other frequencies (monthly/yearly/...) aren't expanded — keep the base
    // occurrence and record why the rest of the series was left out.
    expanded.push({
      ...record,
      recurrence: null,
      exDates: [],
      recurrenceNote: `${recurrenceFreqLabel(
        record.recurrence.freq
      )} recurrence detected — only the first occurrence was imported (daily/weekly series are expanded across the export range; other frequencies are not).`
    });
  });

  const unique = new Map<string, OutlookCalendarEvent>();
  expanded.forEach((record) => {
    const id = `outlook-${stableHash(`${record.uid}-${record.start.toISOString()}`)}`;
    unique.set(id, {
      calendar_event_id: id,
      uid: record.uid,
      title: record.title,
      start_time: record.start.toISOString(),
      end_time: record.end.toISOString(),
      location: record.location,
      organizer: record.organizer,
      attendee_count: record.attendeeCount,
      all_day: record.allDay,
      recurrence_note: record.recurrenceNote,
      source: "outlook_ics",
      imported_at: importedAt
    });
  });

  return [...unique.values()].sort(
    (left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime()
  );
}

function capacityPctFromEvent(event: OutlookCalendarEvent) {
  const start = new Date(event.start_time);
  const end = new Date(event.end_time);
  if (event.all_day) {
    // All-day events (PTO, OOO, reminders) span 24h+ of wall-clock per day but
    // don't represent 24h of work. Count each spanned day as a single workday so
    // a one-day block reads ~20% of the week, not the raw 60% a 24h span scores.
    const spannedDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
    return capacityPctFromMinutes(spannedDays * WORKDAY_MINUTES);
  }
  return capacityPctFromSpan(start, end);
}

export function outlookEventsToWorkBlocks(events: OutlookCalendarEvent[], weekId: string): WorkBlock[] {
  return events.map((event) => ({
    work_block_id: `calendar-${event.calendar_event_id}`,
    week_id: weekId,
    start_time: event.start_time,
    end_time: event.end_time,
    estimated_capacity_pct: capacityPctFromEvent(event),
    category: "Meetings / stakeholder syncs",
    mode: "Collaborative",
    planned_status: "fixed",
    project_name: event.title,
    stakeholder_group: event.organizer ?? event.location ?? "Outlook Calendar",
    derived_from: [event.calendar_event_id],
    evidence: [
      "Imported from local Outlook .ics calendar export",
      event.organizer ? `Organizer: ${event.organizer}` : "Organizer unavailable in export",
      event.attendee_count > 0
        ? `${event.attendee_count} attendee record${event.attendee_count === 1 ? "" : "s"} found`
        : "No attendee records found",
      ...(event.recurrence_note ? [event.recurrence_note] : [])
    ],
    confidence: 0.94,
    user_verified: false,
    blocker_flag: false,
    notes: event.location ? `Location: ${event.location}` : null
  }));
}
