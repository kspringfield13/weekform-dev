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
  SimulationSharedSnapshot,
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
    auditEvents: [],
  };
}

function cloneArtifacts(artifacts: SimulationArtifacts): SimulationArtifacts {
  return Object.fromEntries(
    Object.entries(artifacts).map(([key, values]) => [key, [...values]]),
  ) as unknown as SimulationArtifacts;
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

  if (config.scenario.kind === "quiet") workload = 0.72;
  if (config.scenario.kind === "busy") workload = 1.2;
  if (config.scenario.kind === "deadline-heavy") {
    const cycle = weekIndex % 6;
    workload = 1 + cycle * 0.07;
    reactive = 1 + cycle * 0.08;
  }
  if (config.scenario.kind === "incident") {
    reactive = weekIndex % 8 === 4 ? 1.8 : 1.12;
    fragmentation = weekIndex % 8 === 4 ? 1.6 : 1.1;
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
  return { workload, reactive, fragmentation, meetings, recovery };
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

function makeIntents(
  config: SimulationConfig,
  persona: SimulationPersona,
  member: SimulationMember,
  memberOrdinal: number,
  weekStart: string,
  weekIndex: number,
  totalWeeks: number,
) {
  const random = createSeededRandom(`${config.seed}|${member.memberId}|week:${weekIndex}|activity`);
  const pressure = scenarioPressure(config, weekIndex, totalWeeks);
  const intents: Intent[] = [];
  const calendarEvents: OutlookCalendarEvent[] = [];
  const chatImports: RawEventImport[] = [];
  const activeDates = Array.from({ length: 7 }, (_, day) => addDays(weekStart, day)).filter(
    (date) => config.workDays.includes(isoWeekday(date)) && !isUnavailable(config, memberOrdinal, date),
  );
  const meetingTarget = persona.meetingBehavior.weeklyMinutes.typical *
    (0.55 + config.scenario.meetingDensity / 100) * pressure.meetings;
  const meetingDuration = meetingTarget > 520 ? 90 : 60;
  const meetingDays = Math.min(activeDates.length, Math.max(0, Math.round(meetingTarget / meetingDuration)));

  const addIntent = (
    date: string,
    offset: number,
    duration: number,
    contextIndex: number,
    mode: WorkMode,
    category: WorkCategory,
    plannedStatus: PlannedStatus,
    projectIndex: number,
    suffix: string,
  ) => {
    const context = persona.appContexts[contextIndex % persona.appContexts.length];
    const project = persona.projects[projectIndex % persona.projects.length];
    const title = `${context.syntheticTitles[(weekIndex + projectIndex) % context.syntheticTitles.length]} · ${suffix} · ${member.memberId.split(":").pop()}`;
    intents.push({
      start: zonedDateTimeToIso(date, wallOffset(config, offset), config.timezone),
      end: zonedDateTimeToIso(date, wallOffset(config, offset + duration), config.timezone),
      appName: context.appName,
      windowTitle: title,
      category,
      mode,
      plannedStatus,
      project,
      stakeholder: persona.stakeholders[(weekIndex + projectIndex) % persona.stakeholders.length],
    });
  };

  activeDates.forEach((date, dayIndex) => {
    const categoryA = weightedPick(persona.categoryWeights, random);
    const categoryB = weightedPick(persona.categoryWeights, random);
    const fragmentationChance = Math.min(0.82, (config.scenario.fragmentation / 100) * pressure.fragmentation);
    const fragmented = random() < fragmentationChance;

    if (fragmented) {
      addIntent(date, 0, 28, dayIndex, "Fragmented", categoryA, "planned", dayIndex, "focus segment A");
      addIntent(date, 32, 24, dayIndex + 1, "Reactive", "Ad hoc stakeholder requests", "unplanned", dayIndex + 1, "interrupting request");
      addIntent(date, 61, 29, dayIndex, "Fragmented", categoryA, "planned", dayIndex, "focus recovery");
    } else {
      addIntent(date, 0, pressure.recovery ? 75 : 90, dayIndex, "Deep work", categoryA, "planned", dayIndex, "protected focus");
    }
    addIntent(date, 105, 75, dayIndex + 1, fragmented ? "Fragmented" : "Deep work", categoryB, "planned", dayIndex + 1, "analysis block");

    if (dayIndex < meetingDays) {
      const start = zonedDateTimeToIso(date, wallOffset(config, 240), config.timezone);
      const end = zonedDateTimeToIso(date, wallOffset(config, 240 + meetingDuration), config.timezone);
      calendarEvents.push({
        calendar_event_id: `${member.memberId}:w${weekIndex}:meeting:${dayIndex}`,
        uid: `sim-${memberOrdinal}-${weekIndex}-${dayIndex}@weekform.invalid`,
        title: `SIMULATED — ${persona.meetingBehavior.recurringMeetings[dayIndex % persona.meetingBehavior.recurringMeetings.length]}`,
        start_time: start,
        end_time: end,
        location: "Weekform simulator room",
        organizer: "simulator@weekform.invalid",
        attendee_count: 3 + ((weekIndex + dayIndex) % 6),
        source: "outlook_ics",
        imported_at: zonedDateTimeToIso(weekStart, "08:00", config.timezone),
      });
    } else {
      addIntent(date, 240, 60, dayIndex + 2, "Collaborative", "Documentation / requirement clarification", "planned", dayIndex + 2, "collaboration block");
    }

    const afternoonMode: WorkMode = fragmented || pressure.fragmentation > 1.25 ? "Fragmented" : "Deep work";
    addIntent(date, 315, pressure.recovery ? 60 : 75, dayIndex + 2, afternoonMode, categoryA, "planned", dayIndex + 2, "delivery block");

    if (!pressure.recovery || dayIndex % 2 === 0) {
      // Keep the foreground timeline non-overlapping: reactive pressure raises the duration up to
      // the closeout boundary, while extra pressure is expressed through fragmentation/overtime.
      const reactiveDuration = Math.min(58, Math.round(30 + 18 * Math.min(1.6, pressure.reactive)));
      addIntent(date, 405, reactiveDuration, dayIndex + 3, "Reactive", "Ad hoc stakeholder requests", "unplanned", dayIndex + 3, "reactive handling");
      const burstStart = zonedDateTimeToIso(date, wallOffset(config, 396), config.timezone);
      const burstEnd = zonedDateTimeToIso(date, wallOffset(config, 408), config.timezone);
      chatImports.push({
        event_id: `${member.memberId}:w${weekIndex}:chat:${dayIndex}`,
        user_id: member.memberId,
        timestamp_start: burstStart,
        timestamp_end: burstEnd,
        source_type: "chat",
        app_name: "Slack Sandbox",
        project_hint: "SIMULATED — reactive coordination",
        metadata: {
          provider: "weekform-sandbox",
          messages: String(Math.max(2, Math.round(4 + pressure.reactive * 5 + random() * 4))),
          mentions: String(random() < 0.5 ? 1 : 0),
          surface: "channel",
        },
        privacy_level: "derived_only",
      });
    }

    const recurringCategory: WorkCategory =
      persona.id === "data-analyst" || persona.id === "finance-analyst"
        ? "Recurring reporting"
        : "Admin / coordination";
    addIntent(date, 468, 35, dayIndex + 4, "Collaborative", recurringCategory, "fixed", 0, "daily closeout");

    const overtimeChance = (config.scenario.overtime / 100) * Math.max(1, pressure.workload - 0.1);
    if (random() < overtimeChance || pressure.workload >= 1.35) {
      addIntent(date, 515, 45, dayIndex, "Fragmented", "QA / data validation", "unplanned", 1, "deadline overtime");
    }
  });

  return { intents, calendarEvents, chatImports, pressure };
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
  const { intents, calendarEvents, chatImports } = makeIntents(
    config,
    persona,
    member,
    memberOrdinal,
    weekStart,
    weekIndex,
    totalWeeks,
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
      metadata: { simulated: "true", stakeholder: intent.stakeholder },
      privacy_level: "local_only",
      category: intent.category,
      mode: intent.mode,
      planned_status: intent.plannedStatus,
      project_name: intent.project,
    };
  });
  const imported = importRawEvents(sessionImports, { weekId, userId: member.memberId });
  const chatImported = importRawEvents(chatImports, { weekId, userId: member.memberId });
  const calendarBlocks = outlookEventsToWorkBlocks(calendarEvents, weekId);
  const virtualReviewTime = zonedDateTimeToIso(addDays(weekStart, 6), "18:00", config.timezone);
  const reviewed = buildCorrections([...imported.work_blocks, ...calendarBlocks], member, weekIndex, virtualReviewTime);
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
    realismReport: { valid: true, score: 100, checksRun: 8, violations: [] },
    provenance: PROVENANCE,
  };
  const validation = validateSimulationDataset(dataset);
  dataset = {
    ...dataset,
    realismReport: {
      valid: validation.valid,
      score: Math.max(0, 100 - validation.violations.filter((item) => item.severity === "error").length * 20 - validation.violations.filter((item) => item.severity === "warning").length * 5),
      checksRun: 8,
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
