// Version-1 Weekform cloud-sharing contract (blueprint §5, TEAM_CLAWFATHER_ARCHITECTURE §2).
//
// THE TEAM-SHARING RULE: a team never receives the desktop state object or a filtered copy of it.
// It receives only `SharedWorkloadSnapshotV1`, a separately constructed, versioned payload built by
// the pure allowlist builder in `packages/inference/src/sharedSnapshot.ts`. Every field in the
// payload exists because the builder explicitly put it there AND the member's
// `CloudSharePolicyV1` explicitly allowed it. Nothing here is "everything minus a blocklist", so
// local model evolution (new fields on `WorkBlock`, `WeeklyCapacitySnapshot`, …) cannot leak.
//
// These types deliberately have no imports: they must stay usable by the desktop app, the web
// app, and tests without dragging in local-only models. Field names are camelCase because this is
// the wire contract (blueprint §5.3), distinct from the snake_case local models in `models.ts` —
// the mismatch is a feature: it makes an accidental object spread from a local model a type error
// instead of a silent leak.

/** How much structure the member reveals. Each level strictly adds to the previous one. */
export type CloudShareLevel = "summary" | "categories" | "projects";

/**
 * Per-metric consent switches. A `false` (or missing, on malformed input) flag means the metric
 * is OMITTED from the payload — never sent as zero (blueprint §14.1 case 7).
 */
export interface CloudMetricPolicy {
  reliableCapacity: boolean;
  allocated: boolean;
  reactive: boolean;
  meetings: boolean;
  fragmented: boolean;
  blocked: boolean;
  carryoverRisk: boolean;
  contextSwitching: boolean;
  workInProgress: boolean;
  confidence: boolean;
}

/**
 * The member's sharing policy, stored locally and never uploaded itself. Sharing is off by
 * default (`enabled: false`, `consentedAt: null`, `teamId: null`); the builder rejects any policy
 * that is disabled, unconsented, or teamless.
 */
export interface CloudSharePolicyV1 {
  version: 1;
  /** Off by default. */
  enabled: boolean;
  /** The single team receiving snapshots; null until the member picks one. */
  teamId: string | null;
  shareLevel: CloudShareLevel;
  metrics: CloudMetricPolicy;
  /**
   * Exact project names the member allows at the "projects" level. Project allocation is built
   * ONLY from user-verified work blocks whose `project_name` appears here verbatim.
   */
  allowedProjectNames: string[];
  autoSyncEnabled: boolean;
  /** Hourly while the app runs; fixed for v1 so the consent copy cannot drift from behavior. */
  intervalMinutes: 60;
  /** ISO timestamp of "I reviewed what will be shared with this team", or null. */
  consentedAt: string | null;
}

/** One aggregated allocation slice. `label` is a taxonomy label or an allowlisted project name. */
export interface SharedAllocationEntry {
  label: string;
  /** Percent of the week, clamped to safe display bounds by the builder. */
  value: number;
}

/**
 * The only object the team-sharing path receives. Also the exact object rendered in the desktop
 * consent preview — preview and upload are the same reference, not two calculations. The separate,
 * user-private Web workspace uses `PersonalWorkloadReplicaV1` and cannot expose team fields.
 *
 * Never present, by construction: app names, window titles, raw samples, activity sessions,
 * source/derived_from IDs, evidence arrays, notes, stakeholder names, calendar titles/locations/
 * organizers/attendees, chat data, screenshots, Visual Context insights, API keys, or any field
 * not listed below. `user_id` is assigned by the authenticated database write path — never
 * trusted from this payload.
 */
export interface SharedWorkloadSnapshotV1 {
  schemaVersion: 1;
  /** Stable per (team, week, content) so retries upsert idempotently instead of duplicating. */
  clientSnapshotId: string;
  teamId: string;
  weekId: string;
  /** When this payload was built (transient; excluded from the content fingerprint). */
  observedAt: string;
  /** Most recent underlying reviewed-data change (transient; excluded from the fingerprint). */
  sourceUpdatedAt: string;
  shareLevel: CloudShareLevel;
  /** Partial on purpose: a disabled or non-finite metric is absent, never zeroed. */
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
  /** Present only at "categories" level and above. */
  categoryAllocation?: SharedAllocationEntry[];
  /** Present only at "categories" level and above. */
  workModeAllocation?: SharedAllocationEntry[];
  /** Present only at "projects" level: allowlisted names from user-verified blocks only. */
  projectAllocation?: SharedAllocationEntry[];
  /** Always sent so managers can judge trust and freshness honestly. */
  reviewCoverage: {
    reviewedBlocks: number;
    eligibleBlocks: number;
  };
}

/**
 * A team's server-side share policy (the `teams.share_policy` jsonb column), written by the
 * team's managers on the web and read by every member's desktop client.
 *
 * NARROWING-ONLY BY CONSTRUCTION: this policy is applied as an intersection with the member's
 * own `CloudSharePolicyV1` (see `applyTeamSharePolicy` in the desktop `cloudPolicy.ts`). It can
 * cap the share level and reject metrics the team does not want to receive; it can NEVER enable
 * sharing, add a metric the member did not consent to, add project names, or record consent.
 */
export interface TeamSharePolicyV1 {
  version: 1;
  /**
   * The most structure the team accepts, on the existing ladder ("summary" < "categories" <
   * "projects"). A member's effective level is the narrower of this and their own choice.
   */
  maxShareLevel: CloudShareLevel;
  /**
   * Metrics the team accepts. `null` means the team accepts every metric the member consented
   * to; a record means only metrics flagged `true` here (AND consented by the member) are sent.
   */
  acceptedMetrics: CloudMetricPolicy | null;
}

export type CloudSyncStatus = "idle" | "syncing" | "success" | "error";

/**
 * Local sync bookkeeping for the Account & Sharing surface ("last successful sync", "last
 * attempt", "next scheduled sync while the app is running"). Local-only; never uploaded.
 */
export interface CloudSyncState {
  status: CloudSyncStatus;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  /** Human-readable failure summary for the last attempt, or null. Never raw response bodies. */
  lastError: string | null;
  /** Content fingerprint of the last successfully synced payload (for "unchanged" skips). */
  lastSyncedFingerprint: string | null;
  lastSyncedClientSnapshotId: string | null;
  /** Next hourly attempt while the app runs, or null when auto-sync is off. */
  nextScheduledAt: string | null;
}

/**
 * What the UI may know about the signed-in cloud account. Deliberately excludes access/refresh
 * tokens, session objects, and keys — those stay inside the auth client and MUST NOT be added
 * here.
 */
export interface CloudAccountSummary {
  userId: string;
  email: string;
  displayName: string | null;
  teamId: string | null;
  teamName: string | null;
  role: "owner" | "manager" | "member" | null;
  signedInAt: string | null;
}
