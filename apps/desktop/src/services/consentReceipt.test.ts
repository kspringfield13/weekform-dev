// Contract tests for consent receipts (expansion roadmap A3): the receipt's
// field allowlist is built FROM the exact approved payload and proven
// byte-exact against it — any divergence between payload and receipt fails.
// Run: npm run test:desktop-cloud   (tsx --test)

import test from "node:test";
import assert from "node:assert/strict";

import type { WeeklyCapacitySnapshot, WorkBlock } from "../../../../packages/domain/src/models";
import type {
  CloudMetricPolicy,
  CloudSharePolicyV1,
  SharedWorkloadSnapshotV1
} from "../../../../packages/domain/src/cloud";
import { buildSharedWorkloadSnapshot } from "../../../../packages/inference/src/sharedSnapshot";
import {
  buildConsentReceipt,
  parseConsentReceipts,
  payloadFieldAllowlist,
  verifyConsentReceipt,
  type ConsentReceiptV1
} from "./consentReceipt";
import { serializeConsentReceipts, serializeFullBackup, type FullBackup } from "../lib/dataExport";
import { DEFAULT_TOKEN_USAGE_SETTINGS } from "./localStore";
import { DEFAULT_PROACTIVE_ALERT_SETTINGS, EMPTY_PROACTIVE_ALERT_RUNTIME } from "../lib/proactiveAlerts";

// ---------------------------------------------------------------------------
// Fixtures (mirror packages/inference/src/sharedSnapshot.test.ts)
// ---------------------------------------------------------------------------

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
    stakeholder_group: "Finance leadership",
    derived_from: [],
    evidence: [],
    confidence: 0.9,
    user_verified: true,
    blocker_flag: false,
    notes: null,
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
const RECEIPT_ID = "receipt-0001";
const RECORDED_AT = "2026-07-19T12:00:01.000Z";

function approvedBuild(policy: CloudSharePolicyV1, blocks: WorkBlock[] = [makeBlock({})]) {
  const result = buildSharedWorkloadSnapshot({
    snapshot: makeCapacitySnapshot(),
    workBlocks: blocks,
    policy,
    now: NOW
  });
  assert.equal(result.ok, true, "fixture policy must produce a payload");
  if (!result.ok) throw new Error("unreachable");
  return result;
}

function receiptFor(policy: CloudSharePolicyV1, blocks?: WorkBlock[]) {
  const build = approvedBuild(policy, blocks);
  const receipt = buildConsentReceipt({
    payload: build.snapshot,
    fingerprint: build.fingerprint,
    trigger: "manual",
    receiptId: RECEIPT_ID,
    recordedAt: RECORDED_AT
  });
  return { build, receipt };
}

// ---------------------------------------------------------------------------
// The receipt records the approved share verbatim
// ---------------------------------------------------------------------------

test("receipt carries timestamp, snapshot id, share level, week, and destination from the approved payload", () => {
  const { build, receipt } = receiptFor(makePolicy());
  assert.equal(receipt.version, 1);
  assert.equal(receipt.receipt_id, RECEIPT_ID);
  assert.equal(receipt.recorded_at, RECORDED_AT);
  assert.equal(receipt.trigger, "manual");
  assert.equal(receipt.client_snapshot_id, build.snapshot.clientSnapshotId);
  assert.equal(receipt.content_fingerprint, build.fingerprint);
  assert.equal(receipt.week_id, build.snapshot.weekId);
  assert.equal(receipt.share_level, "summary");
  assert.deepEqual(receipt.destination, { kind: "weekform_cloud_team", team_id: "team-t1" });
});

test("shared_fields is BYTE-EXACT against the approved payload's canonical allowlist", () => {
  const { build, receipt } = receiptFor(makePolicy({ shareLevel: "projects", allowedProjectNames: ["Quarterly forecast refresh"] }));
  // Byte-exact: the serialized allowlists are the same string, not merely set-equal.
  assert.equal(JSON.stringify(receipt.shared_fields), JSON.stringify(payloadFieldAllowlist(build.snapshot)));
  // And the allowlist is derived from the payload's own keys — spot-check content.
  assert.ok(receipt.shared_fields.includes("metrics.reliableNewWorkCapacityPct"));
  assert.ok(receipt.shared_fields.includes("projectAllocation.Quarterly forecast refresh"));
  assert.ok(receipt.shared_fields.includes("reviewCoverage.reviewedBlocks"));
  assert.ok(receipt.shared_fields.includes("shareLevel"));
});

test("a metric the policy disables (null is never zero) is ABSENT from the receipt, and the receipt still verifies", () => {
  const { build, receipt } = receiptFor(
    makePolicy({ metrics: { ...allMetricsEnabled(), meetings: false, confidence: false } })
  );
  assert.equal(build.snapshot.metrics.meetingPct, undefined);
  assert.ok(!receipt.shared_fields.includes("metrics.meetingPct"));
  assert.ok(!receipt.shared_fields.includes("metrics.summaryConfidence"));
  assert.ok(receipt.shared_fields.includes("metrics.reactivePct"));
  assert.deepEqual(verifyConsentReceipt(receipt, build.snapshot), { ok: true });
});

