// Pure allowlist builder for the version-1 cloud-sharing payload (blueprint §5.4).
//
// This module is the single boundary between local models and the cloud. It constructs
// `SharedWorkloadSnapshotV1` FIELD BY FIELD — there is deliberately no object spread from
// `WeeklyCapacitySnapshot` or `WorkBlock`, so a new local field can never ride along into the
// payload. The consent preview and the uploaded payload are the SAME object reference, and the
// content fingerprint is a pure function of the payload's non-transient fields (no Date.now, no
// randomness), so retries are idempotent and "unchanged since last sync" is decidable offline.

import type { WeeklyCapacitySnapshot, WorkBlock } from "../../domain/src/models";
import { workCategories, workModes } from "../../domain/src/taxonomy";
import {
  MAX_SHARED_PROJECT_NAME_LENGTH,
  MAX_SHARED_PROJECTS,
  sharedProjectNameCodePointLength,
  type CloudMetricPolicy,
  type CloudSharePolicyV1,
  type SharedAllocationEntry,
  type SharedWorkloadSnapshotV1
} from "../../domain/src/cloud";
import { normalizeWeekId } from "./capacity";

/** Why a policy cannot produce a payload. Typed so callers render honest copy, never a throw. */
export type SharedSnapshotRejectionReason =
  | "sharing_disabled"
  | "team_missing"
  | "consent_missing";

export interface SharedSnapshotRejection {
  ok: false;
  reason: SharedSnapshotRejectionReason;
  /** Human-readable, sensitive-data-free explanation for the Account & Sharing surface. */
  message: string;
}

/**
 * Human-readable consent preview. `payload` is the EXACT object that will be uploaded — the same
 * reference returned as `snapshot` — never a second calculation; `lines` are derived from that
 * object alone.
 */
export interface SharedSnapshotPreview {
  payload: SharedWorkloadSnapshotV1;
  lines: string[];
}

export interface SharedSnapshotBuildSuccess {
  ok: true;
  snapshot: SharedWorkloadSnapshotV1;
  preview: SharedSnapshotPreview;
  /** Deterministic content fingerprint (transient timestamps and id excluded). */
  fingerprint: string;
}

export type SharedSnapshotBuildResult = SharedSnapshotBuildSuccess | SharedSnapshotRejection;

export interface BuildSharedWorkloadSnapshotInput {
  snapshot: WeeklyCapacitySnapshot;
  /** Candidate blocks; only blocks for the snapshot's week count, and only user-verified ones can contribute project names. */
  workBlocks: WorkBlock[];
  policy: CloudSharePolicyV1;
  /** ISO timestamp injected by the caller so the builder stays pure and testable. */
  now: string;
  /**
   * Optional caller-supplied id (e.g. the id of a previous attempt being retried). When omitted,
   * a stable id is derived from the content fingerprint, so rebuilding identical approved content
   * yields the identical id — retries upsert instead of duplicating.
   */
  clientSnapshotId?: string;
}

// ---------------------------------------------------------------------------
// Numeric safety
// ---------------------------------------------------------------------------

/**
 * Clamp a value into [min, max], rounded to 2 decimals for fingerprint stability. Returns null
 * for non-finite input (NaN/±Infinity) — the caller must OMIT the field, never send a made-up
 * number (blueprint §14.1 case 8).
 */
function safeBoundedNumber(value: number, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const clamped = Math.max(min, Math.min(max, value));
  return Number(clamped.toFixed(2));
}

/** Non-negative integer for review-coverage counts; non-finite/negative input becomes 0. */
function safeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

// ---------------------------------------------------------------------------
// Metric allowlist
// ---------------------------------------------------------------------------

type SharedMetricKey = keyof SharedWorkloadSnapshotV1["metrics"];

/**
 * The complete metric allowlist: policy flag → payload key → local source field → display
 * bounds. A metric absent from this table cannot be shared at all. Percent fields clamp to
 * 0–100, except `allocatedPct`, which may honestly exceed 100 in an overcommitted week and
 * clamps to the 0–999 display bound; unit-interval scores clamp to 0–1 (capacity.ts emits them
 * clamped to [0, 1] already — the clamp here is defense in depth).
 */
