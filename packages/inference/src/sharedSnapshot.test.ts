// Contract tests for the version-1 cloud-sharing payload builder (blueprint §14.1 cases 1–10).
// Run: npx tsx --test packages/inference/src/sharedSnapshot.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { WeeklyCapacitySnapshot, WorkBlock } from "../../domain/src/models";
import type { CloudMetricPolicy, CloudSharePolicyV1 } from "../../domain/src/cloud";
import { buildSharedWorkloadSnapshot, computeSharedSnapshotFingerprint } from "./sharedSnapshot";

// Sensitive sentinels planted in local models. If ANY of these ever appear in the serialized
// payload, the allowlist boundary is broken.
const SENTINEL_WINDOW_TITLE = "SENTINEL_WINDOW_TITLE acme-merger-financials.xlsx — Excel";
const SENTINEL_EVIDENCE = "SENTINEL_EVIDENCE window sample: Slack — #layoffs-planning";
const SENTINEL_NOTE = "SENTINEL_NOTE waiting on Dr. Chen's confidential biopsy results";
const SENTINEL_APP_NAME = "SENTINEL_APP Superhuman";
const SENTINEL_STAKEHOLDER = "SENTINEL_STAKEHOLDER Finance leadership";
const SENTINEL_DERIVED_FROM = "SENTINEL_SESSION_ID sess-9f2c";
const SENTINEL_SECRET_PROJECT = "SENTINEL_PROJECT Project Bluebird (undisclosed acquisition)";

function makeBlock(overrides: Partial<WorkBlock>): WorkBlock {
  return {
    work_block_id: "wb-1",
    week_id: "2026-W29",
    start_time: "2026-07-13T09:00:00.000Z",
    end_time: "2026-07-13T11:00:00.000Z",
    estimated_capacity_pct: 5,
    category: "Planned analysis / project work",
    mode: "Deep work",
    planned_status: "planned",
    project_name: "Quarterly forecast refresh",
    stakeholder_group: SENTINEL_STAKEHOLDER,
    derived_from: [SENTINEL_DERIVED_FROM],
    evidence: [SENTINEL_EVIDENCE, `${SENTINEL_APP_NAME} — ${SENTINEL_WINDOW_TITLE}`],
    confidence: 0.9,
    user_verified: true,
    blocker_flag: false,
    notes: SENTINEL_NOTE,
    ...overrides
  };
}

function makeCapacitySnapshot(overrides: Partial<WeeklyCapacitySnapshot> = {}): WeeklyCapacitySnapshot {
  return {
    week_id: "2026-W29",
    allocated_pct: 82,
    deep_work_pct: 30,
    fragmented_work_pct: 14,
    meeting_pct: 22,
    reactive_pct: 18,
    planned_pct: 44,
    blocked_pct: 4,
    recurring_pct: 12,
    reliable_new_work_capacity_pct: 9,
    committed_utilization_pct: 71,
    carryover_risk_pct: 11,
    wip_load_score: 0.42,
    context_switch_score: 0.37,
    fragmentation_penalty_pct: 4,
    wip_penalty_pct: 4,
    summary_confidence: 0.81,
    category_allocation: [
      { label: "Planned analysis / project work", value: 30 },
      { label: "Meetings / stakeholder syncs", value: 22 }
    ],
    work_mode_allocation: [
      { label: "Deep work", value: 30 },
      { label: "Reactive", value: 18 }
    ],
    ...overrides
  };
}

function allMetricsEnabled(): CloudMetricPolicy {
  return {
    reliableCapacity: true,
    allocated: true,
    reactive: true,
    meetings: true,
    fragmented: true,
    blocked: true,
    carryoverRisk: true,
    contextSwitching: true,
    workInProgress: true,
    confidence: true
  };
}

function makePolicy(overrides: Partial<CloudSharePolicyV1> = {}): CloudSharePolicyV1 {
  return {
    version: 1,
    enabled: true,
    teamId: "team-t1",
    shareLevel: "summary",
    metrics: allMetricsEnabled(),
    allowedProjectNames: [],
    autoSyncEnabled: false,
    intervalMinutes: 60,
    consentedAt: "2026-07-18T16:00:00.000Z",
    ...overrides
  };
}

const NOW = "2026-07-19T12:00:00.000Z";

