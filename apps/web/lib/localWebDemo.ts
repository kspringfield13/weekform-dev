import type {
  PersonalReplicaBlockV1,
  PersonalReplicaCapacityV1,
  PersonalWorkloadReplicaV1,
} from "../../../packages/domain/src/personalCloud";
import {
  buildTeamCalendarEvidence,
  type TeamCalendarEvidenceDay,
} from "../../../packages/inference/src/teamTimeline";
import { forecastTeamCapacity, type TeamCapacityForecast } from "./forecast";
import type { PersonalReplicaView } from "./personalReplica";
import type { LatestSnapshot } from "./snapshots";
export {
  localWebDemoEnabled,
  localWebDemoRequestEnabled,
} from "./localWebDemoGate";

interface DemoSourceStatus {
  name: "Apple Calendar" | "Slack";
  synthetic: true;
  lastSyncedAt: string;
}

export interface LocalWebDemoData {
  generatedAt: string;
  sources: {
    calendar: DemoSourceStatus & { eventCount: number; minutes: number };
    chat: DemoSourceStatus & { episodeCount: number; directedCount: number };
  };
  personalReplicas: PersonalReplicaView[];
  team: {
    teamId: string;
    teamName: string;
    viewerId: string;
    anchorWeekId: string;
    identities: Array<{ userId: string; name: string }>;
    latest: LatestSnapshot[];
    history: LatestSnapshot[];
    evidence: TeamCalendarEvidenceDay[];
    forecast: TeamCapacityForecast;
  };
}

const DAY_MS = 86_400_000;
const TEAM_ID = "local-demo-team";
const VIEWER_ID = "local-demo-maya";

function startOfIsoWeek(reference: Date): Date {
  const result = new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  ));
  const weekday = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - weekday + 1);
  return result;
}

