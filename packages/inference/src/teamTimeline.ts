export type TeamTimelineZoom = "week" | "month" | "quarter";

export interface TeamTimelinePoint {
  userId: string;
  displayName: string;
  isSelf: boolean;
  weekId: string;
  syncedAt: string;
  reliableCapacityPct: number | null;
  reactivePct: number | null;
  meetingPct: number | null;
  fragmentedPct: number | null;
  reviewedBlocks: number;
  eligibleBlocks: number;
}

export interface TeamTimelineIdentity {
  userId: string;
  displayName: string;
  isSelf: boolean;
}

export interface TeamTimelineRow {
  userId: string;
  displayName: string;
  isSelf: boolean;
  cells: Array<TeamTimelinePoint | null>;
}

export interface TeamTimeline {
  weeks: string[];
  rows: TeamTimelineRow[];
}

export type TeamCalendarDayKind = "history" | "today" | "forecast";

export interface TeamCalendarDay {
  dateId: string;
  weekId: string;
  weekdayLabel: string;
  dayLabel: string;
  monthLabel: string;
  isWeekend: boolean;
  kind: TeamCalendarDayKind;
}

export interface TeamCalendarBar {
  point: TeamTimelinePoint;
  startIndex: number;
  spanDays: number;
}

export interface TeamCalendarRow {
  userId: string;
  displayName: string;
  isSelf: boolean;
  bars: TeamCalendarBar[];
}

export interface TeamCalendar {
  days: TeamCalendarDay[];
  rows: TeamCalendarRow[];
  todayIndex: number;
  forecastStartIndex: number;
}

export interface TeamCalendarWeek {
  weekId: string;
  days: Array<TeamCalendarDay | null>;
  points: TeamTimelinePoint[];
  sharedCount: number;
  reviewedBlocks: number;
  eligibleBlocks: number;
  reliableCapacityPct: number | null;
  reactivePct: number | null;
  meetingPct: number | null;
  fragmentedPct: number | null;
  hasToday: boolean;
  hasForecast: boolean;
}

export interface TeamTimelineCapacityForecast {
  verdict: "forecast" | "insufficient-shared-data" | "no-history";
  median: number | null;
  min: number | null;
  max: number | null;
  weekCount: number;
  sharedCount: number;
  memberCount: number;
  latestWeekId: string | null;
}

export type TeamCalendarEvidenceInsight =
  | "blended-pressure"
  | "meeting-dense"
  | "communication-burst"
  | null;

/**
 * Local-only, display-safe facts for one calendar day. These values are counts
 * and unioned minutes; they deliberately cannot carry event titles, people,
 * message content, provider ids, or opaque conversation identifiers.
 */
export interface TeamCalendarEvidenceDay {
  dateId: string;
  calendarEventCount: number;
  calendarMinutes: number;
  chatEpisodeCount: number;
  directedChatCount: number;
  reviewedBlockCount: number;
  insight: TeamCalendarEvidenceInsight;
}

interface TeamCalendarEvidenceInput {
  calendarEvents: Array<{
    start_time: string;
    end_time: string;
    all_day?: boolean;
  }>;
  chatEvents: Array<{
    timestamp_start: string;
    timestamp_end: string;
    source_type: string;
    metadata: Record<string, string | null>;
  }>;
  workBlocks: Array<{
    start_time: string;
    user_verified: boolean;
  }>;
  timeZone?: string;
}

const ZOOM_WEEK_COUNTS: Record<TeamTimelineZoom, number> = {
  week: 1,
  month: 4,
  quarter: 13,
};

const DAY_MS = 86_400_000;
const FORECAST_DAY_COUNT = 7;
const FORECAST_WINDOW_WEEKS = 6;
const MIN_FORECAST_SHARED_COUNT = 2;
const MIN_FORECAST_SHARED_RATIO = 0.5;
const STALE_AFTER_MS = 7 * DAY_MS;

