import type {
  AccelerationPlayType,
  AccelerationSignal,
  ActivitySession,
  OutlookCalendarEvent,
  WorkBlock,
  WorkCategory
} from "../../domain/src/models";
import type { InterruptionLoadAnalysis } from "./capacity";
import { CORE_HOURS_END, CORE_HOURS_START, normalizeWeekId } from "./capacity";

/**
 * Deterministic Acceleration miner — turns observed work into evidence-cited
 * AccelerationSignal[] with no AI and no network. Privacy: it reads ActivitySession,
 * WorkBlock, and calendar-event fields but emits derived labels only — app names,
 * assigned project names, work categories, counts, durations, recurrence, and
 * day-of-week — NEVER raw window titles or calendar event titles/bodies.
 */

const MIN_SEQUENCE_LENGTH = 2;
const MAX_SEQUENCE_LENGTH = 3;
/** A sequence must recur at least this many times to be worth surfacing. */
const MIN_RECURRENCES = 3;
/**
 * Conservative share of the observed repeated minutes that automating the handoff
 * could realistically reclaim. Deliberately low — automation rarely eliminates 100%
 * of the manual time, and the estimate feeds a user-reviewed planning aid. The
 * observed window is treated as a representative week, matching the rest of the
 * deterministic model's current-week scoping.
 */
const SAVINGS_FRACTION = 0.25;

/**
 * A standard 40h analyst week in minutes — the denominator `estimated_capacity_pct` is
 * expressed against (see integrations' `capacityPctFromSpan`). Kept as a local const because
 * the inference layer must NOT import from `apps/desktop` or the integrations package; mirror
 * a change here if the baseline ever moves.
 */
const WEEKLY_BASELINE_MINUTES = 40 * 60;

/** A category is "recurring" once it has been observed at least this many times in the week. */
const MIN_TIMESINK_BLOCKS = MIN_RECURRENCES;

/** An hour-of-day needs at least this many app switches to be worth flagging as a hotspot. */
const MIN_HOTSPOT_SWITCHES = MIN_RECURRENCES;

/**
 * An hour is a "hotspot" only when its switch count is at least this multiple of the average
 * switches across the user's active hours — i.e. switching is genuinely *concentrated* there,
 * not evenly spread through the day. (A day with only one active switching hour is treated as
 * concentrated by definition.)
 */
const HOTSPOT_CONCENTRATION_FACTOR = 1.5;

/**
 * Conservative reclaimable refocus minutes per avoided app switch. The cost of a context switch
 * is well-grounded — Mark et al. (CHI 2008) measured ~23 min to fully return to an interrupted
 * task — but batching never eliminates every switch and not every switch is a deep interruption,
 * so this is set deliberately well below that figure for a user-reviewed planning aid.
 */
const REFOCUS_MINUTES_PER_SWITCH = 3;

/**
 * Categories where an off-the-shelf tool or template has the most leverage: repetitive,
 * low-craft work that is rarely deep-focus output. Membership (not order) gates a `tool`
 * signal; the favored set comes straight from the B2 spec.
 */
const TOOLABLE_CATEGORIES: ReadonlySet<WorkCategory> = new Set<WorkCategory>([
  "Recurring reporting",
  "Admin / coordination",
  "SQL / data modeling / query work",
  "Dashboard development / edits"
]);

/** Djb2 — stable, deterministic id seed (mirrors the sessionizer's local helper). */
function stableHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Finite epoch-ms for ordering, or NEGATIVE_INFINITY for a malformed time (per the
 * Number.isFinite convention — NOT `?? 0`, which does not catch NaN). Invalid times
 * sort oldest-first so they never displace a real ordering.
 */
