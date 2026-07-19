// Pure bounded automatic-sync scheduler for the desktop Account & Sharing surface
// (runbook Prompt 7). Everything here is dependency-free arithmetic over plain
// numbers/strings — no `setTimeout`, no Tauri, no fetch — so it is exercised entirely
// by `tsx --test` and the real hook (`useCloudSync.ts`) is the only place that wires a
// real timer. This mirrors `cloudPolicy.ts`: pure helpers own the decision, the hook
// owns the side effect.
//
// THE RULES this module enforces:
//   1. Auto-sync is OFF unless the caller proves every eligibility condition true —
//      there is no implicit default-on path.
//   2. An unchanged content fingerprint never triggers a redundant attempt.
//   3. Startup/resume catch-up only fires when the last success is older than one
//      interval AND the approved content changed since — never on unchanged content,
//      and never before the member's first manually approved sync.
//   4. Transient-failure retries are capped at three (~1, 5, 15 minutes); once
//      exhausted, scheduling stops until a fresh trigger (content change, policy
//      change, reconnect, or app restart) re-evaluates eligibility.
//   5. 401/403 are auth problems, not transient — they stop automatic retries
//      immediately and require the member to act (reconnect), never a silent loop.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AUTO_SYNC_INTERVAL_MINUTES = 60;
export const AUTO_SYNC_INTERVAL_MS = AUTO_SYNC_INTERVAL_MINUTES * 60_000;

/** Approximately 1, 5, and 15 minutes — capped at three consecutive attempts. */
export const RETRY_DELAYS_MINUTES = [1, 5, 15] as const;
export const RETRY_DELAYS_MS: readonly number[] = RETRY_DELAYS_MINUTES.map((minutes) => minutes * 60_000);
export const MAX_TRANSIENT_RETRIES = RETRY_DELAYS_MINUTES.length;

// ---------------------------------------------------------------------------
// Clock — injected everywhere "now" matters so tests never depend on real time.
// The hook supplies `{ now: () => Date.now() }`; tests supply a fixed/advancing stub.
// ---------------------------------------------------------------------------

export interface SchedulerClock {
  now: () => number;
}

export const systemClock: SchedulerClock = { now: () => Date.now() };

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

export type SchedulerFailureKind = "auth" | "transient";

/**
 * 401/403 mean the credential or authorization itself is the problem — retrying on a
 * timer cannot fix it and would just repeat a rejected write. Every other failure
 * (network error, 5xx, timeout, unknown) is treated as transient and eligible for the
 * bounded retry ladder.
 */
export function classifySyncFailure(status: number | undefined): SchedulerFailureKind {
  return status === 401 || status === 403 ? "auth" : "transient";
}

/**
 * The delay before the Nth consecutive transient-failure retry, or `null` once the
 * ladder is exhausted (capped — no further automatic retry until a fresh trigger).
 * `failureCount` is the count INCLUDING the failure that just happened (1st, 2nd, 3rd).
 */
export function nextRetryDelayMs(failureCount: number): number | null {
  const index = failureCount - 1;
  if (index < 0 || index >= RETRY_DELAYS_MS.length) return null;
  return RETRY_DELAYS_MS[index];
}

// ---------------------------------------------------------------------------
// Eligibility — every condition required before auto-sync may run at all.
// ---------------------------------------------------------------------------

export interface SchedulerEligibility {
  /** `policy.enabled && policy.autoSyncEnabled`. */
  autoSyncEnabled: boolean;
  /** Auto-sync never runs in the browser demo, regardless of persisted policy. */
  isDemoMode: boolean;
  /** `getCloudEnv() !== null` — this build has a cloud endpoint at all. */
  configured: boolean;
  hasSession: boolean;
  /** The signed-in user still holds ACTIVE membership in `policy.teamId` right now. */
  hasTeamMembership: boolean;
  /** `buildResult.ok` — the current reviewed data can build an allowlisted payload. */
  hasBuildablePayload: boolean;
  /** The member has recorded consent for the current share configuration. */
  hasConsent: boolean;
  /** At least one manually approved sync has ever succeeded (auto-sync never performs a first sync). */
  hasEverSyncedSuccessfully: boolean;
}

