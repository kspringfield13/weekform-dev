// Pure helpers for the desktop Account & Sharing surface (runbook Prompt 5).
//
// Everything in this module is deliberately dependency-free (domain types only, no
// Vite/Tauri/network imports) so it can be exercised by `tsx --test` from the repo
// root. It owns:
//   1. defensive parsers + safe defaults for the persisted cloud policy/sync state
//      (mirrors the parse discipline in `localStore.ts`: validate every field a
//      consumer reads, degrade a corrupt blob instead of crashing or trusting it);
//   2. the export-safe backup projection (policy + sync bookkeeping, NEVER tokens);
//   3. the stable clientSnapshotId bookkeeping reused across retries;
//   4. the field-by-field mapping from `SharedWorkloadSnapshotV1` to the
//      `workload_snapshots` row — no object spread, so a local field can't leak.

import type {
  CloudMetricPolicy,
  CloudShareLevel,
  CloudSharePolicyV1,
  CloudSyncState,
  CloudSyncStatus,
  SharedWorkloadSnapshotV1,
  TeamSharePolicyV1
} from "../../../../packages/domain/src/cloud";
import type {
  PersonalReplicaPolicyV1,
  PersonalReplicaSyncStateV1,
} from "../../../../packages/domain/src/personalCloud";
import {
  createDefaultPersonalReplicaPolicy,
  createDefaultPersonalSyncState,
  parsePersonalReplicaPolicy,
  parsePersonalSyncState,
} from "./personalSync";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Share policy
// ---------------------------------------------------------------------------

export const CLOUD_METRIC_KEYS = [
  "reliableCapacity",
  "allocated",
  "reactive",
  "meetings",
  "fragmented",
  "blocked",
  "carryoverRisk",
  "contextSwitching",
  "workInProgress",
  "confidence"
] as const satisfies ReadonlyArray<keyof CloudMetricPolicy>;

/** Human labels for the per-metric consent toggles (matches the builder's preview labels). */
export const CLOUD_METRIC_LABELS: Record<keyof CloudMetricPolicy, string> = {
  reliableCapacity: "Reliable new-work capacity",
  allocated: "Allocated",
  reactive: "Reactive",
  meetings: "Meetings",
  fragmented: "Fragmented work",
  blocked: "Blocked",
  carryoverRisk: "Carryover risk",
  contextSwitching: "Context switching",
  workInProgress: "Work in progress",
  confidence: "Confidence"
};

/**
 * Fresh-install metric defaults: the four headline capacity metrics start on so the
 * FIRST preview a user consents to is meaningful, the finer-grained scores start off.
 * Nothing is uploaded either way until the user enables sharing, picks a team, and
 * records consent against the exact previewed payload.
 */
export function createDefaultCloudMetricPolicy(): CloudMetricPolicy {
  return {
    reliableCapacity: true,
    allocated: true,
    reactive: true,
    meetings: true,
    fragmented: false,
    blocked: false,
    carryoverRisk: false,
    contextSwitching: false,
    workInProgress: false,
    confidence: false
  };
}

/** Sharing is OFF by default: disabled, teamless, unconsented, manual-sync only. */
export function createDefaultCloudSharePolicy(): CloudSharePolicyV1 {
  return {
    version: 1,
    enabled: false,
    teamId: null,
    shareLevel: "summary",
    metrics: createDefaultCloudMetricPolicy(),
    allowedProjectNames: [],
    autoSyncEnabled: false,
    intervalMinutes: 60,
    consentedAt: null
  };
}

const SHARE_LEVELS: ReadonlySet<CloudShareLevel> = new Set(["summary", "categories", "projects"]);

/**
 * Validate a persisted share policy. A missing/garbage blob degrades to the fresh
 * default; a present-but-malformed field degrades to its conservative value — in
 * particular a missing/non-boolean metric flag becomes `false` (omitted, never sent),
 * per the wire contract in `cloud.ts`.
 */