function comparableStartMs(iso: string) {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function finiteMinutes(value: number) {
  return Number.isFinite(value) ? value : 0;
}

/** Convert a block's `estimated_capacity_pct` (% of the week) back into minutes. */
function minutesFromCapacityPct(pct: number) {
  return (finiteMinutes(pct) / 100) * WEEKLY_BASELINE_MINUTES;
}

/** Local hour-of-day (0–23) for an ISO timestamp, or null when it is unparseable. */
function localHourOfDay(iso: string): number | null {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.getHours() : null;
}

/** A 12-hour clock label for an hour bucket, e.g. 0 → "12am", 14 → "2pm". */
function hourLabel(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;
  const meridiem = normalized < 12 ? "am" : "pm";
  const twelve = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${twelve}${meridiem}`;
}

/** A one-hour window label, e.g. 14 → "2pm–3pm". */
function hourWindowLabel(hour: number) {
  return `${hourLabel(hour)}–${hourLabel(hour + 1)}`;
}

/** The project_name accounting for the most minutes in a tally, or null when none is set. */
function dominantProject(projects: Map<string, number>) {
  let best: string | null = null;
  let bestMinutes = 0;
  for (const [project, minutes] of projects) {
    if (minutes > bestMinutes) {
      best = project;
      bestMinutes = minutes;
    }
  }
  return best;
}

interface SequenceTally {
  apps: string[];
  count: number;
  sessionIndices: Set<number>;
}

/**
 * Detect app-sequence n-grams (length 2–3) that recur ≥3 times across the user's
 * observed sessions and emit one `automate` signal per recurring sequence. An n-gram window is
 * only counted when all its sessions fall on the SAME local day — a window straddling a day
 * boundary is an overnight/off-hours gap, not one continuous workflow handoff. Pure;
 * dedup/ranking across detectors is the aggregator's job (B4).
 */
export function detectRepetitiveSequences(sessions: ActivitySession[]): AccelerationSignal[] {
  const ordered = [...sessions].sort((left, right) => {
    const leftMs = comparableStartMs(left.start_time);
    const rightMs = comparableStartMs(right.start_time);
    return leftMs === rightMs ? 0 : rightMs > leftMs ? -1 : 1;
  });

  const signals: AccelerationSignal[] = [];

  for (let length = MIN_SEQUENCE_LENGTH; length <= MAX_SEQUENCE_LENGTH; length += 1) {
    const tallies = new Map<string, SequenceTally>();

    for (let start = 0; start + length <= ordered.length; start += 1) {
      const window = ordered.slice(start, start + length);
      const apps = window.map((session) => session.app_name);
      // A run of the same app is not a workflow transition — only count real handoffs.
      if (apps.every((app) => app === apps[0])) {
        continue;
      }

      // A window that straddles a day boundary is not one continuous workflow — the gap between
      // the last session of one day and the first of the next (an overnight/off-hours gap) is not a
      // handoff, so an n-gram spanning it would invent a cross-day "workflow" that never happened.
      // Only count windows whose sessions all fall on the same local day. An unparseable time
      // (`localDateKey` → null) can't be confirmed same-day, so the window is skipped.
      const windowDay = localDateKey(window[0].start_time);
      if (windowDay === null || window.some((session) => localDateKey(session.start_time) !== windowDay)) {
        continue;
      }

      const key = apps.join(" → ");
      let tally = tallies.get(key);
      if (!tally) {
        tally = { apps, count: 0, sessionIndices: new Set() };
        tallies.set(key, tally);
      }
      tally.count += 1;
      for (let offset = 0; offset < length; offset += 1) {
        tally.sessionIndices.add(start + offset);
      }
    }

    for (const tally of tallies.values()) {
      if (tally.count < MIN_RECURRENCES) {
        continue;
      }

      const involvedSessions = [...tally.sessionIndices].map((index) => ordered[index]);
      const repeatedMinutes = involvedSessions.reduce(
        (total, session) => total + finiteMinutes(session.duration_minutes),
        0
      );
      const estimatedSaved = Math.round(SAVINGS_FRACTION * repeatedMinutes);
      const flow = tally.apps.join(" → ");
      const confidence = Math.min(0.95, 0.5 + (tally.count - MIN_RECURRENCES) * 0.1);

      signals.push({
        signal_id: `automate-${stableHash(`seq:${flow}`)}`,
        type: "automate",
        title: `Repeating workflow: ${flow}`,
        detail: `You moved through ${flow} ${tally.count} times. Automating this handoff could reclaim about ${estimatedSaved} min/week.`,
        evidence: [
          `${flow} observed ${tally.count} times`,
          `${involvedSessions.length} sessions totaling ${Math.round(repeatedMinutes)} min of repeated work`,
          `Estimate reclaims ~${Math.round(SAVINGS_FRACTION * 100)}% of that time once automated`
        ],
        estimated_minutes_saved_per_week: estimatedSaved,
        confidence: Number(confidence.toFixed(2)),
        derived_from: involvedSessions.map((session) => session.session_id)
      });
    }
  }

  return signals;
}

interface CategoryTally {
  category: WorkCategory;
  blockCount: number;
  totalMinutes: number;
  /** Minutes in blocks the user did NOT mark as deep work — the tool-able portion. */
  lowDeepMinutes: number;
  blockIds: string[];
  /** project_name → minutes, so the signal can cite where the time concentrates. */
  projects: Map<string, number>;
}

/**
 * Detect recurring, low-deep-work time-sinks from the user's reviewed WorkBlocks and emit one
 * `tool` signal per tool-able category that is both recurring (≥3 blocks) and dominated by
 * non-deep work. Evidence cites the category, hours/week, the non-deep share, and the dominant
 * project — derived labels and counts only, never window titles. Pure; dedup/ranking across
 * detectors is the aggregator's job (B4).
 *
 * `sessions` is accepted for parity with the other detectors' signatures (B4 fans the same
 * inputs across B1–B3); this miner works from the reviewed blocks, which already carry the
 * category/mode/capacity labels it needs.
 */
export function detectTimeSinks(
  blocks: WorkBlock[],
  sessions: ActivitySession[]
): AccelerationSignal[] {
  void sessions;

  const tallies = new Map<WorkCategory, CategoryTally>();

  for (const block of blocks) {
    if (!TOOLABLE_CATEGORIES.has(block.category)) {
      continue;
    }

    const minutes = minutesFromCapacityPct(block.estimated_capacity_pct);

    let tally = tallies.get(block.category);
    if (!tally) {
      tally = {
        category: block.category,
        blockCount: 0,
        totalMinutes: 0,
        lowDeepMinutes: 0,
        blockIds: [],
        projects: new Map()
      };
      tallies.set(block.category, tally);
    }

    tally.blockCount += 1;
    tally.totalMinutes += minutes;
    if (block.mode !== "Deep work") {
      tally.lowDeepMinutes += minutes;
    }
    tally.blockIds.push(block.work_block_id);
    if (block.project_name) {
      tally.projects.set(block.project_name, (tally.projects.get(block.project_name) ?? 0) + minutes);
    }
  }

  const signals: AccelerationSignal[] = [];

  for (const tally of tallies.values()) {
    // Recurring (observed ≥3 times) AND dominated by non-deep work — the tool-able profile.
    if (tally.blockCount < MIN_TIMESINK_BLOCKS || tally.lowDeepMinutes <= 0) {
      continue;
    }

    const estimatedSaved = Math.round(SAVINGS_FRACTION * tally.lowDeepMinutes);
    if (estimatedSaved <= 0) {
      continue;
    }

    // totalMinutes > 0 here because lowDeepMinutes > 0, so the share denominator is safe.
    const hoursPerWeek = tally.totalMinutes / 60;
    const lowDeepShare = tally.lowDeepMinutes / tally.totalMinutes;
    const confidence = Math.min(
      0.9,
      0.5 + (tally.blockCount - MIN_TIMESINK_BLOCKS) * 0.08 + lowDeepShare * 0.1
    );

    const evidence = [
      `${tally.category} took about ${hoursPerWeek.toFixed(1)}h across ${tally.blockCount} blocks`,
      `${Math.round(lowDeepShare * 100)}% of that time was outside deep work — repetitive, tool-able effort`,
      `Recurring: observed ${tally.blockCount} times (≥${MIN_TIMESINK_BLOCKS} marks a recurring pattern)`
    ];
    const topProject = dominantProject(tally.projects);
    if (topProject) {
      evidence.push(`Most of it sits in "${topProject}"`);
    }

    signals.push({
      signal_id: `tool-${stableHash(`timesink:${tally.category}`)}`,
      type: "tool",
      title: `Time sink: ${tally.category}`,
      detail: `${tally.category} is taking about ${hoursPerWeek.toFixed(1)}h/week, mostly outside deep work. A purpose-built tool or template could reclaim roughly ${estimatedSaved} min/week.`,
      evidence,
      estimated_minutes_saved_per_week: estimatedSaved,
      confidence: Number(confidence.toFixed(2)),
      derived_from: tally.blockIds
    });
  }

  // Sensible standalone ordering (B4 re-ranks): biggest reclaimable time first, id as tie-break.
  signals.sort((left, right) => {
    if (left.estimated_minutes_saved_per_week !== right.estimated_minutes_saved_per_week) {
      return right.estimated_minutes_saved_per_week - left.estimated_minutes_saved_per_week;
    }
    return left.signal_id < right.signal_id ? -1 : left.signal_id > right.signal_id ? 1 : 0;
  });

  return signals;
}

interface HourSwitchTally {
  hour: number;
  count: number;
  /** session_ids on either side of a switch bucketed to this hour — the cited evidence. */
  sessionIds: Set<string>;
}

/**
 * Detect hours-of-day where app switching is concentrated and emit one `technique` signal per
 * hotspot, with a batching/focus angle in `detail`. A "switch" is a handoff between consecutive
 * SAME-DAY sessions whose `app_name` changes (an overnight/cross-day gap is not a handoff, so those
 * pairs are excluded) — the same notion of a real handoff `detectRepetitiveSequences`
 * uses, and the session-level analog of the block-mode fragmentation that drives `context_switch_score`
 * in `capacity.ts` (both treat reactive app-hopping as the fragmentation cost, so the two agree).
 * Switches are bucketed by the local hour the user switched *into* the new app. Pure; dedup/ranking
 * across detectors is the aggregator's job (B4).
 *
 * Privacy: reads `ActivitySession` fields but evidence carries app-switch counts, an hour window,
 * and a share percentage only — never window titles.
 */
export function detectContextSwitchHotspots(sessions: ActivitySession[]): AccelerationSignal[] {
  const ordered = [...sessions].sort((left, right) => {
    const leftMs = comparableStartMs(left.start_time);
    const rightMs = comparableStartMs(right.start_time);
    return leftMs === rightMs ? 0 : rightMs > leftMs ? -1 : 1;
  });

  const tallies = new Map<number, HourSwitchTally>();
  let totalSwitches = 0;

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous.app_name === current.app_name) {
      continue;
    }

    // A day boundary is not a real handoff: the last session of one day and the first of the next
    // are separated by hours (an overnight/off-hours gap), so counting that pair as an app "switch"
    // — and bucketing it into the next morning's start hour — fabricates a transition that never
    // happened. Only same-local-day pairs are genuine switches. `localDateKey` returns null on an
    // unparseable time, which can't be confirmed same-day, so that pair is skipped.
    const previousDay = localDateKey(previous.start_time);
    if (previousDay === null || previousDay !== localDateKey(current.start_time)) {
      continue;
    }

    // Bucket by the hour the user switched into the new app; an unparseable time can't be placed.
    const hour = localHourOfDay(current.start_time);
    if (hour === null) {
      continue;
    }

    let tally = tallies.get(hour);
    if (!tally) {
      tally = { hour, count: 0, sessionIds: new Set() };
      tallies.set(hour, tally);
    }
    tally.count += 1;
    tally.sessionIds.add(previous.session_id);
    tally.sessionIds.add(current.session_id);
    totalSwitches += 1;
  }

  if (totalSwitches === 0) {
    return [];
  }

  const activeHours = tallies.size;
  const meanPerActiveHour = totalSwitches / activeHours;
  const signals: AccelerationSignal[] = [];

  for (const tally of tallies.values()) {
    const concentrated =
      activeHours <= 1 || tally.count >= meanPerActiveHour * HOTSPOT_CONCENTRATION_FACTOR;
    if (tally.count < MIN_HOTSPOT_SWITCHES || !concentrated) {
      continue;
    }

    const estimatedSaved = Math.round(REFOCUS_MINUTES_PER_SWITCH * tally.count);
    if (estimatedSaved <= 0) {
      continue;
    }

    const timeWindow = hourWindowLabel(tally.hour);
    const share = tally.count / totalSwitches;
    const sharePct = Math.max(1, Math.round(share * 100));
    const confidence = Math.min(0.9, 0.5 + (tally.count - MIN_HOTSPOT_SWITCHES) * 0.05 + share * 0.1);

    signals.push({
      signal_id: `technique-${stableHash(`hotspot:${tally.hour}`)}`,
      type: "technique",
      title: `Context-switch hotspot: ${timeWindow}`,
      detail: `You switch apps most around ${timeWindow} — about ${tally.count} switches there. Batching similar work into one block, or guarding ${timeWindow} for focused work, cuts the refocus tax of jumping between tools.`,
      evidence: [
        `${tally.count} app switches concentrated in ${timeWindow}`,
        `${sharePct}% of the week's ${totalSwitches} observed app switches happen then`,
        `Each avoided switch reclaims ~${REFOCUS_MINUTES_PER_SWITCH} min of refocus time`
      ],
      estimated_minutes_saved_per_week: estimatedSaved,
      confidence: Number(confidence.toFixed(2)),
      derived_from: [...tally.sessionIds]
    });
  }

  // Sensible standalone ordering (B4 re-ranks): busiest switching hour first, id as tie-break.
  signals.sort((left, right) => {
    if (left.estimated_minutes_saved_per_week !== right.estimated_minutes_saved_per_week) {
      return right.estimated_minutes_saved_per_week - left.estimated_minutes_saved_per_week;
    }
    return left.signal_id < right.signal_id ? -1 : left.signal_id > right.signal_id ? 1 : 0;
  });

  return signals;
}