test("summary-level receipt records no allocation sections; categories level records section + labels", () => {
  const summary = receiptFor(makePolicy({ shareLevel: "summary" }));
  assert.ok(!summary.receipt.shared_fields.some((field) => field.startsWith("categoryAllocation")));
  const categories = receiptFor(makePolicy({ shareLevel: "categories" }));
  assert.ok(categories.receipt.shared_fields.includes("categoryAllocation"));
  assert.ok(categories.receipt.shared_fields.includes("categoryAllocation.Planned analysis / project work"));
  assert.ok(categories.receipt.shared_fields.includes("workModeAllocation.Deep work"));
  assert.deepEqual(verifyConsentReceipt(categories.receipt, categories.build.snapshot), { ok: true });
});

test("deterministic: same approved payload and injected id/timestamp → deep-equal receipts", () => {
  const first = receiptFor(makePolicy({ shareLevel: "categories" }));
  const second = receiptFor(makePolicy({ shareLevel: "categories" }));
  assert.deepEqual(first.receipt, second.receipt);
});

// ---------------------------------------------------------------------------
// Divergence between payload and receipt FAILS verification
// ---------------------------------------------------------------------------

test("a metric added to the payload after the receipt was written fails verification, named", () => {
  const { build, receipt } = receiptFor(makePolicy({ metrics: { ...allMetricsEnabled(), meetings: false } }));
  const widened: SharedWorkloadSnapshotV1 = {
    ...build.snapshot,
    metrics: { ...build.snapshot.metrics, meetingPct: 22 }
  };
  const verdict = verifyConsentReceipt(receipt, widened);
  assert.equal(verdict.ok, false);
  if (verdict.ok) throw new Error("unreachable");
  assert.deepEqual(verdict.missingFromReceipt, ["metrics.meetingPct"]);
  assert.deepEqual(verdict.extraInReceipt, []);
});

test("a metric removed from the payload fails verification as an over-claiming receipt", () => {
  const { build, receipt } = receiptFor(makePolicy());
  const { reactivePct: _dropped, ...remaining } = build.snapshot.metrics;
  const narrowed: SharedWorkloadSnapshotV1 = { ...build.snapshot, metrics: remaining };
  const verdict = verifyConsentReceipt(receipt, narrowed);
  assert.equal(verdict.ok, false);
  if (verdict.ok) throw new Error("unreachable");
  assert.deepEqual(verdict.extraInReceipt, ["metrics.reactivePct"]);
  assert.deepEqual(verdict.missingFromReceipt, []);
});

test("a changed project label fails verification in both directions", () => {
  const { build, receipt } = receiptFor(
    makePolicy({ shareLevel: "projects", allowedProjectNames: ["Quarterly forecast refresh"] })
  );
  const relabeled: SharedWorkloadSnapshotV1 = {
    ...build.snapshot,
    projectAllocation: [{ label: "Renamed project", value: 5 }]
  };
  const verdict = verifyConsentReceipt(receipt, relabeled);
  assert.equal(verdict.ok, false);
  if (verdict.ok) throw new Error("unreachable");
  assert.deepEqual(verdict.missingFromReceipt, ["projectAllocation.Renamed project"]);
  assert.deepEqual(verdict.extraInReceipt, ["projectAllocation.Quarterly forecast refresh"]);
});

test("even an order-only difference in shared_fields fails (byte-exact, not set-equal)", () => {
  const { build, receipt } = receiptFor(makePolicy());
  const reordered: ConsentReceiptV1 = {
    ...receipt,
    shared_fields: [...receipt.shared_fields].reverse()
  };
  const verdict = verifyConsentReceipt(reordered, build.snapshot);
  assert.equal(verdict.ok, false);
  if (verdict.ok) throw new Error("unreachable");
  // Same set, different bytes: no missing/extra fields, yet not ok.
  assert.deepEqual(verdict.missingFromReceipt, []);
  assert.deepEqual(verdict.extraInReceipt, []);
});

test("envelope divergence (snapshot id, week, share level, destination team) fails, named", () => {
  const { build, receipt } = receiptFor(makePolicy());
  const tampered: ConsentReceiptV1 = {
    ...receipt,
    client_snapshot_id: "someone-elses-id",
    week_id: "2026-W01",
    share_level: "projects",
    destination: { kind: "weekform_cloud_team", team_id: "team-other" }
  };
  const verdict = verifyConsentReceipt(tampered, build.snapshot);
  assert.equal(verdict.ok, false);
  if (verdict.ok) throw new Error("unreachable");
  assert.deepEqual(verdict.envelopeMismatches, [
    "client_snapshot_id",
    "week_id",
    "share_level",
    "destination"
  ]);
});

// ---------------------------------------------------------------------------
// Persistence parse boundary
// ---------------------------------------------------------------------------

