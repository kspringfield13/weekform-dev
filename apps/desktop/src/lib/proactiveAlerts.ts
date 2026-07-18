import type { WeeklyCapacitySnapshot } from "../../../../packages/domain/src/models";
import type { Screen } from "./types";

// Reusable proactive-alert engine for the menu-bar app. Pure and metrics-only: a
// rule may read derived capacity numbers but must NEVER put a window title or app
// name in user-facing text (privacy is a hard constraint). Each rule returns an
// alert or null; the engine surfaces the first one that fires. New proactive
// behaviours plug in as additional rules without touching the wiring.

export type ProactiveAlertSeverity = "info" | "warning";

export interface ProactiveAlert {
  /** Stable identifier for the rule that produced this alert. */
  id: string;
  rule_id: string;
  severity: ProactiveAlertSeverity;
  /** Short headline; metrics/counts only. */
  title: string;
  /** One-line explanation; metrics/counts only. */
  body: string;
  /** Where clicking the alert should take the user. */
  action: Screen;
  /**
   * Coarse fingerprint of the firing condition. Two evaluations that share a
   * signature are treated as "the same alert" — used to de-duplicate OS
   * notifications and to honour a user dismissal until the condition changes.
   */
  signature: string;
}

export interface ProactiveAlertSettings {
  /** Master opt-in. Off by default — same posture as visual context. */
  enabled: boolean;
  /** Per-rule toggle for the capacity guardrail. */
  capacityGuardrailEnabled: boolean;
  /** Reliable-new-work-capacity floor (%) that trips the guardrail. */
  capacityThresholdPct: number;
  /** Per-rule toggle: nudge to clear the review queue before end of day. */
  endOfDayReviewEnabled: boolean;
  /** Per-rule toggle: warn the day before a meeting-heavy day. */
  heavyDayAheadEnabled: boolean;
  /** Per-rule toggle: flag when the weekly summary/forecast are ready to review. */
  weeklyArtifactsEnabled: boolean;
  /** Per-rule toggle: nudge when context-switching is high. */
  fragmentationEnabled: boolean;
}

export const DEFAULT_PROACTIVE_ALERT_SETTINGS: ProactiveAlertSettings = {
  enabled: false,
  capacityGuardrailEnabled: true,
  capacityThresholdPct: 10,
  endOfDayReviewEnabled: true,
  heavyDayAheadEnabled: true,
  weeklyArtifactsEnabled: true,
  fragmentationEnabled: true,
};

/** Carryover-risk ceiling (%) that also trips the guardrail, independent of capacity. */
export const CARRYOVER_RISK_ALERT_THRESHOLD_PCT = 35;
/** Local hour (0-23) from which the end-of-day review nudge may fire. */
export const END_OF_DAY_HOUR = 16;
/** Minimum unverified blocks before the end-of-day review nudge fires. */
export const END_OF_DAY_MIN_UNVERIFIED = 3;
/** Meeting hours on the next day that trip the heavy-day-ahead warning. */
export const HEAVY_DAY_MEETING_HOURS = 4;
/** Context-switch score (0-1) at/above which the fragmentation nudge fires. */
export const FRAGMENTATION_SCORE_THRESHOLD = 0.6;
/**
 * Earliest ISO weekday (1=Mon..7=Sun) the weekly-artifacts nudge fires — Thursday. Compared against
 * an ISO-normalized day-of-week (JS Sunday 0 → 7) so the "Thursday onward" window runs in week-flow
 * order (Thu→Sun) rather than JS's numeric order, which would sort Sunday BEFORE Monday.
 */
export const WEEKLY_ARTIFACTS_MIN_DOW = 4;

export interface ProactiveAlertRuntime {
  /** Last fired signature per rule — prevents re-firing the same condition. */
  lastFiredSignatureByRule: Record<string, string>;
  /** ISO timestamp of the most recent OS notification (global gap throttle). */
  lastFiredAt: string | null;
  /** OS notifications fired per local date key (daily cap). */
  firedCountByDate: Record<string, number>;
}

export const EMPTY_PROACTIVE_ALERT_RUNTIME: ProactiveAlertRuntime = {
  lastFiredSignatureByRule: {},
  lastFiredAt: null,
  firedCountByDate: {},
};

/**
 * Workload-derived inputs the rules read. Assembled by the caller (App) from the
 * current snapshot, ledger, and calendar — all local, all metrics/counts. The
 * time-dependent fields are injected separately by the engine hook at eval time
 * so clock-based rules see the real "now" between renders.
 */
