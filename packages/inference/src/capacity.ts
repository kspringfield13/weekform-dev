import type {
  RawEvent,
  UserCorrection,
  WeeklyCapacitySnapshot,
  WeeklyNarrative,
  WorkBlock,
  WorkCategory,
  WorkMode
} from "../../domain/src/models";
import { workCategories, workModes } from "../../domain/src/taxonomy";

// Target total utilization for the reliable new-work estimate: the ~80% queueing "knee". For an
// M/M/1 queue residence time scales as 1/(1−ρ), so wait time goes vertical past ρ≈0.8 — past the
// knee a knowledge worker's latency (and carryover) explodes. So instead of offering "all the
// hours left up to 100%", offer only enough new work to bring TOTAL utilization up to this knee,
// the only stable operating point. See docs/heuristics-vs-research.md §1.
// Exported so the Weekly "Reliable new work" helper copy renders the same knee the clamp and
// narrative use, instead of hand-mirroring "80" — a magic value that would silently lie if the
// knee ever moves (same rationale as CORE_HOURS_START/END below).
export const TARGET_UTILIZATION_PCT = 80;
// Retained guardrail: never promise more than 40% of a week as reliable new work, even when
// current utilization is near zero (a near-empty week shouldn't license a 60–80% new-work
// commitment on the strength of one quiet week). This was the old fixed ceiling; it stays as the
// conservative floor under the target-utilization model. Hand-tuned; see §1.
const MAX_RELIABLE_NEW_WORK = 40;
// Reactive/interrupted work is counted at only this fraction of its face value in the committed
// model — interrupted work costs higher stress, effort and time pressure and so delivers less
// sustainable throughput (Mark, Gudith & Klocke, CHI 2008; hand-tuned, see §2). Exported so the
// Weekly committed-load breakdown copy ("Reactive (×0.72)" / "counts at 72% of face value") renders
// the same factor the math applies, instead of hand-mirroring the literal — a magic value that would
// silently make the tooltip/chip lie the moment the discount is retuned (same rationale as
// TARGET_UTILIZATION_PCT above).
export const REACTIVE_DISCOUNT_FACTOR = 0.72;

// Length of a standard analyst week, in hours — the same baseline `estimated_capacity_pct` is
// expressed against (`WEEKLY_BASELINE_MINUTES = 40 * 60` in integrations' `normalize.ts`, mirrored
// locally in `accelerate.ts`). Kept as a local const — the inference layer must NOT import from the
// integrations package — so the weekly-narrative copy renders the baseline instead of hardcoding
// "40", a magic value that would silently lie if the baseline week ever moves. Mirror a change here
// if the baseline moves.
const WEEKLY_BASELINE_HOURS = 40;

function roundPct(value: number) {
  return Math.round(value);
}