/**
 * Reactive comms are realistically serviceable in a couple of set windows a day; every reactive
 * burst BEYOND that is a discrete interruption whose refocus tax batching could reclaim. Anchoring
 * the estimate to interruption COUNT (not raw chat duration) is deliberate: a single long, low-volume
 * chat window is already "batched" and shouldn't score, while overlapping bursts can't inflate a
 * count the way summed wall-durations can. Hand-set to a small number of focused windows.
 */
const REACTIVE_BATCH_WINDOWS = 2;

/** Reactive load needs at least this many messages in the window to be worth a Play (vs. noise). */
const MIN_REACTIVE_MESSAGES = MIN_RECURRENCES;

/**
 * Detect a chat-driven reactive load worth batching and emit one `technique` Play — "batch reactive
 * comms into set windows", with a focus-guard angle when the load has a clear time-of-day peak. Reads
 * the pre-computed `InterruptionLoadAnalysis` (from `analyzeInterruptionLoad` in `capacity.ts`), so it
 * adds near-zero new inference and stays in lockstep with the Weekly interruption panel the user
 * already sees.
 *
 * The reclaimable estimate is the refocus tax of the reactive bursts beyond a couple of set windows:
 * `REFOCUS_MINUTES_PER_SWITCH × max(0, burst_count − REACTIVE_BATCH_WINDOWS)`, reusing the SAME
 * Mark-et-al.-grounded per-interruption constant `detectContextSwitchHotspots` prices app switches at,
 * so both `technique` detectors share one refocus model. Keying it to burst COUNT (not `active_hours`)
 * means a single long low-message window — already effectively batched — doesn't over-claim, and
 * overlapping bursts can't double-count wall time. As a `technique` its estimate IS the reclaimable
 * minutes, so it scores against the E3 realized-savings machinery with a capture fraction of 1.
 *
 * Privacy: the analysis carries metadata-only figures (message/burst/mention counts, active hours,
 * and time-of-day/percentage stats) — never message text — so the evidence stays derived-only. Pure;
 * dedup/ranking across detectors is the aggregator's job. Returns [] when there is no chat signal, the
 * message volume is below the noise floor, or there aren't enough bursts beyond the batch windows to
 * reclaim anything.
 */
