import type {
  AccelerationSignal,
  ActiveWindowSample,
  ActivitySession,
  AuditEvent,
  OutlookCalendarEvent,
  RawEvent,
  UserCorrection,
  WeeklyCapacitySnapshot,
  WeeklyNarrative,
  WorkBlock,
  WorkCategory,
  WorkMode,
} from "../../domain/src/models";

export type SimulationSpanUnit = "weeks" | "months" | "years";
export type ScenarioKind =
  | "normal"
  | "quiet"
  | "busy"
  | "deadline-heavy"
  | "incident"
  | "launch"
  | "quarter-end";
export type SharingLevel = "summary" | "summary+categories" | "summary+categories+projects";
export type ExecutionMode = "fast-forward" | "local-playback";
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface WeightedValue<T> {
  value: T;
  /** Integer percentage. All weights in a complete distribution sum to 100. */
  weight: number;
}

export interface SimulationPersona {
  schemaVersion: 1;
  id: string;
  version: string;
  role: string;
  displayName: string;
  responsibilities: string[];
  projects: string[];
  appContexts: Array<{
    family: string;
    appName: string;
    syntheticTitles: string[];
  }>;
  categoryWeights: WeightedValue<WorkCategory>[];
  modeWeights: WeightedValue<WorkMode>[];
  meetingBehavior: {
    weeklyMinutes: { min: number; typical: number; max: number };
    recurringMeetings: string[];
    doubleBookingPercent: number;
  };
  deepWorkCadence: {
    preferredDays: IsoWeekday[];
    preferredStartHours: number[];
    blockMinutes: { min: number; typical: number; max: number };
  };
  reactiveLoad: {
    typicalPercent: number;
    burstsPerDay: { min: number; typical: number; max: number };
    incidentWeekPercent: number;
  };
  interruptions: {
    perFocusHour: number;
    recoveryMinutes: { min: number; typical: number; max: number };
    sources: Array<"chat" | "email" | "meeting" | "alert">;
  };
  stakeholders: string[];
  typicalWorkday: {
    start: string;
    end: string;
    workDays: IsoWeekday[];
  };
  seasonalPressures: string[];
}

export interface SimulationMemberSpec {
  personaId: string;
  count: number;
}

export interface SimulationSpan {
  value: number;
  unit: SimulationSpanUnit;
}

export interface SimulationPtoRange {
  startDate: string;
  endDateExclusive: string;
  memberOrdinal?: number;
}

export interface SimulationScenario {
  version: string;
  kind: ScenarioKind;
  title: string;
  direction: string;
  /** Control values are integer percentages on a 0-100 scale. */
  meetingDensity: number;
  reactiveLoad: number;
  fragmentation: number;
  projectCount: number;
  overtime: number;
  interruptions: number;
}

export interface SimulationSharingPolicy {
  level: SharingLevel;
}

export interface SimulationConfig {
  schemaVersion: 1;
  generatorVersion: string;
  members: SimulationMemberSpec[];
  startDate: string;
  span: SimulationSpan;
  timezone: string;
  workDays: IsoWeekday[];
  workingHours: { start: string; end: string };
  holidays: string[];
  pto: SimulationPtoRange[];
  scenario: SimulationScenario;
  seed: string;
  sharingPolicy: SimulationSharingPolicy;
  executionMode: ExecutionMode;
}

export interface ArtifactStamp {
  isSynthetic: true;
  simulationRunId: string;
  canonicalDatasetId: string;
  canonicalArtifactId: string;
  memberId: string;
  personaVersion: string;
  generatorVersion: string;
  seed: string;
}

export interface SimulationArtifact<T> {
  stamp: ArtifactStamp;
  payload: T;
}

export interface SimulationMember {
  memberId: string;
  personaId: string;
  personaVersion: string;
  role: string;
  displayName: string;
  isSynthetic: true;
}

