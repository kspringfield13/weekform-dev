import type { WorkBlock, WorkCategory, UserCorrection, ReviewCopilotAction, AccelerationPlayType } from "../../../../packages/domain/src/models";
import type { AuditEventType } from "../../../../packages/domain/src/models";
import type { ForecastAccuracyRating } from "../../../../packages/inference/src/capacity";
import type { RealizedSavingsRating } from "../../../../packages/inference/src/accelerate";

/** Placeholder for a timestamp that can't be parsed, so a malformed value never renders the
 *  literal "Invalid Date" (mirrors formatRange's NaN guard on the duration suffix). */
const INVALID_TIME_PLACEHOLDER = "—";

export function formatTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return INVALID_TIME_PLACEHOLDER;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

/** Time-only clock label (e.g. "3:45 PM") for a rendered timestamp, with the same
 *  Invalid-Date guard as formatTime — used where the weekday/date prefix is redundant
 *  (matches formatRange's endpoint format). Mirrors the app's en-US formatter convention
 *  so all timestamps render consistently. */
export function formatClockTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return INVALID_TIME_PLACEHOLDER;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function formatRange(block: WorkBlock) {
  const start = new Date(block.start_time);
  const end = new Date(block.end_time);
  const startMs = start.getTime();
  const endMs = end.getTime();
  // A malformed start_time/end_time yields NaN here; render an em-dash placeholder for the
  // affected endpoint and omit the duration suffix rather than surfacing "Invalid Date"/"… (NaN min)".
  const endClock = Number.isFinite(endMs)
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit"
      }).format(end)
    : INVALID_TIME_PLACEHOLDER;
  const head = `${formatTime(block.start_time)} - ${endClock}`;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return head;
  }
  return `${head} (${formatDurationMinutes(Math.round((endMs - startMs) / 60000))})`;
}