export function detectReactiveLoad(
  analysis: InterruptionLoadAnalysis | null | undefined
): AccelerationSignal[] {
  if (!analysis) {
    return [];
  }

  const messageCount = analysis.message_count;
  // Each reactive burst is a discrete interruption; batching leaves ~REACTIVE_BATCH_WINDOWS check-ins
  // and consolidates the rest. The reclaimable refocus tax therefore scales with the interruptions
  // BEYOND those windows — not raw chat duration or message volume.
  const avoidedInterruptions = Math.max(0, analysis.burst_count - REACTIVE_BATCH_WINDOWS);
  const estimatedSaved = REFOCUS_MINUTES_PER_SWITCH * avoidedInterruptions;
  if (messageCount < MIN_REACTIVE_MESSAGES || estimatedSaved <= 0) {
    return [];
  }

  // Confidence rises with reactive volume, then with the sharper interruption cues: direct
  // @-mentions and after-hours bleed are aimed at the user / bleed into personal time, so they're
  // harder to batch away and make a load a more certain candidate for windowing.
  const volumeBoost = Math.min(0.2, (messageCount - MIN_REACTIVE_MESSAGES) * 0.01);
  const sharpnessBoost = (analysis.mention_pct / 100) * 0.1 + (analysis.after_hours_pct / 100) * 0.1;
  const confidence = Math.min(0.85, 0.5 + volumeBoost + sharpnessBoost);

  // `peak_hour` is non-null exactly when `peak_day` is (see analyzeInterruptionLoad). The peak window
  // is cited in evidence whatever the hour, but the "guard it for focused work" suggestion is offered
  // ONLY when the peak falls inside core hours — advising the user to protect an after-hours slot for
  // deep work would contradict the after-hours-bleed concern this same Play surfaces. The core-hours
  // boundary is imported from capacity.ts (the same CORE_HOURS_START/END that analyzeInterruptionLoad
  // attributes after-hours volume against) so the two can never drift into a self-contradicting Play.
  const peakHour = analysis.peak_hour;
  const peakWindow = peakHour !== null ? hourWindowLabel(peakHour) : null;
  const peakInCoreHours =
    peakHour !== null && peakHour >= CORE_HOURS_START && peakHour < CORE_HOURS_END;
  const guardSuggestion =
    peakInCoreHours && peakWindow ? ` and guarding ${peakWindow} for focused work` : "";
  const hoursLabel = analysis.active_hours.toFixed(1);

  const evidence: string[] = [
    `${analysis.burst_count} separate reactive chat bursts (${messageCount} messages across ${hoursLabel}h)`
  ];
  if (peakWindow) {
    evidence.push(
      analysis.peak_day
        ? `Reactive volume peaked around ${peakWindow} on ${analysis.peak_day}`
        : `Reactive volume peaked around ${peakWindow}`
    );
  }
  if (analysis.mention_pct > 0) {
    evidence.push(`${analysis.mention_pct}% were direct @-mentions aimed at you by name`);
  }
  if (analysis.after_hours_pct > 0) {
    // Boundary derived from the same CORE_HOURS_START/END the after-hours share is computed against
    // (via the in-file hourLabel), so the copy can't drift into a lie if the window ever moves —
    // the anti-hardcoded-literal rule capacity.ts:529 documents for the Weekly note. hourLabel(8) →
    // "8am", hourLabel(18) → "6pm", so this stays byte-identical today.
    evidence.push(
      `${analysis.after_hours_pct}% landed after hours (before ${hourLabel(CORE_HOURS_START)} / at or after ${hourLabel(CORE_HOURS_END)})`
    );
  }
  evidence.push(
    `Batching into ${REACTIVE_BATCH_WINDOWS} set windows consolidates ~${avoidedInterruptions} of those interruptions, each ~${REFOCUS_MINUTES_PER_SWITCH} min of refocus`
  );

  return [
    {
      // Stable id (one reactive-load Play per week) so E2 recurrence + E3 track record can follow it.
      signal_id: `technique-${stableHash("reactive-load")}`,
      type: "technique",
      title: "Batch reactive comms into set windows",
      detail: `You were pulled into ${analysis.burst_count} separate reactive chat bursts (${messageCount} messages). Batching replies into ${REACTIVE_BATCH_WINDOWS} set windows${guardSuggestion} could reclaim about ${estimatedSaved} min/week of refocus time.`,
      evidence,
      estimated_minutes_saved_per_week: estimatedSaved,
      confidence: Number(confidence.toFixed(2)),
      // Derived from aggregate reactive metadata, not enumerable per-item source ids — the evidence
      // lines above carry the (metadata-only) provenance.
      derived_from: []
    }
  ];
}

/** A meeting title must recur at least this many times in the observed week to count as recurring. */
const MIN_MEETING_RECURRENCES = MIN_RECURRENCES;

/**
 * Two consecutive meetings on the same day separated by less than this many minutes leave no real
 * focus window between them — a back-to-back transition whose refocus tax protecting a block reclaims.
 */
const MEETING_FOCUS_GAP_MINUTES = 30;

/** A day needs at least this many back-to-back transitions before a focus-guard Play is worth it. */
const MIN_BACK_TO_BACK_TRANSITIONS = 2;

/** Whole minutes between two ISO timestamps, or 0 when either is unparseable or non-positive. */
function eventMinutes(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return (end - start) / 60_000;
}

/** Normalize a meeting title for recurrence grouping: trimmed, lower-cased, whitespace-collapsed. */
function normalizeMeetingTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

/** Local weekday name for an ISO timestamp, or null when it is unparseable. */
function weekdayLabel(iso: string): string | null {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? WEEKDAY_LABELS[date.getDay()] : null;
}

