import type { PlannedStatus, WorkCategory, WorkMode } from "./models";

/** Explicit, user-private sync policy. It is independent from team sharing. */
export interface PersonalReplicaPolicyV1 {
  version: 1;
  enabled: boolean;
  consentedAt: string | null;
}

export interface PersonalReplicaBlockV1 {
  blockId: string;
  weekId: string;
  startTime: string;
  endTime: string;
  estimatedCapacityPct: number;
  category: WorkCategory;
  mode: WorkMode;
  plannedStatus: PlannedStatus;
  confidence: number;
  userVerified: boolean;
  blockerFlag: boolean;
  /** Hash of reviewable fields. Used for visible optimistic-concurrency conflicts. */
  revision: string;
}

export interface PersonalReplicaCapacityV1 {
  allocatedPct: number;
  deepWorkPct: number;
  fragmentedWorkPct: number;
  meetingPct: number;
  reactivePct: number;
  plannedPct: number;
  blockedPct: number;
  reliableNewWorkCapacityPct: number;
  committedUtilizationPct: number;
  carryoverRiskPct: number;
  wipLoadScore: number;
  contextSwitchScore: number;
  summaryConfidence: number;
}

/**
 * User-private derived replica for Web/Desktop parity. This is a positive allowlist,
 * never a WorkBlock spread. Raw samples, app/window titles, evidence, notes,
 * stakeholder names, project names, screenshots, audit detail, and AI credentials
 * have no representable field here.
 */
export interface PersonalWorkloadReplicaV1 {
  schemaVersion: 1;
  replicaId: string;
  weekId: string;
  generatedAt: string;
  sourceUpdatedAt: string;
  blocks: PersonalReplicaBlockV1[];
  capacity: PersonalReplicaCapacityV1;
}

export interface PersonalReplicaSyncQueueItemV1 {
  batchId: string;
  fingerprint: string;
  payload: PersonalWorkloadReplicaV1;
  queuedAt: string;
  attempts: number;
  lastError: string | null;
}

export interface PersonalReplicaSyncStateV1 {
  deviceId: string;
  deviceName: string;
  cursor: number;
  queue: PersonalReplicaSyncQueueItemV1[];
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export type ReviewCommandAction = "confirm" | "exclude" | "relabel";
export type ReviewCommandStatus = "pending" | "applied" | "rejected" | "conflict";

export interface ReviewCommandPatchV1 {
  category?: WorkCategory;
  mode?: WorkMode;
  plannedStatus?: PlannedStatus;
  blockerFlag?: boolean;
}

export interface ReviewCommandV1 {
  schemaVersion: 1;
  commandId: string;
  blockId: string;
  weekId: string;
  expectedRevision: string;
  action: ReviewCommandAction;
  patch: ReviewCommandPatchV1 | null;
  status: ReviewCommandStatus;
  createdAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
}

export interface PersonalSyncReceiptV1 {
  batchId: string;
  cursor: number;
  syncedAt: string;
}