export function parseCloudSharePolicy(value: unknown): CloudSharePolicyV1 {
  if (!isRecord(value)) return createDefaultCloudSharePolicy();
  const metricsRecord = isRecord(value.metrics) ? value.metrics : {};
  const metrics = {} as CloudMetricPolicy;
  for (const key of CLOUD_METRIC_KEYS) {
    metrics[key] = metricsRecord[key] === true;
  }
  const allowedProjectNames: string[] = [];
  if (Array.isArray(value.allowedProjectNames)) {
    for (const name of value.allowedProjectNames) {
      if (typeof name !== "string") continue;
      const trimmed = name.trim().slice(0, 200);
      if (trimmed.length > 0 && !allowedProjectNames.includes(trimmed)) {
        allowedProjectNames.push(trimmed);
      }
    }
  }
  return {
    version: 1,
    enabled: value.enabled === true,
    teamId: stringOrNull(value.teamId),
    shareLevel: SHARE_LEVELS.has(value.shareLevel as CloudShareLevel)
      ? (value.shareLevel as CloudShareLevel)
      : "summary",
    metrics,
    allowedProjectNames,
    autoSyncEnabled: value.autoSyncEnabled === true,
    intervalMinutes: 60,
    consentedAt: stringOrNull(value.consentedAt)
  };
}

// ---------------------------------------------------------------------------
// Team share policy (A6) — a server-side, narrowing-only cap
// ---------------------------------------------------------------------------

/** The existing share-level ladder, narrowest first. Each level strictly adds structure. */
export const CLOUD_SHARE_LEVEL_ORDER: ReadonlyArray<CloudShareLevel> = [
  "summary",
  "categories",
  "projects"
];

/** The narrower (lower-ladder) of two share levels. */
export function narrowerShareLevel(a: CloudShareLevel, b: CloudShareLevel): CloudShareLevel {
  return CLOUD_SHARE_LEVEL_ORDER.indexOf(a) <= CLOUD_SHARE_LEVEL_ORDER.indexOf(b) ? a : b;
}

/** The narrowest interpretation of a team policy object we cannot fully understand. */
function narrowestTeamSharePolicy(): TeamSharePolicyV1 {
  return { version: 1, maxShareLevel: "summary", acceptedMetrics: null };
}

/**
 * Validate a server-supplied team share policy (the `teams.share_policy` jsonb column).
 * ADVERSARIAL INPUT: this value crosses a trust boundary, so:
 *   - a missing/non-object value is NO policy (`null`) — nothing to apply, member consent alone;
 *   - a present object whose version is not 1 (or whose level is malformed) degrades to the
 *     NARROWEST level, never the widest — when a restriction exists but cannot be interpreted,
 *     less leaves the device, not more;
 *   - `acceptedMetrics` present but uninterpretable rejects every metric (`false`), never
 *     accepts; a missing/non-boolean flag is `false`;
 *   - only whitelisted keys are ever read and the result is a fresh literal, so
 *     prototype-pollution-style keys (`__proto__`, `constructor`, …) can neither pollute nor
 *     ride along.
 * The clamp in `applyTeamSharePolicy` guarantees narrowing regardless of what parses here.
 */
export function parseTeamSharePolicy(value: unknown): TeamSharePolicyV1 | null {
  if (!isRecord(value) || Array.isArray(value)) return null;
  if (value.version !== 1) return narrowestTeamSharePolicy();
  const maxShareLevel = SHARE_LEVELS.has(value.maxShareLevel as CloudShareLevel)
    ? (value.maxShareLevel as CloudShareLevel)
    : "summary";
  let acceptedMetrics: CloudMetricPolicy | null = null;
  if (value.acceptedMetrics !== undefined && value.acceptedMetrics !== null) {
    const record = isRecord(value.acceptedMetrics) ? value.acceptedMetrics : {};
    const metrics = {} as CloudMetricPolicy;
    for (const key of CLOUD_METRIC_KEYS) {
      metrics[key] = record[key] === true;
    }
    acceptedMetrics = metrics;
  }
  return { version: 1, maxShareLevel, acceptedMetrics };
}

/**
 * The pure policy merge: effective consent = member consent ∩ team policy. A team policy can
 * only NARROW what the member already consented to — cap the share level, reject metrics — and
 * can never widen it: `enabled`, `teamId`, `consentedAt`, `autoSyncEnabled`, metric consents,
 * and project names come exclusively from the member's policy (field-by-field, no spread of the
 * team policy), so a hostile server value has no channel to add anything. Project names are
 * dropped entirely when the effective level cannot use them. Pure and deterministic; always
 * returns a fresh object.
 */