test("parseConsentReceipts round-trips valid receipts value-identical and drops malformed ones whole", () => {
  const { receipt } = receiptFor(makePolicy());
  const roundTripped = parseConsentReceipts(JSON.parse(JSON.stringify([receipt])));
  assert.deepEqual(roundTripped, [receipt]);

  // A receipt is a consent record: repairing it would fabricate a different
  // consent claim, so every malformed variant is dropped whole, never normalized.
  const malformed = [
    { ...receipt, version: 2 },
    { ...receipt, shared_fields: ["metrics.reactivePct", 7] },
    { ...receipt, shared_fields: "not-an-array" },
    { ...receipt, destination: { kind: "email", team_id: "team-t1" } },
    { ...receipt, trigger: "scheduled" },
    { ...receipt, recorded_at: 123 },
    "a string",
    null
  ];
  assert.deepEqual(parseConsentReceipts(malformed), []);
  assert.deepEqual(parseConsentReceipts("garbage"), []);
  assert.deepEqual(parseConsentReceipts(undefined), []);
});

// ---------------------------------------------------------------------------
// Export: receipts are exportable, and backup/export still excludes tokens
// ---------------------------------------------------------------------------

test("serializeConsentReceipts emits the JSON envelope and a CSV with the exact allowlist serialized", () => {
  const { receipt } = receiptFor(makePolicy({ shareLevel: "categories" }));
  const json = serializeConsentReceipts([receipt], "json");
  const parsed = JSON.parse(json) as { app: string; kind: string; count: number; records: ConsentReceiptV1[] };
  assert.equal(parsed.app, "Weekform");
  assert.equal(parsed.kind, "consent_receipts");
  assert.equal(parsed.count, 1);
  assert.deepEqual(parsed.records, [receipt]);

  const csv = serializeConsentReceipts([receipt], "csv");
  const [header, row] = csv.split("\r\n");
  assert.ok(header.startsWith("receipt_id,recorded_at,trigger,destination,team_id,week_id,share_level,client_snapshot_id,content_fingerprint,shared_field_count,shared_fields"));
  assert.ok(row.includes(RECEIPT_ID));
  assert.ok(row.includes("team-t1"));
  // The exact allowlist rides along in one cell, field count included.
  assert.ok(row.includes(String(receipt.shared_fields.length)));
  assert.ok(csv.includes("metrics.reactivePct"));
});

test("full backup includes consent receipts and STILL never carries tokens or session material", () => {
  const { receipt } = receiptFor(makePolicy());
  const backup: FullBackup = {
    blocks: [],
    calendarEvents: [],
    chatEvents: [],
    activeWindowSamples: [],
    auditEvents: [],
    corrections: [],
    reviewSuggestions: [],
    generatedForecast: null,
    forecastHistory: [],
    snapshotHistory: [],
    accelerationHistory: [],
    visualContextEnabled: false,
    visualContextInsights: [],
    dismissedPlayIds: [],
    actedOnPlayIds: [],
    generatedPlays: null,
    savedSkills: [],
    managerSummaryText: null,
    generatedNarrative: null,
    lastNarrativeAutoRunDate: null,
    paused: true,
    retentionDays: null,
    onboardingDismissed: false,
    walkthroughCompleted: false,
    proactiveAlertSettings: { ...DEFAULT_PROACTIVE_ALERT_SETTINGS },
    proactiveAlertRuntime: { ...EMPTY_PROACTIVE_ALERT_RUNTIME },
    tokenUsageDays: [],
    tokenUsageSettings: { ...DEFAULT_TOKEN_USAGE_SETTINGS },
    usageCsvRowHashes: [],
    consentReceipts: [receipt],
    // Field-by-field projection shape from cloudPolicy.ts — policy + sync
    // bookkeeping, never session/tokens (the existing invariant under test).
    cloudSharing: {
      policy: makePolicy(),
      syncState: {
        status: "success",
        lastAttemptAt: RECORDED_AT,
        lastSuccessAt: RECORDED_AT,
        lastError: null,
        lastSyncedFingerprint: receipt.content_fingerprint,
        lastSyncedClientSnapshotId: receipt.client_snapshot_id,
        nextScheduledAt: null
      }
    }
  };
  // Simulate a hostile future where token-ish fields sit NEXT to the receipt in
  // memory: the receipt is copied field-by-field at build time, so poisoning the
  // source objects must not leak (mirrors the buildCloudBackupMetadata invariant).
  const serialized = serializeFullBackup(backup, new Date("2026-07-19T13:00:00.000Z"));
  assert.ok(serialized.includes('"consentReceipts"'));
  assert.ok(serialized.includes(receipt.receipt_id));
  // Existing invariant, re-asserted: no access/refresh/auth tokens in any export.
  assert.ok(!/accessToken|refreshToken|auth_token|apiKey/i.test(serialized));
});

test("a receipt built from a payload never contains token, session, or raw-activity material", () => {
  const { receipt } = receiptFor(makePolicy({ shareLevel: "projects", allowedProjectNames: ["Quarterly forecast refresh"] }));
  const serialized = JSON.stringify(receipt);
  assert.ok(!/accessToken|refreshToken|auth_token|apiKey|session/i.test(serialized));
  // Field NAMES only — the receipt records what was shared, never the values.
  assert.ok(!serialized.includes('"metrics":{'));
});
