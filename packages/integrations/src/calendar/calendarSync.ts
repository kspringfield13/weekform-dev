import type {
  CalendarEvent,
  CalendarEventSource,
  WorkBlock,
} from "../../../domain/src/models";
import { outlookEventsToWorkBlocks, parseOutlookIcs } from "./outlookIcs";

export type CalendarProviderId = "outlook" | "google" | "apple";
export type CalendarTransferMode = "file_import" | "live_sync";

export interface CalendarRangeInput {
  start_date: string;
  end_date: string;
}

export interface CalendarRange extends CalendarRangeInput {
  start: string;
  end_exclusive: string;
}

export interface CalendarProviderDescriptor {
  id: CalendarProviderId;
  label: string;
  live_kind: "oauth" | "macos_eventkit";
  source: CalendarEventSource;
  scopes: readonly string[];
  privacy: string;
}

export const CALENDAR_PROVIDERS: readonly CalendarProviderDescriptor[] = [
  {
    id: "outlook",
    label: "Outlook Calendar",
    live_kind: "oauth",
    source: "outlook_calendar",
    scopes: ["Calendars.ReadBasic", "offline_access"],
    privacy: "Reads calendar metadata through Microsoft Graph only after consent.",
  },
  {
    id: "google",
    label: "Google Calendar",
    live_kind: "oauth",
    source: "google_calendar",
    scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    privacy: "Reads calendar event metadata through Google only after consent.",
  },
  {
    id: "apple",
    label: "Apple Calendar",
    live_kind: "macos_eventkit",
    source: "apple_calendar",
    scopes: ["macOS Calendar full access"],
    privacy: "Reads selected dates from the local macOS EventKit store after permission.",
  },
] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

function localMidnight(date: string): Date {
  if (!DATE_PATTERN.test(date)) throw new Error("Choose a valid start and end date.");
  const value = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(value.getTime()) || value.getFullYear() !== Number(date.slice(0, 4))) {
    throw new Error("Choose a valid start and end date.");
  }
  return value;
}

export function normalizeCalendarRange(input: CalendarRangeInput): CalendarRange {
  const start = localMidnight(input.start_date);
  const end = localMidnight(input.end_date);
  if (end < start) throw new Error("The end date must be on or after the start date.");
  const endExclusive = new Date(end);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const days = Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000);
  if (days > MAX_RANGE_DAYS) throw new Error("Calendar ranges are limited to 366 days.");
  return {
    start_date: input.start_date,
    end_date: input.end_date,
    start: start.toISOString(),
    end_exclusive: endExclusive.toISOString(),
  };
}

export function providerDescriptor(provider: CalendarProviderId): CalendarProviderDescriptor {
  const descriptor = CALENDAR_PROVIDERS.find((candidate) => candidate.id === provider);
  if (!descriptor) throw new Error(`Unsupported calendar provider: ${provider}`);
  return descriptor;
}

function overlapsRange(event: CalendarEvent, range: CalendarRange): boolean {
  const start = new Date(event.start_time).getTime();
  const end = new Date(event.end_time).getTime();
  const rangeStart = new Date(range.start).getTime();
  const rangeEnd = new Date(range.end_exclusive).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end > rangeStart && start < rangeEnd;
}

export function filterCalendarEventsByRange(
  events: readonly CalendarEvent[],
  range: CalendarRange,
): CalendarEvent[] {
  return events.filter((event) => overlapsRange(event, range));
}

export function createCalendarImport(
  provider: CalendarProviderId,
  content: string,
  range: CalendarRange,
  importedAt = new Date().toISOString(),
): CalendarEvent[] {
  const descriptor = providerDescriptor(provider);
  return filterCalendarEventsByRange(
    parseOutlookIcs(content, importedAt, descriptor.source),
    range,
  );
}

function eventChanged(prior: CalendarEvent, next: CalendarEvent): boolean {
  return prior.title !== next.title
    || prior.start_time !== next.start_time
    || prior.end_time !== next.end_time
    || prior.location !== next.location
    || prior.organizer !== next.organizer
    || prior.attendee_count !== next.attendee_count
    || prior.all_day !== next.all_day
    || prior.recurrence_note !== next.recurrence_note;
}