export function applyTeamSharePolicy(
  member: CloudSharePolicyV1,
  teamPolicy: TeamSharePolicyV1 | null
): CloudSharePolicyV1 {
  const shareLevel =
    teamPolicy === null
      ? member.shareLevel
      : narrowerShareLevel(member.shareLevel, teamPolicy.maxShareLevel);
  const metrics = {} as CloudMetricPolicy;
  for (const key of CLOUD_METRIC_KEYS) {
    const memberConsented = member.metrics[key] === true;
    const teamAccepts =
      teamPolicy === null ||
      teamPolicy.acceptedMetrics === null ||
      teamPolicy.acceptedMetrics[key] === true;
    metrics[key] = memberConsented && teamAccepts;
  }
  return {
    version: 1,
    enabled: member.enabled,
    teamId: member.teamId,
    shareLevel,
    metrics,
    allowedProjectNames: shareLevel === "projects" ? [...member.allowedProjectNames] : [],
    autoSyncEnabled: member.autoSyncEnabled,
    intervalMinutes: 60,
    consentedAt: member.consentedAt
  };
}

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

export function createEmptyCloudSyncState(): CloudSyncState {
  return {
    status: "idle",
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastSyncedFingerprint: null,
    lastSyncedClientSnapshotId: null,
    nextScheduledAt: null
  };
}

const SYNC_STATUSES: ReadonlySet<CloudSyncStatus> = new Set(["idle", "success", "error"]);

/**
 * Validate persisted sync bookkeeping. A persisted "syncing" status normalizes to
 * "idle" — an attempt interrupted by quitting the app is not still running on relaunch.
 */
export function parseCloudSyncState(value: unknown): CloudSyncState {
  if (!isRecord(value)) return createEmptyCloudSyncState();
  return {
    status: SYNC_STATUSES.has(value.status as CloudSyncStatus)
      ? (value.status as CloudSyncStatus)
      : "idle",
    lastAttemptAt: stringOrNull(value.lastAttemptAt),
    lastSuccessAt: stringOrNull(value.lastSuccessAt),
    lastError: stringOrNull(value.lastError),
    lastSyncedFingerprint: stringOrNull(value.lastSyncedFingerprint),
    lastSyncedClientSnapshotId: stringOrNull(value.lastSyncedClientSnapshotId),
    nextScheduledAt: stringOrNull(value.nextScheduledAt)
  };
}

// ---------------------------------------------------------------------------
// Session (local prototype storage only — NEVER exported)
// ---------------------------------------------------------------------------

/**
 * The signed-in Supabase session as kept in local prototype storage. This object
 * must never reach a JSON export, an audit event's details, or the wire payload;
 * `buildCloudBackupMetadata` below is the only export projection and omits it by
 * construction.
 */
export interface PersistedCloudSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds when the access token expires, or null when unknown. */
  expiresAt: number | null;
  userId: string;
  email: string;
  displayName: string | null;
  signedInAt: string | null;
}

export function parseCloudSession(value: unknown): PersistedCloudSession | null {
  if (!isRecord(value)) return null;
  const accessToken = stringOrNull(value.accessToken);
  const refreshToken = stringOrNull(value.refreshToken);
  const userId = stringOrNull(value.userId);
  const email = stringOrNull(value.email);
  if (!accessToken || !refreshToken || !userId || !email) return null;
  return {
    accessToken,
    refreshToken,
    expiresAt:
      typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
        ? value.expiresAt
        : null,
    userId,
    email,
    displayName: stringOrNull(value.displayName),
    signedInAt: stringOrNull(value.signedInAt)
  };
}

// ---------------------------------------------------------------------------
// Stable clientSnapshotId across retries
// ---------------------------------------------------------------------------

/**
 * The id reserved for the CURRENT approved content. `workload_snapshots.client_snapshot_id`
 * is a uuid column with a per-user uniqueness constraint, so the id is generated once per
 * content fingerprint and persisted; a retry of the same content reuses it and the server
 * upserts instead of duplicating.
 */
