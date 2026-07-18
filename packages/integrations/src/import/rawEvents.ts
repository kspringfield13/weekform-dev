import type {
  PlannedStatus,
  PrivacyLevel,
  RawEvent,
  SourceType,
  WorkBlock,
  WorkCategory,
  WorkMode
} from "../../../domain/src/models";
import { plannedStatuses, workCategories, workModes } from "../../../domain/src/taxonomy";
import { capacityPctFromSpan, stableHash } from "../internal/normalize";

/**
 * Generic activity-source import.
 *
 * `SourceType` reserves `chat` / `git` / `browser` / `task` alongside the
 * wired `window` + `calendar`, but the app only had bespoke mappers for the
 * latter two. This module is the source-agnostic alternative: a new source
 * emits a JSON file of {@link RawEventImport} records and {@link importRawEvents}
 * turns them into `WorkBlock`s — so adding a source needs *data, not code*.
 *
 * ## Import contract (JSON)
 *
 * Pass an array, an `{ "events": [...] }` wrapper, or the raw JSON string of
 * either. Each element is a {@link RawEventImport}:
 *
 * ```json
 * {
 *   "events": [
 *     {
 *       "timestamp_start": "2026-06-22T14:00:00Z",
 *       "timestamp_end":   "2026-06-22T15:30:00Z",
 *       "source_type": "git",
 *       "project_hint": "clear-capacity",
 *       "app_name": "git",
 *       "metadata": { "commits": "4" }
 *     }
 *   ]
 * }
 * ```
 *
 * Only `timestamp_start`, `timestamp_end`, and `source_type` are required;
 * everything else is optional and normalized to a full `RawEvent`. A source
 * that already knows the work shape may refine the derived `WorkBlock` by
 * passing `category` / `mode` / `planned_status` / `project_name` /
 * `capacity_pct` — each is validated and, when invalid, falls back to the
 * per-source default below.
 */

/** The documented JSON shape a new source emits. See module docs. */
export interface RawEventImport {
  /** ISO timestamp (any `Date`-parseable string). Required. */
  timestamp_start: string;
  /** ISO timestamp; must be strictly after `timestamp_start`. Required. */
  timestamp_end: string;
  /** Which reserved source this came from. Required. */
  source_type: SourceType;
  /** Stable id from the source; auto-derived from content when omitted. */
  event_id?: string;
  user_id?: string;
  app_name?: string | null;
  window_title?: string | null;
  domain?: string | null;
  file_path?: string | null;
  project_hint?: string | null;
  metadata?: Record<string, string | null>;
  privacy_level?: PrivacyLevel;
  // Optional WorkBlock refinements (validated; ignored when invalid).
  category?: WorkCategory;
  mode?: WorkMode;
  planned_status?: PlannedStatus;
  project_name?: string;
  capacity_pct?: number;
}

export interface ImportRawEventsOptions {
  /** Pin every block to this ISO week id instead of deriving it per event. */
  weekId?: string;
  /** User id stamped onto events that omit one. */
  userId?: string;
}

export interface RawEventImportResult {
  /** Normalized raw events (one per accepted import record). */
  events: RawEvent[];
  /** Work blocks derived from `events`, sorted by start time. */
  work_blocks: WorkBlock[];
  /** Records dropped for a missing/invalid time span or unknown source. */
  skipped: number;
  /**
   * Set only when a JSON-string payload was malformed. The payload is treated
   * as an empty import (no throw, mirroring the never-throwing calendar source)
   * and this carries a human-readable reason the UI can surface. `undefined`
   * on the happy path, so the common result shape is unchanged.
   */
  error?: string;
}

interface SourceDefaults {
  category: WorkCategory;
  mode: WorkMode;
  planned_status: PlannedStatus;
  stakeholder_group: string;
  project_fallback: string;
  /** Heuristic imports sit below the Outlook mapper's 0.94 so they surface for review. */
  confidence: number;
  label: string;
}