// Zero-pad the week number in an ISO week id ("2026-W5" -> "2026-W05") so week ids sort
// chronologically under the lexicographic string compare (`localeCompare` / raw `<`) used
// throughout the ordering + rolling-window logic here. A non-padded week number — from an external
// import or a hand-authored/legacy-persisted history record — otherwise sorts WRONG ("2026-W5" >
// "2026-W27"), silently corrupting forecast track records, baselines, and realized-savings order.
// Normalize where ids ENTER (snapshot creation + every ordering boundary) so a stray non-padded id
// is fixed once rather than mishandled everywhere. Returns the input unchanged when it doesn't match
// the YYYY-W<number> shape, so an unexpected id is never mangled.
export function normalizeWeekId(weekId: string): string {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(weekId);
  if (!match) return weekId;
  return `${match[1]}-W${match[2].padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// Coerce a NaN/Infinity to 0 before it enters an aggregate. A single corrupt block field (a
// non-finite estimated_capacity_pct or confidence) would otherwise poison every downstream sum and
// average — including summary_confidence, which the narrative renders as "confidence is NaN%".
// Mirrors accelerate.ts#finiteMinutes.
function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

// Take the last `n` entries of an array — the rolling-window tail used by the accuracy-trend and
// baseline rollups. Guards `n <= 0` explicitly: `array.slice(-0)` is `slice(0)`, which returns the
// WHOLE array rather than an empty tail, so a non-positive window must short-circuit to `[]`.
function sliceLastN<T>(items: T[], n: number): T[] {
  if (n <= 0) return [];
  return items.slice(-n);
}

function sum(blocks: WorkBlock[], predicate: (block: WorkBlock) => boolean) {
  return blocks.filter(predicate).reduce((total, block) => total + finite(block.estimated_capacity_pct), 0);
}

function allocationBy<T extends string>(
  labels: T[],
  blocks: WorkBlock[],
  selector: (block: WorkBlock) => T
) {
  return labels
    .map((label) => ({
      label,
      value: roundPct(sum(blocks, (block) => selector(block) === label))
    }))
    .filter((item) => item.value > 0);
}

export function computeWeeklyCapacitySnapshot(
  weekId: string,
  blocks: WorkBlock[]
): WeeklyCapacitySnapshot {
  const included = blocks.filter((block) => block.planned_status !== "blocked" || block.blocker_flag);
  const allocated = roundPct(sum(included, () => true));
  const meetingPct = roundPct(sum(included, (block) => block.category === "Meetings / stakeholder syncs"));

  // Bucket predicates for the committed-utilization model. `committed_utilization_pct` used to sum
  // these NON-disjointly, so a block matching more than one (e.g. Recurring + Reactive) was counted
  // in each: a 30% block added ~1.72× its capacity (recurring 1.0 + reactive 0.72 ≈ 52%),
  // systematically overstating committed load and understating the headline reliable-new-work
  // number. Each included block now contributes to EXACTLY ONE committed bucket, assigned in the
  // priority order carryover > recurring > reactive (the `included` filter above drops ONLY
  // blocked-AND-unflagged work, so a `blocker_flag` block stays here as committed load;
  // fragmentation/WIP are shape penalties, not per-block volume, so they add on top).
  // The remaining planned / verified deep work is not forward-committed load.
  const isCarryoverRisk = (block: WorkBlock) => !block.user_verified && block.confidence < 0.75;
  const isRecurring = (block: WorkBlock) =>
    block.category === "Recurring reporting" ||
    block.category === "Admin / coordination" ||
    block.planned_status === "fixed";
  const isReactive = (block: WorkBlock) =>
    block.planned_status === "unplanned" ||
    block.mode === "Reactive" ||
    block.category === "Ad hoc stakeholder requests";

  // Reported recurring load = the committed-recurring bucket: recurring blocks NOT already claimed
  // by the higher-priority carryover bucket. This field feeds only the Weekly committed-load
  // breakdown, so reporting the disjoint bucket keeps that breakdown's parts summing exactly to
  // committed_utilization_pct (see the committed computation below).
  const recurringPct = roundPct(sum(included, (block) => isRecurring(block) && !isCarryoverRisk(block)));
  const plannedPct = roundPct(sum(included, (block) => block.planned_status === "planned"));
  // Reported reactive load stays TOTAL (every reactive-predicate block) — it's an independent
  // interruption-volume metric (MetricCard, trend chart, agent tools), not a committed-bucket
  // figure. The committed model uses the disjoint reactive contribution (`reactiveCommittedPct`).
  const reactivePct = roundPct(sum(included, isReactive));
  // `blocked_pct` reports the FULL blocked share, so compute it over the PRE-FILTER `blocks` set
  // with the complete blocked predicate (flag OR blocked status OR the Blocked category). Note the
  // `included` filter above drops ONLY blocked-AND-unflagged work — a `blocker_flag`'d blocked
  // block is KEPT in `included` (counted as committed load) and also reported here; the predicate
  // additionally folds in the unflagged `planned_status === "blocked"` case the filter drops, which
  // would otherwise never be counted anywhere.
  const blockedPct = roundPct(
    sum(
      blocks,
      (block) =>
        block.blocker_flag ||
        block.planned_status === "blocked" ||
        block.category === "Blocked / waiting / dependency delay"
    )
  );
  const deepWorkPct = roundPct(sum(included, (block) => block.mode === "Deep work"));
  const fragmentedWorkPct = roundPct(sum(included, (block) => block.mode === "Fragmented"));
  // Discount unverified low-confidence work to 55% when scoring carryover risk: only a fraction of
  // it is likely to actually spill into next week. The 0.55 weight is hand-tuned, not derived —
  // see docs/heuristics-vs-research.md §1–2 ("Document the 0.72 / 0.55 / 40% constants").
  // Highest-priority committed bucket — takes ALL its matching blocks, so this reported value is
  // unchanged by the disjoint refactor (recurring/reactive only lose blocks to it).
  const carryoverRiskPct = roundPct(sum(included, isCarryoverRisk) * 0.55);
  // Capacity-weight the context-switch score: the share of the week's ESTIMATED CAPACITY (not the
  // raw block count) spent on fragmented/reactive work. The old count-based ratio let volume-tiny
  // fragments dominate — ten 1-minute fragmented blocks beside one 8-hour deep block scored 0.91
  // and flagged a "fragmented week" that was 99% deep work; weighting by estimated_capacity_pct
  // scores that same week ~0.09. Every sibling metric is already capacity-weighted, so this makes
  // the score consistent with them. Denominator is the total included capacity (guarded to ≥1 so an
  // empty week yields 0). The 0.45 narrative / 0.6 alert thresholds still read sensibly — now
  // "45% of the week's TIME is fragmented" rather than "45% of the blocks are".
  const contextSwitchScore = clamp(
    sum(included, (block) => block.mode === "Fragmented" || block.mode === "Reactive") /
      Math.max(sum(included, () => true), 1),
    0,
    1
  );
  // Work-in-progress penalty. Context-switching cost grows FASTER than the raw count of
  // concurrent projects (the cost is closer to combinatorial — every extra project competes
  // with all the others for attention), and the research pass found fragmentation is likely
  // *under*-weighted, not over- (docs/heuristics-vs-research.md §3: collaboration is ~85% of
  // the week, sustained attention ~47s). So curve the score upward (quadratic) instead of the
  // old forgiving linear count/10: a handful of parallel projects now hurts disproportionately
  // more than the same work volume on a single project. Squaring `count / 7` keeps the score
  // near the old linear value around 5 projects, gentler below it (few projects = little
  // switching), and harsher above — saturating the penalty at 7 concurrent projects (the
  // "badly overloaded" knee). Still clamped to [0,1].
  const activeProjectCount = new Set(included.map((block) => block.project_name)).size;
  const wipLoadScore = clamp(Math.pow(activeProjectCount / 7, 2), 0, 1);
  const fragmentationPenalty = roundPct(contextSwitchScore * 12);
  const wipPenalty = roundPct(wipLoadScore * 10);
  // Disjoint reactive committed bucket: reactive blocks NOT already claimed by the higher-priority
  // carryover or recurring buckets. This is what the committed model counts (kept separate from the
  // TOTAL `reactivePct` reported above), so no block is double-counted across buckets.
  const reactiveCommittedPct = roundPct(
    sum(included, (block) => isReactive(block) && !isCarryoverRisk(block) && !isRecurring(block))
  );
  // Forward-committed load = the week's current utilization for the target-utilization model.
  // Sum the DISJOINT commitments that carry into next week: recurring work that repeats, carryover
  // that spills in, reactive load (counted at only ~72% of its face value — Mark, Gudith & Klocke,
  // CHI 2008, found reactive/interrupted work costs higher stress, effort and time pressure, so
  // it delivers less *sustainable* throughput; 0.72 is hand-tuned, docs/heuristics-vs-research.md
  // §2), plus the fragmentation/WIP drag. This replaces the old implicit "100% baseline".
  // Every term except `reactiveCommittedPct * REACTIVE_DISCOUNT_FACTOR` is a pre-rounded integer, so
  // the Weekly breakdown can recover the reactive contribution exactly as the remainder (NOTES gotcha).
  const committedUtilizationPct = roundPct(
    recurringPct + carryoverRiskPct + reactiveCommittedPct * REACTIVE_DISCOUNT_FACTOR + fragmentationPenalty + wipPenalty
  );
  // Reliable new work = headroom that brings total utilization up to the ~80% knee, clamped to a
  // [0, 40] guardrail. More explainable than the old 0–40% clamp ("you're at 64% committed; ~16%
  // keeps you under the 80% reliability knee") and removes the arbitrary 100% baseline; the 40%
  // cap stays as the old-behavior floor against over-promising on a near-empty week. See §1.
  const reliableNewWorkCapacityPct = clamp(
    TARGET_UTILIZATION_PCT - committedUtilizationPct,
    0,
    MAX_RELIABLE_NEW_WORK
  );
  const averageConfidence =
    included.reduce((total, block) => total + finite(block.confidence), 0) / Math.max(included.length, 1);

  return {
    week_id: normalizeWeekId(weekId),
    allocated_pct: allocated,
    deep_work_pct: deepWorkPct,
    fragmented_work_pct: fragmentedWorkPct,
    meeting_pct: meetingPct,
    reactive_pct: reactivePct,
    planned_pct: plannedPct,
    blocked_pct: blockedPct,
    recurring_pct: recurringPct,
    reliable_new_work_capacity_pct: reliableNewWorkCapacityPct,
    committed_utilization_pct: committedUtilizationPct,
    carryover_risk_pct: carryoverRiskPct,
    wip_load_score: Number(wipLoadScore.toFixed(2)),
    context_switch_score: Number(contextSwitchScore.toFixed(2)),
    fragmentation_penalty_pct: fragmentationPenalty,
    wip_penalty_pct: wipPenalty,
    summary_confidence: Number(averageConfidence.toFixed(2)),
    category_allocation: allocationBy<WorkCategory>(workCategories, included, (block) => block.category),
    work_mode_allocation: allocationBy<WorkMode>(workModes, included, (block) => block.mode)
  };
}

export type ForecastAccuracyRating = "on_target" | "close" | "off";

export interface ForecastAccuracy {
  predicted_pct: number;
  actual_pct: number;
  error_pts: number; // absolute points between forecast and outcome
  signed_error_pts: number; // predicted - actual (positive = over-predicted)
  rating: ForecastAccuracyRating;
}

/**
 * Score a past forecast against the capacity the model actually computed for the
 * week it targeted. Pure and primitive-only so it stays unit-testable and free of
 * frontend persistence types. Thresholds are point-deltas on the 0–100 reliable
 * new-work capacity scale.
 */
export function scoreForecastAccuracy(predictedPct: number, actualPct: number): ForecastAccuracy {
  const signed = roundPct(predictedPct - actualPct);
  const error = Math.abs(signed);
  const rating: ForecastAccuracyRating = error <= 5 ? "on_target" : error <= 12 ? "close" : "off";
  return {
    predicted_pct: roundPct(predictedPct),
    actual_pct: roundPct(actualPct),
    error_pts: error,
    signed_error_pts: signed,
    rating
  };
}

/**
 * A rolling track record of how far past forecasts have landed from the model's eventual
 * computation, so the UI can frame the latest forecast with evidence ("forecasts have
 * averaged ±N pts over the last K weeks"). `week_count` is how many scored forecasts fed
 * the average.
 */
export interface ForecastAccuracyTrend {
  week_count: number;
  mean_abs_error_pts: number; // mean absolute point error over the window
  mean_signed_error_pts: number; // mean signed error (predicted - actual; positive = over-predicts)
}

const ACCURACY_TREND_WINDOW_WEEKS = 8;

/**
 * Roll the most recent scored forecasts into a single mean-absolute-error. Each input pairs a
 * past forecast's predicted reliable capacity with the capacity the model actually computed for
 * the week it targeted (keyed by `week_id`, one entry per week). Pure and primitive-only like
 * `scoreForecastAccuracy`: it reuses that helper for the per-week error so rounding/thresholds
 * stay consistent, sorts by `week_id` defensively, and averages the most recent
 * `ACCURACY_TREND_WINDOW_WEEKS`. Returns `null` when there is nothing scored so the caller can
 * hide the line.
 */
export function summarizeForecastAccuracy(
  scored: { week_id: string; predicted_pct: number; actual_pct: number }[]
): ForecastAccuracyTrend | null {
  if (scored.length === 0) return null;
  const window = sliceLastN(
    [...scored].sort((left, right) =>
      normalizeWeekId(left.week_id).localeCompare(normalizeWeekId(right.week_id))
    ),
    ACCURACY_TREND_WINDOW_WEEKS
  );
  const totals = window.reduce(
    (sums, item) => {
      const scored = scoreForecastAccuracy(item.predicted_pct, item.actual_pct);
      return { error: sums.error + scored.error_pts, signed: sums.signed + scored.signed_error_pts };
    },
    { error: 0, signed: 0 }
  );
  return {
    week_count: window.length,
    mean_abs_error_pts: roundPct(totals.error / window.length),
    mean_signed_error_pts: roundPct(totals.signed / window.length)
  };
}

/** A scored forecast keyed by the week it targeted, for the per-week track-record list. */
export interface ForecastTrackRecordEntry extends ForecastAccuracy {
  week_id: string;
}

/**
 * Build a per-week predicted-vs-actual track record so the UI can list how every past forecast
 * landed (rating chip + signed error) and the model can be audited over time. Each input pairs a
 * past forecast's predicted reliable capacity with the capacity the model actually computed for
 * the week it targeted (one entry per week). Pure and primitive-only like
 * `summarizeForecastAccuracy`; reuses `scoreForecastAccuracy` so rounding/thresholds stay
 * consistent with the single-week banner, and sorts newest week first for display.
 */
export function buildForecastTrackRecord(
  scored: { week_id: string; predicted_pct: number; actual_pct: number }[]
): ForecastTrackRecordEntry[] {
  return [...scored]
    .sort((left, right) =>
      normalizeWeekId(right.week_id).localeCompare(normalizeWeekId(left.week_id))
    )
    .map((item) => ({
      week_id: normalizeWeekId(item.week_id),
      ...scoreForecastAccuracy(item.predicted_pct, item.actual_pct)
    }));
}

/**
 * Rolling personal baselines for the headline capacity metrics. `week_count` is how
 * many prior-week snapshots fed the medians; each metric is the median over the most
 * recent `BASELINE_WINDOW_WEEKS` of them (or `null` when there is no history). Lets the
 * UI read this week's numbers against the user's own norm instead of an absolute scale.
 */
export interface CapacityBaselines {
  week_count: number;
  reactive_pct: number | null;
  meeting_pct: number | null;
  context_switch_score: number | null;
  reliable_new_work_capacity_pct: number | null;
}

const BASELINE_WINDOW_WEEKS = 6;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Compute rolling medians for the headline capacity metrics over the most recent
 * `BASELINE_WINDOW_WEEKS` snapshots in `history`. Pure and domain-typed (no persistence
 * types) so it stays unit-testable. Input is sorted by `week_id` defensively; pass
 * prior-week snapshots ONLY — exclude the week being compared so it doesn't pull its own
 * median toward itself.
 */
export function computeCapacityBaselines(history: WeeklyCapacitySnapshot[]): CapacityBaselines {
  const window = sliceLastN(
    [...history].sort((left, right) =>
      normalizeWeekId(left.week_id).localeCompare(normalizeWeekId(right.week_id))
    ),
    BASELINE_WINDOW_WEEKS
  );
  return {
    week_count: window.length,
    reactive_pct: median(window.map((snapshot) => snapshot.reactive_pct)),
    meeting_pct: median(window.map((snapshot) => snapshot.meeting_pct)),
    context_switch_score: median(window.map((snapshot) => snapshot.context_switch_score)),
    reliable_new_work_capacity_pct: median(
      window.map((snapshot) => snapshot.reliable_new_work_capacity_pct)
    )
  };
}

/**
 * A systematic mislabel surfaced from the user's correction history: the same field was
 * re-labeled from `from_value` to `to_value` at least `SYSTEMATIC_CORRECTION_THRESHOLD`
 * times, which suggests a repeatable bias in the model's labeling for that pattern.
 */
export interface CorrectionBias {
  field: UserCorrection["field"];
  from_value: string;
  to_value: string;
  count: number;
}

export interface CorrectionBiasAnalysis {
  total_corrections: number;
  /** Corrections eligible for bias detection (label fields with a real value change). */
  label_correction_count: number;
  /** Systematic from→to patterns, sorted by count descending. Empty when none reach the threshold. */
  biases: CorrectionBias[];
}

// Fields where a from→to edit represents a repeatable classification mislabel. Free-text and
// timestamp edits are excluded — they don't form a meaningful directional bias signal.
const BIAS_LABEL_FIELDS: ReadonlySet<UserCorrection["field"]> = new Set([
  "category",
  "mode",
  "planned_status",
  "stakeholder_group",
  "blocker_flag"
]);

const SYSTEMATIC_CORRECTION_THRESHOLD = 3;

/**
 * Surface systematic mislabels from the user's correction history so the model's blind spots
 * are visible — no retraining, this just closes the feedback loop. A bias is any
 * `(field, old_value → new_value)` pattern repeated at least `SYSTEMATIC_CORRECTION_THRESHOLD`
 * times across the label fields (e.g. category X→Y corrected ≥3×, or planned→unplanned drift).
 * Pure and domain-typed (no persistence/frontend types) so it stays unit-testable.
 */
export function analyzeCorrections(corrections: UserCorrection[]): CorrectionBiasAnalysis {
  const counts = new Map<string, CorrectionBias>();
  let labelCount = 0;
  for (const correction of corrections) {
    if (!BIAS_LABEL_FIELDS.has(correction.field)) continue;
    if (correction.old_value === correction.new_value) continue;
    labelCount += 1;
    // JSON-encode the (field, from, to) triple into the dedup key so distinct corrections can
    // never alias on a shared delimiter (label values like "Planned analysis / project work"
    // carry spaces and slashes), and the source stays plain text — no control-char separators.
    const key = JSON.stringify([correction.field, correction.old_value, correction.new_value]);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, {
        field: correction.field,
        from_value: correction.old_value,
        to_value: correction.new_value,
        count: 1
      });
    }
  }
  const biases = [...counts.values()]
    .filter((bias) => bias.count >= SYSTEMATIC_CORRECTION_THRESHOLD)
    .sort((left, right) => right.count - left.count);
  return {
    total_corrections: corrections.length,
    label_correction_count: labelCount,
    biases
  };
}

/**
 * Chat-driven interruption load, derived from imported workplace-chat events. Chat is the one
 * source that exposes reactive interruption density — the part of the capacity model that
 * calendar + git can't see — so this quantifies how much it fragmented the week's deep work,
 * feeding the same `context_switch_score` / `fragmented_work_pct` story.
 *
 * - `messages_per_active_hour` is the interruption density while engaged in chat bursts.
 * - `burst_count` is the reactive-burst frequency (one imported chat event per burst).
 * - `interrupted_deep_work_pct` is how often a chat burst overlapped a deep-work block in the
 *   same window — the interleave signal.
 */
export interface InterruptionLoadAnalysis {
  /** Reactive chat bursts in the window (one per imported chat event). */
  burst_count: number;
  /** Total messages across bursts (metadata count only — never message text). */
  message_count: number;
  /** Direct @-mentions — the sharpest interruption signal. */
  mention_count: number;
  /**
   * Share (0–100) of reactive messages that were direct @-mentions — how much of the chat
   * pressure was aimed at the user by name (harder to batch/defer than ambient channel chatter).
   * Floored to 1 when there is any mention volume (so a non-zero count never displays alongside
   * "0%"), capped at 100 to stay sane if a malformed export reports more mentions than messages;
   * 0 only when there are no mentions or no messages to divide by.
   */
  mention_pct: number;
  /** Hours spent inside chat bursts. */
  active_hours: number;
  /** Messages per active chat hour — interruption density while engaged. */
  messages_per_active_hour: number;
  /** Deep-work blocks active during the chat window. */
  deep_work_block_count: number;
  /** Deep-work blocks a chat burst overlapped (interleaved). */
  interrupted_deep_work_count: number;
  /** Share (0–100) of in-window deep-work blocks a chat burst interleaved. */
  interrupted_deep_work_pct: number;
  /** Distinct local weekdays that carried reactive message volume (0–7; caller scopes to a week). */
  active_day_count: number;
  /** Weekday name (local time) reactive message volume peaked on; null when no message volume. */
  peak_day: string | null;
  /** Reactive messages on `peak_day` (metadata count only); 0 when `peak_day` is null. */
  peak_day_message_count: number;
  /**
   * Local hour (0–23) reactive volume concentrated in ON the peak day — the time-of-day axis the
   * weekday peak can't show. Non-null exactly when `peak_day` is non-null (the peak day always
   * carries ≥1 message-bearing hour), so it renders alongside the peak-day note.
   */
  peak_hour: number | null;
  /**
   * Lowest-volume *active* weekday (local time) — the quietest day to protect for deep work;
   * null when there are fewer than 2 active days (no quieter day to contrast against the peak).
   */
  calm_day: string | null;
  /**
   * How many top active days `concentration_pct` covers — `min(2, active_day_count)`. Names the
   * cluster so the caller can say "your busiest N days" without recomputing.
   */
  concentration_day_count: number;
  /**
   * Share (0–100) of the week's reactive message volume that landed in the busiest
   * `concentration_day_count` active days — how *clustered* (vs. evenly spread) the reactive load
   * was. A heavy cluster is batchable; an even spread is endemic. 100 for a single-active-day week
   * (its one day holds everything); the caller gates any "batchable" note on there being quieter
   * days left AND the share exceeding an even spread. 0 only when there is no message volume.
   */
  concentration_pct: number;
  /**
   * Whether the reactive load is *clustered* enough to be worth flagging as batchable: the busiest
   * one-or-two days hold a share ≥`CONCENTRATION_MARGIN_PCT` points above an even spread AND there
   * are quieter days left to protect (`active_day_count > concentration_day_count`). False for a
   * roughly-flat week (top days lead only trivially) or when there aren't enough active days to
   * contrast — so the caller can gate the "batchable" note on this one boolean.
   */
  concentration_is_clustered: boolean;
  /** Reactive messages that landed outside core hours (before 08:00 / at-or-after 18:00 local). */
  after_hours_message_count: number;
  /**
   * Share (0–100) of reactive messages that landed after hours; 0 only when there is no after-hours
   * volume, floored to 1 when there is any (so a non-zero count never displays alongside "0%").
   */
  after_hours_pct: number;
}

// Core working-hour window (local time) for the after-hours reactive-load signal. Reactive chat
// that starts before 08:00 or at/after 18:00 is attributed to "after hours" — work bleeding into
// personal time, an unsustainable-pace cue (Pencavel's diminishing-returns-past-long-hours point,
// docs/heuristics-vs-research.md §5, applied to *when* the load lands, not just how much). Hand-set
// boundary — there is no per-user schedule yet; a burst is bucketed by its START hour, consistent
// with the weekday bucketing below.
// Exported so the Weekly after-hours note renders the same boundary the signal is computed from
// (via `formatHourOfDay`), instead of hardcoding "8am–6pm" — a magic value that would silently lie
// if this window ever moves.
export const CORE_HOURS_START = 8;
export const CORE_HOURS_END = 18;

// A reactive load counts as "clustered" (worth flagging as batchable) when its busiest one-or-two
// active days hold a message share at least this many points above an even spread across all active
// days — enough of a lump that the remaining days are meaningfully quieter and protectable. Below
// this margin the top days lead only trivially (a roughly flat week), so surfacing it would be noise.
const CONCENTRATION_MARGIN_PCT = 15;

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

/** Parse a metadata count string (`messages`/`mentions`); non-numeric/negative → 0. */
function metadataCount(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

/**
 * Quantify chat-driven interruption load from imported chat events plus the work blocks they
 * could have fragmented. Pure and domain-typed (no persistence/frontend types) so it stays
 * unit-testable like `scoreForecastAccuracy`. **Privacy:** reads ONLY the metadata-only counts
 * the chat parser emits (`messages`/`mentions`) plus event time spans — never message text.
 * Returns `null` when there is no chat signal so the caller can hide the panel.
 */
export function analyzeInterruptionLoad(
  chatEvents: RawEvent[],
  workBlocks: WorkBlock[]
): InterruptionLoadAnalysis | null {
  const bursts: { start: number; end: number }[] = [];
  // Reactive message volume bucketed by local weekday (0–6) so we can name the day focus took the
  // most chat pressure. Local time is the right semantic — the user's sense of "Wednesday".
  const dayMessages = new Map<number, number>();
  // Reactive message volume bucketed by (local weekday, local hour) via `dayIndex * 24 + hour`, so
  // once the peak day is known we can name the hour reactive load concentrated in ON that day —
  // the time-of-day axis, not conflated with any other day's hourly pattern.
  const dayHourMessages = new Map<number, number>();
  let messageCount = 0;
  let mentionCount = 0;
  let afterHoursMessages = 0;
  for (const event of chatEvents) {
    if (event.source_type !== "chat") continue;
    const start = new Date(event.timestamp_start).getTime();
    const end = new Date(event.timestamp_end).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
    // `metadata` is typed non-null, but events can arrive from untrusted persisted
    // JSON — fall back to an empty bag so a malformed record can't throw here.
    const metadata = event.metadata ?? {};
    const messages = metadataCount(metadata.messages);
    // A chat burst with no message volume carries no reactive signal — it is a malformed
    // record, not an interruption — so skip it entirely before it can inflate `burst_count`,
    // `active_hours`, or the deep-work-overlap window. This closes an inconsistency with the
    // per-day / peak / after-hours buckets below, whose guard already documents that a
    // "malformed 0-message burst … can't inflate the count" — but `burst_count`/`active_hours`
    // were derived from bursts pushed BEFORE that guard, so a 0-message record still inflated
    // them. The real importer always emits `messages >= 1` (chatExport.ts stamps
    // `String(session.length)` for a non-empty burst), so this is byte-identical on real/demo
    // data and only defends corrupt/hand-authored persisted JSON.
    if (messages === 0) continue;
    bursts.push({ start, end });
    messageCount += messages;
    mentionCount += metadataCount(metadata.mentions);
    // Bucket the burst's reactive volume by local weekday (and by weekday+hour). `messages > 0`
    // is guaranteed above, so these aggregates and `burst_count` / `active_hours` now agree on
    // exactly which bursts count. Local time is the right semantic — the user's sense of "Wednesday".
    const startDate = new Date(start);
    const dayIndex = startDate.getDay();
    dayMessages.set(dayIndex, (dayMessages.get(dayIndex) ?? 0) + messages);
    // Attribute the burst's messages to "after hours" by its start hour, mirroring the weekday
    // bucketing — a metadata-only sustainability cue, never message text.
    const startHour = startDate.getHours();
    dayHourMessages.set(
      dayIndex * 24 + startHour,
      (dayHourMessages.get(dayIndex * 24 + startHour) ?? 0) + messages
    );
    if (startHour < CORE_HOURS_START || startHour >= CORE_HOURS_END) {
      afterHoursMessages += messages;
    }
  }
  if (bursts.length === 0) return null;

  // Name the weekday reactive volume peaked on. Iterate by ascending weekday index so ties resolve
  // to the lower index deterministically regardless of event order; strict `>` from a 0 baseline
  // leaves `peak_day` null for a burst-only week with no message counts (nothing worth naming).
  let peakDayIndex = -1;
  let peakDayMessages = 0;
  for (const dayIndex of [...dayMessages.keys()].sort((left, right) => left - right)) {
    const total = dayMessages.get(dayIndex) ?? 0;
    if (total > peakDayMessages) {
      peakDayMessages = total;
      peakDayIndex = dayIndex;
    }
  }

  // Within the peak day, name the local hour reactive volume concentrated in — the time-of-day the
  // user is likeliest to lose focus, an axis the weekday peak alone can't surface. Iterate hours
  // ascending with strict `>` so ties resolve to the earlier hour deterministically. The peak day
  // always carries ≥1 message-bearing hour bucket, so `peakHourIndex` is set whenever `peakDayIndex`
  // is — i.e. `peak_hour` is non-null exactly when `peak_day` is.
  let peakHourIndex = -1;
  let peakHourMessages = 0;
  if (peakDayIndex >= 0) {
    for (let hour = 0; hour < 24; hour += 1) {
      const total = dayHourMessages.get(peakDayIndex * 24 + hour) ?? 0;
      if (total > peakHourMessages) {
        peakHourMessages = total;
        peakHourIndex = hour;
      }
    }
  }

  // Name the calmest *active* weekday (lowest reactive volume) so the footnote can suggest a
  // concrete day to protect for deep work. Only meaningful with ≥2 active days — with one (or
  // zero) message-bearing day there is no quieter day to contrast against the peak, so leave it
  // null. Same ascending-index iteration + strict `<` from a high baseline → lowest-index-wins
  // tie-break, mirroring the peak computation above, but SKIP the peak day: naming the same
  // weekday both busiest and calmest is a contradiction. Excluding it is a no-op except when the
  // peak day is also a min-volume day (which requires every active day to carry equal volume,
  // since the peak day holds the global max) — the exact tie that produced `calm_day === peak_day`.
  // Then guard the residual identical case: if the calmest non-peak day is not actually quieter
  // than the peak (all active days equal), there is no meaningful contrast, so leave it null.
  let calmDayIndex = -1;
  if (dayMessages.size >= 2) {
    let calmDayMessages = Number.POSITIVE_INFINITY;
    for (const dayIndex of [...dayMessages.keys()].sort((left, right) => left - right)) {
      if (dayIndex === peakDayIndex) continue;
      const total = dayMessages.get(dayIndex) ?? 0;
      if (total < calmDayMessages) {
        calmDayMessages = total;
        calmDayIndex = dayIndex;
      }
    }
    // `peakDayMessages` is the global max, so `calmDayMessages` can only equal it when every
    // active day is tied — in which case no day is genuinely calmer than the peak.
    if (calmDayIndex >= 0 && calmDayMessages >= peakDayMessages) {
      calmDayIndex = -1;
    }
  }

  // How concentrated the reactive load is across the active days: the share of total reactive
  // message volume that landed in the busiest one-or-two days. An even spread is endemic (hard to
  // batch); a heavy cluster in a day or two is batchable — the caller can suggest protecting the
  // rest. Take the top min(2, active days) so a single-active-day week reports its one day and a
  // multi-day week its worst two. Sum of `dayMessages` values equals `messageCount` (both count
  // only message-bearing bursts), so the share can never exceed 100.
  const sortedDayVolumes = [...dayMessages.values()].sort((left, right) => right - left);
  const concentrationDayCount = Math.min(2, sortedDayVolumes.length);
  const concentratedMessages = sortedDayVolumes
    .slice(0, concentrationDayCount)
    .reduce((sum, volume) => sum + volume, 0);
  const concentrationPct =
    messageCount > 0 ? Math.round((concentratedMessages / messageCount) * 100) : 0;
  // Clustered only when the top days lead an even spread by a real margin AND quieter days remain —
  // i.e. `active_day_count (= dayMessages.size) > concentrationDayCount`, which forces ≥3 active days
  // (so `concentrationDayCount` is 2). Decide it here so the view just reads one boolean, mirroring
  // how the mention/after-hours floors are computed in this function rather than in the screen.
  const evenSharePct =
    dayMessages.size > 0 ? Math.round((concentrationDayCount / dayMessages.size) * 100) : 0;
  const concentrationIsClustered =
    dayMessages.size > concentrationDayCount &&
    concentrationPct >= evenSharePct + CONCENTRATION_MARGIN_PCT;

  // Scope deep-work blocks to the chat window so the interleave denominator reflects the period
  // chat could actually have fragmented, not the user's entire history.
  const windowStart = Math.min(...bursts.map((burst) => burst.start));
  const windowEnd = Math.max(...bursts.map((burst) => burst.end));
  const deepWorkInWindow = workBlocks
    .filter((block) => block.mode === "Deep work")
    .map((block) => ({
      start: new Date(block.start_time).getTime(),
      end: new Date(block.end_time).getTime()
    }))
    .filter(
      (span) =>
        !Number.isNaN(span.start) &&
        !Number.isNaN(span.end) &&
        span.start < windowEnd &&
        windowStart < span.end
    );

  const interrupted = deepWorkInWindow.filter((span) =>
    bursts.some((burst) => burst.start < span.end && span.start < burst.end)
  ).length;

  // Active chat time is the UNION of the burst spans, NOT their raw sum. Bursts within one
  // provider+kind group are gap-split so they can't overlap, but bursts from DIFFERENT groups
  // (a Slack text burst running while Teams text bursts arrive) routinely overlap in wall-clock
  // time — summing them would double-count the overlap, inflating active_hours and deflating the
  // derived messages_per_active_hour density. Merge the sorted spans and total the merged lengths
  // so overlapping time is counted once. `bursts` is non-empty here (the length===0 early return
  // above), and every burst has end > start (guarded in the loop), so each merged span is positive.
  const sortedBursts = [...bursts].sort((left, right) => left.start - right.start);
  let activeMs = 0;
  let spanStart = sortedBursts[0].start;
  let spanEnd = sortedBursts[0].end;
  for (let index = 1; index < sortedBursts.length; index += 1) {
    const burst = sortedBursts[index];
    if (burst.start > spanEnd) {
      activeMs += spanEnd - spanStart;
      spanStart = burst.start;
      spanEnd = burst.end;
    } else if (burst.end > spanEnd) {
      spanEnd = burst.end;
    }
  }
  activeMs += spanEnd - spanStart;
  const activeHours = activeMs / 3_600_000;
  return {
    burst_count: bursts.length,
    message_count: messageCount,
    mention_count: mentionCount,
    // Floor to 1% when there is any mention volume (mirrors `after_hours_pct`) so a non-zero
    // count never renders beside "0%"; cap at 100 so a malformed export reporting more mentions
    // than messages can't exceed 100%. Guard `messageCount > 0` (a mentions-only, 0-message burst
    // is possible) so the division never yields Infinity.
    mention_pct:
      mentionCount > 0 && messageCount > 0
        ? Math.min(100, Math.max(1, Math.round((mentionCount / messageCount) * 100)))
        : 0,
    active_hours: Number(activeHours.toFixed(2)),
    messages_per_active_hour: activeHours > 0 ? Math.round(messageCount / activeHours) : 0,
    deep_work_block_count: deepWorkInWindow.length,
    interrupted_deep_work_count: interrupted,
    interrupted_deep_work_pct:
      deepWorkInWindow.length > 0 ? Math.round((interrupted / deepWorkInWindow.length) * 100) : 0,
    active_day_count: dayMessages.size,
    peak_day: peakDayIndex >= 0 ? WEEKDAY_NAMES[peakDayIndex] : null,
    peak_day_message_count: peakDayMessages,
    peak_hour: peakHourIndex >= 0 ? peakHourIndex : null,
    calm_day: calmDayIndex >= 0 ? WEEKDAY_NAMES[calmDayIndex] : null,
    concentration_day_count: concentrationDayCount,
    concentration_pct: concentrationPct,
    concentration_is_clustered: concentrationIsClustered,
    after_hours_message_count: afterHoursMessages,
    // Floor to 1% when there is any after-hours volume so the footnote (gated on the count) never
    // shows "0%" beside a non-zero count. messageCount ≥ afterHoursMessages > 0 here, so safe.
    after_hours_pct:
      afterHoursMessages > 0 ? Math.max(1, Math.round((afterHoursMessages / messageCount) * 100)) : 0
  };
}

/**
 * A stakeholder group (channel / DM) the week's reactive chat work served, ranked by message
 * volume. Channel/participant labels only — never message content.
 */
export interface ChatStakeholderGroup {
  /** Channel/untagged display label (e.g. "#data-requests", "Direct & untagged"). Never message text. */
  label: string;
  /** Reactive bursts that involved this group (the concrete, always-exact count). */
  burst_count: number;
  /**
   * Share (0–100) of the window's reactive message *volume* this group accounts for. A burst
   * spanning multiple channels splits its volume evenly so no channel is over-credited; that
   * fractional weight drives the share but is never surfaced as a misleading rounded count.
   */
  share_pct: number;
}

export interface ChatStakeholderSummary {
  /** Total reactive messages across every group in the window (metadata counts only). */
  total_message_count: number;
  /** Distinct stakeholder groups seen, before the top-N cut. */
  group_count: number;
  /** Top groups by reactive message volume, descending. */
  groups: ChatStakeholderGroup[];
}

const DEFAULT_STAKEHOLDER_LIMIT = 4;
// Bursts with no channel/DM label (e.g. a DM export that omits the participant name) still
// served reactive time — bucket them honestly rather than silently dropping the volume.
const UNLABELED_STAKEHOLDER_GROUP = "Direct & untagged";

/**
 * Split a metadata `channels` value ("#a\n#b") into trimmed labels; missing/empty → [].
 * Splits on NEWLINE, not comma: a channel/space display name can itself contain a comma
 * (Webex spaces, free-form Teams channels), and `chatExport.ts` joins the burst's labels
 * with "\n" for exactly that reason — a comma split would fracture one real channel into
 * phantom stakeholder groups. (Records written before the delimiter switch used ", "; a
 * legacy single-channel name now parses whole — correct — while a legacy multi-channel
 * burst merges into one label until it is re-imported, a self-healing display-only edge.)
 */
function parseChannelLabels(value: string | null | undefined): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/)
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
}

/**
 * Rank the stakeholder groups (channels / DMs) the week's reactive chat work served, so the user
 * can see *who* their ad-hoc time went to — the collaboration view calendar + git can't surface.
 * Pure and domain-typed (no persistence/frontend types) so it stays unit-testable like
 * `analyzeInterruptionLoad`. **Privacy:** reads ONLY the metadata-only labels/counts the chat
 * parser emits (`channels` labels + `messages` count) plus event time spans — never message text.
 * A burst spanning multiple channels splits its volume evenly so no channel is over-credited.
 * Returns `null` when there is no chat signal so the caller can hide the panel.
 */
export function summarizeChatStakeholders(
  chatEvents: RawEvent[],
  options: { limit?: number } = {}
): ChatStakeholderSummary | null {
  const limit = Math.max(1, options.limit ?? DEFAULT_STAKEHOLDER_LIMIT);
  const groups = new Map<string, { label: string; weight: number; bursts: number }>();
  let totalMessages = 0;
  for (const event of chatEvents) {
    if (event.source_type !== "chat") continue;
    const start = new Date(event.timestamp_start).getTime();
    const end = new Date(event.timestamp_end).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue;
    // `metadata` is typed non-null, but events can arrive from untrusted persisted JSON —
    // fall back to an empty bag so a malformed record can't throw here.
    const metadata = event.metadata ?? {};
    const messages = metadataCount(metadata.messages);
    // A 0-message burst carries no reactive volume: its `perLabel` weight is 0 (so it never
    // credits a group's `share_pct`), and it must not count toward a group's `burst_count`
    // either — skip it so the per-group burst tally stays exact, mirroring the same-file
    // `analyzeInterruptionLoad` guard. Byte-identical on real/demo data (the importer always
    // emits `messages >= 1`); this only defends corrupt/hand-authored persisted JSON.
    if (messages === 0) continue;
    const labels = parseChannelLabels(metadata.channels);
    const targets = labels.length > 0 ? labels : [UNLABELED_STAKEHOLDER_GROUP];
    const perLabel = messages / targets.length;
    totalMessages += messages;
    for (const label of targets) {
      const existing = groups.get(label) ?? { label, weight: 0, bursts: 0 };
      existing.weight += perLabel;
      existing.bursts += 1;
      groups.set(label, existing);
    }
  }
  // No reactive message volume (no chat events, or only zero-message bursts) → nothing worth
  // ranking, so hide the panel rather than render a row of meaningless 0% chips.
  if (totalMessages === 0) return null;

  const ranked = [...groups.values()]
    .sort((left, right) => right.weight - left.weight || right.bursts - left.bursts || left.label.localeCompare(right.label))
    .map((group) => ({
      label: group.label,
      burst_count: group.bursts,
      share_pct: Math.round((group.weight / totalMessages) * 100)
    }));

  return {
    total_message_count: totalMessages,
    group_count: ranked.length,
    groups: ranked.slice(0, limit)
  };
}

export function generateWeeklyNarrative(
  snapshot: WeeklyCapacitySnapshot,
  baselines?: CapacityBaselines | null
): WeeklyNarrative {
  // Frame the headline + lead driver on whichever tracked allocation actually leads the week — not
  // a planned-vs-reactive binary. The old `reactive_pct > planned_pct * 0.7` test collapsed to
  // `reactive_pct > 0` whenever planned_pct was 0 (the calendar-only first-use path the empty
  // states steer users toward: every imported meeting is stamped `planned_status: "fixed"`, so
  // planned_pct is 0 and meeting_pct is high). That made a 0%-planned week either claim "planned
  // work remained the largest allocation" — with planned at 0% beside a full meeting bar on the
  // same Weekly screen — or, once any reactive slice appeared, assert reactive "displaced planned
  // analysis time" that never existed. Reactive leads only when it's at least the meeting share AND
  // clears the 0.7-of-planned bar (preserving the "reactive is catching up to planned" early
  // warning); otherwise a week whose meetings outweigh planned work is framed as meeting-led.
  const reactiveDominant =
    snapshot.reactive_pct > 0 &&
    snapshot.reactive_pct >= snapshot.meeting_pct &&
    snapshot.reactive_pct > snapshot.planned_pct * 0.7;
  const meetingDominant =
    !reactiveDominant && snapshot.meeting_pct > 0 && snapshot.meeting_pct > snapshot.planned_pct;
  // "Dense meetings": an absolute `>= 18%`-of-week cut fires for nearly everyone — collaboration is
  // ~85% of the modern work week, so 18% (~7.2h) is below most people's normal meeting load and the
  // flag cries wolf (see docs/heuristics-vs-research.md §4). When ≥2 prior weeks of history exist,
  // compare against the user's OWN rolling median instead, flagging the week only when its meeting
  // share runs meaningfully (≥25%) above that personal norm. Fall back to the absolute 18% when
  // there isn't enough history to have a personal baseline (< 2 prior weeks, or a null/zero median —
  // a zero median means the user normally has ~no meetings, so `> median * 1.25` collapses to `> 0`
  // and would flag any single short sync; the absolute cut is the honest test there).
  const meetingMedian =
    baselines && baselines.week_count >= 2 ? baselines.meeting_pct : null;
  const denseMeetings =
    meetingMedian !== null && meetingMedian > 0
      ? snapshot.meeting_pct > meetingMedian * 1.25
      : snapshot.meeting_pct >= 18;
  // Flag a fragmented week once the context-switch score crosses 0.45. Penalizing fragmentation is
  // well-grounded (collaboration is ~85% of the work week; sustained attention averages ~47s —
  // Mark 2023), and the model likely *under*-weights it; the exact 0.45 cut is hand-tuned, not
  // derived — see docs/heuristics-vs-research.md §3.
  const fragmented = snapshot.context_switch_score >= 0.45;
  const topDrivers = [
    reactiveDominant
      ? "Reactive work displaced planned analysis time"
      : meetingDominant
        ? "Meetings were the largest allocation this week"
        : "Planned work remained the largest allocation",
    denseMeetings ? "Meeting density consumed a material part of the week" : "Meetings stayed below the main risk threshold",
    fragmented ? "Frequent context switches reduced reliable delivery capacity" : "Deep-work windows were relatively protected"
  ];

  const headline = reactiveDominant
    ? "Urgent requests shaped this week's priorities."
    : meetingDominant
      ? "Meetings took priority alongside core project work."
      : "Core project work moved forward this week.";

  // `committed_utilization_pct` is an unbounded sum of penalties, so a busy week can land at or
  // past the ~80% utilization knee — and there `reliable_new_work_capacity_pct` clamps to 0. The
  // headroom copy must respect that boundary rather than always promising the week stays "near the
  // knee where reliability holds" (it doesn't — the user is over it). Branch both clauses on the
  // same threshold the clamp uses, mirroring the Weekly "Reliable new work" card's past/room
  // wording, and interpolate `TARGET_UTILIZATION_PCT` so the prose and the clamp can't drift.
  const overKnee = snapshot.committed_utilization_pct >= TARGET_UTILIZATION_PCT;
  const reliabilityClause = overKnee
    ? `reliable new-work capacity is estimated at ${snapshot.reliable_new_work_capacity_pct}% — already past the ~${TARGET_UTILIZATION_PCT}% utilization knee where delivery reliability degrades`
    : `reliable new-work capacity is estimated at ${snapshot.reliable_new_work_capacity_pct}% — enough to stay near the ~${TARGET_UTILIZATION_PCT}% utilization knee where delivery reliability holds`;
  return {
    week_id: snapshot.week_id,
    headline,
    summary_text: `Estimated allocation reached ${snapshot.allocated_pct}% of a standard ${WEEKLY_BASELINE_HOURS}-hour week. Planned work accounted for ${snapshot.planned_pct}%, reactive work for ${snapshot.reactive_pct}%, and meetings for ${snapshot.meeting_pct}%. About ${snapshot.committed_utilization_pct}% of next week is already committed (recurring work, carryover, reactive load and fragmentation), so ${reliabilityClause}.`,
    key_drivers: topDrivers,
    manager_ready_summary: overKnee
      ? "I kept my core priorities moving this week while also handling several interruptions and recurring commitments. Those demands left less uninterrupted time than planned, and I am carrying some work into next week. My immediate focus is finishing those commitments before I take on another substantial project."
      : "I kept my core priorities moving this week while balancing a few interruptions and recurring commitments. I made steady progress on the work already in flight and still have some room for an additional focused priority next week. I will protect time for the current deliverables and flag early if new requests begin to compete with them."
  };
}