const METRIC_RULES: ReadonlyArray<{
  policyKey: keyof CloudMetricPolicy;
  payloadKey: SharedMetricKey;
  label: string;
  read: (snapshot: WeeklyCapacitySnapshot) => number;
  min: number;
  max: number;
}> = [
  {
    policyKey: "reliableCapacity",
    payloadKey: "reliableNewWorkCapacityPct",
    label: "Reliable new-work capacity",
    read: (s) => s.reliable_new_work_capacity_pct,
    min: 0,
    max: 100
  },
  {
    policyKey: "allocated",
    payloadKey: "allocatedPct",
    label: "Allocated",
    read: (s) => s.allocated_pct,
    min: 0,
    max: 999
  },
  {
    policyKey: "reactive",
    payloadKey: "reactivePct",
    label: "Reactive",
    read: (s) => s.reactive_pct,
    min: 0,
    max: 100
  },
  {
    policyKey: "meetings",
    payloadKey: "meetingPct",
    label: "Meetings",
    read: (s) => s.meeting_pct,
    min: 0,
    max: 100
  },
  {
    policyKey: "fragmented",
    payloadKey: "fragmentedWorkPct",
    label: "Fragmented work",
    read: (s) => s.fragmented_work_pct,
    min: 0,
    max: 100
  },
  {
    policyKey: "blocked",
    payloadKey: "blockedPct",
    label: "Blocked",
    read: (s) => s.blocked_pct,
    min: 0,
    max: 100
  },
  {
    policyKey: "carryoverRisk",
    payloadKey: "carryoverRiskPct",
    label: "Carryover risk",
    read: (s) => s.carryover_risk_pct,
    min: 0,
    max: 100
  },
  {
    policyKey: "contextSwitching",
    payloadKey: "contextSwitchScore",
    label: "Context switching",
    read: (s) => s.context_switch_score,
    min: 0,
    max: 1
  },
  {
    policyKey: "workInProgress",
    payloadKey: "wipLoadScore",
    label: "Work in progress",
    read: (s) => s.wip_load_score,
    min: 0,
    max: 1
  },
  {
    policyKey: "confidence",
    payloadKey: "summaryConfidence",
    label: "Confidence",
    read: (s) => s.summary_confidence,
    min: 0,
    max: 1
  }
];

// ---------------------------------------------------------------------------
// Allocation allowlists
// ---------------------------------------------------------------------------

const CATEGORY_LABELS = new Set<string>(workCategories);
const MODE_LABELS = new Set<string>(workModes);

/**
 * Copy allocation entries whose label is on the given allowlist and whose value is finite,
 * clamped to 0–100. Labels are re-validated against the fixed taxonomy even though the local
 * model types them, so a corrupted persisted record cannot smuggle free text.
 */
function sanitizeAllocation(
  entries: Array<{ label: string; value: number }>,
  allowedLabels: ReadonlySet<string>
): SharedAllocationEntry[] {
  const result: SharedAllocationEntry[] = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry?.label !== "string" || !allowedLabels.has(entry.label)) continue;
    const value = safeBoundedNumber(entry.value, 0, 100);
    if (value === null) continue;
    result.push({ label: entry.label, value });
  }
  result.sort((a, b) => a.label.localeCompare(b.label));
  return result;
}

/**
 * Project allocation from user-verified blocks whose exact `project_name` the member explicitly
 * allowlisted. Unverified blocks never contribute; names outside the allowlist never appear —
 * not even grouped — so a sensitive project title cannot leak by being "summarized".
 */
function buildProjectAllocation(
  blocks: WorkBlock[],
  allowedProjectNames: string[]
): SharedAllocationEntry[] {
  const allowed = new Set<string>();
  for (const name of Array.isArray(allowedProjectNames) ? allowedProjectNames : []) {
    if (typeof name !== "string") continue;
    const trimmed = name.trim();
    const codePointLength = sharedProjectNameCodePointLength(trimmed);
    if (codePointLength === null
      || codePointLength === 0
      || codePointLength > MAX_SHARED_PROJECT_NAME_LENGTH) continue;
    allowed.add(trimmed);
    if (allowed.size === MAX_SHARED_PROJECTS) break;
  }
  if (allowed.size === 0) return [];
  const totals = new Map<string, number>();
  for (const block of blocks) {
    if (block.user_verified !== true) continue;
    const name = typeof block.project_name === "string" ? block.project_name.trim() : "";
    if (!allowed.has(name)) continue;
    const contribution = safeBoundedNumber(block.estimated_capacity_pct, 0, 100);
    if (contribution === null) continue;
    totals.set(name, (totals.get(name) ?? 0) + contribution);
  }
  const result: SharedAllocationEntry[] = [];
  for (const [label, total] of totals) {
    const value = safeBoundedNumber(total, 0, 100);
    if (value === null) continue;
    result.push({ label, value });
  }
  result.sort((a, b) => a.label.localeCompare(b.label));
  return result;
}

