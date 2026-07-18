// Shared normalization primitives for the source mappers in this package
// (calendar/outlookIcs.ts, import/rawEvents.ts). Keeping them in one place
// means the capacity heuristic stays identical across sources — tuning the
// baseline or floor in two copies is how calendar and imported blocks would
// silently drift onto different scales.

/** Minutes in a baseline 40-hour analyst week. */
export const WEEKLY_BASELINE_MINUTES = 40 * 60;

/**
 * Hours in that baseline week (`WEEKLY_BASELINE_MINUTES / 60`). Exported so the
 * "N-hour week" display copy (CapacityTrendChart header/sr-only caption, the
 * Weekly "standard N-hour baseline" subtitle) renders the same baseline the
 * `capacityPctFromMinutes` denominator uses instead of hardcoding "40" — a
 * magic value that would silently lie if the baseline week ever moves.
 */
export const WEEKLY_BASELINE_HOURS = WEEKLY_BASELINE_MINUTES / 60;

/** Deterministic djb2-xor hash → base36, for stable ids derived from content. */
export function stableHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Estimated share of a 40-hour week a duration in minutes occupies, as a
 * percent floored at 0.25 (so a real block never reads as exactly 0%) and
 * clamped at 100 (a single block can't consume more than a whole week — a
 * multi-day span would otherwise report >100%).
 */
export function capacityPctFromMinutes(minutes: number) {
  const bounded = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
  return Math.max(0.25, Math.min(100, Math.round((bounded / WEEKLY_BASELINE_MINUTES) * 100)));
}

/**
 * Estimated share of a 40-hour week a `[start, end)` span occupies. See
 * `capacityPctFromMinutes` for the floor/clamp semantics.
 */
export function capacityPctFromSpan(start: Date, end: Date) {
  return capacityPctFromMinutes((end.getTime() - start.getTime()) / 60_000);
}