function isoWeekId(reference: Date): string {
  const cursor = new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  ));
  const weekday = cursor.getUTCDay() || 7;
  cursor.setUTCDate(cursor.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((cursor.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
  return `${cursor.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function at(
  weekStart: Date,
  day: number,
  hour: number,
  minute = 0,
): Date {
  return new Date(weekStart.getTime() + (day * DAY_MS) + ((hour * 60 + minute) * 60_000));
}

function revision(seed: number): string {
  return Math.max(0, seed).toString(16).padStart(16, "0").slice(-16);
}

const PERSONAL_BLOCKS = [
  {
    category: "Planned analysis / project work",
    mode: "Deep work",
    plannedStatus: "planned",
    day: 0,
    hour: 9,
    duration: 150,
    capacity: 12,
    confidence: 0.94,
  },
  {
    category: "Meetings / stakeholder syncs",
    mode: "Collaborative",
    plannedStatus: "fixed",
    day: 0,
    hour: 13,
    duration: 60,
    capacity: 7,
    confidence: 0.98,
  },
  {
    category: "Ad hoc stakeholder requests",
    mode: "Reactive",
    plannedStatus: "unplanned",
    day: 1,
    hour: 10,
    duration: 75,
    capacity: 8,
    confidence: 0.84,
  },
  {
    category: "Admin / coordination",
    mode: "Fragmented",
    plannedStatus: "unplanned",
    day: 1,
    hour: 14,
    duration: 50,
    capacity: 5,
    confidence: 0.78,
  },
  {
    category: "SQL / data modeling / query work",
    mode: "Deep work",
    plannedStatus: "planned",
    day: 2,
    hour: 9,
    duration: 135,
    capacity: 11,
    confidence: 0.92,
  },
  {
    category: "Recurring reporting",
    mode: "Fragmented",
    plannedStatus: "fixed",
    day: 3,
    hour: 11,
    duration: 90,
    capacity: 9,
    confidence: 0.9,
  },
  {
    category: "Blocked / waiting / dependency delay",
    mode: "Blocked",
    plannedStatus: "blocked",
    day: 4,
    hour: 10,
    duration: 60,
    capacity: 6,
    confidence: 0.73,
  },
] as const satisfies ReadonlyArray<{
  category: PersonalReplicaBlockV1["category"];
  mode: PersonalReplicaBlockV1["mode"];
  plannedStatus: PersonalReplicaBlockV1["plannedStatus"];
  day: number;
  hour: number;
  duration: number;
  capacity: number;
  confidence: number;
}>;

function demoCapacity(weekOffset: number): PersonalReplicaCapacityV1 {
  const reliable = [24, 29, 20, 33, 27, 36][weekOffset] ?? 24;
  const reactive = [24, 19, 31, 16, 22, 14][weekOffset] ?? 24;
  const meetings = [27, 23, 29, 18, 25, 17][weekOffset] ?? 27;
  const fragmented = [18, 15, 23, 13, 17, 12][weekOffset] ?? 18;
  return {
    allocatedPct: 88 - Math.min(weekOffset * 2, 10),
    deepWorkPct: 36 + Math.min(weekOffset * 2, 10),
    fragmentedWorkPct: fragmented,
    meetingPct: meetings,
    reactivePct: reactive,
    plannedPct: 61,
    blockedPct: weekOffset === 0 ? 6 : 2,
    reliableNewWorkCapacityPct: reliable,
    committedUtilizationPct: 68 + Math.max(0, 3 - weekOffset),
    carryoverRiskPct: weekOffset === 0 ? 28 : 18,
    wipLoadScore: 54,
    contextSwitchScore: 41,
    summaryConfidence: 0.88,
  };
}

function personalReplica(reference: Date, weekOffset: number): PersonalReplicaView {
  const currentMonday = startOfIsoWeek(reference);
  const monday = new Date(currentMonday.getTime() - (weekOffset * 7 * DAY_MS));
  const weekId = isoWeekId(monday);
  const blueprints = weekOffset === 0 ? PERSONAL_BLOCKS.slice(0, 4) : PERSONAL_BLOCKS;
  const blocks: PersonalReplicaBlockV1[] = blueprints.map((blueprint, index) => {
    const startTime = at(monday, blueprint.day, blueprint.hour);
    return {
      blockId: `local-demo-${weekId.toLowerCase()}-${index + 1}`,
      weekId,
      startTime: startTime.toISOString(),
      endTime: new Date(startTime.getTime() + (blueprint.duration * 60_000)).toISOString(),
      estimatedCapacityPct: blueprint.capacity,
      category: blueprint.category,
      mode: blueprint.mode,
      plannedStatus: blueprint.plannedStatus,
      confidence: blueprint.confidence,
      userVerified: index < blueprints.length - (weekOffset === 0 ? 1 : 0),
      blockerFlag: blueprint.mode === "Blocked",
      revision: revision(10_000 + (weekOffset * 100) + index),
    };
  });
  const generatedAt = new Date(reference.getTime() - (weekOffset * 7 * DAY_MS) - 8 * 60_000);
  const payload: PersonalWorkloadReplicaV1 = {
    schemaVersion: 1,
    replicaId: `personal-${weekId}`,
    weekId,
    generatedAt: generatedAt.toISOString(),
    sourceUpdatedAt: new Date(generatedAt.getTime() - 4 * 60_000).toISOString(),
    blocks,
    capacity: demoCapacity(weekOffset),
  };
  return {
    replicaId: payload.replicaId,
    weekId,
    revision: revision(20_000 + weekOffset),
    syncedAt: new Date(generatedAt.getTime() + 2 * 60_000).toISOString(),
    payload,
  };
}

const TEAM_IDENTITIES = [
  { userId: VIEWER_ID, name: "Maya Chen" },
  { userId: "local-demo-jordan", name: "Jordan Lee" },
  { userId: "local-demo-sam", name: "Sam Rivera" },
  { userId: "local-demo-riley", name: "Riley Morgan" },
  { userId: "local-demo-quinn", name: "Quinn Patel" },
];

function teamHistory(reference: Date): LatestSnapshot[] {
  const currentMonday = startOfIsoWeek(reference);
  const capacityByMember = [31, 14, 24, 38, 19];
  return Array.from({ length: 13 }, (_, weekOffset) => {
    const monday = new Date(currentMonday.getTime() - (weekOffset * 7 * DAY_MS));
    const weekId = isoWeekId(monday);
    return TEAM_IDENTITIES.map((identity, memberIndex): LatestSnapshot => {
      const unknownCurrent = memberIndex === 3 && weekOffset === 0;
      const observedAt = weekOffset === 0
        ? new Date(reference.getTime() - ((memberIndex + 1) * 32 * 60_000))
        : new Date(at(monday, 4, 16).getTime() + (memberIndex * 60_000));
      const drift = ((weekOffset + memberIndex) % 3) - 1;
      return {
        userId: identity.userId,
        teamId: TEAM_ID,
        weekId,
        observedAt: observedAt.toISOString(),
        sourceUpdatedAt: new Date(observedAt.getTime() - 5 * 60_000).toISOString(),
        shareLevel: memberIndex === 0 ? "categories" : "summary",
        reliableCapacityPct: unknownCurrent ? null : Math.max(8, capacityByMember[memberIndex]! + (drift * 4) + weekOffset),
        reactivePct: unknownCurrent ? null : Math.max(8, 30 - (memberIndex * 4) + (drift * 3)),
        meetingPct: unknownCurrent ? null : 18 + (memberIndex * 5) + (weekOffset % 2) * 3,
        fragmentedPct: unknownCurrent ? null : 13 + (memberIndex * 3) + Math.abs(drift * 2),
        summaryConfidence: unknownCurrent ? null : 0.78 + (memberIndex * 0.04),
        reviewedBlocks: unknownCurrent ? 0 : 24 + memberIndex * 3,
        eligibleBlocks: unknownCurrent ? 0 : 29 + memberIndex * 4,
      };
    });
  }).flat();
}

function evidenceInputs(reference: Date) {
  const calendarEvents: Array<{
    start_time: string;
    end_time: string;
    all_day?: boolean;
    source: "apple_calendar";
  }> = [];
  const chatEvents: Array<{
    timestamp_start: string;
    timestamp_end: string;
    source_type: string;
    metadata: Record<string, string | null>;
  }> = [];
  const workBlocks: Array<{ start_time: string; user_verified: boolean }> = [];
  const observedCutoff = reference.getTime() - 10 * 60_000;
  const dayOffsets = [
    -88, -84, -81, -77, -74, -70, -67, -63, -60, -56,
    -53, -49, -46, -42, -39, -35, -32, -28, -24, -20,
    -17, -14, -11, -8, -6, -4, -3, -2, -1, 0,
  ];

  for (const [dayIndex, dayOffset] of dayOffsets.entries()) {
    const dayStart = new Date(Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate() + dayOffset,
      9,
    ));
    const blendedPressureDay = dayOffset === -1 || dayOffset === 0;
    const meetingDenseDay = dayOffset === -4;
    const communicationBurstDay = dayOffset === -3;
    const calendarCount = blendedPressureDay || meetingDenseDay ? 4 : 1 + (dayIndex % 3);
    const chatCount = blendedPressureDay || communicationBurstDay
      ? 6
      : meetingDenseDay
        ? 2
        : 1 + ((dayIndex * 2) % 5);
    for (let index = 0; index < calendarCount; index += 1) {
      const start = new Date(dayStart.getTime() + (index * 75 * 60_000));
      const durationMinutes = blendedPressureDay || meetingDenseDay ? 60 : 40 + ((index % 2) * 20);
      calendarEvents.push({
        start_time: start.toISOString(),
        end_time: new Date(start.getTime() + durationMinutes * 60_000).toISOString(),
        source: "apple_calendar",
      });
    }
    for (let index = 0; index < chatCount; index += 1) {
      const start = new Date(dayStart.getTime() + ((index * 38 + 25) * 60_000));
      const end = new Date(start.getTime() + 12 * 60_000);
      if (end.getTime() > observedCutoff) continue;
      chatEvents.push({
        timestamp_start: start.toISOString(),
        timestamp_end: end.toISOString(),
        source_type: "chat",
        metadata: {
          provider: "slack",
          kind: "response_episode",
          attention_signal: "self_sent",
          directed_trigger: (blendedPressureDay || communicationBurstDay) && index < 3 ? "true" : null,
        },
      });
    }
    const candidateWorkBlocks = [
      { start_time: new Date(dayStart.getTime() + 15 * 60_000), user_verified: true },
      { start_time: new Date(dayStart.getTime() + 4 * 60 * 60_000), user_verified: dayIndex % 3 !== 0 },
    ];
    workBlocks.push(...candidateWorkBlocks.flatMap((block) => (
      block.start_time.getTime() <= observedCutoff
        ? [{ start_time: block.start_time.toISOString(), user_verified: block.user_verified }]
        : []
    )));
  }
  return { calendarEvents, chatEvents, workBlocks };
}

export function createLocalWebDemoData(reference = new Date()): LocalWebDemoData {
  const generatedAt = new Date(reference);
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("Local Web demo requires a valid reference date.");
  }
  const personalReplicas = Array.from({ length: 6 }, (_, index) => personalReplica(generatedAt, index));
  const history = teamHistory(generatedAt);
  const anchorWeekId = isoWeekId(generatedAt);
  const latest = history.filter((snapshot) => snapshot.weekId === anchorWeekId);
  const inputs = evidenceInputs(generatedAt);
  const evidence = buildTeamCalendarEvidence({ ...inputs, timeZone: "UTC" });
  const lastSyncedAt = new Date(generatedAt.getTime() - 6 * 60_000).toISOString();

  return {
    generatedAt: generatedAt.toISOString(),
    sources: {
      calendar: {
        name: "Apple Calendar",
        synthetic: true,
        eventCount: inputs.calendarEvents.length,
        minutes: evidence.reduce((total, day) => total + day.calendarMinutes, 0),
        lastSyncedAt,
      },
      chat: {
        name: "Slack",
        synthetic: true,
        episodeCount: inputs.chatEvents.length,
        directedCount: evidence.reduce((total, day) => total + day.directedChatCount, 0),
        lastSyncedAt,
      },
    },
    personalReplicas,
    team: {
      teamId: TEAM_ID,
      teamName: "Northstar Analytics",
      viewerId: VIEWER_ID,
      anchorWeekId,
      identities: TEAM_IDENTITIES,
      latest,
      history,
      evidence,
      forecast: forecastTeamCapacity(TEAM_IDENTITIES.length, history, generatedAt.toISOString()),
    },
  };
}
