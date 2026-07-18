// Meeting occupied-time helpers. Calendar meetings can OVERLAP in wall-clock — a
// double-booking, or short syncs nested inside a longer "hold"/workshop block — so
// summing each event's raw `end - start` over-reports how much of the day is
// actually occupied. Union the spans instead: overlapping time is counted once.
//
// This mirrors the interval-union the loop already applies to the two sibling
// "sum of possibly-overlapping durations" sites — chat-burst active hours
// (`analyzeInterruptionLoad`, capacity.ts) and the meeting back-to-back detector
// (`detectMeetingLoad`, accelerate.ts). Those live in `packages/` and must inline
// their own copy; the two consumers here (`proactiveAlertData.tomorrowMeetingHours`
// in App.tsx and `getCalendarSummary` in services/agentTools.ts) are both app-side,
// so they share this one implementation rather than each carrying a raw sum.

/**
 * Total wall-clock milliseconds covered by a set of half-open `[start, end)` spans,
 * counting overlapping time ONCE (interval union) instead of summing raw per-span
 * durations. Sorts a copy by start and walks a running max end — the same union used
 * at capacity.ts / accelerate.ts. Callers pass spans that are already finite with
 * `end > start` (each site guards NaN / non-positive at selection time); an empty
 * list returns 0.
 */
export function unionSpanMs(spans: { start: number; end: number }[]): number {
  if (spans.length === 0) return 0;
  const sorted = [...spans].sort((left, right) => left.start - right.start);
  let total = 0;
  let spanStart = sorted[0].start;
  let spanEnd = sorted[0].end;
  for (let index = 1; index < sorted.length; index += 1) {
    const span = sorted[index];
    if (span.start > spanEnd) {
      // Disjoint from the current merged span: bank it and open a new one.
      total += spanEnd - spanStart;
      spanStart = span.start;
      spanEnd = span.end;
    } else if (span.end > spanEnd) {
      // Overlaps/abuts the current span: extend its end, counting the overlap once.
      spanEnd = span.end;
    }
  }
  total += spanEnd - spanStart;
  return total;
}