export function isAutoSyncEligible(input: SchedulerEligibility): boolean {
  return (
    input.autoSyncEnabled &&
    !input.isDemoMode &&
    input.configured &&
    input.hasSession &&
    input.hasTeamMembership &&
    input.hasBuildablePayload &&
    input.hasConsent &&
    input.hasEverSyncedSuccessfully
  );
}

// ---------------------------------------------------------------------------
// Fingerprint no-op — the "no redundant rows" rule
// ---------------------------------------------------------------------------

/**
 * Whether an attempt should actually call the sync service. `false` for unchanged
 * content — the scheduler still wakes up on schedule to re-check, but performs no
 * network call and writes no row when nothing approved has changed.
 */
export function shouldPerformSyncAttempt(
  currentFingerprint: string,
  lastSyncedFingerprint: string | null
): boolean {
  return currentFingerprint !== lastSyncedFingerprint;
}

/** A first fingerprint seeds the watcher; only a later content change resets transient failures. */
export function shouldResetRetryLadder(
  previousFingerprint: string | null,
  currentFingerprint: string
): boolean {
  return previousFingerprint !== null && previousFingerprint !== currentFingerprint;
}

// ---------------------------------------------------------------------------
// Startup/resume catch-up
// ---------------------------------------------------------------------------

export interface CatchUpInput {
  lastSuccessAt: string | null;
  lastSyncedFingerprint: string | null;
  currentFingerprint: string;
  intervalMs?: number;
}

/**
 * True when Weekform should attempt immediately (on launch or window focus/resume)
 * instead of waiting for the next hourly mark: the last success is at least one
 * interval old AND the approved content changed since that success. Unchanged content
 * never catches up — that would just re-write the same row for freshness alone, which
 * this prototype does not claim to do.
 */
export function shouldCatchUpNow(input: CatchUpInput, nowMs: number): boolean {
  const intervalMs = input.intervalMs ?? AUTO_SYNC_INTERVAL_MS;
  if (input.currentFingerprint === input.lastSyncedFingerprint) return false;
  if (input.lastSuccessAt === null) return false; // no prior manual sync to catch up from
  const lastSuccessMs = Date.parse(input.lastSuccessAt);
  if (!Number.isFinite(lastSuccessMs)) return false;
  return nowMs - lastSuccessMs >= intervalMs;
}

// ---------------------------------------------------------------------------
// The unified plan — what the hook should schedule right now
// ---------------------------------------------------------------------------

export type SchedulerReason = "catch_up" | "retry" | "interval";

export interface SchedulerPlan {
  scheduled: boolean;
  delayMs: number | null;
  nextAttemptAtMs: number | null;
  reason: SchedulerReason | null;
}

export const NOT_SCHEDULED: SchedulerPlan = {
  scheduled: false,
  delayMs: null,
  nextAttemptAtMs: null,
  reason: null
};

export interface SchedulerPlanInput {
  eligibility: SchedulerEligibility;
  now: number;
  lastSuccessAt: string | null;
  lastSyncedFingerprint: string | null;
  /** `buildResult.ok ? fingerprint : null` — no plan can exist without buildable content. */
  currentFingerprint: string | null;
  /** Consecutive transient failures since the last success (or since the ladder was last reset). */
  transientFailureCount: number;
  /** True once a 401/403 has occurred and not yet cleared by reconnect or a policy change. */
  authBlocked: boolean;
  intervalMs?: number;
}

/**
 * The single decision point the hook consults after every relevant state change
 * (policy edit, sign-in/out, team membership refresh, content change, attempt
 * result). Returns `NOT_SCHEDULED` whenever any stop condition applies — sign-out,
 * membership loss, policy disable, disconnect, demo mode, an unresolved auth failure,
 * or an exhausted retry ladder all collapse to the same "nothing scheduled" result, so
 * the hook only needs one branch to clear its timer.
 */
