import type {
  ActiveWindowSample,
  ActivitySession,
  AuditEvent,
  OutlookCalendarEvent,
  RawEvent,
  UserCorrection,
  WorkBlock,
  WorkCategory,
  WorkMode,
  PlannedStatus,
} from "../../domain/src/models";
import { sessionizeActiveWindowSamples } from "../../inference/src/sessionizer/activeWindow";
import {
  analyzeInterruptionLoad,
  computeCapacityBaselines,
  computeWeeklyCapacitySnapshot,
  generateWeeklyNarrative,
} from "../../inference/src/capacity";
import { buildAccelerationSignals } from "../../inference/src/accelerate";
import { outlookEventsToWorkBlocks } from "../../integrations/src/calendar/outlookIcs";
import { importRawEvents, type RawEventImport } from "../../integrations/src/import/rawEvents";
import { canonicalJson, createSeededRandom, fingerprint } from "./canonical";
import {
  addDays,
  addMinutesToWallTime,
  isoWeekday,
  isoWeekId,
  simulationWeekStarts,
  zonedDateTimeToIso,
} from "./clock";
import { getPersona } from "./personas";
import { getPersonaWorkCatalog } from "./workCatalog";
import { validateSimulationConfig, validateSimulationDataset } from "./validate";
import type {
  ArtifactStamp,
  SimulationArtifact,
  SimulationArtifacts,
  SimulationCheckpoint,
  SimulationConfig,
  SimulationDataset,
  SimulationForecast,
  SimulationMember,
  SimulationPersona,
  SimulationBusinessRecord,
  SimulationCommunication,
  SimulationSharedSnapshot,
  SimulationWorkItem,
  SimulationWeekSnapshot,
} from "./types";

const PROVENANCE = [
  "sessionizeActiveWindowSamples",
  "importRawEvents",
  "outlookEventsToWorkBlocks",
  "computeWeeklyCapacitySnapshot",
  "computeCapacityBaselines",
  "generateWeeklyNarrative",
  "analyzeInterruptionLoad",
  "buildAccelerationSignals",
  "personaWorkCatalog",
];

interface Intent {
  start: string;
  end: string;
  appName: string;
  windowTitle: string;
  category: WorkCategory;
  mode: WorkMode;
  plannedStatus: PlannedStatus;
  project: string;
  stakeholder: string;
  workItemId: string;
}

interface RunIdentity {
  runId: string;
  canonicalDatasetId: string;
  inputFingerprint: string;
}

function emptyArtifacts(): SimulationArtifacts {
  return {
    rawEvents: [],
    activeWindowSamples: [],
    activitySessions: [],
    calendarEvents: [],
    workBlocks: [],
    corrections: [],
    weeklySnapshots: [],
    narratives: [],
    accelerationSignals: [],
    forecasts: [],
    sharedSnapshots: [],
    workItems: [],
    communications: [],
    businessRecords: [],
    auditEvents: [],
  };
}

function cloneArtifacts(artifacts: SimulationArtifacts): SimulationArtifacts {
  const normalized = emptyArtifacts();
  for (const key of Object.keys(normalized) as Array<keyof SimulationArtifacts>) {
    const values = artifacts[key];
    (normalized[key] as SimulationArtifact<unknown>[]) = Array.isArray(values)
      ? [...(values as SimulationArtifact<unknown>[])]
      : [];
  }
  return normalized;
}

function inputIdentity(config: SimulationConfig): RunIdentity {
  const inputFingerprint = fingerprint({
    generatorVersion: config.generatorVersion,
    members: config.members,
    startDate: config.startDate,
    span: config.span,
    timezone: config.timezone,
    workDays: [...config.workDays].sort(),
    workingHours: config.workingHours,
    holidays: [...config.holidays].sort(),
    pto: config.pto,
    scenario: config.scenario,
    seed: config.seed,
    sharingPolicy: config.sharingPolicy,
    executionMode: config.executionMode,
  });
  return {
    inputFingerprint,
    runId: `sim-run-${inputFingerprint.slice(0, 12)}`,
    canonicalDatasetId: `sim-data-${inputFingerprint.slice(0, 16)}`,
  };
}

function expandMembers(config: SimulationConfig, identity: RunIdentity): SimulationMember[] {
  const members: SimulationMember[] = [];
  let ordinal = 0;
  for (const spec of config.members) {
    const persona = getPersona(spec.personaId);
    if (!persona) continue;
    for (let count = 0; count < spec.count; count += 1) {
      const memberNumber = String(ordinal + 1).padStart(2, "0");
      members.push({
        memberId: `${identity.canonicalDatasetId}:member:${String(ordinal).padStart(3, "0")}`,
        personaId: persona.id,
        personaVersion: persona.version,
        role: persona.role,
        displayName: `Simulated ${persona.displayName} ${memberNumber}`,
        isSynthetic: true,
      });
      ordinal += 1;
    }
  }
  return members;
}

function artifact<T>(
  payload: T,
  kind: string,
  member: SimulationMember,
  config: SimulationConfig,
  identity: RunIdentity,
  coordinate: string,
): SimulationArtifact<T> {
  const stamp: ArtifactStamp = {
    isSynthetic: true,
    simulationRunId: identity.runId,
    canonicalDatasetId: identity.canonicalDatasetId,
    canonicalArtifactId: `${identity.canonicalDatasetId}:${member.memberId.split(":").pop()}:${coordinate}:${kind}`,
    memberId: member.memberId,
    personaVersion: member.personaVersion,
    generatorVersion: config.generatorVersion,
    seed: config.seed,
  };
  return { stamp, payload };
}