function buildOrFail(policy: CloudSharePolicyV1, blocks: WorkBlock[] = [makeBlock({})]) {
  const result = buildSharedWorkloadSnapshot({
    snapshot: makeCapacitySnapshot(),
    workBlocks: blocks,
    policy,
    now: NOW
  });
  assert.equal(result.ok, true, "expected a payload, got a rejection");
  if (!result.ok) throw new Error("unreachable");
  return result;
}

// Case 0: preview construction is independent from upload approval. A selected team can always
// be reviewed before the individual approves sharing; only a missing recipient blocks preview.
test("builds a preview before approval and rejects only a missing recipient", () => {
  const base = makePolicy();
  const disabled = buildSharedWorkloadSnapshot({
    snapshot: makeCapacitySnapshot(),
    workBlocks: [],
    policy: { ...base, enabled: false },
    now: NOW
  });
  assert.equal(disabled.ok, true);

  const teamless = buildSharedWorkloadSnapshot({
    snapshot: makeCapacitySnapshot(),
    workBlocks: [],
    policy: { ...base, teamId: null },
    now: NOW
  });
  assert.deepEqual([teamless.ok, !teamless.ok && teamless.reason], [false, "team_missing"]);

  const unconsented = buildSharedWorkloadSnapshot({
    snapshot: makeCapacitySnapshot(),
    workBlocks: [],
    policy: { ...base, consentedAt: null },
    now: NOW
  });
  assert.equal(unconsented.ok, true);
  assert.deepEqual(
    unconsented.ok ? unconsented.preview.payload : null,
    unconsented.ok ? unconsented.snapshot : null
  );
});

// Case 1: summary level includes only enabled numeric metrics — no allocation arrays at all.
test("summary output contains only enabled summary fields", () => {
  const { snapshot } = buildOrFail(makePolicy({ shareLevel: "summary" }));
  assert.deepEqual(Object.keys(snapshot).sort(), [
    "clientSnapshotId",
    "metrics",
    "observedAt",
    "reviewCoverage",
    "schemaVersion",
    "shareLevel",
    "sourceUpdatedAt",
    "teamId",
    "weekId"
  ]);
  assert.equal(snapshot.categoryAllocation, undefined);
  assert.equal(snapshot.workModeAllocation, undefined);
  assert.equal(snapshot.projectAllocation, undefined);
  assert.deepEqual(snapshot.metrics, {
    reliableNewWorkCapacityPct: 9,
    allocatedPct: 82,
    reactivePct: 18,
    meetingPct: 22,
    fragmentedWorkPct: 14,
    blockedPct: 4,
    carryoverRiskPct: 11,
    contextSwitchScore: 0.37,
    wipLoadScore: 0.42,
    summaryConfidence: 0.81
  });
  assert.deepEqual(snapshot.reviewCoverage, { reviewedBlocks: 1, eligibleBlocks: 1 });
});

// Case 2: categories level adds ONLY category/work-mode allocation — still no project data.
test("categories output adds only category and work-mode allocation", () => {
  const summaryKeys = Object.keys(buildOrFail(makePolicy({ shareLevel: "summary" })).snapshot);
  const { snapshot } = buildOrFail(makePolicy({ shareLevel: "categories" }));
  const addedKeys = Object.keys(snapshot).filter((key) => !summaryKeys.includes(key)).sort();
  assert.deepEqual(addedKeys, ["categoryAllocation", "workModeAllocation"]);
  assert.equal(snapshot.projectAllocation, undefined);
  assert.deepEqual(snapshot.categoryAllocation, [
    { label: "Meetings / stakeholder syncs", value: 22 },
    { label: "Planned analysis / project work", value: 30 }
  ]);
  assert.deepEqual(snapshot.workModeAllocation, [
    { label: "Deep work", value: 30 },
    { label: "Reactive", value: 18 }
  ]);
});