const SOURCE_DEFAULTS: Record<SourceType, SourceDefaults> = {
  window: {
    category: "Planned analysis / project work",
    mode: "Deep work",
    planned_status: "planned",
    stakeholder_group: "Local activity",
    project_fallback: "Focused app work",
    confidence: 0.6,
    label: "foreground app"
  },
  calendar: {
    category: "Meetings / stakeholder syncs",
    mode: "Collaborative",
    planned_status: "fixed",
    stakeholder_group: "Calendar",
    project_fallback: "Calendar event",
    confidence: 0.85,
    label: "calendar"
  },
  browser: {
    category: "Documentation / requirement clarification",
    mode: "Reactive",
    planned_status: "unplanned",
    stakeholder_group: "Web research",
    project_fallback: "Browser activity",
    confidence: 0.5,
    label: "browser"
  },
  // Generic workplace-chat signal. The specific vendor (Slack / Microsoft
  // Teams / Webex) rides on a per-message `provider` field, not a dedicated
  // SourceType — orgs standardize on one chat app, so the reactive-work signal
  // is vendor-uniform. See `chat/chatExport.ts`.
  chat: {
    category: "Ad hoc stakeholder requests",
    mode: "Reactive",
    planned_status: "unplanned",
    stakeholder_group: "Workplace chat",
    project_fallback: "Reactive messaging",
    confidence: 0.55,
    label: "workplace chat"
  },
  task: {
    category: "Planned analysis / project work",
    mode: "Deep work",
    planned_status: "planned",
    stakeholder_group: "Task tracker",
    project_fallback: "Tracked task",
    confidence: 0.7,
    label: "task tracker"
  },
  git: {
    category: "Planned analysis / project work",
    mode: "Deep work",
    planned_status: "planned",
    stakeholder_group: "Version control",
    project_fallback: "Code work",
    confidence: 0.7,
    label: "git"
  },
  manual: {
    category: "Admin / coordination",
    mode: "Reactive",
    planned_status: "unplanned",
    stakeholder_group: "Manual entry",
    project_fallback: "Manual entry",
    confidence: 0.65,
    label: "manual entry"
  }
};