export function planNextAutoSyncAttempt(input: SchedulerPlanInput): SchedulerPlan {
  if (!isAutoSyncEligible(input.eligibility)) return NOT_SCHEDULED;
  if (input.authBlocked) return NOT_SCHEDULED;
  if (input.currentFingerprint === null) return NOT_SCHEDULED;

  const intervalMs = input.intervalMs ?? AUTO_SYNC_INTERVAL_MS;

  // A pending retry always takes priority over the normal hourly cadence.
  if (input.transientFailureCount > 0) {
    const delayMs = nextRetryDelayMs(input.transientFailureCount);
    if (delayMs === null) return NOT_SCHEDULED; // ladder exhausted — wait for a fresh trigger
    return { scheduled: true, delayMs, nextAttemptAtMs: input.now + delayMs, reason: "retry" };
  }

  if (
    shouldCatchUpNow(
      {
        lastSuccessAt: input.lastSuccessAt,
        lastSyncedFingerprint: input.lastSyncedFingerprint,
        currentFingerprint: input.currentFingerprint,
        intervalMs
      },
      input.now
    )
  ) {
    return { scheduled: true, delayMs: 0, nextAttemptAtMs: input.now, reason: "catch_up" };
  }

  const lastSuccessMs = input.lastSuccessAt !== null ? Date.parse(input.lastSuccessAt) : NaN;
  const nextAttemptAtMs = Number.isFinite(lastSuccessMs) ? lastSuccessMs + intervalMs : input.now + intervalMs;
  const delayMs = Math.max(0, nextAttemptAtMs - input.now);
  return { scheduled: true, delayMs, nextAttemptAtMs, reason: "interval" };
}

// ---------------------------------------------------------------------------
// Timer arming — the single translation from a plan to a real timer.
// The hook passes `window.setTimeout`/`window.clearTimeout`; tests pass a fake
// (or the real Node timers) — so the exact arm/fire/disarm contract the effect
// relies on is proven here instead of only by reading the effect body.
// ---------------------------------------------------------------------------

export interface TimerHost {
  setTimeout: (handler: () => void, delayMs: number) => number;
  clearTimeout: (id: number) => void;
}

/**
 * Arm one timer for `plan`, or nothing at all for an unscheduled plan. Always
 * returns a disarm function (a no-op when nothing was armed) so the caller —
 * a React effect cleanup — never branches: every re-plan disarms the previous
 * timer before the next one is armed, which is what guarantees the controller
 * owns at most ONE live timer.
 */
export function armAutoSyncTimer(
  plan: SchedulerPlan,
  runAttempt: () => void,
  timers: TimerHost
): () => void {
  if (!plan.scheduled || plan.delayMs === null) return () => {};
  const id = timers.setTimeout(runAttempt, plan.delayMs);
  return () => timers.clearTimeout(id);
}

// ---------------------------------------------------------------------------
// UI-facing formatting — pure, so the panel's "next attempt" text is exact
// ---------------------------------------------------------------------------

export function planToNextScheduledIso(plan: SchedulerPlan): string | null {
  return plan.nextAttemptAtMs !== null ? new Date(plan.nextAttemptAtMs).toISOString() : null;
}

/** Human-readable, never-technical failure text for the sync status panel. */
export function describeSchedulerFailure(kind: SchedulerFailureKind, message: string): string {
  if (kind === "auth") {
    return `Auto-sync stopped: sign in again to resume. (${message})`;
  }
  return `Auto-sync attempt failed and will retry automatically: ${message}`;
}

export function describeRetriesExhausted(message: string): string {
  return `Auto-sync paused after repeated failures. Last error: ${message}. It will try again after your next change or the next time you open Weekform.`;
}
