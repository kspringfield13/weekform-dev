// Focused tests for the bounded automatic-sync scheduler (runbook Prompt 7).
// Run: npm run test:desktop-cloud   (tsx --test)

import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_SYNC_INTERVAL_MS,
  MAX_TRANSIENT_RETRIES,
  NOT_SCHEDULED,
  RETRY_DELAYS_MINUTES,
  armAutoSyncTimer,
  classifySyncFailure,
  isAutoSyncEligible,
  nextRetryDelayMs,
  planNextAutoSyncAttempt,
  planToNextScheduledIso,
  shouldCatchUpNow,
  shouldPerformSyncAttempt,
  shouldResetRetryLadder,
  type SchedulerEligibility
} from "./cloudScheduler";
import { resolveClientSnapshotId, type CloudPendingSnapshot } from "./cloudPolicy";

const NOW = Date.parse("2026-07-19T15:00:00.000Z");

function baseEligibility(overrides: Partial<SchedulerEligibility> = {}): SchedulerEligibility {
  return {
    autoSyncEnabled: true,
    isDemoMode: false,
    configured: true,
    hasSession: true,
    hasTeamMembership: true,
    hasBuildablePayload: true,
    hasConsent: true,
    hasEverSyncedSuccessfully: true,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Fingerprint no-op — "no redundant rows for an unchanged content fingerprint"
// ---------------------------------------------------------------------------

test("shouldPerformSyncAttempt is false for an unchanged fingerprint (no redundant row)", () => {
  assert.equal(shouldPerformSyncAttempt("fp-1", "fp-1"), false);
});

test("shouldPerformSyncAttempt is true when the approved content changed", () => {
  assert.equal(shouldPerformSyncAttempt("fp-2", "fp-1"), true);
  assert.equal(shouldPerformSyncAttempt("fp-1", null), true);
});

test("a changed approved fingerprint resets an exhausted transient retry ladder", () => {
  assert.equal(shouldResetRetryLadder("fp-old", "fp-new"), true);
  assert.equal(shouldResetRetryLadder("fp-same", "fp-same"), false);
  assert.equal(shouldResetRetryLadder(null, "fp-first"), false);
});

test("an unchanged fingerprint still schedules the next hourly check, not a catch-up", () => {
  const lastSuccessAt = new Date(NOW - AUTO_SYNC_INTERVAL_MS * 3).toISOString();
  const plan = planNextAutoSyncAttempt({
    eligibility: baseEligibility(),
    now: NOW,
    lastSuccessAt,
    lastSyncedFingerprint: "fp-1",
    currentFingerprint: "fp-1", // unchanged since last success, even though it's overdue
    transientFailureCount: 0,
    authBlocked: false
  });
  assert.equal(plan.scheduled, true);
  assert.equal(plan.reason, "interval");
  assert.notEqual(plan.reason, "catch_up");
});

// ---------------------------------------------------------------------------
// clientSnapshotId reuse across retries
// ---------------------------------------------------------------------------

test("clientSnapshotId is reused across retries of the same content fingerprint", () => {
  let generateCalls = 0;
  const generateId = () => {
    generateCalls += 1;
    return `generated-${generateCalls}`;
  };

  let pending: CloudPendingSnapshot | null = null;
  pending = resolveClientSnapshotId(pending, "fp-retry", generateId);
  const firstId = pending.clientSnapshotId;

  // Simulate three retry attempts (1, 5, 15 minutes) against the SAME fingerprint —
  // e.g. a transient failure on each — and confirm the id never changes and the
  // generator is never called again.
  for (let attempt = 0; attempt < RETRY_DELAYS_MINUTES.length; attempt += 1) {
    pending = resolveClientSnapshotId(pending, "fp-retry", generateId);
    assert.equal(pending.clientSnapshotId, firstId);
  }
  assert.equal(generateCalls, 1);

  // A genuinely new approved payload (new fingerprint) mints a new id.
  pending = resolveClientSnapshotId(pending, "fp-next", generateId);
  assert.notEqual(pending.clientSnapshotId, firstId);
  assert.equal(generateCalls, 2);
});

// ---------------------------------------------------------------------------
// Disable cancellation
// ---------------------------------------------------------------------------

test("disabling auto-sync (policy or toggle) cancels scheduling", () => {
  const input = {
    eligibility: baseEligibility({ autoSyncEnabled: false }),
    now: NOW,
    lastSuccessAt: new Date(NOW - AUTO_SYNC_INTERVAL_MS).toISOString(),
    lastSyncedFingerprint: "fp-1",
    currentFingerprint: "fp-2",
    transientFailureCount: 0,
    authBlocked: false
  };
  assert.deepEqual(planNextAutoSyncAttempt(input), NOT_SCHEDULED);
});

test("sign-out, membership loss, or disconnect each stop scheduling", () => {
  const shared = {
    now: NOW,
    lastSuccessAt: new Date(NOW - AUTO_SYNC_INTERVAL_MS).toISOString(),
    lastSyncedFingerprint: "fp-1",
    currentFingerprint: "fp-2",
    transientFailureCount: 0,
    authBlocked: false
  };
  assert.equal(
    planNextAutoSyncAttempt({ ...shared, eligibility: baseEligibility({ hasSession: false }) }).scheduled,
    false
  );
  assert.equal(
    planNextAutoSyncAttempt({ ...shared, eligibility: baseEligibility({ hasTeamMembership: false }) }).scheduled,
    false
  );
  assert.equal(
    planNextAutoSyncAttempt({ ...shared, eligibility: baseEligibility({ hasConsent: false }) }).scheduled,
    false
  );
});

// ---------------------------------------------------------------------------
// Startup/resume catch-up
// ---------------------------------------------------------------------------

test("startup catch-up fires when last success is older than one interval AND content changed", () => {
  const lastSuccessAt = new Date(NOW - AUTO_SYNC_INTERVAL_MS - 60_000).toISOString();
  const plan = planNextAutoSyncAttempt({
    eligibility: baseEligibility(),
    now: NOW,
    lastSuccessAt,
    lastSyncedFingerprint: "fp-old",
    currentFingerprint: "fp-new",
    transientFailureCount: 0,
    authBlocked: false
  });
  assert.equal(plan.scheduled, true);
  assert.equal(plan.reason, "catch_up");
  assert.equal(plan.delayMs, 0);
});

test("no catch-up when the last success is recent, even if content changed", () => {
  const lastSuccessAt = new Date(NOW - 10 * 60_000).toISOString();
  assert.equal(
    shouldCatchUpNow(
      { lastSuccessAt, lastSyncedFingerprint: "fp-old", currentFingerprint: "fp-new" },
      NOW
    ),
    false
  );
});

test("no catch-up before any manual sync has ever succeeded", () => {
  assert.equal(
    shouldCatchUpNow(
      { lastSuccessAt: null, lastSyncedFingerprint: null, currentFingerprint: "fp-new" },
      NOW
    ),
    false
  );
  const plan = planNextAutoSyncAttempt({
    eligibility: baseEligibility({ hasEverSyncedSuccessfully: false }),
    now: NOW,
    lastSuccessAt: null,
    lastSyncedFingerprint: null,
    currentFingerprint: "fp-new",
    transientFailureCount: 0,
    authBlocked: false
  });
  assert.deepEqual(plan, NOT_SCHEDULED);
});

// ---------------------------------------------------------------------------
// 401/403 stop retries (auth, not transient)
// ---------------------------------------------------------------------------

test("401 and 403 classify as auth, not transient", () => {
  assert.equal(classifySyncFailure(401), "auth");
  assert.equal(classifySyncFailure(403), "auth");
  assert.equal(classifySyncFailure(500), "transient");
  assert.equal(classifySyncFailure(undefined), "transient"); // network-level failure
});

test("an unresolved auth failure stops scheduling immediately, even with capacity for retries", () => {
  const plan = planNextAutoSyncAttempt({
    eligibility: baseEligibility(),
    now: NOW,
    lastSuccessAt: new Date(NOW - AUTO_SYNC_INTERVAL_MS).toISOString(),
    lastSyncedFingerprint: "fp-1",
    currentFingerprint: "fp-2",
    transientFailureCount: 0,
    authBlocked: true
  });
  assert.deepEqual(plan, NOT_SCHEDULED);
});

// ---------------------------------------------------------------------------
// Retry ladder: ~1, 5, 15 minutes, capped
// ---------------------------------------------------------------------------

test("transient retry delays follow the 1/5/15 minute ladder and cap at three", () => {
  assert.equal(nextRetryDelayMs(1), 1 * 60_000);
  assert.equal(nextRetryDelayMs(2), 5 * 60_000);
  assert.equal(nextRetryDelayMs(3), 15 * 60_000);
  assert.equal(nextRetryDelayMs(4), null);
  assert.equal(MAX_TRANSIENT_RETRIES, 3);
});

test("planNextAutoSyncAttempt schedules the next retry over the normal hourly interval", () => {
  const plan = planNextAutoSyncAttempt({
    eligibility: baseEligibility(),
    now: NOW,
    lastSuccessAt: new Date(NOW - 5 * 60_000).toISOString(), // recent success, well under an hour
    lastSyncedFingerprint: "fp-1",
    currentFingerprint: "fp-2",
    transientFailureCount: 2,
    authBlocked: false
  });
  assert.equal(plan.scheduled, true);
  assert.equal(plan.reason, "retry");
  assert.equal(plan.delayMs, 5 * 60_000);
});

test("an exhausted retry ladder stops scheduling until a fresh trigger", () => {
  const plan = planNextAutoSyncAttempt({
    eligibility: baseEligibility(),
    now: NOW,
    lastSuccessAt: new Date(NOW - 5 * 60_000).toISOString(),
    lastSyncedFingerprint: "fp-1",
    currentFingerprint: "fp-2",
    transientFailureCount: 4,
    authBlocked: false
  });
  assert.deepEqual(plan, NOT_SCHEDULED);
});

// ---------------------------------------------------------------------------
// Demo mode never schedules
// ---------------------------------------------------------------------------

test("demo mode never schedules auto-sync, regardless of every other input", () => {
  const permissiveExceptDemo = baseEligibility({ isDemoMode: true });
  assert.equal(isAutoSyncEligible(permissiveExceptDemo), false);
  const plan = planNextAutoSyncAttempt({
    eligibility: permissiveExceptDemo,
    now: NOW,
    lastSuccessAt: new Date(NOW - AUTO_SYNC_INTERVAL_MS * 2).toISOString(),
    lastSyncedFingerprint: "fp-old",
    currentFingerprint: "fp-new",
    transientFailureCount: 0,
    authBlocked: false
  });
  assert.deepEqual(plan, NOT_SCHEDULED);
});

test("an unconfigured build (no cloud env) never schedules", () => {
  assert.equal(isAutoSyncEligible(baseEligibility({ configured: false })), false);
});

// ---------------------------------------------------------------------------
// Interval default and UI formatting
// ---------------------------------------------------------------------------

test("the default interval is fixed at 60 minutes", () => {
  assert.equal(AUTO_SYNC_INTERVAL_MS, 60 * 60_000);
});

test("planToNextScheduledIso mirrors nextAttemptAtMs, or null when not scheduled", () => {
  assert.equal(planToNextScheduledIso(NOT_SCHEDULED), null);
  const plan = planNextAutoSyncAttempt({
    eligibility: baseEligibility(),
    now: NOW,
    lastSuccessAt: new Date(NOW - 5 * 60_000).toISOString(),
    lastSyncedFingerprint: "fp-1",
    currentFingerprint: "fp-1",
    transientFailureCount: 0,
    authBlocked: false
  });
  assert.equal(planToNextScheduledIso(plan), new Date(plan.nextAttemptAtMs as number).toISOString());
});

// ---------------------------------------------------------------------------
// Timer arming — the plan → real-timer contract the useCloudSync effect relies on
// ---------------------------------------------------------------------------

interface RecordedTimer {
  id: number;
  handler: () => void;
  delayMs: number;
  cleared: boolean;
}

function fakeTimerHost() {
  const timers: RecordedTimer[] = [];
  let nextId = 1;
  return {
    timers,
    host: {
      setTimeout: (handler: () => void, delayMs: number) => {
        const id = nextId++;
        timers.push({ id, handler, delayMs, cleared: false });
        return id;
      },
      clearTimeout: (id: number) => {
        const timer = timers.find((entry) => entry.id === id);
        if (timer) timer.cleared = true;
      }
    }
  };
}

test("armAutoSyncTimer arms exactly one timer with the plan's delay and fires the attempt", () => {
  const { timers, host } = fakeTimerHost();
  let attempts = 0;
  const plan = planNextAutoSyncAttempt({
    eligibility: baseEligibility(),
    now: NOW,
    lastSuccessAt: new Date(NOW - AUTO_SYNC_INTERVAL_MS / 2).toISOString(),
    lastSyncedFingerprint: "fp-1",
    currentFingerprint: "fp-2",
    transientFailureCount: 0,
    authBlocked: false
  });
  armAutoSyncTimer(plan, () => {
    attempts += 1;
  }, host);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, plan.delayMs);
  assert.equal(timers[0].delayMs, AUTO_SYNC_INTERVAL_MS / 2);
  timers[0].handler();
  assert.equal(attempts, 1);
});

test("armAutoSyncTimer arms nothing for NOT_SCHEDULED and its disarm is a safe no-op", () => {
  const { timers, host } = fakeTimerHost();
  const disarm = armAutoSyncTimer(NOT_SCHEDULED, () => {
    assert.fail("an unscheduled plan must never run an attempt");
  }, host);
  assert.equal(timers.length, 0);
  disarm(); // effect cleanup always runs — must not throw or clear a foreign timer
  assert.equal(timers.length, 0);
});

test("disarming before the timer fires clears it — a re-plan never leaves a stale timer", () => {
  const { timers, host } = fakeTimerHost();
  const plan = planNextAutoSyncAttempt({
    eligibility: baseEligibility(),
    now: NOW,
    lastSuccessAt: new Date(NOW).toISOString(),
    lastSyncedFingerprint: "fp-1",
    currentFingerprint: "fp-2",
    transientFailureCount: 0,
    authBlocked: false
  });
  const disarm = armAutoSyncTimer(plan, () => {
    assert.fail("a disarmed timer must never run an attempt");
  }, host);
  assert.equal(timers.length, 1);
  disarm();
  assert.equal(timers[0].cleared, true);
});

test("re-planning after each transient failure arms the 1/5/15-minute ladder in order", () => {
  const { timers, host } = fakeTimerHost();
  for (let failures = 1; failures <= MAX_TRANSIENT_RETRIES; failures++) {
    const plan = planNextAutoSyncAttempt({
      eligibility: baseEligibility(),
      now: NOW,
      lastSuccessAt: new Date(NOW - AUTO_SYNC_INTERVAL_MS).toISOString(),
      lastSyncedFingerprint: "fp-1",
      currentFingerprint: "fp-2",
      transientFailureCount: failures,
      authBlocked: false
    });
    armAutoSyncTimer(plan, () => {}, host);
  }
  assert.deepEqual(
    timers.map((timer) => timer.delayMs),
    RETRY_DELAYS_MINUTES.map((minutes) => minutes * 60_000)
  );
});

test("armAutoSyncTimer drives real platform timers end-to-end (catch-up plan fires immediately)", async () => {
  const plan = planNextAutoSyncAttempt({
    eligibility: baseEligibility(),
    now: NOW,
    lastSuccessAt: new Date(NOW - AUTO_SYNC_INTERVAL_MS * 2).toISOString(),
    lastSyncedFingerprint: "fp-1",
    currentFingerprint: "fp-2",
    transientFailureCount: 0,
    authBlocked: false
  });
  assert.equal(plan.reason, "catch_up");
  assert.equal(plan.delayMs, 0);
  const fired = new Promise<void>((resolve) => {
    // The same shape the hook passes: platform setTimeout/clearTimeout, id-based.
    armAutoSyncTimer(plan, resolve, {
      setTimeout: (handler, delayMs) => setTimeout(handler, delayMs) as unknown as number,
      clearTimeout: (id) => clearTimeout(id)
    });
  });
  await fired; // resolves only if a REAL timer was armed and actually fired
});