export interface ProactiveAlertData {
  snapshot: WeeklyCapacitySnapshot;
  hasWorkBlocks: boolean;
  /** Count of unverified work blocks awaiting review. */
  unverifiedCount: number;
  /** Meeting hours scheduled for the next calendar day. */
  tomorrowMeetingHours: number;
  /** Meeting count scheduled for the next calendar day. */
  tomorrowMeetingCount: number;
  /** Present (with a stable signature) when weekly artifacts are ready to review. */
  weeklyArtifacts: { signature: string } | null;
}

export interface ProactiveAlertInput extends ProactiveAlertData {
  /** Local hour, 0-23. */
  nowHour: number;
  /** Local day of week, 0=Sun..6=Sat. */
  nowDow: number;
  /** Local date key for "today" (signature scoping). */
  todayKey: string;
}

type ProactiveAlertRule = (
  input: ProactiveAlertInput,
  settings: ProactiveAlertSettings,
) => ProactiveAlert | null;

// Bucket a value so small fluctuations around a threshold don't churn the
// signature (and therefore don't re-fire a fresh OS notification each tick).
function bucket(value: number, size: number): number {
  return Math.round(value / size) * size;
}

const capacityGuardrailRule: ProactiveAlertRule = (input, settings) => {
  const cap = input.snapshot.reliable_new_work_capacity_pct;
  const carryover = input.snapshot.carryover_risk_pct;
  const lowCapacity = cap <= settings.capacityThresholdPct;
  const highCarryover = carryover >= CARRYOVER_RISK_ALERT_THRESHOLD_PCT;
  if (!lowCapacity && !highCarryover) return null;

  const reasons: string[] = [];
  if (lowCapacity) reasons.push(`reliable new-work capacity is down to ${Math.round(cap)}%`);
  if (highCarryover) reasons.push(`carryover risk is at ${Math.round(carryover)}%`);

  const signature = `capacity:${lowCapacity ? `low-${bucket(cap, 2)}` : "ok"}:${highCarryover ? `carry-${bucket(carryover, 5)}` : "ok"}`;

  // Sentence-case the joined reasons without leaking any non-metric content.
  const detail = reasons.join(" and ");
  return {
    id: "capacity-guardrail",
    rule_id: "capacity-guardrail",
    severity: "warning",
    title: lowCapacity ? "Capacity running low" : "Carryover risk climbing",
    body: `${detail.charAt(0).toUpperCase()}${detail.slice(1)}. Review your week before taking on new work.`,
    action: "weekly",
    signature,
  };
};

// Warn the day before a meeting-heavy day so a focus block can be protected.
const heavyDayAheadRule: ProactiveAlertRule = (input) => {
  if (input.tomorrowMeetingHours < HEAVY_DAY_MEETING_HOURS) return null;
  const hours = Math.round(input.tomorrowMeetingHours);
  const count = input.tomorrowMeetingCount;
  return {
    id: "heavy-day-ahead",
    rule_id: "heavy-day-ahead",
    severity: "warning",
    title: "Heavy meeting day ahead",
    body: `Tomorrow has about ${hours}h of meetings across ${count} event${count === 1 ? "" : "s"}. Protect a focus block before it fills up.`,
    action: "weekly",
    // Scoped to today: one warning per day about the upcoming day.
    signature: `heavyday:${input.todayKey}:${bucket(input.tomorrowMeetingHours, 1)}`,
  };
};

// Nudge when context-switching is high so reactive work can be batched.
const fragmentationRule: ProactiveAlertRule = (input) => {
  const score = input.snapshot.context_switch_score;
  if (score < FRAGMENTATION_SCORE_THRESHOLD) return null;
  return {
    id: "fragmentation",
    rule_id: "fragmentation",
    severity: "warning",
    title: "Context-switching is high",
    body: `Your context-switch score is ${Math.round(score * 100)}%. Consider batching reactive work into a single focus block.`,
    action: "weekly",
    signature: `frag:${input.snapshot.week_id}:${bucket(score * 100, 10)}`,
  };
};