// ---------------------------------------------------------------------------
// Deterministic fingerprint
// ---------------------------------------------------------------------------

type StableJson = string | number | boolean | null | StableJson[] | { [key: string]: StableJson };

/** JSON.stringify with recursively sorted object keys, so key order can never change the hash. */
function stableStringify(value: StableJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

/** FNV-1a 64-bit over UTF-16 code units; pure, dependency-free, and stable across runs. */
function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hash ^= BigInt(code & 0xff);
    hash = (hash * prime) & mask;
    hash ^= BigInt(code >> 8);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Deterministic fingerprint of the payload's approved CONTENT. Excludes `observedAt`,
 * `sourceUpdatedAt`, and `clientSnapshotId` — the transient fields — so rebuilding the same
 * approved data later yields the same fingerprint, while any policy or data change (share level,
 * metric set, values, allocations, team, week) changes it.
 */
export function computeSharedSnapshotFingerprint(snapshot: SharedWorkloadSnapshotV1): string {
  const content: StableJson = {
    schemaVersion: snapshot.schemaVersion,
    teamId: snapshot.teamId,
    weekId: snapshot.weekId,
    shareLevel: snapshot.shareLevel,
    metrics: { ...snapshot.metrics },
    categoryAllocation: (snapshot.categoryAllocation ?? []).map((entry) => ({
      label: entry.label,
      value: entry.value
    })),
    workModeAllocation: (snapshot.workModeAllocation ?? []).map((entry) => ({
      label: entry.label,
      value: entry.value
    })),
    projectAllocation: (snapshot.projectAllocation ?? []).map((entry) => ({
      label: entry.label,
      value: entry.value
    })),
    reviewCoverage: {
      reviewedBlocks: snapshot.reviewCoverage.reviewedBlocks,
      eligibleBlocks: snapshot.reviewCoverage.eligibleBlocks
    }
  };
  return fnv1a64Hex(stableStringify(content));
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * Human-readable consent lines derived ONLY from the payload that will be uploaded, so the
 * preview cannot claim less (or more) than the sync sends. Disabled metrics render as
 * "Not shared" by name — absence is a first-class state.
 */
export function describeSharedSnapshot(snapshot: SharedWorkloadSnapshotV1): string[] {
  const sharedLabels: string[] = [];
  const notSharedLabels: string[] = [];
  for (const rule of METRIC_RULES) {
    if (snapshot.metrics[rule.payloadKey] !== undefined) sharedLabels.push(rule.label);
    else notSharedLabels.push(rule.label);
  }
  const lines: string[] = [
    `Team ${snapshot.teamId} receives week ${snapshot.weekId} at the "${snapshot.shareLevel}" level.`,
    sharedLabels.length > 0
      ? `Shared metrics (${sharedLabels.length}): ${sharedLabels.join(", ")}.`
      : "Shared metrics: none.",
    notSharedLabels.length > 0 ? `Not shared: ${notSharedLabels.join(", ")}.` : "Not shared: none."
  ];
  if (snapshot.categoryAllocation) {
    lines.push(`Category allocation: ${snapshot.categoryAllocation.length} categories.`);
  } else {
    lines.push("Category allocation: not shared.");
  }
  if (snapshot.workModeAllocation) {
    lines.push(`Work-mode allocation: ${snapshot.workModeAllocation.length} modes.`);
  } else {
    lines.push("Work-mode allocation: not shared.");
  }
  if (snapshot.projectAllocation) {
    lines.push(
      snapshot.projectAllocation.length > 0
        ? `Project allocation: ${snapshot.projectAllocation.map((entry) => entry.label).join(", ")}.`
        : "Project allocation: enabled, but no verified work matches your allowed project names."
    );
  } else {
    lines.push("Project allocation: not shared.");
  }
  lines.push(
    `Review coverage: ${snapshot.reviewCoverage.reviewedBlocks} of ${snapshot.reviewCoverage.eligibleBlocks} work blocks reviewed.`
  );
  lines.push("Never sent: app names, window titles, evidence, notes, calendar or chat details, screenshots.");
  return lines;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the version-1 shared payload, or a typed rejection when the policy does not permit
 * sharing. Pure: same inputs → same payload, same fingerprint, same clientSnapshotId (when not
 * caller-supplied).
 */
export function buildSharedWorkloadSnapshot(
  input: BuildSharedWorkloadSnapshotInput
): SharedSnapshotBuildResult {
  const { snapshot, workBlocks, policy, now } = input;

  if (policy.enabled !== true) {
    return {
      ok: false,
      reason: "sharing_disabled",
      message: "Sharing is off. Nothing is uploaded until you turn sharing on."
    };
  }
  const teamId = typeof policy.teamId === "string" ? policy.teamId.trim() : "";
  if (teamId.length === 0) {
    return {
      ok: false,
      reason: "team_missing",
      message: "No team selected. Choose the team that should receive your capacity signals."
    };
  }
  if (typeof policy.consentedAt !== "string" || policy.consentedAt.trim().length === 0) {
    return {
      ok: false,
      reason: "consent_missing",
      message:
        'Consent not recorded. Review the exact payload and confirm "I reviewed what will be shared with this team."'
    };
  }

  const weekId = normalizeWeekId(snapshot.week_id);
  const weekBlocks = (Array.isArray(workBlocks) ? workBlocks : []).filter(
    (block) => normalizeWeekId(block.week_id) === weekId
  );
  // Review-only evidence (currently directed Chat signals) deliberately carries
  // zero modeled capacity. Keep those cards in the individual's local review
  // queue, but do not let their count become a manager-visible proxy for source
  // activity or enter shared project/source freshness calculations.
  const eligibleWeekBlocks = weekBlocks.filter(
    (block) =>
      Number.isFinite(block.estimated_capacity_pct) && block.estimated_capacity_pct > 0
  );

  // Metrics: explicit allowlist walk. A disabled flag or a non-finite source value both mean the
  // key is ABSENT from the payload — never zero, never null.
  const metrics: SharedWorkloadSnapshotV1["metrics"] = {};
  for (const rule of METRIC_RULES) {
    if (policy.metrics?.[rule.policyKey] !== true) continue;
    const value = safeBoundedNumber(rule.read(snapshot), rule.min, rule.max);
    if (value === null) continue;
    metrics[rule.payloadKey] = value;
  }

  const includeCategories = policy.shareLevel === "categories" || policy.shareLevel === "projects";
  const includeProjects = policy.shareLevel === "projects";

  const reviewedBlocks = safeCount(
    eligibleWeekBlocks.filter((block) => block.user_verified === true).length
  );
  const eligibleBlocks = safeCount(eligibleWeekBlocks.length);

  // Most recent underlying reviewed-data change; falls back to `now` when no blocks exist. ISO
  // strings compare correctly lexicographically.
  let sourceUpdatedAt = "";
  for (const block of eligibleWeekBlocks) {
    if (typeof block.end_time === "string" && block.end_time > sourceUpdatedAt) {
      sourceUpdatedAt = block.end_time;
    }
  }
  if (sourceUpdatedAt.length === 0) sourceUpdatedAt = now;

  // Assemble field-by-field. NOTE: no spread from `snapshot`, `policy`, or any block — every key
  // below is on the wire contract by name.
  const shared: SharedWorkloadSnapshotV1 = {
    schemaVersion: 1,
    clientSnapshotId: "", // assigned below once the content fingerprint exists
    teamId,
    weekId,
    observedAt: now,
    sourceUpdatedAt,
    shareLevel: policy.shareLevel,
    metrics,
    reviewCoverage: { reviewedBlocks, eligibleBlocks }
  };
  if (includeCategories) {
    shared.categoryAllocation = sanitizeAllocation(snapshot.category_allocation, CATEGORY_LABELS);
    shared.workModeAllocation = sanitizeAllocation(snapshot.work_mode_allocation, MODE_LABELS);
  }
  if (includeProjects) {
    shared.projectAllocation = buildProjectAllocation(
      eligibleWeekBlocks,
      policy.allowedProjectNames
    );
  }

  const fingerprint = computeSharedSnapshotFingerprint(shared);
  shared.clientSnapshotId =
    typeof input.clientSnapshotId === "string" && input.clientSnapshotId.trim().length > 0
      ? input.clientSnapshotId.trim()
      : `wfsnap1-${fingerprint}`;

  return {
    ok: true,
    snapshot: shared,
    // Same reference on purpose: the preview IS the upload (blueprint §5.4 requirement 10).
    preview: { payload: shared, lines: describeSharedSnapshot(shared) },
    fingerprint
  };
}