export interface SimulationForecast {
  schemaVersion: 1;
  weekId: string;
  label: "Synthetic projection";
  reliableNewWorkCapacityPct: number;
  conservativeCapacityPct: number;
  likelyCapacityPct: number;
  optimisticCapacityPct: number;
  confidence: number;
  basis: string[];
}

export interface SimulationSharedSnapshot {
  schemaVersion: 1;
  weekId: string;
  shareLevel: SharingLevel;
  metrics: Partial<{
    reliableNewWorkCapacityPct: number;
    allocatedPct: number;
    reactivePct: number;
    meetingPct: number;
    fragmentedWorkPct: number;
    blockedPct: number;
    carryoverRiskPct: number;
    contextSwitchScore: number;
    wipLoadScore: number;
    summaryConfidence: number;
  }>;
  categoryAllocation?: Array<{ label: WorkCategory; value: number }>;
  workModeAllocation?: Array<{ label: WorkMode; value: number }>;
}

export interface SimulationArtifacts {
  rawEvents: SimulationArtifact<RawEvent>[];
  activeWindowSamples: SimulationArtifact<ActiveWindowSample>[];
  activitySessions: SimulationArtifact<ActivitySession>[];
  calendarEvents: SimulationArtifact<OutlookCalendarEvent>[];
  workBlocks: SimulationArtifact<WorkBlock>[];
  corrections: SimulationArtifact<UserCorrection>[];
  weeklySnapshots: SimulationArtifact<WeeklyCapacitySnapshot>[];
  narratives: SimulationArtifact<WeeklyNarrative>[];
  accelerationSignals: SimulationArtifact<AccelerationSignal>[];
  forecasts: SimulationArtifact<SimulationForecast>[];
  sharedSnapshots: SimulationArtifact<SimulationSharedSnapshot>[];
  auditEvents: SimulationArtifact<AuditEvent>[];
}

export interface SimulationWeekSnapshot extends SimulationArtifact<WeeklyCapacitySnapshot> {
  weekId: string;
  memberIds: string[];
}

export type RealismSeverity = "info" | "warning" | "error";

export interface RealismViolation {
  code: string;
  severity: RealismSeverity;
  message: string;
  artifactId?: string;
  memberId?: string;
  weekId?: string;
}

export interface RealismReport {
  valid: boolean;
  score: number;
  checksRun: number;
  violations: RealismViolation[];
}

export interface SimulationDataset {
  schemaVersion: 1;
  isSynthetic: true;
  runId: string;
  canonicalDatasetId: string;
  canonicalFingerprint: string;
  config: SimulationConfig;
  members: SimulationMember[];
  artifacts: SimulationArtifacts;
  weeklySnapshots: SimulationWeekSnapshot[];
  realismReport: RealismReport;
  provenance: string[];
}

export type SimulationCheckpointStatus = "running" | "canceled" | "complete";

export interface SimulationCheckpoint {
  schemaVersion: 1;
  inputFingerprint: string;
  nextWeekIndex: number;
  status: SimulationCheckpointStatus;
  generatedArtifacts: SimulationArtifacts;
  dataset: SimulationDataset | null;
}

export interface SimulationValidationViolation extends RealismViolation {}

export interface SimulationValidationResult {
  valid: boolean;
  errors: string[];
  violations: SimulationValidationViolation[];
}

export type SimulatorRole = "member" | "manager" | "simulator_admin";

export interface SimulationAccessContext {
  featureEnabled: boolean;
  authenticated: boolean;
  roles: SimulatorRole[];
}

export interface SimulationAccessDecision {
  allowed: boolean;
  reason: string;
}

export type LocalPlaybackActionType = "navigate" | "click" | "type" | "switch-tab" | "wait";

export interface LocalPlaybackAction {
  actionId: string;
  type: LocalPlaybackActionType;
  url: string;
  selector?: string;
  value?: string;
  durationMs?: number;
}

export interface LocalPlaybackPlan {
  actions: LocalPlaybackAction[];
  syntheticCredentialsOnly: true;
  externalMutationsAllowed: false;
  dedicatedProfile: true;
  cancelable: true;
}