// Case 3: projects level includes only allowlisted names from user-VERIFIED blocks.
test("projects output includes only allowed names from verified blocks", () => {
  const blocks = [
    makeBlock({ work_block_id: "wb-1", project_name: "Quarterly forecast refresh", estimated_capacity_pct: 5 }),
    makeBlock({ work_block_id: "wb-2", project_name: "Quarterly forecast refresh", estimated_capacity_pct: 7 }),
    // Allowed name but NOT user-verified: must not contribute.
    makeBlock({ work_block_id: "wb-3", project_name: "Quarterly forecast refresh", user_verified: false, estimated_capacity_pct: 50 }),
    // Verified but not on the allowlist: must not appear, not even grouped.
    makeBlock({ work_block_id: "wb-4", project_name: SENTINEL_SECRET_PROJECT, estimated_capacity_pct: 20 })
  ];
  const { snapshot } = buildOrFail(
    makePolicy({ shareLevel: "projects", allowedProjectNames: ["Quarterly forecast refresh"] }),
    blocks
  );
  assert.deepEqual(snapshot.projectAllocation, [{ label: "Quarterly forecast refresh", value: 12 }]);
  assert.equal(JSON.stringify(snapshot).includes(SENTINEL_SECRET_PROJECT), false);
});

test("project output cannot exceed the server's fifty-entry payload bound", () => {
  const projectNames = Array.from({ length: 55 }, (_, index) => `Allowed project ${index + 1}`);
  const blocks = projectNames.map((projectName, index) =>
    makeBlock({
      work_block_id: `wb-project-${index + 1}`,
      project_name: projectName,
      estimated_capacity_pct: 1,
      user_verified: true
    })
  );
  const result = buildOrFail(
    makePolicy({ shareLevel: "projects", allowedProjectNames: projectNames }),
    blocks
  );

  assert.equal(result.snapshot.projectAllocation?.length, 50);
  assert.equal(
    result.snapshot.projectAllocation?.some((entry) => entry.label === "Allowed project 51"),
    false
  );
});

test("project output accepts the server's two-hundred-code-point astral boundary", () => {
  const boundaryName = `${"a".repeat(199)}😀`;
  const result = buildOrFail(
    makePolicy({ shareLevel: "projects", allowedProjectNames: [boundaryName] }),
    [makeBlock({
      work_block_id: "wb-project-astral-boundary",
      project_name: boundaryName,
      estimated_capacity_pct: 7,
      user_verified: true,
    })],
  );

  assert.deepEqual(result.snapshot.projectAllocation, [{ label: boundaryName, value: 7 }]);
});

// Cases 4–6: sensitive sentinels can never appear in the serialized payload, at the widest level.
test("window-title, evidence, and note sentinels never appear in serialized output", () => {
  const result = buildOrFail(
    makePolicy({ shareLevel: "projects", allowedProjectNames: ["Quarterly forecast refresh"] })
  );
  const serialized = JSON.stringify(result.snapshot);
  const previewSerialized = JSON.stringify(result.preview);
  for (const sentinel of [
    SENTINEL_WINDOW_TITLE,
    SENTINEL_EVIDENCE,
    SENTINEL_NOTE,
    SENTINEL_APP_NAME,
    SENTINEL_STAKEHOLDER,
    SENTINEL_DERIVED_FROM
  ]) {
    assert.equal(serialized.includes(sentinel), false, `payload leaked: ${sentinel}`);
    assert.equal(previewSerialized.includes(sentinel), false, `preview leaked: ${sentinel}`);
  }
  // Forbidden local field names must not exist as payload keys either.
  for (const forbiddenKey of ["evidence", "notes", "derived_from", "app_name", "window_title", "stakeholder_group"]) {
    assert.equal(serialized.includes(`"${forbiddenKey}"`), false, `payload carries key: ${forbiddenKey}`);
  }
});

// Case 7: disabled metrics are omitted — absent keys, never zero.
test("disabled metrics are absent from the payload, not zero", () => {
  const { snapshot } = buildOrFail(
    makePolicy({
      metrics: { ...allMetricsEnabled(), reactive: false, meetings: false, confidence: false }
    })
  );
  assert.equal("reactivePct" in snapshot.metrics, false);
  assert.equal("meetingPct" in snapshot.metrics, false);
  assert.equal("summaryConfidence" in snapshot.metrics, false);
  assert.equal(snapshot.metrics.reactivePct, undefined);
  assert.equal(snapshot.metrics.allocatedPct, 82);
});

