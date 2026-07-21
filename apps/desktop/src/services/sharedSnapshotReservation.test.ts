import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { CloudSharePolicyV1 } from "../../../../packages/domain/src/cloud";
import type { WeeklyCapacitySnapshot, WorkBlock } from "../../../../packages/domain/src/models";
import {
  buildReservedSharedSnapshot,
  isSharedSnapshotUploadAuthorized,
  runAfterDurableSharedSnapshotReservation,
} from "./sharedSnapshotReservation";

const NOW = "2026-07-20T16:00:00.000Z";
const FIRST_ID = "11111111-2222-4333-8444-555555555555";
const SECOND_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const cloudAccountSource = readFileSync(
  new URL("../hooks/useCloudAccount.ts", import.meta.url),
  "utf8",
);
const cloudSyncSource = readFileSync(
  new URL("../hooks/useCloudSync.ts", import.meta.url),
  "utf8",
);
const cloudPanelSource = readFileSync(
  new URL("../components/settings/CloudAccountPanel.tsx", import.meta.url),
  "utf8",
);

function snapshot(): WeeklyCapacitySnapshot {
  return {
    week_id: "2026-W30",
    allocated_pct: 140,
    deep_work_pct: 30,
    fragmented_work_pct: 10,
    meeting_pct: 20,
    reactive_pct: 25,
    planned_pct: 85,
    blocked_pct: 5,
    recurring_pct: 10,
    reliable_new_work_capacity_pct: 0,
    committed_utilization_pct: 100,
    carryover_risk_pct: 40,
    wip_load_score: 0.7,
    context_switch_score: 0.6,
    fragmentation_penalty_pct: 5,
    wip_penalty_pct: 5,
    summary_confidence: 0.9,
    category_allocation: [],
    work_mode_allocation: []
  };
}

function policy(overrides: Partial<CloudSharePolicyV1> = {}): CloudSharePolicyV1 {
  return {
    version: 1,
    enabled: true,
    teamId: "11111111-1111-4111-8111-111111111111",
    shareLevel: "summary",
    metrics: {
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
    },
    allowedProjectNames: [],
    autoSyncEnabled: false,
    intervalMinutes: 60,
    consentedAt: NOW,
    ...overrides
  };
}

test("first render reserves the UUID embedded in the preview before an effect persists it", () => {
  let generated = 0;
  const result = buildReservedSharedSnapshot({
    snapshot: snapshot(),
    workBlocks: [] as WorkBlock[],
    policy: policy(),
    pendingSnapshot: null,
    now: NOW,
    generateId: () => {
      generated += 1;
      return FIRST_ID;
    }
  });

  assert.equal(result.buildResult.ok, true);
  assert.deepEqual(result.reservation, {
    fingerprint: result.buildResult.ok ? result.buildResult.fingerprint : "",
    clientSnapshotId: FIRST_ID
  });
  assert.equal(result.buildResult.ok && result.buildResult.snapshot.clientSnapshotId, FIRST_ID);
  assert.equal(generated, 1);
});

test("an unchanged fingerprint reuses the persisted reservation without generating another UUID", () => {
  const first = buildReservedSharedSnapshot({
    snapshot: snapshot(),
    workBlocks: [],
    policy: policy(),
    pendingSnapshot: null,
    now: NOW,
    generateId: () => FIRST_ID
  });
  assert.equal(first.buildResult.ok, true);
  assert.ok(first.reservation);

  let generated = 0;
  const retry = buildReservedSharedSnapshot({
    snapshot: snapshot(),
    workBlocks: [],
    policy: policy(),
    pendingSnapshot: first.reservation,
    now: "2026-07-20T17:00:00.000Z",
    generateId: () => {
      generated += 1;
      return SECOND_ID;
    }
  });

  assert.equal(retry.buildResult.ok, true);
  assert.equal(retry.buildResult.ok && retry.buildResult.snapshot.clientSnapshotId, FIRST_ID);
  assert.equal(retry.reservation, first.reservation);
  assert.equal(generated, 0);
});

test("a missing recipient neither reserves nor generates a client snapshot ID", () => {
  let generated = 0;
  const result = buildReservedSharedSnapshot({
    snapshot: snapshot(),
    workBlocks: [],
    policy: policy({ teamId: null }),
    pendingSnapshot: null,
    now: NOW,
    generateId: () => {
      generated += 1;
      return FIRST_ID;
    }
  });

  assert.equal(result.buildResult.ok, false);
  assert.equal(result.reservation, null);
  assert.equal(generated, 0);
});

