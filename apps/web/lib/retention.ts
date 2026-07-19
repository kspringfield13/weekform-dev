// Cloud retention policy as ONE config constant + a pure statement derivation
// (expansion roadmap A3). The retention window the UI claims must come from
// here, never from hand-written prose, so the visible statement can never
// drift from the actual policy.
//
// HONESTY CONTRACT: Weekform Cloud currently has NO automatic expiry — shared
// snapshots persist until the member deletes them ("Delete my cloud history",
// RLS-scoped to the member's own rows). The honest encoding of that policy is
// `null` (no window), never 0 or a made-up large number: null is "no automatic
// deletion exists", not "deleted after zero days". If a real expiry job ever
// lands server-side, changing this constant to its window is the ONLY edit the
// statement needs — and until such a job exists, this constant must stay null.

/** Automatic retention window in days, or null when no automatic expiry exists. */
export const CLOUD_RETENTION_WINDOW_DAYS: number | null = null;

/**
 * The visible retention statement, derived from the configured window. Pure and
 * deterministic. A non-null window must be a positive integer number of days —
 * anything else is a configuration bug worth failing loudly over, not a value
 * to round into a plausible-looking claim.
 */
export function describeCloudRetention(
  windowDays: number | null = CLOUD_RETENTION_WINDOW_DAYS,
): string {
  if (windowDays === null) {
    return (
      "Shared snapshots are kept until you delete them — there is no automatic " +
      "expiry. “Delete my cloud history” removes everything you have shared, at any time."
    );
  }
  if (!Number.isInteger(windowDays) || windowDays <= 0) {
    throw new RangeError(
      `CLOUD_RETENTION_WINDOW_DAYS must be null or a positive integer, got ${windowDays}`,
    );
  }
  return (
    `Shared snapshots are automatically deleted ${windowDays} ${windowDays === 1 ? "day" : "days"} ` +
    "after they are shared. “Delete my cloud history” removes them sooner, at any time."
  );
}
