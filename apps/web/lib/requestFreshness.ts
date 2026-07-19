/**
 * Pure timing policy for request-fresh dashboard updates.
 *
 * This is deliberately polling, not a realtime subscription. The browser keeps
 * only the last request timestamp in memory; every refresh asks the server to
 * run its authenticated, RLS-scoped Supabase queries again.
 */

export const REQUEST_FRESH_INTERVAL_MS = 15_000;
export const REQUEST_FRESH_MIN_GAP_MS = 5_000;

export type RefreshReason = "interval" | "online" | "visible";

export interface RefreshDecisionInput {
  reason: RefreshReason;
  nowMs: number;
  lastRequestedAtMs: number;
  visible: boolean;
  online: boolean;
}

/**
 * Permit refreshes only while useful, with a hard lower bound between calls.
 * Interval ticks wait for the full cadence; resume events may refresh sooner,
 * but never form a rapid online/visibility event loop.
 */
export function shouldRequestFreshData(input: RefreshDecisionInput): boolean {
  if (!input.visible || !input.online) return false;
  if (!Number.isFinite(input.nowMs) || !Number.isFinite(input.lastRequestedAtMs)) {
    return false;
  }
  const elapsed = input.nowMs - input.lastRequestedAtMs;
  if (elapsed < REQUEST_FRESH_MIN_GAP_MS) return false;
  return input.reason === "interval" ? elapsed >= REQUEST_FRESH_INTERVAL_MS : true;
}
