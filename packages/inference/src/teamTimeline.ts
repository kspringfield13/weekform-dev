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

const ZOOM_WEEK_COUNTS: Record<TeamTimelineZoom, number> = {
  week: 1,
  month: 4,
  quarter: 13,
};

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