function weightedPick<T>(values: Array<{ value: T; weight: number }>, random: () => number): T {
  const roll = random() * 100;
  let cursor = 0;
  for (const entry of values) {
    cursor += entry.weight;
    if (roll < cursor) return entry.value;
  }
  return values[values.length - 1].value;
}

function scenarioPressure(config: SimulationConfig, weekIndex: number, totalWeeks: number) {
  let workload = 1;
  let reactive = 1;
  let fragmentation = 1;
  let meetings = 1;
  let recovery = false;
  let reactiveSpike = false;

  if (config.scenario.kind === "quiet") workload = 0.72;
  if (config.scenario.kind === "busy") workload = 1.2;
  if (config.scenario.kind === "deadline-heavy") {
    const cycle = weekIndex % 6;
    workload = 1 + cycle * 0.07;
    reactive = 1 + cycle * 0.08;
  }
  if (config.scenario.kind === "incident") {
    reactiveSpike = weekIndex % 8 === 4;
    reactive = reactiveSpike ? 1.8 : 1.12;
    fragmentation = reactiveSpike ? 1.6 : 1.1;
  }
  if (config.scenario.kind === "launch") {
    const distance = Math.abs((weekIndex % 10) - 7);
    workload = 1 + Math.max(0, 4 - distance) * 0.1;
    meetings = 1 + Math.max(0, 3 - distance) * 0.08;
  }
  if (config.scenario.kind === "quarter-end") {
    if (weekIndex >= 5 && weekIndex <= 7) {
      workload = 1.08;
      meetings = 1.12;
    } else if (weekIndex >= 8 && weekIndex <= 12) {
      const ramp = weekIndex - 7;
      workload = 1.08 + ramp * 0.08;
      reactive = 1.1 + ramp * 0.12;
      fragmentation = 1.08 + ramp * 0.1;
      meetings = 1.1 + ramp * 0.05;
      if (weekIndex === 11) {
        reactive = 2;
        fragmentation = 1.75;
        reactiveSpike = true;
      }
    } else if (weekIndex === 13 || weekIndex === 14) {
      workload = weekIndex === 13 ? 0.68 : 0.8;
      reactive = 0.62;
      fragmentation = 0.7;
      meetings = 0.72;
      recovery = true;
    } else if (weekIndex >= Math.max(21, totalWeeks - 5)) {
      const ramp = weekIndex - Math.max(20, totalWeeks - 6);
      workload = 1.04 + ramp * 0.045;
      reactive = 1.02 + ramp * 0.06;
      fragmentation = 1.02 + ramp * 0.04;
      meetings = 1.03 + ramp * 0.03;
    }
  }
  return { workload, reactive, fragmentation, meetings, recovery, reactiveSpike };
}

function isUnavailable(config: SimulationConfig, memberOrdinal: number, date: string) {
  if (config.holidays.includes(date)) return true;
  return config.pto.some(
    (range) =>
      (range.memberOrdinal === undefined || range.memberOrdinal === memberOrdinal) &&
      date >= range.startDate &&
      date < range.endDateExclusive,
  );
}

function wallOffset(config: SimulationConfig, minutes: number) {
  return addMinutesToWallTime(config.workingHours.start, minutes);
}

function wallTimeMinutes(wallTime: string) {
  const [hour, minute] = wallTime.split(":").map(Number);
  return hour * 60 + minute;
}

function workingDayMinutes(config: SimulationConfig) {
  return wallTimeMinutes(config.workingHours.end) - wallTimeMinutes(config.workingHours.start);
}

function atWorkOffset(config: SimulationConfig, date: string, offset: number) {
  const boundedOffset = clamp(Math.round(offset), 0, workingDayMinutes(config));
  return zonedDateTimeToIso(date, wallOffset(config, boundedOffset), config.timezone);
}

function activeWorkDates(
  config: SimulationConfig,
  memberOrdinal: number,
  weekStart: string,
) {
  return Array.from({ length: 7 }, (_, day) => addDays(weekStart, day)).filter(
    (date) => config.workDays.includes(isoWeekday(date)) && !isUnavailable(config, memberOrdinal, date),
  );
}