function dateIdInTimeZone(value: string, timeZone: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

/** Pick the most useful evidence day when the calendar opens. */
export function defaultTeamCalendarEvidenceDate(
  evidence: ReadonlyArray<{ dateId: string }>,
  todayIso: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
): string | null {
  const todayId = dateIdInTimeZone(todayIso, timeZone);
  if (!todayId) return null;
  const dates = [...new Set(evidence
    .map(({ dateId }) => dateId)
    .filter((dateId) => /^\d{4}-\d{2}-\d{2}$/.test(dateId)))]
    .sort();
  if (dates.includes(todayId)) return todayId;
  const historicalDates = dates.filter((dateId) => dateId < todayId);
  return historicalDates[historicalDates.length - 1]
    ?? dates.find((dateId) => dateId > todayId)
    ?? null;
}

function unionMinutes(spans: Array<{ start: number; end: number }>): number {
  const sorted = spans
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((left, right) => left.start - right.start);
  if (sorted.length === 0) return 0;
  let total = 0;
  let cursorStart = sorted[0]?.start ?? 0;
  let cursorEnd = sorted[0]?.end ?? 0;
  for (const span of sorted.slice(1)) {
    if (span.start <= cursorEnd) {
      cursorEnd = Math.max(cursorEnd, span.end);
    } else {
      total += cursorEnd - cursorStart;
      cursorStart = span.start;
      cursorEnd = span.end;
    }
  }
  return Math.round((total + cursorEnd - cursorStart) / 60_000);
}

/**
 * Blend the current Mac user's already-normalized Calendar and Chat evidence
 * into daily facts for the Team calendar. The result never enters Team cloud
 * sharing: it is a private local overlay beside approved team aggregates.
 */
export function buildTeamCalendarEvidence({
  calendarEvents,
  chatEvents,
  workBlocks,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
}: TeamCalendarEvidenceInput): TeamCalendarEvidenceDay[] {
  const days = new Map<string, {
    calendarEventCount: number;
    meetingSpans: Array<{ start: number; end: number }>;
    chatEpisodeCount: number;
    directedChatCount: number;
    reviewedBlockCount: number;
  }>();
  const day = (dateId: string) => {
    const current = days.get(dateId) ?? {
      calendarEventCount: 0,
      meetingSpans: [],
      chatEpisodeCount: 0,
      directedChatCount: 0,
      reviewedBlockCount: 0,
    };
    days.set(dateId, current);
    return current;
  };

  for (const event of calendarEvents) {
    if (event.all_day) continue;
    const dateId = dateIdInTimeZone(event.start_time, timeZone);
    const start = Date.parse(event.start_time);
    const end = Date.parse(event.end_time);
    if (!dateId || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const current = day(dateId);
    current.calendarEventCount += 1;
    current.meetingSpans.push({ start, end });
  }

  for (const event of chatEvents) {
    if (event.source_type !== "chat") continue;
    const dateId = dateIdInTimeZone(event.timestamp_start, timeZone);
    if (!dateId) continue;
    const current = day(dateId);
    current.chatEpisodeCount += 1;
    if (event.metadata.directed_trigger === "true") current.directedChatCount += 1;
  }

  for (const block of workBlocks) {
    if (!block.user_verified) continue;
    const dateId = dateIdInTimeZone(block.start_time, timeZone);
    if (dateId) day(dateId).reviewedBlockCount += 1;
  }

  return [...days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([dateId, value]) => {
    const calendarMinutes = unionMinutes(value.meetingSpans);
    const insight: TeamCalendarEvidenceInsight = calendarMinutes >= 180 && value.chatEpisodeCount >= 4
      ? "blended-pressure"
      : calendarMinutes >= 180 || value.calendarEventCount >= 4
        ? "meeting-dense"
        : value.chatEpisodeCount >= 6 || value.directedChatCount >= 3
          ? "communication-burst"
          : null;
    return {
      dateId,
      calendarEventCount: value.calendarEventCount,
      calendarMinutes,
      chatEpisodeCount: value.chatEpisodeCount,
      directedChatCount: value.directedChatCount,
      reviewedBlockCount: value.reviewedBlockCount,
      insight,
    };
  });
}

function isoDateId(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDay(value: string): Date | null {
  const dateId = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateId)) return null;
  const date = new Date(`${dateId}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || isoDateId(date) !== dateId ? null : date;
}

function isoWeekId(date: Date): string {
  const cursor = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  ));
  const day = cursor.getUTCDay() || 7;
  cursor.setUTCDate(cursor.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((cursor.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${cursor.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function isoWeekMonday(weekId: string): Date | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isInteger(year) || week < 1 || week > 53) return null;
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthDay = januaryFourth.getUTCDay() || 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - januaryFourthDay + 1 + ((week - 1) * 7));
  return isoWeekId(monday) === weekId ? monday : null;
}

/**
 * Daily calendar columns for the existing Week / Month / Quarter controls.
 * Each horizon shows that many completed-or-current calendar days and always
 * reserves the next seven days as a visibly separate forecast window.
 */
export function teamTimelineCalendarDays(
  todayIso: string,
  zoom: TeamTimelineZoom,
): TeamCalendarDay[] {
  const today = parseIsoDay(todayIso);
  if (!today) return [];
  const historyDayCount = ZOOM_WEEK_COUNTS[zoom] * 7;
  const first = new Date(today.getTime() - ((historyDayCount - 1) * DAY_MS));
  return Array.from({ length: historyDayCount + FORECAST_DAY_COUNT }, (_, index) => {
    const date = new Date(first.getTime() + (index * DAY_MS));
    const dateId = isoDateId(date);
    const offsetFromToday = Math.round((date.getTime() - today.getTime()) / DAY_MS);
    const weekday = date.getUTCDay();
    return {
      dateId,
      weekId: isoWeekId(date),
      weekdayLabel: new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(date),
      dayLabel: String(date.getUTCDate()),
      monthLabel: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date),
      isWeekend: weekday === 0 || weekday === 6,
      kind: offsetFromToday < 0 ? "history" : offsetFromToday === 0 ? "today" : "forecast",
    };
  });
}

/**
 * Position weekly approved summaries on a daily calendar. A snapshot occupies
 * only the visible days of its ISO week and never extends into the forecast
 * side of Today, so the chart does not imply daily observations we do not own.
 */
export function buildTeamCalendar(
  points: TeamTimelinePoint[],
  todayIso: string,
  zoom: TeamTimelineZoom,
  identities: TeamTimelineIdentity[] = [],
): TeamCalendar {
  const days = teamTimelineCalendarDays(todayIso, zoom);
  const todayIndex = days.findIndex((day) => day.kind === "today");
  const forecastStartIndex = days.findIndex((day) => day.kind === "forecast");
  const visibleWeekIds = new Set(days.filter((day) => day.kind !== "forecast").map((day) => day.weekId));
  const latestByMemberWeek = new Map<string, TeamTimelinePoint>();

  for (const point of points) {
    if (!visibleWeekIds.has(point.weekId)) continue;
    const key = `${point.userId}:${point.weekId}`;
    const current = latestByMemberWeek.get(key);
    if (!current || point.syncedAt > current.syncedAt) latestByMemberWeek.set(key, point);
  }

  const identityByUser = new Map<string, Pick<TeamTimelinePoint, "displayName" | "isSelf">>(
    identities.map(({ userId, displayName, isSelf }) => [userId, { displayName, isSelf }]),
  );
  for (const point of latestByMemberWeek.values()) {
    identityByUser.set(point.userId, {
      displayName: point.displayName,
      isSelf: point.isSelf,
    });
  }

  const rows = Array.from(identityByUser, ([userId, identity]) => {
    const bars = Array.from(latestByMemberWeek.values())
      .filter((point) => point.userId === userId)
      .map((point) => {
        const indexes = days.flatMap((day, index) => (
          day.kind !== "forecast" && day.weekId === point.weekId ? [index] : []
        ));
        if (indexes.length === 0) return null;
        return {
          point,
          startIndex: indexes[0] as number,
          spanDays: indexes.length,
        };
      })
      .filter((bar): bar is TeamCalendarBar => bar !== null)
      .sort((left, right) => left.startIndex - right.startIndex);
    return { userId, displayName: identity.displayName, isSelf: identity.isSelf, bars };
  }).sort((left, right) => (
    Number(right.isSelf) - Number(left.isSelf)
    || left.displayName.localeCompare(right.displayName)
    || left.userId.localeCompare(right.userId)
  ));

  return { days, rows, todayIndex, forecastStartIndex };
}

function numericMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number);
}

function medianPointMetric(
  points: TeamTimelinePoint[],
  key: "reliableCapacityPct" | "reactivePct" | "meetingPct" | "fragmentedPct",
): number | null {
  return numericMedian(points.flatMap((point) => {
    const value = point[key];
    return typeof value === "number" && Number.isFinite(value) ? [value] : [];
  }));
}

/**
 * Convert the rolling horizon into Monday-first calendar rows and team-level
 * weekly analytics. Metrics are medians of the latest approved member summary;
 * missing values stay null and forecast days never become observations.
 */
export function buildTeamCalendarWeeks(calendar: TeamCalendar): TeamCalendarWeek[] {
  const weeks: TeamCalendarWeek[] = [];
  const weekById = new Map<string, TeamCalendarWeek>();

  for (const day of calendar.days) {
    let week = weekById.get(day.weekId);
    if (!week) {
      const points = calendar.rows.flatMap((row) => row.bars
        .filter((bar) => bar.point.weekId === day.weekId)
        .map((bar) => bar.point));
      week = {
        weekId: day.weekId,
        days: Array<TeamCalendarDay | null>(7).fill(null),
        points,
        sharedCount: new Set(points.map((point) => point.userId)).size,
        reviewedBlocks: points.reduce((total, point) => total + point.reviewedBlocks, 0),
        eligibleBlocks: points.reduce((total, point) => total + point.eligibleBlocks, 0),
        reliableCapacityPct: medianPointMetric(points, "reliableCapacityPct"),
        reactivePct: medianPointMetric(points, "reactivePct"),
        meetingPct: medianPointMetric(points, "meetingPct"),
        fragmentedPct: medianPointMetric(points, "fragmentedPct"),
        hasToday: false,
        hasForecast: false,
      };
      weekById.set(day.weekId, week);
      weeks.push(week);
    }
    const parsed = parseIsoDay(day.dateId);
    if (!parsed) continue;
    const mondayFirstIndex = (parsed.getUTCDay() + 6) % 7;
    week.days[mondayFirstIndex] = day;
    week.hasToday ||= day.kind === "today";
    week.hasForecast ||= day.kind === "forecast";
  }

  return weeks;
}

/**
 * A compact, deterministic reliable-capacity forecast for the native calendar.
 * It mirrors the Web forecast's guardrails: latest retries win, current team
 * coverage must include at least two people and half the roster, and the value
 * is the median/range of up to six weekly team medians—not a per-person guess.
 */
export function buildTeamTimelineCapacityForecast(
  points: TeamTimelinePoint[],
  memberCount: number,
  nowIso: string,
): TeamTimelineCapacityForecast {
  const latestByMemberWeek = new Map<string, TeamTimelinePoint>();
  for (const point of points) {
    const key = `${point.userId}:${point.weekId}`;
    const current = latestByMemberWeek.get(key);
    if (!current || point.syncedAt > current.syncedAt) latestByMemberWeek.set(key, point);
  }
  const capacityPoints = [...latestByMemberWeek.values()].filter((point) => (
    typeof point.reliableCapacityPct === "number" && Number.isFinite(point.reliableCapacityPct)
  ));
  const weekIds = [...new Set(capacityPoints.map((point) => point.weekId))].sort();
  if (weekIds.length === 0) {
    return { verdict: "no-history", median: null, min: null, max: null, weekCount: 0, sharedCount: 0, memberCount, latestWeekId: null };
  }

  const now = Date.parse(nowIso);
  const latestWeekId = [...weekIds].reverse().find((weekId) => capacityPoints.some((point) => {
    if (point.weekId !== weekId) return false;
    const synced = Date.parse(point.syncedAt);
    return Number.isFinite(now) && Number.isFinite(synced) && now - synced <= STALE_AFTER_MS;
  })) ?? null;
  const currentPoints = latestWeekId === null ? [] : capacityPoints.filter((point) => {
    if (point.weekId !== latestWeekId) return false;
    const synced = Date.parse(point.syncedAt);
    return Number.isFinite(now) && Number.isFinite(synced) && now - synced <= STALE_AFTER_MS;
  });
  const sharedCount = new Set(currentPoints.map((point) => point.userId)).size;
  const coverageOk = sharedCount >= MIN_FORECAST_SHARED_COUNT
    && memberCount > 0
    && sharedCount / memberCount >= MIN_FORECAST_SHARED_RATIO;
  if (!coverageOk) {
    return { verdict: "insufficient-shared-data", median: null, min: null, max: null, weekCount: 0, sharedCount, memberCount, latestWeekId };
  }

  const weeklyMedians = weekIds.flatMap((weekId) => {
    const median = numericMedian(capacityPoints
      .filter((point) => point.weekId === weekId)
      .map((point) => point.reliableCapacityPct as number));
    return median === null ? [] : [median];
  }).slice(-FORECAST_WINDOW_WEEKS);
  return {
    verdict: "forecast",
    median: numericMedian(weeklyMedians),
    min: Math.min(...weeklyMedians),
    max: Math.max(...weeklyMedians),
    weekCount: weeklyMedians.length,
    sharedCount,
    memberCount,
    latestWeekId,
  };
}

export function teamTimelineWeeks(
  anchorWeekId: string,
  zoom: TeamTimelineZoom,
): string[] {
  const anchor = isoWeekMonday(anchorWeekId);
  if (!anchor) return [];
  const count = ZOOM_WEEK_COUNTS[zoom];
  return Array.from({ length: count }, (_, index) => {
    const week = new Date(anchor);
    week.setUTCDate(anchor.getUTCDate() - ((count - index - 1) * 7));
    return isoWeekId(week);
  });
}

export function buildTeamTimeline(
  points: TeamTimelinePoint[],
  anchorWeekId: string,
  zoom: TeamTimelineZoom,
  identities: TeamTimelineIdentity[] = [],
): TeamTimeline {
  const weeks = teamTimelineWeeks(anchorWeekId, zoom);
  const visibleWeeks = new Set(weeks);
  const latestByMemberWeek = new Map<string, TeamTimelinePoint>();

  for (const point of points) {
    if (!visibleWeeks.has(point.weekId)) continue;
    const key = `${point.userId}:${point.weekId}`;
    const current = latestByMemberWeek.get(key);
    if (!current || point.syncedAt > current.syncedAt) latestByMemberWeek.set(key, point);
  }

  const identityByUser = new Map<string, Pick<TeamTimelinePoint, "displayName" | "isSelf">>(
    identities.map(({ userId, displayName, isSelf }) => [userId, { displayName, isSelf }]),
  );
  for (const point of latestByMemberWeek.values()) {
    identityByUser.set(point.userId, {
      displayName: point.displayName,
      isSelf: point.isSelf,
    });
  }

  const rows = Array.from(identityByUser, ([userId, identity]) => ({
    userId,
    displayName: identity.displayName,
    isSelf: identity.isSelf,
    cells: weeks.map((weekId) => latestByMemberWeek.get(`${userId}:${weekId}`) ?? null),
  })).sort((left, right) => (
    Number(right.isSelf) - Number(left.isSelf)
    || left.displayName.localeCompare(right.displayName)
    || left.userId.localeCompare(right.userId)
  ));

  return { weeks, rows };
}