// Remind to clear the review queue before wrapping up for the day.
const endOfDayReviewRule: ProactiveAlertRule = (input) => {
  if (input.nowHour < END_OF_DAY_HOUR) return null;
  if (input.unverifiedCount < END_OF_DAY_MIN_UNVERIFIED) return null;
  const count = input.unverifiedCount;
  return {
    id: "end-of-day-review",
    rule_id: "end-of-day-review",
    severity: "info",
    title: "Review before you wrap up",
    body: `${count} work block${count === 1 ? "" : "s"} still need review. A quick pass keeps this week's capacity accurate.`,
    action: "daily",
    // One nudge per day regardless of how the count drifts.
    signature: `eod:${input.todayKey}`,
  };
};

// Surface the generated weekly summary/forecast for review before sharing.
const weeklyArtifactsRule: ProactiveAlertRule = (input) => {
  if (!input.weeklyArtifacts) return null;
  // `nowDow` is JS `getDay()` (0=Sun..6=Sat), but the app's week is Monday-first (ISO), so Sunday is
  // the LAST day of the current week — the natural end-of-week review day. Map Sunday 0 → ISO 7
  // before the "Thursday onward" gate so it fires Thu/Fri/Sat/Sun; a raw `nowDow < 4` would sort
  // Sunday (0) before Monday and silently drop it while still firing Saturday.
  const isoDow = input.nowDow === 0 ? 7 : input.nowDow;
  if (isoDow < WEEKLY_ARTIFACTS_MIN_DOW) return null;
  return {
    id: "weekly-artifacts",
    rule_id: "weekly-artifacts",
    severity: "info",
    title: "Weekly summary ready",
    body: "Your weekly summary and forecast are ready to review before you share them.",
    action: "narrative",
    signature: `artifacts:${input.weeklyArtifacts.signature}`,
  };
};

// Order is priority: the first firing rule wins the single alert slot.
const RULES: ProactiveAlertRule[] = [
  capacityGuardrailRule,
  heavyDayAheadRule,
  fragmentationRule,
  endOfDayReviewRule,
  weeklyArtifactsRule,
];

function isRuleEnabled(ruleId: string, settings: ProactiveAlertSettings): boolean {
  switch (ruleId) {
    case "capacity-guardrail":
      return settings.capacityGuardrailEnabled;
    case "heavy-day-ahead":
      return settings.heavyDayAheadEnabled;
    case "fragmentation":
      return settings.fragmentationEnabled;
    case "end-of-day-review":
      return settings.endOfDayReviewEnabled;
    case "weekly-artifacts":
      return settings.weeklyArtifactsEnabled;
    default:
      return true;
  }
}

/**
 * Evaluate every enabled rule and return the first alert that fires (or null).
 * Returns null when alerts are disabled or there is no workload to reason about.
 */
export function evaluateProactiveAlerts(
  input: ProactiveAlertInput,
  settings: ProactiveAlertSettings,
): ProactiveAlert | null {
  if (!settings.enabled || !input.hasWorkBlocks) return null;
  for (const rule of RULES) {
    const candidate = rule(input, settings);
    if (candidate && isRuleEnabled(candidate.rule_id, settings)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Decide whether an alert warrants an interruptive OS notification right now,
 * given prior firing history. The in-app banner is shown regardless; this gate
 * only governs the toast so the menu bar stays quiet.
 */
export function shouldFireOsNotification(
  alert: ProactiveAlert,
  runtime: ProactiveAlertRuntime,
  now: number,
  todayKey: string,
  maxPerDay: number,
  minGapMs: number,
): boolean {
  if (runtime.lastFiredSignatureByRule[alert.rule_id] === alert.signature) return false;
  if ((runtime.firedCountByDate[todayKey] ?? 0) >= maxPerDay) return false;
  if (runtime.lastFiredAt && now - new Date(runtime.lastFiredAt).getTime() < minGapMs) return false;
  return true;
}

/** Record that an OS notification fired, returning the next runtime snapshot. */
export function recordFiredAlert(
  alert: ProactiveAlert,
  runtime: ProactiveAlertRuntime,
  nowIso: string,
  todayKey: string,
): ProactiveAlertRuntime {
  return {
    lastFiredSignatureByRule: {
      ...runtime.lastFiredSignatureByRule,
      [alert.rule_id]: alert.signature,
    },
    lastFiredAt: nowIso,
    // Only today's key is ever read (shouldFireOsNotification checks
    // firedCountByDate[todayKey]), so drop every prior date rather than spread
    // the whole map forward — otherwise it accrues one dead key per day forever
    // on a long-lived tray app.
    firedCountByDate: {
      [todayKey]: (runtime.firedCountByDate[todayKey] ?? 0) + 1,
    },
  };
}