// Case 8: NaN/Infinity never reach the output; out-of-range values clamp to display bounds.
test("non-finite values are omitted and out-of-range values are clamped", () => {
  const corrupt = makeCapacitySnapshot({
    reactive_pct: Number.NaN,
    meeting_pct: Number.POSITIVE_INFINITY,
    carryover_risk_pct: -12,
    allocated_pct: 1400,
    context_switch_score: 3.5,
    category_allocation: [
      { label: "Planned analysis / project work", value: Number.NaN },
      { label: "Meetings / stakeholder syncs", value: 22 }
    ],
    work_mode_allocation: [{ label: "Deep work", value: Number.NEGATIVE_INFINITY }]
  });
  const result = buildSharedWorkloadSnapshot({
    snapshot: corrupt,
    workBlocks: [makeBlock({ estimated_capacity_pct: Number.NaN })],
    policy: makePolicy({ shareLevel: "projects", allowedProjectNames: ["Quarterly forecast refresh"] }),
    now: NOW
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  const serialized = JSON.stringify(result.snapshot);
  assert.equal(serialized.includes("null"), false);
  assert.equal("reactivePct" in result.snapshot.metrics, false);
  assert.equal("meetingPct" in result.snapshot.metrics, false);
  assert.equal(result.snapshot.metrics.carryoverRiskPct, 0);
  assert.equal(result.snapshot.metrics.allocatedPct, 999);
  assert.equal(result.snapshot.metrics.contextSwitchScore, 1);
  assert.deepEqual(result.snapshot.categoryAllocation, [{ label: "Meetings / stakeholder syncs", value: 22 }]);
  assert.deepEqual(result.snapshot.workModeAllocation, []);
  assert.deepEqual(result.snapshot.projectAllocation, []);
  for (const value of Object.values(result.snapshot.metrics)) {
    assert.equal(Number.isFinite(value), true);
  }
});

// Case 9: same approved content → same fingerprint AND same clientSnapshotId, regardless of when
// the payload is rebuilt (retry idempotency).
test("same approved content produces the same fingerprint and client snapshot id", () => {
  const policy = makePolicy({ shareLevel: "categories" });
  const first = buildOrFail(policy);
  const later = buildSharedWorkloadSnapshot({
    snapshot: makeCapacitySnapshot(),
    workBlocks: [makeBlock({})],
    policy,
    now: "2026-07-19T18:45:00.000Z" // different build time must not change identity
  });
  assert.equal(later.ok, true);
  if (!later.ok) throw new Error("unreachable");
  assert.equal(first.fingerprint, later.fingerprint);
  assert.equal(first.snapshot.clientSnapshotId, later.snapshot.clientSnapshotId);
  assert.equal(computeSharedSnapshotFingerprint(first.snapshot), first.fingerprint);
  // A caller-supplied retry id is honored verbatim.
  const retry = buildSharedWorkloadSnapshot({
    snapshot: makeCapacitySnapshot(),
    workBlocks: [makeBlock({})],
    policy,
    now: NOW,
    clientSnapshotId: first.snapshot.clientSnapshotId
  });
  assert.equal(retry.ok && retry.snapshot.clientSnapshotId, first.snapshot.clientSnapshotId);
});

// Case 10: any policy change — narrower metrics or a different share level — changes the
// fingerprint, so "unchanged" can never mask a scope change.
test("policy changes change the fingerprint", () => {
  const base = buildOrFail(makePolicy({ shareLevel: "categories" }));
  const narrower = buildOrFail(
    makePolicy({ shareLevel: "categories", metrics: { ...allMetricsEnabled(), reactive: false } })
  );
  const widerLevel = buildOrFail(
    makePolicy({ shareLevel: "projects", allowedProjectNames: ["Quarterly forecast refresh"] })
  );
  assert.notEqual(base.fingerprint, narrower.fingerprint);
  assert.notEqual(base.fingerprint, widerLevel.fingerprint);
  assert.notEqual(narrower.fingerprint, widerLevel.fingerprint);
});

// Consent-UX invariant behind cases 1–10: the preview is the SAME object that syncs — not a
// second calculation that could drift from the upload.
test("preview payload is the identical object that will be uploaded", () => {
  const result = buildOrFail(makePolicy({ shareLevel: "categories" }));
  assert.equal(result.preview.payload, result.snapshot);
  assert.equal(result.preview.lines.length > 0, true);
  assert.equal(result.preview.lines.some((line) => line.includes("Not shared")), true);
});