/** A 12-hour clock label for a local hour bucket (0–23), e.g. 0 → "12am", 14 → "2pm". */
export function formatHourOfDay(hour: number): string {
  const normalized = ((Math.round(hour) % 24) + 24) % 24;
  const meridiem = normalized < 12 ? "am" : "pm";
  const twelve = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${twelve}${meridiem}`;
}

/** Compact 12-hour clock label for a local hour bucket (0–23), e.g. 0 → "12a", 14 → "2p". */
export function formatHourCompact(hour: number): string {
  const normalized = ((Math.round(hour) % 24) + 24) % 24;
  if (normalized === 0) return "12a";
  if (normalized === 12) return "12p";
  return normalized < 12 ? `${normalized}a` : `${normalized - 12}p`;
}

/** Spoken 12-hour clock label for a local hour bucket (0–23), e.g. 0 → "12 am", 14 → "2 pm". */
export function formatHourA11y(hour: number): string {
  const normalized = ((Math.round(hour) % 24) + 24) % 24;
  if (normalized === 0) return "12 am";
  if (normalized === 12) return "12 pm";
  return normalized < 12 ? `${normalized} am` : `${normalized - 12} pm`;
}

/**
 * Relative label for a day offset (0 = today, 1 = yesterday, else the weekday name).
 * `long` picks the full form ("Yesterday" / "Monday") over the compact one ("Yest." / "Mon").
 */
export function formatRelativeDayLabel(diffDays: number, options?: { long?: boolean }): string {
  const long = options?.long ?? false;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return long ? "Yesterday" : "Yest.";
  const d = new Date();
  d.setDate(d.getDate() - diffDays);
  return d.toLocaleDateString("en-US", { weekday: long ? "long" : "short" });
}

/**
 * ISO timestamp → local "HH:MM" value for a `<input type="time">`. A malformed/legacy ISO
 * yields an Invalid Date whose getHours()/getMinutes() are NaN, which would render the literal
 * "NaN:NaN" into the time input (and slip past the non-empty draft guard on save) — so guard the
 * parse and return "" (an empty time input) instead, mirroring applyLocalTime's Invalid-Date guard.
 */
export function toLocalTimeInput(isoString: string): string {
  const d = new Date(isoString);
  if (!Number.isFinite(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Apply a local "HH:MM" value onto an ISO timestamp, keeping its date. A malformed
 * `hhmm` yields NaN hours/minutes, and `d.setHours(NaN, NaN)` produces an Invalid Date
 * whose `.toISOString()` THROWS — so guard the parse and return the original ISO unchanged.
 */
export function applyLocalTime(originalIso: string, hhmm: string): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return originalIso;
  const d = new Date(originalIso);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

export function compactCategory(category: WorkCategory) {
  return category.replace(" stakeholder ", " ");
}

export function pct(value: number) {
  return `${Math.round(value)}%`;
}

/**
 * Humanize an integer tally with locale thousands separators ("1,284"), so a large count stays
 * readable instead of running together as "1284" — captured activity samples accrue one per
 * foreground-window tick and reach the thousands over a workday. Clamps NaN/negatives to 0 and
 * rounds (mirroring formatDurationMinutes) so a malformed value never renders "1,284.4".
 */
export function formatCount(count: number): string {
  const total = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  return total.toLocaleString();
}

/** Compact large token counts for dense UI while keeping exact values available elsewhere. */
export function formatTokenCount(tokens: number): string {
  const total = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0;
  if (total >= 999_500) {
    return `${(total / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (total >= 1_000) return `${Math.round(total / 1_000)}k`;
  return String(total);
}

/**
 * Humanize a minutes count for a duration label: "45 min" below an hour, "2h 5m" at or above
 * one, "1h" on an exact hour (no redundant "0m"). Rounds to whole minutes and clamps
 * NaN/negatives to 0, so a fractional or malformed duration never renders "12.333 min" or
 * "0h -3m". Shared by the session/observed-time labels (CompactWidget, ActivityCapturePanel)
 * so long durations read consistently everywhere.
 */
export function formatDurationMinutes(minutes: number): string {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

export function formatAuditTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return INVALID_TIME_PLACEHOLDER;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function fieldLabel(field: UserCorrection["field"]) {
  const labels: Record<UserCorrection["field"], string> = {
    category: "Category",
    mode: "Mode",
    planned_status: "Planned status",
    project_name: "Project",
    stakeholder_group: "Stakeholder",
    blocker_flag: "Blocked flag",
    notes: "Notes",
    exclude: "Excluded block",
    verification: "Verified block",
    manager_summary: "Manager summary",
    calendar_import: "Calendar import",
    start_time: "Start time",
    end_time: "End time"
  };

  return labels[field];
}

const PLANNED_STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  unplanned: "Unplanned",
  fixed: "Fixed",
  blocked: "Blocked",
};

export function plannedStatusLabel(status: string): string {
  return PLANNED_STATUS_LABELS[status] ?? status;
}

const REVIEW_ACTION_LABELS: Record<ReviewCopilotAction, string> = {
  confirm: "Confirm",
  relabel: "Relabel",
  exclude: "Exclude",
  merge: "Merge blocks",
  split: "Split block",
  note: "Add note",
};

export function reviewActionLabel(action: ReviewCopilotAction): string {
  return REVIEW_ACTION_LABELS[action] ?? action;
}

const ACCELERATION_TYPE_LABELS: Record<AccelerationPlayType, string> = {
  automate: "Automate",
  tool: "Tool",
  technique: "Technique",
};

export function accelerationTypeLabel(type: AccelerationPlayType): string {
  return ACCELERATION_TYPE_LABELS[type] ?? type;
}

// Plain-language gloss for each acceleration play type, used as the play-type chip's
// hover tooltip and an explanation-only screen-reader mirror (the chip text alone reads
// as a bare enum). Single-sourced here so the Acceleration PlayCard and the SkillsLibrary
// chip can't drift apart. Falls back to the label for any unmapped type.
const ACCELERATION_TYPE_GLOSSES: Record<AccelerationPlayType, string> = {
  automate: "A repetitive workflow that a reusable automation or AI skill could take over",
  tool: "A recurring time-sink where an off-the-shelf tool or template would help",
  technique: "A working-habit change that cuts an observed friction or context-switch cost",
};

export function accelerationTypeGloss(type: AccelerationPlayType): string {
  return ACCELERATION_TYPE_GLOSSES[type] ?? accelerationTypeLabel(type);
}

const PRIVACY_LABELS: Record<string, string> = {
  local_only: "Local only",
  derived_only: "Derived only",
  excluded: "Excluded",
};

const PRIVACY_TOOLTIPS: Record<string, string> = {
  local_only: "Raw data stays on this device and is never shared",
  derived_only: "Only anonymised summaries leave this device",
  excluded: "This event was excluded from all reports",
};

export function privacyLevelLabel(level: string): string {
  return PRIVACY_LABELS[level] ?? level;
}

export function privacyLevelTooltip(level: string): string {
  return PRIVACY_TOOLTIPS[level] ?? "";
}

export function humanizeCorrectionValue(field: UserCorrection["field"], value: string): string {
  if (field === "planned_status") return plannedStatusLabel(value);
  if (field === "blocker_flag") {
    // blocker_flag corrections store the raw boolean as `String(block.blocker_flag)` → "true"/"false";
    // humanize it so the model-bias note / corrections chip / undo toast never show a bare boolean.
    if (value === "true") return "Blocked";
    if (value === "false") return "Not blocked";
  }
  if (field === "start_time" || field === "end_time") {
    const date = new Date(value);
    if (!isNaN(date.getTime())) return formatTime(value);
  }
  return value;
}

const FORECAST_RATING_LABELS: Record<ForecastAccuracyRating, string> = {
  on_target: "On target",
  close: "Close",
  off: "Off",
};

export function forecastRatingLabel(rating: ForecastAccuracyRating): string {
  return FORECAST_RATING_LABELS[rating];
}

const REALIZED_SAVINGS_RATING_LABELS: Record<RealizedSavingsRating, string> = {
  beat: "Beat estimate",
  met: "On track",
  missed: "Below estimate",
};

// Humanize an acceleration realized-savings rating for the track-record chip (never raw snake_case).
export function realizedSavingsRatingLabel(rating: RealizedSavingsRating): string {
  return REALIZED_SAVINGS_RATING_LABELS[rating];
}

// Turn the rolling mean signed forecast error into a plain-language bias phrase, so the
// accuracy line can say whether the model systematically over- or under-predicts (a
// self-correcting cue). Positive = over-predicts. Returns "" when the average bias rounds
// to under a point, so a well-calibrated model shows no noise.
export function forecastBiasPhrase(meanSignedErrorPts: number): string {
  const rounded = Math.round(meanSignedErrorPts);
  if (rounded === 0) return "";
  const direction = rounded > 0 ? "over-predict" : "under-predict";
  return `tends to ${direction} by ~${Math.abs(rounded)} pts`;
}

// Render an ISO week id ("2026-W26") as a readable label without date math, so the
// forecast track record can title each row. Falls back to the raw id if it doesn't parse.
export function formatIsoWeekLabel(weekId: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!match) return weekId;
  return `Week ${Number(match[2])}, ${match[1]}`;
}

// Plain-language labels for the known `AuditEvent.source` identifiers, so the audit
// detail header never surfaces a raw snake_case internal id. Anything unmapped falls
// back to a Title-Case-from-snake_case rendering via `sourceLabel`.
const AUDIT_SOURCE_LABELS: Record<string, string> = {
  review_layer: "Review layer",
  openai_responses_api: "OpenAI Responses API",
  openai_vision: "OpenAI Vision",
  grok_responses_api: "Grok Responses API",
  grok_vision: "Grok Vision",
  deepseek_responses_api: "DeepSeek Responses API",
  deepseek_vision: "DeepSeek Vision",
  custom_responses_api: "Custom provider Responses API",
  custom_vision: "Custom provider Vision",
  macos_active_window: "macOS active window",
  outlook_ics: "Outlook .ics",
  chat_export: "Chat export",
  usage_csv: "Usage CSV",
  settings: "AI usage settings",
  weekly_review: "Weekly review",
  proactive_alerts: "Proactive alerts",
  acceleration_engine: "Acceleration engine",
  privacy_control: "Privacy control",
  sessionizer: "Sessionizer",
  onboarding: "Onboarding",
  walkthrough: "Walkthrough",
  cloud_sync: "Weekform Web",
};

// Humanize an `AuditEvent.source` for display (never render the raw snake_case id).
export function sourceLabel(source: string): string {
  const mapped = AUDIT_SOURCE_LABELS[source];
  if (mapped) return mapped;
  // Title-Case-from-snake_case fallback for any source not in the map.
  return source
    .split("_")
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function auditTypeLabel(type: AuditEventType) {
  const labels: Record<AuditEventType, string> = {
    active_window_sample: "Capture",
    activity_session: "Session",
    calendar_import: "Calendar",
    chat_import: "Chat",
    user_correction: "Correction",
    narrative_generation: "Narrative",
    work_block_classification: "Classifier",
    review_copilot: "Copilot",
    proactive_alert: "Alert",
    forecast_agent: "Forecast",
    visual_context: "Visual",
    privacy_pause: "Privacy",
    privacy_resume: "Privacy",
    retention_policy: "Privacy",
    visual_context_policy: "Privacy",
    data_reset: "Privacy",
    data_export: "Privacy",
    acceleration_engine: "Acceleration",
    onboarding: "Onboarding",
    usage_import: "AI Usage",
    usage_settings: "AI Usage",
    cloud_sharing: "Cloud",
    weekly_review: "Weekly Review"
  };

  return labels[type];
}