/** Local calendar-day key (YYYY-MM-DD) for grouping events by day, or null when unparseable. */
function localDateKey(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface MeetingSeries {
  /**
   * Normalized grouping key (lower-cased title) — used ONLY to derive a stable, non-leaking
   * signal id via `stableHash`; the raw title is never emitted into a signal's user-visible fields.
   */
  key: string;
  count: number;
  totalMinutes: number;
  attendeeSum: number;
  /** Distinct local weekdays the series lands on — a derived, title-free recurrence label. */
  weekdays: Set<string>;
}

interface MeetingDay {
  label: string;
  intervals: { start: number; end: number }[];
}

/**
 * Detect meeting load from imported calendar events — the single largest reclaimable sink for analysts,
 * and the one input the other three miners never see. Emits `technique` Plays for (1) recurring meetings
 * (same title observed ≥ MIN_MEETING_RECURRENCES times — an async-update candidate) and (2) a day whose
 * meetings stack back-to-back with no real focus gap (protect a focus block). Pure; dedup/ranking across
 * detectors is the aggregator's job.
 *
 * Estimate model (both `technique`, so the estimate IS the reclaimable minutes — capture fraction 1 in
 * the E3 track record): the recurring-meeting Play reclaims the conservative shared `SAVINGS_FRACTION` of
 * the series' time (an async equivalent still costs some reading/writing), while the focus-guard Play
 * reclaims the refocus tax of the back-to-back transitions using the SAME Mark-et-al.-grounded
 * `REFOCUS_MINUTES_PER_SWITCH` the other refocus detectors price a switch at. Meeting refocus is a
 * distinct friction source from app-switch hotspots (sessions) and reactive-chat bursts (chat), so it is
 * never cross-deduped against them — like the other `technique` detectors, its minutes sum into the
 * "est. saved/week" headline as a conservative planning aid, not a guarantee.
 *
 * Privacy: reads meeting metadata (title, times, attendee count) — the title is used ONLY to group a
 * recurring series and to hash a stable signal id — and emits counts / durations / recurrence /
 * day-of-week only, never the event title or body. Plays are mined from aggregate meeting metadata,
 * so `derived_from` is [] (the evidence lines carry the metadata-only provenance), matching the E4
 * reactive-load Play.
 */
export function detectMeetingLoad(events: OutlookCalendarEvent[]): AccelerationSignal[] {
  // All-day events (PTO/OOO/holidays, RFC 5545 VALUE=DATE) span 24h+ of wall-clock but are NOT
  // meetings — counting their raw `end - start` span would fabricate a huge "recurring meeting"
  // (a week of all-day PTO reads as ~120h to make async) and, because an all-day interval sorts
  // first and covers the whole day, spuriously register every real meeting that day as a
  // back-to-back "tight transition". Skip them for BOTH detectors here, mirroring the capacity
  // path (`capacityPctFromEvent`), the `getCalendarSummary` agent tool, and App.tsx's
  // proactive-alert guard (`if (event.all_day) continue;`).
  const meetings = events.filter((event) => !event.all_day);
  if (meetings.length === 0) {
    return [];
  }

  const signals: AccelerationSignal[] = [];

  // --- Recurring meetings: same title observed ≥ MIN_MEETING_RECURRENCES times → an async candidate.
  const series = new Map<string, MeetingSeries>();
  for (const event of meetings) {
    const key = normalizeMeetingTitle(event.title);
    if (!key) {
      continue;
    }
    let group = series.get(key);
    if (!group) {
      group = { key, count: 0, totalMinutes: 0, attendeeSum: 0, weekdays: new Set() };
      series.set(key, group);
    }
    group.count += 1;
    group.totalMinutes += eventMinutes(event.start_time, event.end_time);
    group.attendeeSum += Number.isFinite(event.attendee_count) ? Math.max(0, event.attendee_count) : 0;
    const day = weekdayLabel(event.start_time);
    if (day) {
      group.weekdays.add(day);
    }
  }

  for (const group of series.values()) {
    if (group.count < MIN_MEETING_RECURRENCES || group.totalMinutes <= 0) {
      continue;
    }
    // Priced with the automate/tool capture FORMULA (SAVINGS_FRACTION × minutes), but this is a
    // `technique` scored at capture fraction 1 in the E3 track record (see `captureFraction`): the 25%
    // product already IS the reclaimable time — an async replacement keeps ~75% as residual work — so
    // the play tops out at "met" and must NOT be inverted by SAVINGS_FRACTION when scoring realized savings.
    const estimatedSaved = Math.round(SAVINGS_FRACTION * group.totalMinutes);
    if (estimatedSaved <= 0) {
      continue;
    }
    const hoursPerWeek = group.totalMinutes / 60;
    const avgMinutes = Math.round(group.totalMinutes / group.count);
    const avgAttendees = Math.round(group.attendeeSum / group.count);
    const confidence = Math.min(0.9, 0.5 + (group.count - MIN_MEETING_RECURRENCES) * 0.1);

    // Title-free recurrence label derived from the days the series lands on (privacy: never the
    // calendar title itself — see the module + function docstrings).
    const weekdays = [...group.weekdays];
    const dayLabel =
      weekdays.length === 1
        ? `every ${weekdays[0]}`
        : weekdays.length > 1
          ? `across ${weekdays.length} weekdays`
          : "";
    const daySuffix = dayLabel ? `, ${dayLabel}` : "";

    const evidence = [
      `A recurring meeting ran ${group.count} times this week (${hoursPerWeek.toFixed(1)}h total, ~${avgMinutes} min each${daySuffix})`,
      avgAttendees > 0
        ? `About ${avgAttendees} attendee${avgAttendees === 1 ? "" : "s"} per instance`
        : "Recurring calendar series",
      `Moving it to an async update could reclaim ~${Math.round(SAVINGS_FRACTION * 100)}% of that time`
    ];

    signals.push({
      signal_id: `technique-${stableHash(`meeting-recurring:${group.key}`)}`,
      type: "technique",
      title: `Recurring meeting (${group.count}× this week)`,
      detail: `A ~${avgMinutes}-min meeting recurred ${group.count} times this week (~${hoursPerWeek.toFixed(1)}h total${daySuffix}). Making it an async update — a status thread or a recorded summary — could reclaim about ${estimatedSaved} min/week.`,
      evidence,
      estimated_minutes_saved_per_week: estimatedSaved,
      confidence: Number(confidence.toFixed(2)),
      // Mined from aggregate meeting metadata, not enumerable per-item source ids — the evidence
      // lines above carry the (metadata-only) provenance.
      derived_from: []
    });
  }

  // --- Back-to-back stacks: the day with the most tight meeting transitions → protect a focus block.
  const days = new Map<string, MeetingDay>();
  for (const event of meetings) {
    const start = new Date(event.start_time).getTime();
    const end = new Date(event.end_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    const key = localDateKey(event.start_time);
    const label = weekdayLabel(event.start_time);
    if (!key || !label) {
      continue;
    }
    let day = days.get(key);
    if (!day) {
      day = { label, intervals: [] };
      days.set(key, day);
    }
    day.intervals.push({ start, end });
  }

  let totalTightTransitions = 0;
  let busiestDayLabel: string | null = null;
  let busiestDayTransitions = 0;
  for (const day of days.values()) {
    const sorted = [...day.intervals].sort((left, right) => left.start - right.start);
    let tight = 0;
    // Measure each meeting's gap against the running MAX end of all preceding meetings that day, not
    // just the immediate predecessor-by-start's end. On a day with overlapping/nested meetings — a
    // double-booking, or short syncs inside a longer "hold"/workshop block (both reach here since only
    // all-day events are filtered above) — the predecessor-by-start can be a short meeting nested inside
    // an earlier, longer one, whose earlier `.end` inflates the computed gap and makes a genuinely tight
    // transition read as real focus time (undercounting `tight`). `busyUntil` is the instant the user is
    // actually free next. Byte-identical for a day of disjoint meetings (their ends are already monotonic
    // by start, so `busyUntil === sorted[index - 1].end`), so only overlapping days change — same
    // interval-union reasoning as `analyzeInterruptionLoad`'s active-hours merge in capacity.ts.
    let busyUntil = sorted[0].end;
    for (let index = 1; index < sorted.length; index += 1) {
      const gapMinutes = (sorted[index].start - busyUntil) / 60_000;
      if (gapMinutes < MEETING_FOCUS_GAP_MINUTES) {
        tight += 1;
      }
      busyUntil = Math.max(busyUntil, sorted[index].end);
    }
    totalTightTransitions += tight;
    if (tight > busiestDayTransitions) {
      busiestDayTransitions = tight;
      busiestDayLabel = day.label;
    }
  }

  if (busiestDayLabel && busiestDayTransitions >= MIN_BACK_TO_BACK_TRANSITIONS) {
    const estimatedSaved = REFOCUS_MINUTES_PER_SWITCH * totalTightTransitions;
    if (estimatedSaved > 0) {
      const confidence = Math.min(
        0.85,
        0.5 + (busiestDayTransitions - MIN_BACK_TO_BACK_TRANSITIONS) * 0.1
      );
      signals.push({
        // Stable id (one focus-guard Play per week) so E2 recurrence + E3 track record can follow it.
        signal_id: `technique-${stableHash("meeting-focus-guard")}`,
        type: "technique",
        title: `Protect a focus block on ${busiestDayLabel}`,
        detail: `${busiestDayLabel} has ${busiestDayTransitions} back-to-back meeting transitions with no real focus gap between them. Blocking a protected focus window — and shortening or declining one adjacent meeting — reclaims the refocus tax of jumping straight from one meeting into the next.`,
        evidence: [
          `${busiestDayTransitions} back-to-back meeting transitions on ${busiestDayLabel} (gaps under ${MEETING_FOCUS_GAP_MINUTES} min)`,
          `${totalTightTransitions} such tight transitions across the week`,
          `Each avoided back-to-back reclaims ~${REFOCUS_MINUTES_PER_SWITCH} min of refocus time`
        ],
        estimated_minutes_saved_per_week: estimatedSaved,
        confidence: Number(confidence.toFixed(2)),
        derived_from: []
      });
    }
  }

  // Sensible standalone ordering (aggregator re-ranks): biggest reclaimable time first, id as tie-break.
  signals.sort((left, right) => {
    if (left.estimated_minutes_saved_per_week !== right.estimated_minutes_saved_per_week) {
      return right.estimated_minutes_saved_per_week - left.estimated_minutes_saved_per_week;
    }
    return left.signal_id < right.signal_id ? -1 : left.signal_id > right.signal_id ? 1 : 0;
  });

  return signals;
}

/** Cap the surfaced Plays to a focused, reviewable set — the highest-leverage signals only. */
const MAX_ACCELERATION_SIGNALS = 6;
/** Minimum reclaimable estimate for a Play to surface; lower values are too noisy to act on. */
export const MIN_ACCELERATION_MINUTES_SAVED_PER_WEEK = 60;

export interface AccelerationMiningInput {
  blocks: WorkBlock[];
  sessions: ActivitySession[];
  /**
   * Optional cross-week recurrence (E2): `signal_id` → count of prior ISO weeks that signal was
   * mined, from persisted `accelerationHistory`. Nudges ranking/emphasis and drives the card badge;
   * it NEVER touches `estimated_minutes_saved_per_week`, so the reclaimable estimate stays
   * deterministic and explainable. Missing/empty ⇒ every signal is treated as first-seen.
   */
  recurrenceBySignalId?: Record<string, number>;
  /**
   * Optional chat-driven interruption analysis (E4), from `analyzeInterruptionLoad` in `capacity.ts`.
   * When present and above the reactive-volume floor, the miner emits a `technique` Play to batch
   * reactive comms. Metadata-only (counts / hours / percentages) — never message text. Missing/null ⇒
   * no reactive-load Play.
   */
  interruptionLoad?: InterruptionLoadAnalysis | null;
  /**
   * Optional imported calendar events (E5). When present, the miner mines recurring low-value
   * meetings and back-to-back meeting stacks into `technique` Plays — the meeting load the other
   * detectors never see. Metadata-only (title / times / attendee count), never event bodies.
   * Missing/empty ⇒ no meeting Plays.
   */
  calendarEvents?: OutlookCalendarEvent[];
}

/** Per-recurring-week ranking bump — a persistent habit ranks slightly above a one-off. */
const RECURRENCE_BOOST_PER_WEEK = 0.12;
/** Cap the boost so a long-running signal can't dominate a genuinely bigger one-off win. */
const MAX_RECURRENCE_BOOST_WEEKS = 4;

/** Ranking multiplier from a signal's `recurrence_weeks` (1.0 when first-seen). Emphasis only. */
function recurrenceMultiplier(signal: AccelerationSignal) {
  const weeks = Math.min(Math.max(0, signal.recurrence_weeks ?? 0), MAX_RECURRENCE_BOOST_WEEKS);
  return 1 + RECURRENCE_BOOST_PER_WEEK * weeks;
}

/**
 * DETERMINISTIC rank weight: expected minutes reclaimed, discounted by how sure the miner is.
 * Recurrence is deliberately NOT folded in here — this score decides which signals survive dedup,
 * the nested-`automate` collapse, and the top-N cap, so keeping it recurrence-free guarantees a
 * signal's surfaced `estimated_minutes_saved_per_week` never changes because of recurrence.
 */
function signalScore(signal: AccelerationSignal) {
  return signal.estimated_minutes_saved_per_week * signal.confidence;
}

/**
 * Deterministic rank order: highest score first, then raw reclaimable minutes, then signal_id —
 * so the merge is stable regardless of which detector emitted a tied pair.
 */
function compareSignals(left: AccelerationSignal, right: AccelerationSignal) {
  const leftScore = signalScore(left);
  const rightScore = signalScore(right);
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }
  if (left.estimated_minutes_saved_per_week !== right.estimated_minutes_saved_per_week) {
    return right.estimated_minutes_saved_per_week - left.estimated_minutes_saved_per_week;
  }
  return left.signal_id < right.signal_id ? -1 : left.signal_id > right.signal_id ? 1 : 0;
}

/**
 * FINAL display ordering: the deterministic score nudged by the recurrence multiplier, so a
 * persistent habit sits a little higher among the already-selected cards. Applied only to the set
 * that already survived the deterministic dedup/collapse/cap, so it changes ORDER only — never
 * which signals surface or their `estimated_minutes_saved_per_week`. Falls back to `compareSignals`
 * on a tie so ordering stays stable.
 */
function compareByRecurrence(left: AccelerationSignal, right: AccelerationSignal) {
  const leftScore = signalScore(left) * recurrenceMultiplier(left);
  const rightScore = signalScore(right) * recurrenceMultiplier(right);
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }
  return compareSignals(left, right);
}