export interface CloudPendingSnapshot {
  fingerprint: string;
  clientSnapshotId: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCloudPendingSnapshot(value: unknown): CloudPendingSnapshot | null {
  if (!isRecord(value)) return null;
  const fingerprint = stringOrNull(value.fingerprint);
  const clientSnapshotId = stringOrNull(value.clientSnapshotId);
  if (!fingerprint || !clientSnapshotId || !UUID_PATTERN.test(clientSnapshotId)) return null;
  return { fingerprint, clientSnapshotId };
}

/**
 * Reuse the reserved id when the content fingerprint is unchanged (a retry); mint a
 * new one via the injected generator when the approved content changed. Pure — the
 * caller persists the returned record.
 */
export function resolveClientSnapshotId(
  pending: CloudPendingSnapshot | null,
  fingerprint: string,
  generateId: () => string
): CloudPendingSnapshot {
  if (pending && pending.fingerprint === fingerprint) return pending;
  return { fingerprint, clientSnapshotId: generateId() };
}

// ---------------------------------------------------------------------------
// Persisted cloud state envelope
// ---------------------------------------------------------------------------

export interface PersistedCloudStateV1 {
  version: 1;
  session: PersistedCloudSession | null;
  policy: CloudSharePolicyV1;
  syncState: CloudSyncState;
  pendingSnapshot: CloudPendingSnapshot | null;
  personalReplicaPolicy: PersonalReplicaPolicyV1;
  personalSyncState: PersonalReplicaSyncStateV1;
}

export function createDefaultCloudState(): PersistedCloudStateV1 {
  return {
    version: 1,
    session: null,
    policy: createDefaultCloudSharePolicy(),
    syncState: createEmptyCloudSyncState(),
    pendingSnapshot: null,
    personalReplicaPolicy: createDefaultPersonalReplicaPolicy(),
    personalSyncState: createDefaultPersonalSyncState(),
  };
}

export function parsePersistedCloudState(value: unknown): PersistedCloudStateV1 {
  if (!isRecord(value) || value.version !== 1) return createDefaultCloudState();
  return {
    version: 1,
    session: parseCloudSession(value.session),
    policy: parseCloudSharePolicy(value.policy),
    syncState: parseCloudSyncState(value.syncState),
    pendingSnapshot: parseCloudPendingSnapshot(value.pendingSnapshot),
    personalReplicaPolicy: parsePersonalReplicaPolicy(value.personalReplicaPolicy),
    personalSyncState: parsePersonalSyncState(value.personalSyncState),
  };
}

// ---------------------------------------------------------------------------
// Export projection — policy + sync metadata, NEVER auth tokens
// ---------------------------------------------------------------------------

/** What the full local backup may carry about cloud sharing. No session, no tokens. */
export interface CloudBackupMetadata {
  policy: CloudSharePolicyV1;
  syncState: CloudSyncState;
  personalReplicaPolicy: PersonalReplicaPolicyV1;
  personalSync: Omit<PersonalReplicaSyncStateV1, "queue"> & { queuedBatches: number };
}

/**
 * Field-by-field projection for the full-backup export. Built explicitly (no spread
 * of the persisted envelope) so the session/tokens cannot ride along even if a future
 * field lands next to them in storage.
 */
export function buildCloudBackupMetadata(
  policy: CloudSharePolicyV1,
  syncState: CloudSyncState,
  personalReplicaPolicy: PersonalReplicaPolicyV1 = createDefaultPersonalReplicaPolicy(),
  personalSyncState: PersonalReplicaSyncStateV1 = createDefaultPersonalSyncState(() => "not-configured"),
): CloudBackupMetadata {
  const metrics = {} as CloudMetricPolicy;
  for (const key of CLOUD_METRIC_KEYS) {
    metrics[key] = policy.metrics[key] === true;
  }
  return {
    policy: {
      version: 1,
      enabled: policy.enabled,
      teamId: policy.teamId,
      shareLevel: policy.shareLevel,
      metrics,
      allowedProjectNames: [...policy.allowedProjectNames],
      autoSyncEnabled: policy.autoSyncEnabled,
      intervalMinutes: 60,
      consentedAt: policy.consentedAt
    },
    syncState: {
      status: syncState.status,
      lastAttemptAt: syncState.lastAttemptAt,
      lastSuccessAt: syncState.lastSuccessAt,
      lastError: syncState.lastError,
      lastSyncedFingerprint: syncState.lastSyncedFingerprint,
      lastSyncedClientSnapshotId: syncState.lastSyncedClientSnapshotId,
      nextScheduledAt: syncState.nextScheduledAt
    },
    personalReplicaPolicy: {
      version: 1,
      enabled: personalReplicaPolicy.enabled,
      consentedAt: personalReplicaPolicy.consentedAt,
    },
    personalSync: {
      deviceId: personalSyncState.deviceId,
      deviceName: personalSyncState.deviceName,
      cursor: personalSyncState.cursor,
      lastAttemptAt: personalSyncState.lastAttemptAt,
      lastSuccessAt: personalSyncState.lastSuccessAt,
      lastError: personalSyncState.lastError,
      queuedBatches: personalSyncState.queue.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Payload → workload_snapshots row (field-by-field, snake_case wire columns)
// ---------------------------------------------------------------------------

export interface WorkloadSnapshotRow {
  client_snapshot_id: string;
  schema_version: 1;
  team_id: string;
  user_id: string;
  week_id: string;
  observed_at: string;
  source_updated_at: string;
  share_level: CloudShareLevel;
  reliable_new_work_capacity_pct: number | null;
  allocated_pct: number | null;
  reactive_pct: number | null;
  meeting_pct: number | null;
  fragmented_work_pct: number | null;
  blocked_pct: number | null;
  carryover_risk_pct: number | null;
  context_switch_score: number | null;
  wip_load_score: number | null;
  summary_confidence: number | null;
  category_allocation: Array<{ label: string; value: number }> | null;
  work_mode_allocation: Array<{ label: string; value: number }> | null;
  project_allocation: Array<{ label: string; value: number }> | null;
  reviewed_blocks: number;
  eligible_blocks: number;
  content_fingerprint: string;
}

function metricOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function allocationOrNull(
  entries: Array<{ label: string; value: number }> | undefined
): Array<{ label: string; value: number }> | null {
  if (!entries) return null;
  return entries.map((entry) => ({ label: entry.label, value: entry.value }));
}

/**
 * Map the shared payload onto the `workload_snapshots` columns. `user_id` is the
 * authenticated user's id and is re-validated server-side by the RLS WITH CHECK
 * (`user_id = auth.uid()` AND active team membership); a disabled metric is a NULL
 * column, never zero. No spread from the payload — every column is named here.
 */
export function sharedSnapshotToRow(
  snapshot: SharedWorkloadSnapshotV1,
  fingerprint: string,
  userId: string
): WorkloadSnapshotRow {
  return {
    client_snapshot_id: snapshot.clientSnapshotId,
    schema_version: 1,
    team_id: snapshot.teamId,
    user_id: userId,
    week_id: snapshot.weekId,
    observed_at: snapshot.observedAt,
    source_updated_at: snapshot.sourceUpdatedAt,
    share_level: snapshot.shareLevel,
    reliable_new_work_capacity_pct: metricOrNull(snapshot.metrics.reliableNewWorkCapacityPct),
    allocated_pct: metricOrNull(snapshot.metrics.allocatedPct),
    reactive_pct: metricOrNull(snapshot.metrics.reactivePct),
    meeting_pct: metricOrNull(snapshot.metrics.meetingPct),
    fragmented_work_pct: metricOrNull(snapshot.metrics.fragmentedWorkPct),
    blocked_pct: metricOrNull(snapshot.metrics.blockedPct),
    carryover_risk_pct: metricOrNull(snapshot.metrics.carryoverRiskPct),
    context_switch_score: metricOrNull(snapshot.metrics.contextSwitchScore),
    wip_load_score: metricOrNull(snapshot.metrics.wipLoadScore),
    summary_confidence: metricOrNull(snapshot.metrics.summaryConfidence),
    category_allocation: allocationOrNull(snapshot.categoryAllocation),
    work_mode_allocation: allocationOrNull(snapshot.workModeAllocation),
    project_allocation: allocationOrNull(snapshot.projectAllocation),
    reviewed_blocks: snapshot.reviewCoverage.reviewedBlocks,
    eligible_blocks: snapshot.reviewCoverage.eligibleBlocks,
    content_fingerprint: fingerprint
  };
}