export function reconcileCalendarEvents(
  current: readonly CalendarEvent[],
  incoming: readonly CalendarEvent[],
  options: { provider: CalendarProviderId; range: CalendarRange; mode: CalendarTransferMode },
): {
  events: CalendarEvent[];
  delta: { added: number; updated: number; unchanged: number; removed: number };
} {
  const descriptor = providerDescriptor(options.provider);
  const currentById = new Map(current.map((event) => [event.calendar_event_id, event]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const event of incoming) {
    const prior = currentById.get(event.calendar_event_id);
    if (!prior) added += 1;
    else if (eventChanged(prior, event)) updated += 1;
    else unchanged += 1;
  }

  const incomingIds = new Set(incoming.map((event) => event.calendar_event_id));
  const replacedIds = new Set<string>();
  if (options.mode === "live_sync") {
    current.forEach((event) => {
      if (
        event.source === descriptor.source
        && overlapsRange(event, options.range)
        && !incomingIds.has(event.calendar_event_id)
      ) replacedIds.add(event.calendar_event_id);
    });
  }

  const merged = new Map(
    current
      .filter((event) => !replacedIds.has(event.calendar_event_id))
      .map((event) => [event.calendar_event_id, event]),
  );
  incoming.forEach((event) => merged.set(event.calendar_event_id, event));
  return {
    events: [...merged.values()].sort((left, right) => left.start_time.localeCompare(right.start_time)),
    delta: { added, updated, unchanged, removed: replacedIds.size },
  };
}

const SOURCE_LABEL: Record<CalendarEventSource, string> = {
  outlook_calendar: "Outlook Calendar",
  google_calendar: "Google Calendar",
  apple_calendar: "Apple Calendar",
};

export function calendarEventsToWorkBlocks(events: CalendarEvent[], weekId: string): WorkBlock[] {
  return events.map((event) => {
    const date = new Date(event.start_time);
    const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = localDate.getDay() || 7;
    localDate.setDate(localDate.getDate() + 4 - day);
    const yearStart = new Date(localDate.getFullYear(), 0, 1);
    const week = Math.ceil((((localDate.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
    const eventWeekId = Number.isFinite(date.getTime())
      ? `${localDate.getFullYear()}-W${String(week).padStart(2, "0")}`
      : weekId;
    const block = outlookEventsToWorkBlocks([event], eventWeekId)[0];
    const label = SOURCE_LABEL[event.source];
    return {
      ...block,
      stakeholder_group: event.organizer ?? event.location ?? label,
      evidence: [
        `Imported from ${label}`,
        ...block.evidence.slice(1),
      ],
    };
  });
}

export function mergeCalendarWorkBlocks(
  currentBlocks: readonly WorkBlock[],
  events: CalendarEvent[],
  fallbackWeekId: string,
): WorkBlock[] {
  const currentById = new Map(currentBlocks.map((block) => [block.work_block_id, block]));
  const currentBySourceId = new Map<string, WorkBlock>();
  currentBlocks.forEach((block) => {
    block.derived_from.forEach((sourceId) => {
      const existing = currentBySourceId.get(sourceId);
      if (!existing || (!existing.user_verified && block.user_verified)) currentBySourceId.set(sourceId, block);
    });
  });
  return calendarEventsToWorkBlocks(events, fallbackWeekId).map((derived) => {
    const prior = currentById.get(derived.work_block_id)
      ?? derived.derived_from.map((sourceId) => currentBySourceId.get(sourceId)).find(Boolean);
    if (!prior?.user_verified) return derived;
    return {
      ...derived,
      category: prior.category,
      mode: prior.mode,
      planned_status: prior.planned_status,
      project_name: prior.project_name,
      stakeholder_group: prior.stakeholder_group,
      confidence: prior.confidence,
      user_verified: true,
      blocker_flag: prior.blocker_flag,
      notes: prior.notes,
    };
  });
}