function activeProjectPool(persona: SimulationPersona, projectCount: number) {
  return Array.from({ length: projectCount }, (_, index) => {
    const base = persona.projects[index % persona.projects.length];
    const cycle = Math.floor(index / persona.projects.length);
    return cycle === 0 ? base : `${base} · workstream ${cycle + 1}`;
  });
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, precision = 0) {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function pickRoleMode(
  config: SimulationConfig,
  persona: SimulationPersona,
  date: string,
  index: number,
  pressure: ReturnType<typeof scenarioPressure>,
  random: () => number,
): WorkMode {
  if (pressure.reactiveSpike && index === 2) return "Blocked";

  const reactiveDemand = clamp(
    (config.scenario.reactiveLoad / 100) * 0.65
      + (persona.reactiveLoad.typicalPercent / 100) * 0.75,
    0,
    1.4,
  ) * pressure.reactive;
  const interruptionDemand = clamp(
    (config.scenario.interruptions / 100) * 0.7
      + Math.min(1, persona.interruptions.perFocusHour / 2.5) * 0.45,
    0,
    1.4,
  ) * pressure.fragmentation;

  // High controls have a guaranteed, visible scheduling consequence while the
  // remaining duties continue to follow each persona's full mode distribution.
  if (reactiveDemand >= 0.65 && index === 2) return "Reactive";
  if (interruptionDemand >= 0.7 && index === 1) return "Fragmented";

  const preferredDeepWorkDay = persona.deepWorkCadence.preferredDays.includes(isoWeekday(date));
  const adjusted = persona.modeWeights
    .filter((entry) => pressure.reactiveSpike || entry.value !== "Blocked")
    .map((entry) => {
      let multiplier = 1;
      if (entry.value === "Reactive") multiplier = 0.3 + reactiveDemand * 1.8;
      if (entry.value === "Fragmented") multiplier = 0.35 + interruptionDemand * 1.55;
      if (entry.value === "Deep work" && preferredDeepWorkDay) multiplier = 1.35;
      return { value: entry.value, weight: entry.weight * multiplier };
    });
  const total = adjusted.reduce((sum, entry) => sum + entry.weight, 0);
  return weightedPick(adjusted.map((entry) => ({ ...entry, weight: (entry.weight / total) * 100 })), random);
}

function buildRoleArtifacts(
  config: SimulationConfig,
  persona: SimulationPersona,
  member: SimulationMember,
  memberOrdinal: number,
  weekStart: string,
  weekIndex: number,
  pressure: ReturnType<typeof scenarioPressure>,
): {
  workItems: SimulationWorkItem[];
  communications: SimulationCommunication[];
  businessRecords: SimulationBusinessRecord[];
} {
  const catalog = getPersonaWorkCatalog(persona.id);
  if (!catalog) throw new Error(`Persona ${persona.id} has no work catalog.`);
  const random = createSeededRandom(`${config.seed}|${member.memberId}|week:${weekIndex}|work-world`);
  const weekId = isoWeekId(weekStart);
  const workItems: SimulationWorkItem[] = [];
  const communications: SimulationCommunication[] = [];
  const businessRecords: SimulationBusinessRecord[] = [];
  const availableDates = activeWorkDates(config, memberOrdinal, weekStart);
  if (availableDates.length === 0) return { workItems, communications, businessRecords };

  const preferredDates = availableDates.filter((date) =>
    persona.deepWorkCadence.preferredDays.includes(isoWeekday(date))
  );
  const scheduledDates = preferredDates.length > 0 ? preferredDates : availableDates;
  const projects = activeProjectPool(persona, config.scenario.projectCount);
  const dayMinutes = workingDayMinutes(config);
  const dueOffset = Math.max(1, dayMinutes - Math.min(20, Math.max(1, dayMinutes * 0.08)));
  const completionOffset = Math.max(1, dueOffset - Math.min(20, Math.max(1, dayMinutes * 0.08)));
  const recordOffset = Math.max(1, dueOffset - Math.min(8, Math.max(1, dayMinutes * 0.03)));

  Array.from({ length: 3 }, (_, index) => index).forEach((index) => {
    const duty = catalog.duties[(weekIndex * 3 + index) % catalog.duties.length];
    const pattern = catalog.communicationPatterns[(weekIndex + index) % catalog.communicationPatterns.length];
    const measure = catalog.businessMeasures[(weekIndex * 2 + index) % catalog.businessMeasures.length];
    const project = projects[(weekIndex * 3 + index) % projects.length];
    const workItemId = `${member.memberId}:w${weekIndex}:work:${index}`;
    const date = scheduledDates[(weekIndex + index) % scheduledDates.length];
    const mode = pickRoleMode(config, persona, date, index, pressure, random);
    const dueAt = atWorkOffset(config, date, dueOffset);
    const pressureLoad = Math.max(0.7, pressure.workload + (pressure.reactive - 1) * 0.22);
    const plannedMinutes = Math.max(15, Math.min(dayMinutes, Math.round(duty.typicalMinutes / 15) * 15));
    const actualMinutes = Math.max(10, Math.min(dayMinutes, Math.round(plannedMinutes * pressureLoad * (0.82 + random() * 0.34))));
    const blocked = mode === "Blocked";
    const inProgress = !blocked && ((weekIndex + index) % 6 === 0 || (pressure.workload > 1.32 && index === 1));
    const status: SimulationWorkItem["status"] = blocked ? "blocked" : inProgress ? "in-progress" : "completed";
    const priority: SimulationWorkItem["priority"] =
      blocked || pressure.reactive >= 1.55 ? "urgent" : pressure.workload >= 1.18 || duty.priority === "high" ? "high" : duty.priority;

    workItems.push({
      schemaVersion: 1,
      workItemId,
      weekId,
      scheduledDate: date,
      title: `SIMULATED — ${duty.title}`,
      responsibility: duty.responsibility,
      project,
      deliverable: duty.deliverable,
      category: blocked ? "Blocked / waiting / dependency delay" : duty.category,
      mode,
      status,
      priority,
      plannedMinutes,
      actualMinutes,
      dueAt,
      completedAt: status === "completed" ? atWorkOffset(config, date, completionOffset) : null,
      blockedReason: status === "blocked" ? "SIMULATED dependency review is waiting on an upstream owner." : null,
      sourceSurface: duty.preferredSurface,
    });

    communications.push({
      schemaVersion: 1,
      communicationId: `${member.memberId}:w${weekIndex}:communication:${index}`,
      weekId,
      occurredAt: atWorkOffset(config, date, dayMinutes * (0.25 + index * 0.2)),
      channel: pattern.channel,
      direction: pattern.direction,
      purpose: pattern.purpose,
      subject: `SIMULATED — ${pattern.subject}`,
      stakeholderGroup: persona.stakeholders[(weekIndex + index) % persona.stakeholders.length],
      relatedWorkItemId: workItemId,
      messageCount: pattern.channel === "meeting" ? 1 : Math.max(2, Math.round(3 + random() * 7 * pressure.reactive)),
      responseMinutes: Math.max(
        2,
        Math.round(
          persona.interruptions.recoveryMinutes.typical
            * (0.65 + random() * 0.7)
            * pressure.fragmentation,
        ),
      ),
      actionItem: `Confirm the next step for ${duty.deliverable.toLowerCase()}.`,
    });

    const direction = measure.higherIsBetter ? 1 : -1;
    const scenarioEffect = direction * ((pressure.workload - 1) * -0.08 + (pressure.recovery ? 0.04 : 0));
    const seasonalWave = Math.sin((weekIndex + index) * 0.72) * 0.045;
    const rawValue = measure.baseline * (1 + scenarioEffect + seasonalWave + (random() - 0.5) * 0.035);
    const value = round(clamp(rawValue, measure.plausibleMin, measure.plausibleMax), 2);
    const target = round(measure.target, 2);
    const variancePct = target === 0 ? 0 : round(((value - target) / Math.abs(target)) * 100, 1);
    businessRecords.push({
      schemaVersion: 1,
      recordId: `${member.memberId}:w${weekIndex}:business:${index}`,
      weekId,
      recordedAt: atWorkOffset(config, date, recordOffset),
      relatedWorkItemId: workItemId,
      relatedProject: project,
      label: measure.label,
      value,
      target,
      unit: measure.unit,
      plausibleMin: measure.plausibleMin,
      plausibleMax: measure.plausibleMax,
      variancePct,
      trend: Math.abs(value - measure.baseline) < Math.max(0.01, Math.abs(measure.baseline) * 0.01)
        ? "flat"
        : value > measure.baseline ? "up" : "down",
      sourceSurface: measure.sourceSurface,
    });
  });

  return { workItems, communications, businessRecords };
}

function makeIntents(
  config: SimulationConfig,
  persona: SimulationPersona,
  member: SimulationMember,
  memberOrdinal: number,
  weekStart: string,
  weekIndex: number,
  pressure: ReturnType<typeof scenarioPressure>,
  workItems: SimulationWorkItem[],
) {
  const random = createSeededRandom(`${config.seed}|${member.memberId}|week:${weekIndex}|activity`);
  const intents: Intent[] = [];
  const calendarEvents: OutlookCalendarEvent[] = [];
  const chatImports: RawEventImport[] = [];
  const calendarWorkItemIds = new Map<string, string>();
  const activeDates = activeWorkDates(config, memberOrdinal, weekStart);
  const dayMinutes = workingDayMinutes(config);
  if (activeDates.length === 0 || workItems.length === 0) {
    return { intents, calendarEvents, calendarWorkItemIds, chatImports };
  }

  const meetingDensityFactor = clamp(0.2 + config.scenario.meetingDensity / 65, 0.2, 1.75);
  const meetingTarget = persona.meetingBehavior.weeklyMinutes.typical
    * meetingDensityFactor
    * pressure.meetings;
  const meetingDays = Math.min(
    activeDates.length,
    Math.max(0, Math.ceil(meetingTarget / Math.max(30, Math.min(90, dayMinutes * 0.18)))),
  );
  const meetingDuration = meetingDays === 0
    ? 0
    : clamp(Math.round((meetingTarget / meetingDays) / 15) * 15, 15, Math.min(90, dayMinutes * 0.2));
  const reactiveDemand = clamp(
    ((config.scenario.reactiveLoad / 100) * 0.65
      + (persona.reactiveLoad.typicalPercent / 100) * 0.75)
      * pressure.reactive,
    0,
    1.4,
  );
  const interruptionDemand = clamp(
    ((config.scenario.interruptions / 100) * 0.7
      + Math.min(1, persona.interruptions.perFocusHour / 2.5) * 0.45)
      * pressure.fragmentation,
    0,
    1.4,
  );

  const contextIndexFor = (workItem: SimulationWorkItem, fallback: number) => {
    const exact = persona.appContexts.findIndex((context) => context.family === workItem.sourceSurface);
    return exact >= 0 ? exact : fallback % persona.appContexts.length;
  };

  const plannedStatusFor = (workItem: SimulationWorkItem): PlannedStatus => {
    if (workItem.mode === "Blocked" || workItem.status === "blocked") return "blocked";
    if (workItem.mode === "Reactive") return "unplanned";
    if (workItem.mode === "Collaborative" && workItem.category === "Meetings / stakeholder syncs") return "fixed";
    return "planned";
  };

  const addIntent = (
    date: string,
    offset: number,
    duration: number,
    workItem: SimulationWorkItem,
    contextIndex: number,
    suffix: string,
  ) => {
    const safeOffset = clamp(Math.round(offset), 0, Math.max(0, dayMinutes - 1));
    const safeDuration = clamp(Math.round(duration), 1, Math.max(1, dayMinutes - safeOffset));
    const context = persona.appContexts[contextIndex % persona.appContexts.length];
    const title = `${workItem.title} · ${suffix} · ${member.memberId.split(":").pop()}`;
    intents.push({
      start: atWorkOffset(config, date, safeOffset),
      end: atWorkOffset(config, date, safeOffset + safeDuration),
      appName: context.appName,
      windowTitle: title,
      category: workItem.category,
      mode: workItem.mode,
      plannedStatus: plannedStatusFor(workItem),
      project: workItem.project,
      stakeholder: persona.stakeholders[(weekIndex + contextIndex) % persona.stakeholders.length],
      workItemId: workItem.workItemId,
    });
  };

  activeDates.forEach((date, dayIndex) => {
    const primary = workItems[dayIndex % workItems.length];
    const secondary = workItems[(dayIndex + 1) % workItems.length];
    const tertiary = workItems[(dayIndex + 2) % workItems.length];
    const preferredOffsets = persona.deepWorkCadence.preferredStartHours
      .map((hour) => hour * 60 - wallTimeMinutes(config.workingHours.start))
      .filter((offset) => offset >= 0 && offset <= dayMinutes * 0.28);
    const morningOffset = primary.mode === "Deep work" && preferredOffsets.length > 0
      ? preferredOffsets[(weekIndex + dayIndex) % preferredOffsets.length]
      : 0;
    const focusSlot = Math.max(12, dayMinutes * 0.23 - morningOffset);
    const focusDuration = clamp(
      primary.mode === "Deep work"
        ? persona.deepWorkCadence.blockMinutes.typical
        : primary.mode === "Reactive"
          ? 20 + reactiveDemand * 38
          : primary.plannedMinutes * 0.45,
      10,
      focusSlot,
    );

    if (primary.mode === "Fragmented") {
      const recoveryGap = clamp(
        persona.interruptions.recoveryMinutes.typical * (0.65 + interruptionDemand * 0.35),
        3,
        Math.max(3, focusDuration * 0.25),
      );
      const segment = Math.max(5, (focusDuration - recoveryGap) / 2);
      addIntent(date, morningOffset, segment, primary, contextIndexFor(primary, dayIndex), "focus segment A");
      addIntent(date, morningOffset + segment + recoveryGap, segment, primary, contextIndexFor(primary, dayIndex), "focus recovery");
    } else {
      addIntent(date, morningOffset, focusDuration, primary, contextIndexFor(primary, dayIndex), "primary duty block");
    }

    const secondOffset = dayMinutes * 0.27;
    const secondDuration = clamp(
      secondary.mode === "Reactive" ? 20 + reactiveDemand * 32 : secondary.plannedMinutes * 0.38,
      10,
      dayMinutes * 0.16,
    );
    addIntent(date, secondOffset, secondDuration, secondary, contextIndexFor(secondary, dayIndex + 1), "supporting duty block");

    if (dayIndex < meetingDays) {
      const meetingItem = workItems.find((item) => item.mode === "Collaborative") ?? secondary;
      const meetingOffset = dayMinutes * 0.47;
      const start = atWorkOffset(config, date, meetingOffset);
      const end = atWorkOffset(config, date, meetingOffset + meetingDuration);
      const calendarEventId = `${member.memberId}:w${weekIndex}:meeting:${dayIndex}`;
      calendarEvents.push({
        calendar_event_id: calendarEventId,
        uid: `sim-${memberOrdinal}-${weekIndex}-${dayIndex}@weekform.invalid`,
        title: `${meetingItem.title} · ${persona.meetingBehavior.recurringMeetings[dayIndex % persona.meetingBehavior.recurringMeetings.length]}`,
        start_time: start,
        end_time: end,
        location: "Weekform simulator room",
        organizer: "simulator@weekform.invalid",
        attendee_count: 3 + ((weekIndex + dayIndex) % 6),
        source: "outlook_ics",
        imported_at: atWorkOffset(config, activeDates[0], 0),
      });
      calendarWorkItemIds.set(calendarEventId, meetingItem.workItemId);
    }

    const afternoonOffset = dayMinutes * 0.68;
    const afternoonDuration = clamp(
      tertiary.mode === "Deep work"
        ? persona.deepWorkCadence.blockMinutes.typical * 0.65
        : tertiary.mode === "Reactive"
          ? 18 + reactiveDemand * 42
          : tertiary.plannedMinutes * 0.4,
      10,
      dayMinutes * 0.14,
    );
    addIntent(date, afternoonOffset, afternoonDuration, tertiary, contextIndexFor(tertiary, dayIndex + 2), "delivery block");

    const reactiveItem = workItems.find((item) => item.mode === "Reactive") ?? primary;
    const burstStartOffset = dayMinutes * 0.86;
    const burstDuration = clamp(8 + reactiveDemand * 18, 8, dayMinutes * 0.07);
    if (reactiveItem.mode === "Reactive" && !pressure.recovery) {
      addIntent(date, burstStartOffset, burstDuration, reactiveItem, contextIndexFor(reactiveItem, dayIndex + 3), "reactive handling");
    }

    const chatStart = atWorkOffset(config, date, dayMinutes * 0.83);
    const chatEnd = atWorkOffset(config, date, dayMinutes * 0.83 + Math.max(3, Math.min(12, burstDuration)));
    chatImports.push({
      event_id: `${member.memberId}:w${weekIndex}:chat:${dayIndex}`,
      user_id: member.memberId,
      timestamp_start: chatStart,
      timestamp_end: chatEnd,
      source_type: "chat",
      app_name: "Slack Sandbox",
      project_hint: reactiveItem.project,
      metadata: {
        provider: "weekform-sandbox",
        messages: String(Math.max(1, Math.round(
          persona.reactiveLoad.burstsPerDay.typical * (0.4 + reactiveDemand) + random() * 3,
        ))),
        mentions: String(random() < interruptionDemand * 0.5 ? 1 : 0),
        surface: "channel",
        work_item_id: reactiveItem.workItemId,
        interruption_recovery_minutes: String(persona.interruptions.recoveryMinutes.typical),
      },
      privacy_level: "derived_only",
    });
  });

  return { intents, calendarEvents, calendarWorkItemIds, chatImports };
}

function samplesFromIntents(intents: Intent[], member: SimulationMember, weekIndex: number): ActiveWindowSample[] {
  const samples: ActiveWindowSample[] = [];
  intents.forEach((intent, intentIndex) => {
    const start = new Date(intent.start).getTime();
    const end = new Date(intent.end).getTime();
    for (let timestamp = start, sampleIndex = 0; timestamp <= end; timestamp += 60_000, sampleIndex += 1) {
      samples.push({
        sample_id: `${member.memberId}:w${weekIndex}:intent:${intentIndex}:sample:${sampleIndex}`,
        timestamp: new Date(timestamp).toISOString(),
        app_name: intent.appName,
        window_title: intent.windowTitle,
        source_type: "macos_active_window",
        privacy_level: "local_only",
      });
    }
  });
  return samples;
}

function sessionKey(session: ActivitySession) {
  return `${session.app_name}|${session.window_title ?? ""}|${session.start_time}`;
}

function intentKey(intent: Intent) {
  return `${intent.appName}|${intent.windowTitle}|${intent.start}`;
}

function linkImportedBlocksToWorkItems(
  blocks: WorkBlock[],
  events: RawEvent[],
  workItems: SimulationWorkItem[],
) {
  const eventById = new Map(events.map((event) => [event.event_id, event]));
  const workItemById = new Map(workItems.map((workItem) => [workItem.workItemId, workItem]));
  return blocks.map((block) => {
    const event = block.derived_from.map((eventId) => eventById.get(eventId)).find(Boolean);
    const workItemId = event?.metadata.work_item_id;
    const workItem = workItemId ? workItemById.get(workItemId) : undefined;
    if (!workItem) return block;
    return {
      ...block,
      category: workItem.category,
      mode: workItem.mode,
      planned_status: workItem.mode === "Blocked"
        ? "blocked" as const
        : workItem.mode === "Reactive"
          ? "unplanned" as const
          : block.planned_status,
      project_name: workItem.project,
      blocker_flag: workItem.mode === "Blocked" || workItem.status === "blocked",
      evidence: [...block.evidence, `Work item: ${workItem.workItemId}`, `Synthetic duty: ${workItem.title}`],
    };
  });
}

function linkCalendarBlocksToWorkItems(
  blocks: WorkBlock[],
  calendarWorkItemIds: Map<string, string>,
  workItems: SimulationWorkItem[],
) {
  const workItemById = new Map(workItems.map((workItem) => [workItem.workItemId, workItem]));
  return blocks.map((block) => {
    const workItemId = block.derived_from.map((eventId) => calendarWorkItemIds.get(eventId)).find(Boolean);
    const workItem = workItemId ? workItemById.get(workItemId) : undefined;
    if (!workItem) return block;
    return {
      ...block,
      project_name: workItem.project,
      evidence: [...block.evidence, `Work item: ${workItem.workItemId}`, `Synthetic duty: ${workItem.title}`],
    };
  });
}

function buildCorrections(
  blocks: WorkBlock[],
  member: SimulationMember,
  weekIndex: number,
  virtualTimestamp: string,
): { blocks: WorkBlock[]; corrections: UserCorrection[] } {
  const corrections: UserCorrection[] = [];
  const updated = blocks.map((block, index) => {
    if (index % 7 !== (weekIndex % 7)) return { ...block, user_verified: index % 4 !== 0 };
    const correction: UserCorrection = {
      correction_id: `${member.memberId}:w${weekIndex}:correction:${index}`,
      work_block_id: block.work_block_id,
      field: "verification",
      old_value: "false",
      new_value: "true",
      timestamp: virtualTimestamp,
      reason: "Simulated review confirmed this synthetic block against its generated evidence.",
    };
    corrections.push(correction);
    return { ...block, user_verified: true, confidence: Math.max(0.84, block.confidence) };
  });
  return { blocks: updated, corrections };
}

function buildSharedSnapshot(config: SimulationConfig, snapshot: ReturnType<typeof computeWeeklyCapacitySnapshot>): SimulationSharedSnapshot {
  const shared: SimulationSharedSnapshot = {
    schemaVersion: 1,
    weekId: snapshot.week_id,
    shareLevel: config.sharingPolicy.level,
    metrics: {
      reliableNewWorkCapacityPct: snapshot.reliable_new_work_capacity_pct,
      allocatedPct: snapshot.allocated_pct,
      reactivePct: snapshot.reactive_pct,
      meetingPct: snapshot.meeting_pct,
      fragmentedWorkPct: snapshot.fragmented_work_pct,
      blockedPct: snapshot.blocked_pct,
      carryoverRiskPct: snapshot.carryover_risk_pct,
      contextSwitchScore: snapshot.context_switch_score,
      wipLoadScore: snapshot.wip_load_score,
      summaryConfidence: snapshot.summary_confidence,
    },
  };
  if (config.sharingPolicy.level !== "summary") {
    shared.categoryAllocation = snapshot.category_allocation;
    shared.workModeAllocation = snapshot.work_mode_allocation;
  }
  return shared;
}

function buildForecast(
  current: ReturnType<typeof computeWeeklyCapacitySnapshot>,
  prior: ReturnType<typeof computeWeeklyCapacitySnapshot>[],
): SimulationForecast {
  const baselines = computeCapacityBaselines(prior);
  const baseline = baselines.reliable_new_work_capacity_pct ?? current.reliable_new_work_capacity_pct;
  const likely = Math.max(0, Math.min(40, Math.round((baseline + current.reliable_new_work_capacity_pct) / 2)));
  return {
    schemaVersion: 1,
    weekId: current.week_id,
    label: "Synthetic projection",
    reliableNewWorkCapacityPct: likely,
    conservativeCapacityPct: Math.max(0, likely - 9),
    likelyCapacityPct: likely,
    optimisticCapacityPct: Math.min(40, likely + 8),
    confidence: Number(Math.min(0.9, 0.58 + prior.length * 0.025).toFixed(2)),
    basis: [
      "Derived from deterministic Weekform capacity history",
      "Scenario calendar and deadline pressure remain synthetic",
      "This is not an AI Forecast Agent result",
    ],
  };
}

function generateMemberWeek(
  config: SimulationConfig,
  identity: RunIdentity,
  member: SimulationMember,
  memberOrdinal: number,
  weekStart: string,
  weekIndex: number,
  totalWeeks: number,
  existing: SimulationArtifacts,
): SimulationArtifacts {
  const output = emptyArtifacts();
  const persona = getPersona(member.personaId);
  if (!persona) throw new Error(`Persona ${member.personaId} disappeared during generation.`);
  const weekId = isoWeekId(weekStart);
  const pressure = scenarioPressure(config, weekIndex, totalWeeks);
  const roleArtifacts = buildRoleArtifacts(
    config,
    persona,
    member,
    memberOrdinal,
    weekStart,
    weekIndex,
    pressure,
  );
  const { intents, calendarEvents, calendarWorkItemIds, chatImports } = makeIntents(
    config,
    persona,
    member,
    memberOrdinal,
    weekStart,
    weekIndex,
    pressure,
    roleArtifacts.workItems,
  );
  const activeWindowSamples = samplesFromIntents(intents, member, weekIndex);
  const sessions = sessionizeActiveWindowSamples(activeWindowSamples);
  const intentBySession = new Map(intents.map((intent) => [intentKey(intent), intent]));
  const sessionImports: RawEventImport[] = sessions.map((session) => {
    const intent = intentBySession.get(sessionKey(session));
    if (!intent) {
      throw new Error(
        `Generated session did not resolve to its simulation intent: ${session.session_id} (${sessionKey(session)})`,
      );
    }
    return {
      event_id: session.session_id,
      user_id: member.memberId,
      timestamp_start: session.start_time,
      timestamp_end: session.end_time,
      source_type: "window",
      app_name: session.app_name,
      window_title: session.window_title,
      project_hint: intent.project,
      metadata: {
        simulated: "true",
        stakeholder: intent.stakeholder,
        work_item_id: intent.workItemId,
        work_category: intent.category,
        work_mode: intent.mode,
      },
      privacy_level: "local_only",
      category: intent.category,
      mode: intent.mode,
      planned_status: intent.plannedStatus,
      project_name: intent.project,
    };
  });
  const imported = importRawEvents(sessionImports, { weekId, userId: member.memberId });
  const linkedImportedBlocks = linkImportedBlocksToWorkItems(
    imported.work_blocks,
    imported.events,
    roleArtifacts.workItems,
  );
  const chatImported = importRawEvents(chatImports, { weekId, userId: member.memberId });
  const calendarBlocks = linkCalendarBlocksToWorkItems(
    outlookEventsToWorkBlocks(calendarEvents, weekId),
    calendarWorkItemIds,
    roleArtifacts.workItems,
  );
  const virtualReviewTime = zonedDateTimeToIso(addDays(weekStart, 6), "18:00", config.timezone);
  const reviewed = buildCorrections([...linkedImportedBlocks, ...calendarBlocks], member, weekIndex, virtualReviewTime);
  const priorSnapshots = existing.weeklySnapshots
    .filter((entry) => entry.stamp.memberId === member.memberId)
    .map((entry) => entry.payload);
  const snapshot = computeWeeklyCapacitySnapshot(weekId, reviewed.blocks);
  const baselines = computeCapacityBaselines(priorSnapshots);
  const narrative = generateWeeklyNarrative(snapshot, baselines);
  const interruptionLoad = analyzeInterruptionLoad(chatImported.events, reviewed.blocks);
  const signals = buildAccelerationSignals({
    sessions,
    blocks: reviewed.blocks,
    interruptionLoad,
    calendarEvents,
  });
  const forecast = buildForecast(snapshot, priorSnapshots);
  const shared = buildSharedSnapshot(config, snapshot);
  const auditEvents: AuditEvent[] = [
    {
      event_id: `${member.memberId}:w${weekIndex}:audit:signals`,
      timestamp: zonedDateTimeToIso(weekStart, "08:00", config.timezone),
      type: "activity_session",
      source: "span_simulator",
      title: "Synthetic signals generated",
      summary: `${activeWindowSamples.length} synthetic samples produced for ${weekId}`,
      privacy_level: "derived_only",
      details: { is_synthetic: true, simulation_run_id: identity.runId, member_id: member.memberId },
    },
    {
      event_id: `${member.memberId}:w${weekIndex}:audit:capacity`,
      timestamp: virtualReviewTime,
      type: "work_block_classification",
      source: "span_simulator",
      title: "Synthetic week derived",
      summary: `Weekform inference derived the ${weekId} capacity snapshot`,
      privacy_level: "derived_only",
      details: { is_synthetic: true, simulation_run_id: identity.runId, approved_state_change: false },
    },
  ];

  const coordinate = `w${String(weekIndex).padStart(4, "0")}`;
  output.activeWindowSamples = activeWindowSamples.map((payload, index) => artifact(payload, "sample", member, config, identity, `${coordinate}:s${index}`));
  output.activitySessions = sessions.map((payload, index) => artifact(payload, "session", member, config, identity, `${coordinate}:ss${index}`));
  output.rawEvents = [...imported.events, ...chatImported.events].map((payload, index) => artifact(payload, "raw", member, config, identity, `${coordinate}:r${index}`));
  output.calendarEvents = calendarEvents.map((payload, index) => artifact(payload, "calendar", member, config, identity, `${coordinate}:c${index}`));
  output.workBlocks = reviewed.blocks.map((payload, index) => artifact(payload, "block", member, config, identity, `${coordinate}:b${index}`));
  output.corrections = reviewed.corrections.map((payload, index) => artifact(payload, "correction", member, config, identity, `${coordinate}:x${index}`));
  output.weeklySnapshots = [artifact(snapshot, "snapshot", member, config, identity, coordinate)];
  output.narratives = [artifact(narrative, "narrative", member, config, identity, coordinate)];
  output.accelerationSignals = signals.map((payload, index) => artifact(payload, "acceleration", member, config, identity, `${coordinate}:a${index}`));
  output.forecasts = [artifact(forecast, "forecast", member, config, identity, coordinate)];
  output.sharedSnapshots = [artifact(shared, "shared", member, config, identity, coordinate)];
  output.workItems = roleArtifacts.workItems.map((payload, index) => artifact(payload, "work-item", member, config, identity, `${coordinate}:wi${index}`));
  output.communications = roleArtifacts.communications.map((payload, index) => artifact(payload, "communication", member, config, identity, `${coordinate}:cm${index}`));
  output.businessRecords = roleArtifacts.businessRecords.map((payload, index) => artifact(payload, "business", member, config, identity, `${coordinate}:br${index}`));
  output.auditEvents = auditEvents.map((payload, index) => artifact(payload, "audit", member, config, identity, `${coordinate}:u${index}`));
  return output;
}

function appendArtifacts(target: SimulationArtifacts, source: SimulationArtifacts) {
  for (const key of Object.keys(target) as Array<keyof SimulationArtifacts>) {
    (target[key] as SimulationArtifact<unknown>[]).push(...(source[key] as SimulationArtifact<unknown>[]));
  }
}

function assembleDataset(config: SimulationConfig, artifacts: SimulationArtifacts): SimulationDataset {
  const identity = inputIdentity(config);
  const members = expandMembers(config, identity);
  const weeklySnapshots: SimulationWeekSnapshot[] = artifacts.weeklySnapshots.map((record) => ({
    ...record,
    weekId: record.payload.week_id,
    memberIds: [record.stamp.memberId],
  }));
  let dataset: SimulationDataset = {
    schemaVersion: 1,
    isSynthetic: true,
    runId: identity.runId,
    canonicalDatasetId: identity.canonicalDatasetId,
    canonicalFingerprint: "",
    config,
    members,
    artifacts,
    weeklySnapshots,
    realismReport: { valid: true, score: 100, checksRun: 10, violations: [] },
    provenance: PROVENANCE,
  };
  const validation = validateSimulationDataset(dataset);
  dataset = {
    ...dataset,
    realismReport: {
      valid: validation.valid,
      score: Math.max(0, 100 - validation.violations.filter((item) => item.severity === "error").length * 20 - validation.violations.filter((item) => item.severity === "warning").length * 5),
      checksRun: 10,
      violations: validation.violations,
    },
  };
  const canonicalFingerprint = fingerprint({ ...dataset, canonicalFingerprint: undefined, runId: undefined });
  return { ...dataset, canonicalFingerprint };
}

export { validateSimulationConfig } from "./validate";

export function createSimulationCheckpoint(config: SimulationConfig): SimulationCheckpoint {
  const validation = validateSimulationConfig(config);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return {
    schemaVersion: 1,
    inputFingerprint: inputIdentity(config).inputFingerprint,
    nextWeekIndex: 0,
    status: "running",
    generatedArtifacts: emptyArtifacts(),
    dataset: null,
  };
}

export function advanceSimulation(
  config: SimulationConfig,
  checkpoint: SimulationCheckpoint,
  weekCount = 1,
  options: { cancel?: boolean } = {},
): SimulationCheckpoint {
  const identity = inputIdentity(config);
  if (checkpoint.inputFingerprint !== identity.inputFingerprint) {
    throw new Error("Checkpoint inputs do not match this simulation configuration.");
  }
  if (checkpoint.status === "complete") return checkpoint;
  const weekStarts = simulationWeekStarts(config);
  const members = expandMembers(config, identity);
  const artifacts = cloneArtifacts(checkpoint.generatedArtifacts);
  const endIndex = Math.min(weekStarts.length, checkpoint.nextWeekIndex + Math.max(0, weekCount));
  for (let weekIndex = checkpoint.nextWeekIndex; weekIndex < endIndex; weekIndex += 1) {
    members.forEach((member, memberOrdinal) => {
      const generated = generateMemberWeek(
        config,
        identity,
        member,
        memberOrdinal,
        weekStarts[weekIndex],
        weekIndex,
        weekStarts.length,
        artifacts,
      );
      appendArtifacts(artifacts, generated);
    });
  }
  const complete = endIndex >= weekStarts.length;
  const status = complete ? "complete" : options.cancel ? "canceled" : "running";
  return {
    schemaVersion: 1,
    inputFingerprint: identity.inputFingerprint,
    nextWeekIndex: endIndex,
    status,
    generatedArtifacts: artifacts,
    dataset: complete ? assembleDataset(config, artifacts) : null,
  };
}

export function runSimulationToCompletion(config: SimulationConfig): SimulationDataset {
  const checkpoint = createSimulationCheckpoint(config);
  const complete = advanceSimulation(config, checkpoint, simulationWeekStarts(config).length);
  if (!complete.dataset) throw new Error("Simulation did not complete.");
  return complete.dataset;
}

export function replayMatches(left: SimulationDataset, right: SimulationDataset): boolean {
  return (
    left.canonicalFingerprint === right.canonicalFingerprint &&
    canonicalJson(left.artifacts) === canonicalJson(right.artifacts)
  );
}