test("upload authorization stays closed until the individual approves the preview", () => {
  const unapprovedPolicy = policy({ enabled: false, consentedAt: null });
  const preview = buildReservedSharedSnapshot({
    snapshot: snapshot(),
    workBlocks: [],
    policy: unapprovedPolicy,
    pendingSnapshot: null,
    now: NOW,
    generateId: () => FIRST_ID,
  }).buildResult;

  assert.equal(preview.ok, true, "an individual must be able to inspect data before approval");
  assert.equal(isSharedSnapshotUploadAuthorized(unapprovedPolicy, preview), false);
  assert.equal(
    isSharedSnapshotUploadAuthorized(
      { ...unapprovedPolicy, enabled: true, consentedAt: NOW },
      preview,
    ),
    true,
  );
});

test("upload waits until the exact first-use reservation is durably confirmed", async () => {
  const events: string[] = [];
  let releasePersistence!: () => void;
  const persistenceGate = new Promise<void>((resolve) => {
    releasePersistence = resolve;
  });
  const reservation = {
    fingerprint: "fingerprint-1",
    clientSnapshotId: FIRST_ID,
  };

  const operation = runAfterDurableSharedSnapshotReservation({
    reservation,
    persistReservation: async (value) => {
      assert.equal(value, reservation);
      events.push("persist:start");
      await persistenceGate;
      events.push("persist:confirmed");
    },
    operation: async () => {
      events.push("upload");
      return "uploaded";
    },
  });

  await Promise.resolve();
  assert.deepEqual(events, ["persist:start"]);
  releasePersistence();
  assert.deepEqual(await operation, { ok: true, value: "uploaded" });
  assert.deepEqual(events, ["persist:start", "persist:confirmed", "upload"]);
});

test("a reservation persistence failure fails closed without invoking upload", async () => {
  let uploadCalls = 0;

  const result = await runAfterDurableSharedSnapshotReservation({
    reservation: {
      fingerprint: "fingerprint-1",
      clientSnapshotId: FIRST_ID,
    },
    persistReservation: async () => {
      throw new Error("synthetic durable storage failure");
    },
    operation: async () => {
      uploadCalls += 1;
      return "must-not-run";
    },
  });

  assert.equal(result.ok, false);
  assert.match(
    result.ok ? "" : String(result.persistenceError),
    /synthetic durable storage failure/,
  );
  assert.equal(uploadCalls, 0);
});

test("manual and automatic team uploads use the account's strict reservation persistence boundary", () => {
  assert.match(
    cloudAccountSource,
    /persistPendingSnapshot:\s*\(value:\s*CloudPendingSnapshot\)\s*=>\s*Promise<void>/,
  );
  assert.match(
    cloudAccountSource,
    /const persistPendingSnapshot\s*=\s*useCallback[\s\S]*?await enqueueCloudWrite\(envelope\)/,
  );

  const guardedCalls = [
    ...cloudSyncSource.matchAll(/runAfterDurableSharedSnapshotReservation\(\{([\s\S]*?)\n\s*\}\);/g),
  ];
  assert.equal(guardedCalls.length, 2, "manual and automatic upload paths must both be guarded");
  for (const call of guardedCalls) {
    assert.match(call[1] ?? "", /persistReservation:\s*account\.persistPendingSnapshot/);
    assert.match(call[1] ?? "", /operation:\s*\(\)\s*=>\s*runFreshGuardedUpload/);
  }
  assert.match(
    cloudSyncSource,
    /isSharedSnapshotUploadAuthorized\(policy, buildResult\)/,
    "manual sync must re-check individual approval at the upload boundary",
  );
  assert.match(
    cloudAccountSource,
    /const approveSharing[\s\S]*?await enqueueCloudWrite\(nextEnvelope\)[\s\S]*?setPolicy\(approvedPolicy\)/,
    "approval must be durably stored before it becomes upload-eligible in React state",
  );
});

test("Account & Sharing offers one individual approval action and starts the first sync", () => {
  assert.match(cloudPanelSource, /Approve and start sharing/);
  assert.match(cloudPanelSource, /await ctrl\.approveSharing\(\)/);
  assert.match(cloudPanelSource, /setSyncAfterApproval\(true\)/);
  assert.match(cloudPanelSource, /syncAfterApproval[\s\S]*?void sync\.syncNow\(\)/);
  assert.doesNotMatch(cloudPanelSource, /I reviewed what will be shared with this team/);
});