/** True when every member of `a` is also in `b` (a ⊆ b). Callers guard against an empty `a`. */
function isSubsetOrEqual(a: Set<string>, b: Set<string>) {
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

/**
 * The single entry point the UI/derived layer consumes: run the deterministic miners
 * (B1 repetitive sequences, B2 time-sinks, B3 context-switch hotspots, E4 reactive-load when an
 * interruption analysis is supplied, and E5 meeting load when calendar events are supplied), dedupe,
 * select and cap by the DETERMINISTIC
 * `estimated_minutes_saved_per_week × confidence` score, then apply cross-week recurrence (E2) as a
 * final ORDERING nudge over the survivors. Signals below
 * `MIN_ACCELERATION_MINUTES_SAVED_PER_WEEK` stay hidden so the surface is reserved for roughly
 * hour-plus weekly wins.
 *
 * Recurrence is handled in two deliberately-separated steps so it can never change a surfaced
 * signal's minutes: (a) each signal is annotated with `recurrence_weeks` + an evidence line for the
 * card badge; (b) selection — dedup, the nested-`automate` collapse, and the top-N cap — runs on the
 * recurrence-FREE `compareSignals`, so which signals survive (and thus their displayed estimate) is
 * fully deterministic; only the final `compareByRecurrence` re-sort lets a persistent habit sit a
 * little higher among the already-chosen cards.
 *
 * Dedup has two layers: (1) defensive signal_id dedup (detectors mint unique ids today, but a
 * future detector could collide — keep the higher-ranked on a clash); (2) nested-evidence collapse
 * for `automate` signals only — B1 intentionally emits BOTH the 2-gram and the 3-gram of the same
 * app flow, so when one signal's cited sessions are wholly contained in another's, keep only the
 * top-ranked of that nested cluster. The collapse is restricted to `automate` because that is the
 * only detector that overlaps by design: `tool` signals own disjoint per-category block sets and
 * `technique` signals are one-per-hour, so a generic nested collapse could wrongly drop a distinct
 * hotspot whose sessions happen to overlap another's.
 */
export function buildAccelerationSignals(input: AccelerationMiningInput): AccelerationSignal[] {
  const { blocks, sessions, recurrenceBySignalId, interruptionLoad, calendarEvents } = input;

  const mined = [
    ...detectRepetitiveSequences(sessions),
    ...detectTimeSinks(blocks, sessions),
    ...detectContextSwitchHotspots(sessions),
    ...detectReactiveLoad(interruptionLoad),
    ...detectMeetingLoad(calendarEvents ?? [])
  ];

  const meaningful = mined.filter(
    (signal) => signal.estimated_minutes_saved_per_week >= MIN_ACCELERATION_MINUTES_SAVED_PER_WEEK
  );

  const byId = new Map<string, AccelerationSignal>();
  for (const signal of meaningful) {
    const existing = byId.get(signal.signal_id);
    // compareSignals < 0 ⇒ `signal` outranks `existing`, so the higher-ranked one survives a clash.
    if (!existing || compareSignals(signal, existing) < 0) {
      byId.set(signal.signal_id, signal);
    }
  }

  // Cross-week recurrence (E2): tag each signal with how many prior weeks it was mined and cite
  // that in its evidence. This adjusts ranking/emphasis and the card badge ONLY — the estimate is
  // untouched. A malformed/negative count degrades to first-seen (no boost, no badge, no note).
  const annotated = [...byId.values()].map((signal) => {
    const weeks = Math.floor(recurrenceBySignalId?.[signal.signal_id] ?? 0);
    if (!Number.isFinite(weeks) || weeks < 1) {
      return signal;
    }
    return {
      ...signal,
      recurrence_weeks: weeks,
      evidence: [
        ...signal.evidence,
        `Recurring signal: also surfaced in ${weeks} earlier ${weeks === 1 ? "week" : "weeks"} — a persistent pattern, so it's ranked a little higher`
      ]
    };
  });

  // Select on the recurrence-free score so recurrence can't change which signals (or which minutes)
  // survive; the recurrence emphasis is applied as a final re-sort below.
  const ranked = annotated.sort(compareSignals);

  const kept: AccelerationSignal[] = [];
  for (const candidate of ranked) {
    if (kept.length >= MAX_ACCELERATION_SIGNALS) {
      break;
    }
    const candidateEvidence = new Set(candidate.derived_from);
    const dominated =
      candidate.type === "automate" &&
      candidateEvidence.size > 0 &&
      kept.some((keptSignal) => {
        if (keptSignal.type !== "automate") {
          return false;
        }
        const keptEvidence = new Set(keptSignal.derived_from);
        if (keptEvidence.size === 0) {
          return false;
        }
        // Nested either direction ⇒ the same underlying flow; the already-kept signal outranks it.
        return (
          isSubsetOrEqual(candidateEvidence, keptEvidence) ||
          isSubsetOrEqual(keptEvidence, candidateEvidence)
        );
      });
    if (!dominated) {
      kept.push(candidate);
    }
  }

  // Final emphasis pass: reorder the already-selected survivors so a persistent habit ranks a
  // little higher. Order only — the set and every displayed estimate are already fixed above.
  return kept.slice(0, MAX_ACCELERATION_SIGNALS).sort(compareByRecurrence);
}

/* ------------------------------------------------------------------------------------------------
 * Realized-savings track record (E3)
 *
 * Turns the engine's forward-looking `estimated_minutes_saved_per_week` claims into a proven record:
 * for each Play the user marked ACTED ON, compare its estimate in one retained week against the
 * following retained week and score whether the observed reduction met, missed, or beat what the
 * play projected. Pure and primitive-only, mirroring the forecast accuracy machinery in `capacity.ts`
 * (`scoreForecastAccuracy` / `summarizeForecastAccuracy` / `buildForecastTrackRecord`).
 *
 * Privacy: reads ONLY the derived per-week summaries (id / type / minutes) — no evidence strings,
 * no app names, no window titles — so the whole feature is privacy-trivial.
 * ---------------------------------------------------------------------------------------------- */

export type RealizedSavingsRating = "beat" | "met" | "missed";

/** A scored comparison of one acted-on play across a pair of consecutive retained weeks. */
export interface RealizedSavingsEntry {
  signal_id: string;
  type: AccelerationPlayType;
  /** The baseline week the play was projected to save time in. */
  week_id: string;
  /** The following retained week its observed load was compared against. */
  next_week_id: string;
  /** The play's `estimated_minutes_saved_per_week` in the baseline week. */
  projected_minutes: number;
  /** Observed minutes reclaimed (reduction in the underlying load; can be negative if load rose). */
  realized_minutes: number;
  rating: RealizedSavingsRating;
}

/** Roll-up across every scored entry — the "your plays reclaimed ~X of the ~Y projected" headline. */
export interface RealizedSavingsSummary {
  scored_count: number;
  total_projected_minutes: number;
  /** Sum of realized minutes, per-entry floored at 0 — the reclaimed-time headline figure. */
  total_realized_minutes: number;
  beat_count: number;
  met_count: number;
  missed_count: number;
}

/** The minimal per-week summary the scorer needs — structurally the persisted acceleration snapshot. */
export interface RealizedSavingsWeek {
  week_id: string;
  signals: {
    signal_id: string;
    type: AccelerationPlayType;
    estimated_minutes_saved_per_week: number;
  }[];
}

/**
 * How much of the underlying observed load each detector's estimate represents, so a week-over-week
 * drop in the estimate can be inverted back into the observed time actually reclaimed:
 *   - automate / tool: `estimate = SAVINGS_FRACTION × observed minutes` (the conservative 25% cut),
 *     so a drop of ΔE in the estimate corresponds to ΔE / SAVINGS_FRACTION observed minutes — which
 *     is why these plays CAN beat their (deliberately conservative) projection.
 *   - technique: capture fraction 1 — the estimate already IS the reclaimable minutes, so a drop of
 *     ΔE in the estimate IS the minutes reclaimed and a technique tops out at "met" (full
 *     elimination), never beating its own projection. This holds for BOTH technique estimate shapes,
 *     so the dispatch keys on `type` alone even though the two shapes differ:
 *       · the refocus plays (context-switch hotspots, reactive-load, back-to-back focus-guard) price
 *         `estimate = REFOCUS_MINUTES_PER_SWITCH × switch count`, i.e. the refocus minutes themselves;
 *       · the recurring-meeting play prices `estimate = SAVINGS_FRACTION × meeting minutes` (the
 *         automate/tool FORMULA), yet that product is STILL the reclaimable minutes here — an async
 *         replacement keeps ~75% of the time as residual reading/writing (see detectMeetingLoad's
 *         estimate-model note, ~L649), so only the 25% is ever reclaimed. Do NOT "fix" this to
 *         divide by SAVINGS_FRACTION: it reuses the automate/tool formula but NOT their capture
 *         SEMANTICS (there the full observed load is the reclaimable pool, so a drop maps back to
 *         ΔE / SAVINGS_FRACTION and the play CAN beat). Dividing here would 4× the realized figure
 *         and let the play falsely "beat", corrupting the "proof, not claims" E3 record.
 * Coupled to the detector formulas above by necessity; keep in sync if an estimate formula changes.
 */
function captureFraction(type: AccelerationPlayType): number {
  return type === "technique" ? 1 : SAVINGS_FRACTION;
}

/** A shortfall/overshoot smaller than this many minutes still counts as "met". */
const REALIZED_TOLERANCE_FLOOR_MIN = 5;
/** ...or a shortfall/overshoot within this fraction of the projection (whichever is larger). */
const REALIZED_TOLERANCE_FRACTION = 0.2;

/**
 * Score one play against the following week: given its baseline-week estimate and the following
 * retained week's estimate, compute the observed minutes reclaimed (the load reduction the estimate
 * drop implies) and rate it beat / met / missed against the projection. Pure and primitive-only like
 * `scoreForecastAccuracy`.
 */
export function scoreRealizedSaving(
  type: AccelerationPlayType,
  currentEstimate: number,
  nextEstimate: number
): { projected_minutes: number; realized_minutes: number; rating: RealizedSavingsRating } {
  const projected = Math.round(finiteMinutes(currentEstimate));
  const drop = finiteMinutes(currentEstimate) - finiteMinutes(nextEstimate);
  const realized = Math.round(drop / captureFraction(type));
  const tolerance = Math.max(REALIZED_TOLERANCE_FLOOR_MIN, projected * REALIZED_TOLERANCE_FRACTION);
  let rating: RealizedSavingsRating;
  if (realized >= projected + tolerance) {
    rating = "beat";
  } else if (realized <= projected - tolerance) {
    rating = "missed";
  } else {
    rating = "met";
  }
  return { projected_minutes: projected, realized_minutes: realized, rating };
}

/**
 * Build the per-week realized-savings track record for every acted-on play. For each acted-on
 * `signal_id`, walk the retained weeks in chronological order and score each week it was present
 * against the immediately-following retained week — but ONLY when the signal is present in BOTH
 * weeks. A signal that is absent the following week is deliberately NOT scored: its absence is
 * ambiguous (its load may have fallen, OR it may have slipped below a detector threshold / off the
 * capped top-N — the persisted snapshot only stores the surfaced signals), and crediting absence as
 * a resolved win would fabricate large false "beats", undercutting the "proof, not claims" contract.
 * When `currentWeekId` is supplied the still-accumulating current ISO week is excluded, so only
 * settled, completed weeks are compared — otherwise a row would flip beat↔miss mid-week as this
 * week's mining fills in (mirrors the forecast track record scoring only once a week completes).
 * One entry per acted-on play per baseline week; a duplicate week record's later estimate wins
 * ("latest wins"). Newest baseline week first for display.
 *
 * Note (documented limitation): `actedOnSignalIds` carries no timestamp, so a play acted on recently
 * is also scored against weeks that predate the action — the record shows how the observed load moved
 * for flagged plays, correlational evidence to review, not a causal proof the action drove it.
 */
export function buildRealizedSavings(input: {
  history: RealizedSavingsWeek[];
  actedOnSignalIds: string[];
  /** Exclude this in-progress ISO week so only completed, settled weeks are scored. */
  currentWeekId?: string;
}): RealizedSavingsEntry[] {
  const actedOn = new Set(input.actedOnSignalIds);
  const currentWeekId = input.currentWeekId ? normalizeWeekId(input.currentWeekId) : undefined;
  const completedHistory = currentWeekId
    ? input.history.filter((week) => normalizeWeekId(week.week_id) < currentWeekId)
    : input.history;
  if (actedOn.size === 0 || completedHistory.length < 2) {
    return [];
  }

  // Collapse to one estimate per (week_id, signal_id). One record per week upstream, but a later
  // occurrence overwriting an earlier one keeps "latest wins" if a duplicate ever slips through.
  const byWeek = new Map<string, Map<string, { type: AccelerationPlayType; estimate: number }>>();
  for (const week of completedHistory) {
    // Key by the NORMALIZED week id so ordering (below) is chronological and the emitted
    // week_id / next_week_id render cleanly; a non-padded id shares its slot with its padded twin.
    const weekKey = normalizeWeekId(week.week_id);
    let perSignal = byWeek.get(weekKey);
    if (!perSignal) {
      perSignal = new Map();
      byWeek.set(weekKey, perSignal);
    }
    for (const signal of week.signals) {
      if (!actedOn.has(signal.signal_id)) {
        continue;
      }
      perSignal.set(signal.signal_id, {
        type: signal.type,
        estimate: finiteMinutes(signal.estimated_minutes_saved_per_week)
      });
    }
  }

  const orderedWeeks = [...byWeek.keys()].sort((left, right) => left.localeCompare(right));
  const entries: RealizedSavingsEntry[] = [];

  for (let index = 0; index < orderedWeeks.length - 1; index += 1) {
    const weekId = orderedWeeks[index];
    const nextWeekId = orderedWeeks[index + 1];
    const currentSignals = byWeek.get(weekId);
    const nextSignals = byWeek.get(nextWeekId);
    if (!currentSignals) {
      continue;
    }
    for (const [signalId, current] of currentSignals) {
      const next = nextSignals?.get(signalId);
      // Only score when the signal is observable in BOTH weeks — see the doc note: absence the next
      // week is ambiguous (resolved vs. crowded off the capped top-N), so it is left unscored.
      if (!next) {
        continue;
      }
      const scored = scoreRealizedSaving(current.type, current.estimate, next.estimate);
      entries.push({
        signal_id: signalId,
        type: current.type,
        week_id: weekId,
        next_week_id: nextWeekId,
        projected_minutes: scored.projected_minutes,
        realized_minutes: scored.realized_minutes,
        rating: scored.rating
      });
    }
  }

  // Newest baseline week first; within a week, the bigger projection leads.
  entries.sort((left, right) => {
    if (left.week_id !== right.week_id) {
      return right.week_id.localeCompare(left.week_id);
    }
    if (left.projected_minutes !== right.projected_minutes) {
      return right.projected_minutes - left.projected_minutes;
    }
    return left.signal_id < right.signal_id ? -1 : left.signal_id > right.signal_id ? 1 : 0;
  });

  return entries;
}

/**
 * Roll the scored entries into the headline summary. Returns null when nothing has been scored so
 * the caller can hide the surface. `total_realized_minutes` floors each entry at 0 so a single
 * regression week can't erase the reclaimed-time headline; per-row detail still shows the honest
 * (possibly negative) figure.
 */
export function summarizeRealizedSavings(
  entries: RealizedSavingsEntry[]
): RealizedSavingsSummary | null {
  if (entries.length === 0) {
    return null;
  }
  return entries.reduce<RealizedSavingsSummary>(
    (summary, entry) => ({
      scored_count: summary.scored_count + 1,
      total_projected_minutes: summary.total_projected_minutes + entry.projected_minutes,
      total_realized_minutes: summary.total_realized_minutes + Math.max(0, entry.realized_minutes),
      beat_count: summary.beat_count + (entry.rating === "beat" ? 1 : 0),
      met_count: summary.met_count + (entry.rating === "met" ? 1 : 0),
      missed_count: summary.missed_count + (entry.rating === "missed" ? 1 : 0)
    }),
    {
      scored_count: 0,
      total_projected_minutes: 0,
      total_realized_minutes: 0,
      beat_count: 0,
      met_count: 0,
      missed_count: 0
    }
  );
}