/** ISO-8601 week id (e.g. `2026-W26`). Mirrors `lib/date.ts#getCurrentIsoWeekId`. */
function isoWeekId(date: Date) {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const isoYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function nonEmpty(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** True when `value` is a plain (non-array) object usable as the `metadata` bag. */
function isStringRecord(value: unknown): value is Record<string, string | null> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImportRecord(value: unknown): value is RawEventImport {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.timestamp_start === "string" &&
    typeof record.timestamp_end === "string" &&
    typeof record.source_type === "string"
  );
}

/**
 * Parse a JSON import string WITHOUT throwing, so a bad file never crashes an
 * import (the calendar source is line-based and never throws — this brings the
 * JSON sources to the same contract). An empty/whitespace string is "no data"
 * (`[]`); a non-empty malformed string yields `{ data: [], malformed: true }`
 * so the caller can surface a reason instead of catching a `SyntaxError`. A
 * non-string payload passes straight through.
 */
export function parseImportJson(payload: unknown): { data: unknown; malformed: boolean } {
  if (typeof payload !== "string") {
    return { data: payload, malformed: false };
  }
  const trimmed = payload.trim();
  if (!trimmed) {
    return { data: [], malformed: false };
  }
  try {
    return { data: JSON.parse(trimmed), malformed: false };
  } catch {
    return { data: [], malformed: true };
  }
}

function coercePayload(
  payload: string | RawEventImport[] | { events: RawEventImport[] }
): { records: unknown[]; malformed: boolean } {
  const { data, malformed } = parseImportJson(payload);
  if (Array.isArray(data)) {
    return { records: data, malformed };
  }
  if (data && typeof data === "object" && Array.isArray((data as { events?: unknown }).events)) {
    return { records: (data as { events: unknown[] }).events, malformed };
  }
  return { records: [], malformed };
}

function importOne(
  input: RawEventImport,
  options: ImportRawEventsOptions
): { event: RawEvent; block: WorkBlock } | null {
  const start = new Date(input.timestamp_start);
  const end = new Date(input.timestamp_end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return null;
  }

  // Drop records whose source_type is outside the reserved union (e.g. a typo)
  // rather than silently relabeling them — keeps `skipped` honest.
  const defaults = SOURCE_DEFAULTS[input.source_type];
  if (!defaults) {
    return null;
  }
  const source = input.source_type;

  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const eventId = nonEmpty(input.event_id) ?? `raw-${source}-${stableHash(`${startIso}-${endIso}`)}`;

  const event: RawEvent = {
    event_id: eventId,
    user_id: nonEmpty(input.user_id) ?? options.userId ?? "local-user",
    timestamp_start: startIso,
    timestamp_end: endIso,
    source_type: source,
    app_name: nonEmpty(input.app_name),
    window_title: nonEmpty(input.window_title),
    domain: nonEmpty(input.domain),
    file_path: nonEmpty(input.file_path),
    project_hint: nonEmpty(input.project_hint),
    metadata: isStringRecord(input.metadata) ? input.metadata : {},
    privacy_level: input.privacy_level ?? "derived_only"
  };

  const category = workCategories.includes(input.category as WorkCategory)
    ? (input.category as WorkCategory)
    : defaults.category;
  const mode = workModes.includes(input.mode as WorkMode)
    ? (input.mode as WorkMode)
    : defaults.mode;
  const plannedStatus = plannedStatuses.includes(input.planned_status as PlannedStatus)
    ? (input.planned_status as PlannedStatus)
    : defaults.planned_status;

  const capacityPct =
    typeof input.capacity_pct === "number" && Number.isFinite(input.capacity_pct)
      ? // Floor at 0.25 AND cap at 100 — a single block can't consume more than a whole week.
        // Mirrors the `capacityPctFromMinutes` clamp (normalize.ts) so a hand-authored generic
        // import passing an out-of-range `capacity_pct` (e.g. 500) can't escape the >100% cap
        // every other capacity path enforces.
        Math.max(0.25, Math.min(100, Math.round(input.capacity_pct)))
      : capacityPctFromSpan(start, end);

  // Sensitive raw content (window_title / file_path) is preserved on the
  // RawEvent for local inspection but kept out of the displayed evidence list.
  const evidence = [
    `Imported from ${defaults.label} source`,
    event.app_name ? `App: ${event.app_name}` : null,
    event.domain ? `Domain: ${event.domain}` : null,
    event.project_hint ? `Project hint: ${event.project_hint}` : null
  ].filter((line): line is string => line !== null);

  const block: WorkBlock = {
    // Keyed off eventId alone so the block and its RawEvent dedup together
    // (both maps collapse on eventId); a reused event_id won't leave a block
    // pointing at a dropped event.
    work_block_id: `imported-${stableHash(eventId)}`,
    week_id: options.weekId ?? isoWeekId(start),
    start_time: startIso,
    end_time: endIso,
    estimated_capacity_pct: capacityPct,
    category,
    mode,
    planned_status: plannedStatus,
    project_name:
      nonEmpty(input.project_name) ??
      event.project_hint ??
      event.app_name ??
      defaults.project_fallback,
    stakeholder_group: event.domain ?? defaults.stakeholder_group,
    derived_from: [eventId],
    evidence,
    confidence: defaults.confidence,
    user_verified: false,
    blocker_flag:
      category === "Blocked / waiting / dependency delay" || plannedStatus === "blocked",
    notes: null
  };

  return { event, block };
}

/**
 * Normalize an import payload into `RawEvent`s and derived `WorkBlock`s.
 *
 * Accepts a `RawEventImport[]`, an `{ events: [...] }` wrapper, or the JSON
 * string of either. A malformed JSON string does NOT throw — it yields an empty
 * result whose `error` carries the reason (mirroring the never-throwing calendar
 * source). Records that lack the required fields, carry an unknown
 * `source_type`, or have an invalid time span (`end > start`) are dropped and
 * counted in `skipped` rather than silently lost. Work blocks are
 * de-duplicated by id and sorted by start time.
 */
export function importRawEvents(
  payload: string | RawEventImport[] | { events: RawEventImport[] },
  options: ImportRawEventsOptions = {}
): RawEventImportResult {
  const { records, malformed } = coercePayload(payload);

  const events = new Map<string, RawEvent>();
  const blocks = new Map<string, WorkBlock>();
  let skipped = 0;

  for (const record of records) {
    const result = isImportRecord(record) ? importOne(record, options) : null;
    if (!result) {
      skipped += 1;
      continue;
    }
    events.set(result.event.event_id, result.event);
    blocks.set(result.block.work_block_id, result.block);
  }

  const work_blocks = [...blocks.values()].sort(
    (left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime()
  );

  const result: RawEventImportResult = { events: [...events.values()], work_blocks, skipped };
  if (malformed) {
    result.error = "That file could not be read — it isn't valid JSON.";
  }
  return result;
}
