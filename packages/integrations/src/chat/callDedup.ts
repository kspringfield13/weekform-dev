import type { WorkBlock } from "../../../domain/src/models";

/**
 * De-duplicate chat-derived call/huddle meeting blocks against the meetings
 * already on the user's calendar.
 *
 * A Teams/Webex call (or Slack huddle) is frequently the *same* event as a
 * calendar invite — counting both would double-count it in the capacity model's
 * `meeting_pct`. This pure helper drops any chat call block whose span is
 * *mostly* covered by a calendar-derived meeting block, keeping the calendar
 * copy (the authoritative one) and every reactive (non-meeting) chat block
 * untouched.
 *
 * "Mostly covered" means a single calendar meeting overlaps more than half of
 * the call's own span (`MAJORITY_OVERLAP_RATIO`). Requiring a majority — rather
 * than any touch — means an unrelated huddle that merely straddles a meeting's
 * edge is kept, so genuine meeting/reactive time isn't silently undercounted.
 *
 * It reads only `category` + the `[start_time, end_time)` span — no message text
 * or window titles — so it preserves the chat family's metadata-only invariant.
 */

/** The single work category that represents a meeting/sync. */
const MEETING_CATEGORY: WorkBlock["category"] = "Meetings / stakeholder syncs";

/**
 * Length (epoch ms) of the intersection of two half-open `[start, end)` spans;
 * `0` when they don't overlap (or only touch at an endpoint).
 */
export function spanOverlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * A chat call is treated as the same event as a calendar meeting only when a
 * single meeting covers MORE than this fraction of the call's own span. Using a
 * strict majority avoids dropping an unrelated huddle that merely clips a
 * meeting's edge, while still catching a call that a meeting substantially
 * contains (e.g. a re-imported call, which overlaps its stored twin 100%).
 */
export const MAJORITY_OVERLAP_RATIO = 0.5;

interface Span {
  start: number;
  end: number;
}

/** Parse a block's `[start_time, end_time)` into epoch ms; `null` if unusable. */
function blockSpan(block: WorkBlock): Span | null {
  const start = new Date(block.start_time).getTime();
  const end = new Date(block.end_time).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return null;
  }
  return { start, end };
}

export interface ChatCallDedupResult {
  /** Chat blocks to keep: every reactive block + call blocks with no calendar twin. */
  kept: WorkBlock[];
  /** Chat call blocks dropped because a calendar meeting already covers their span. */
  deduped: WorkBlock[];
}

/**
 * Partition freshly-imported chat blocks into the ones to keep and the call
 * blocks that duplicate an existing calendar meeting.
 *
 * @param chatBlocks      The chat import's `work_blocks` (reactive + call blocks).
 * @param existingBlocks  Blocks already in the ledger; only their meeting blocks
 *                        are used as the dedup target. Pass the full block list —
 *                        non-meeting blocks are ignored.
 *
 * Only chat *meeting* blocks (category `Meetings / stakeholder syncs`, produced
 * from `call`/`huddle` surfaces) are eligible to be deduped; reactive chat
 * blocks are always kept. Re-importing the same export is idempotent: a call
 * that was kept becomes its own calendar twin on the second pass and dedups
 * against the stored copy, so no duplicate accrues.
 */
export function dedupeChatCallsAgainstCalendar(
  chatBlocks: WorkBlock[],
  existingBlocks: WorkBlock[]
): ChatCallDedupResult {
  // Compute the calendar meeting spans once up front (O(calls × meetings) total).
  const meetingSpans = existingBlocks
    .filter((block) => block.category === MEETING_CATEGORY)
    .map(blockSpan)
    .filter((span): span is Span => span !== null);

  const kept: WorkBlock[] = [];
  const deduped: WorkBlock[] = [];

  for (const block of chatBlocks) {
    if (block.category !== MEETING_CATEGORY) {
      // Reactive interruption blocks never collide with the calendar.
      kept.push(block);
      continue;
    }
    const span = blockSpan(block);
    // `blockSpan` guarantees `end > start`, so `callDuration` is always > 0.
    const isDuplicate =
      span !== null &&
      meetingSpans.some(
        (meeting) =>
          spanOverlapMs(span.start, span.end, meeting.start, meeting.end) >
          MAJORITY_OVERLAP_RATIO * (span.end - span.start)
      );
    if (isDuplicate) {
      deduped.push(block);
    } else {
      kept.push(block);
    }
  }

  return { kept, deduped };
}
