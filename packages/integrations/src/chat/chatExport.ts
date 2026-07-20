import {
  importRawEvents,
  parseImportJson,
  type ImportRawEventsOptions,
  type RawEventImport,
  type RawEventImportResult
} from "../import/rawEvents";
import type { WorkBlock } from "../../../domain/src/models";
import { stableHash } from "../internal/normalize";

/**
 * Workplace chat → reviewed attention evidence.
 *
 * Chat can expose observed response, coordination, and call participation that
 * calendar + git cannot see. Availability is not work: ambient inbound traffic
 * is ignored and a directed-only mention stays a zero-capacity review card.
 * This module turns a *provider-neutral, metadata-only* legacy export into
 * reviewable `WorkBlock`s by:
 *   1. {@link parseChatExport} — JSON export → {@link ChatMessageRecord}[]
 *   2. {@link chatMessagesToImport} — messages → session {@link RawEventImport}[]
 *      (self-sent text becomes response or coordination episodes;
 *      `call`/`huddle` surfaces become collaborative meeting blocks)
 *   3. {@link importChatExport} — the full pipeline, normalized through the
 *      shared {@link importRawEvents} so capacity/id/dedup heuristics stay
 *      identical to every other source.
 *
 * ## Single generic `chat` source — vendor rides on `provider`
 *
 * There is ONE `chat` `SourceType`, not one per vendor: most orgs standardize
 * on a single chat app, so the workload signal is identical across
 * Slack / Google Chat / Webex. The specific app rides on the per-message
 * `provider` metadata field (legacy Teams files remain readable), never as a
 * separate source type or downstream display label.
 *
 * ## Privacy — METADATA ONLY (hard constraint)
 *
 * Message bodies are sensitive like window titles. This whole family is
 * metadata-only: timestamps, channel/DM/thread surface, direction, mention
 * flag, opaque thread correlation, and participant-count buckets. Conversation
 * display names are intentionally discarded because channels and spaces can be
 * sensitive, identifying, or DM counterpart names. The
 * parser reads ONLY the whitelisted fields below — it has no field that could
 * carry message text, so even an export that includes a `text`/`body` field is
 * never read, stored in evidence, or sent anywhere.
 *
 * ## Export contract (JSON)
 *
 * Pass an array, a `{ "messages": [...] }` (or `{ "events": [...] }`) wrapper,
 * or the JSON string of any of these. Each element is a metadata-only message:
 *
 * ```json
 * {
 *   "timestamp": "2026-06-22T09:01:00Z",
 *   "provider": "slack",        // slack | google_chat | webex | teams (legacy)
 *   "surface": "channel",       // channel | dm | thread | call | huddle
 *   "direction": "received",    // sent | received
 *   "mentioned_me": true,
 *   "thread_id": "T-1042",
 *   "participant_count": 6,
 *   "channel_name": "#data-requests"
 * }
 * ```
 *
 * Only `timestamp` and `provider` are required; everything else falls back to a
 * sensible default (`surface: "channel"`, `direction: "received"`,
 * `mentioned_me: false`). Malformed messages (missing/invalid timestamp or an
 * unrecognized provider) are dropped, mirroring `parseGitLog` / `parseOutlookIcs`.
 *
 * Live Slack, Google Chat, and Webex connections use the versioned native
 * evidence contract in `chatSync.ts`. This module remains the pure compatibility
 * path for existing Weekform-normalized JSON files.
 */

/** Supported live vendors plus the legacy Teams file-import compatibility id. */
export type ChatProvider = "slack" | "google_chat" | "webex" | "teams";

/**
 * Where a message was exchanged. `call`/`huddle` mark synchronous voice/video
 * sessions (Teams/Webex meetings, ad-hoc Slack huddles) — those sessionize into
 * collaborative *meeting* blocks rather than reactive interruption blocks, and
 * are de-duplicated against calendar meetings by `chat/callDedup.ts`.
 */
export type ChatSurface = "channel" | "dm" | "thread" | "call" | "huddle";

/** Direction relative to the user. */
export type ChatDirection = "sent" | "received";

/** A single parsed, metadata-only chat message. Carries NO message text. */
export interface ChatMessageRecord {
  timestamp: Date;
  provider: ChatProvider;
  surface: ChatSurface;
  direction: ChatDirection;
  /** True when the user was @-mentioned (an interruption signal). */
  mentioned_me: boolean;
  thread_id: string | null;
  participant_count: number | null;
  /** @deprecated Display names are discarded during parsing and always null. */
  channel_name: string | null;
}

export interface ChatExportOptions extends ImportRawEventsOptions {
  /** Observed actions more than this many minutes apart start a new episode. */
  sessionGapMinutes?: number;
  /** Minutes of attention assumed before a burst's first message. */
  leadMinutes?: number;
  /** Maximum gap between a directed signal and an observed response. */
  responseWindowMinutes?: number;
}

const CHAT_PROVIDERS: readonly ChatProvider[] = ["slack", "google_chat", "webex", "teams"];
const CHAT_SURFACES: readonly ChatSurface[] = ["channel", "dm", "thread", "call", "huddle"];
const CHAT_DIRECTIONS: readonly ChatDirection[] = ["sent", "received"];

/** Surfaces that represent a synchronous call/meeting rather than a text ping. */
const CALL_SURFACES: readonly ChatSurface[] = ["call", "huddle"];

/** True when a message records participation in a synchronous call/huddle. */
function isCallSurface(surface: ChatSurface): boolean {
  return CALL_SURFACES.includes(surface);
}

// Chat bursts are tighter than coding sessions, so the default gap is shorter
// than gitLog's 90m and the lead is small (a reactive ping costs a few minutes
// of context switch, not a half-hour of ramp-up).
// Exported so the Weekly interruption-load copy renders the burst-clustering
// window from this one source instead of hand-mirroring "20 minutes" — a magic
// value that would silently lie if the default gap ever moves.
export const DEFAULT_SESSION_GAP_MINUTES = 20;
const DEFAULT_LEAD_MINUTES = 5;
const DEFAULT_RESPONSE_WINDOW_MINUTES = 30;

/** Normalize common vendor aliases to the canonical provider id. */
function normalizeProvider(value: unknown): ChatProvider | null {
  if (typeof value !== "string") {
    return null;
  }
  const key = value.trim().toLowerCase();
  if (CHAT_PROVIDERS.includes(key as ChatProvider)) {
    return key as ChatProvider;
  }
  if (key === "microsoft_teams" || key === "ms_teams" || key === "msteams") {
    return "teams";
  }
  if (
    key === "google chat" ||
    key === "google-chat" ||
    key === "googlechat" ||
    key === "gchat" ||
    key === "hangouts_chat"
  ) {
    return "google_chat";
  }
  if (key === "cisco_webex" || key === "webex_teams") {
    return "webex";
  }
  return null;
}

function normalizeSurface(value: unknown): ChatSurface {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return CHAT_SURFACES.includes(key as ChatSurface) ? (key as ChatSurface) : "channel";
}

function normalizeDirection(value: unknown): ChatDirection {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  return CHAT_DIRECTIONS.includes(key as ChatDirection) ? (key as ChatDirection) : "received";
}

function normalizeCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  return null;
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Parse a metadata-only chat export into message records. Accepts an array, a
 * `{ messages: [...] }` (or `{ events: [...] }`) wrapper, or the JSON string of
 * either. An empty/whitespace OR malformed string is treated as "no data"
 * (returns `[]`) rather than throwing — the same lenient contract as
 * `parseGitLog` / `parseOutlookIcs`; {@link importChatExport} is where a
 * malformed string is turned into a surfaceable error. Messages missing a valid
 * `timestamp` or a recognized `provider` are dropped.
 *
 * Only the whitelisted metadata fields are read — there is intentionally no
 * field that could carry message text.
 */
export function parseChatExport(
  content: string | unknown[] | { messages?: unknown[]; events?: unknown[] }
): ChatMessageRecord[] {
  const { data } = parseImportJson(content);
  let rows: unknown[] = [];
  if (Array.isArray(data)) {
    rows = data;
  } else if (data && typeof data === "object" && Array.isArray((data as { messages?: unknown }).messages)) {
    rows = (data as { messages: unknown[] }).messages;
  } else if (data && typeof data === "object" && Array.isArray((data as { events?: unknown }).events)) {
    // `{ events: [...] }` is the sibling import-envelope shape (rawEvents.ts#coercePayload)
    // and is promised by this function's own JSDoc. Read it as a fallback after
    // `.messages` so an export following either documented wrapper parses instead
    // of silently dropping to zero records.
    rows = (data as { events: unknown[] }).events;
  }

  const records: ChatMessageRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const message = row as Record<string, unknown>;
    const provider = normalizeProvider(message.provider);
    if (!provider) {
      continue;
    }
    const timestamp = new Date(typeof message.timestamp === "string" ? message.timestamp : NaN);
    if (Number.isNaN(timestamp.getTime())) {
      continue;
    }

    records.push({
      timestamp,
      provider,
      surface: normalizeSurface(message.surface),
      direction: normalizeDirection(message.direction),
      mentioned_me: message.mentioned_me === true,
      thread_id: normalizeLabel(message.thread_id),
      participant_count: normalizeCount(message.participant_count),
      // Conversation display names can identify a person, client, incident, or
      // confidential project. Do not retain them even when an old normalized
      // export contains the field.
      channel_name: null
    });
  }

  return records;
}

interface LegacyChatEpisode {
  provider: ChatProvider;
  correlationKey: string;
  isCall: boolean;
  messages: ChatMessageRecord[];
}

interface LegacyChatAttentionModel {
  imports: RawEventImport[];
  reviewBlocks: WorkBlock[];
}

function legacyCorrelationKey(message: ChatMessageRecord): string {
  if (message.thread_id) return `thread:${message.thread_id}`;
  if (message.surface === "dm") return "dm";
  return `surface:${message.surface}`;
}

function sharesDirectedContext(
  directed: ChatMessageRecord,
  observed: ChatMessageRecord
): boolean {
  if (directed.provider !== observed.provider) return false;
  if (directed.thread_id && observed.thread_id) {
    return directed.thread_id === observed.thread_id;
  }
  // The legacy shape has no safe conversation id once display names are
  // discarded. Two unkeyed DMs or channel messages can belong to different
  // people/spaces, so fail closed rather than inventing a response link.
  return false;
}

function isoWeekId(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function sessionizeLegacyMessages(
  messages: readonly ChatMessageRecord[],
  gapMs: number
): LegacyChatEpisode[] {
  const groups = new Map<string, LegacyChatEpisode>();
  for (const message of messages) {
    const isCall = isCallSurface(message.surface);
    const correlationKey = legacyCorrelationKey(message);
    const key = `${message.provider}:${isCall ? "call" : "text"}:${correlationKey}`;
    const group = groups.get(key);
    if (group) {
      group.messages.push(message);
    } else {
      groups.set(key, { provider: message.provider, correlationKey, isCall, messages: [message] });
    }
  }

  const episodes: LegacyChatEpisode[] = [];
  for (const group of groups.values()) {
    const sorted = [...group.messages].sort((left, right) =>
      left.timestamp.getTime() - right.timestamp.getTime()
    );
    let current: ChatMessageRecord[] = [];
    for (const message of sorted) {
      const previous = current[current.length - 1];
      if (previous && message.timestamp.getTime() - previous.timestamp.getTime() > gapMs) {
        episodes.push({ ...group, messages: current });
        current = [];
      }
      current.push(message);
    }
    if (current.length > 0) episodes.push({ ...group, messages: current });
  }
  return episodes.sort((left, right) =>
    left.messages[0].timestamp.getTime() - right.messages[0].timestamp.getTime()
  );
}

/**
 * Apply the same attention contract as the live connectors to normalized
 * legacy JSON. Ambient inbound traffic is ignored; received mentions remain
 * zero-capacity review evidence; only self-sent text and joined calls create
 * observed workload episodes.
 */
function buildLegacyAttentionModel(
  messages: ChatMessageRecord[],
  options: ChatExportOptions
): LegacyChatAttentionModel {
  const gapMs = Math.max(0, options.sessionGapMinutes ?? DEFAULT_SESSION_GAP_MINUTES) * 60_000;
  const leadMs = Math.max(0, options.leadMinutes ?? DEFAULT_LEAD_MINUTES) * 60_000;
  const responseWindowMs = Math.max(
    1,
    options.responseWindowMinutes ?? DEFAULT_RESPONSE_WINDOW_MINUTES
  ) * 60_000;
  const directed = messages
    .filter((message) =>
      !isCallSurface(message.surface) &&
      message.direction === "received" &&
      message.mentioned_me
    )
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  const observed = messages.filter((message) =>
    isCallSurface(message.surface) || message.direction === "sent"
  );
  const episodes = sessionizeLegacyMessages(observed, gapMs);
  const consumedDirected = new Set<ChatMessageRecord>();
  const imports = episodes.map((episode) => {
    const first = episode.messages[0];
    const last = episode.messages[episode.messages.length - 1];
    const lastAt = last.timestamp.getTime();
    const precursors = episode.isCall
      ? []
      : directed.filter((candidate) => {
          if (consumedDirected.has(candidate) || !sharesDirectedContext(candidate, last)) return false;
          const candidateAt = candidate.timestamp.getTime();
          return candidateAt <= lastAt && lastAt - candidateAt <= responseWindowMs;
        });
    precursors.forEach((message) => consumedDirected.add(message));

    const isResponse = !episode.isCall && precursors.length > 0;
    const kind = episode.isCall
      ? "call"
      : isResponse
        ? "response_episode"
        : "coordination_episode";
    const projectName = episode.isCall
      ? "Chat call"
      : isResponse
        ? "Reactive messaging"
        : "Chat coordination";
    const metadata: Record<string, string> = {
      provider: episode.provider,
      kind,
      attention_grade: "observed",
      attention_signal: episode.isCall ? "call_joined" : "self_sent",
      coverage: "observed"
    };
    if (isResponse) metadata.directed_trigger = "true";

    return {
      event_id: `chat-${episode.isCall ? "call-" : ""}${episode.provider}-${first.timestamp.toISOString()}`,
      timestamp_start: new Date(first.timestamp.getTime() - leadMs).toISOString(),
      timestamp_end: new Date(lastAt + 60_000).toISOString(),
      source_type: "chat" as const,
      // Provider remains in local metadata for individual source analysis. It
      // must not ride into display evidence or downstream AI/replica copy.
      app_name: "Workplace chat",
      project_name: projectName,
      privacy_level: "derived_only" as const,
      metadata,
      ...(episode.isCall
        ? {
            category: "Meetings / stakeholder syncs" as const,
            mode: "Collaborative" as const,
            planned_status: "fixed" as const
          }
        : !isResponse
          ? {
              category: "Admin / coordination" as const,
              mode: "Collaborative" as const,
              planned_status: "unplanned" as const
            }
          : {})
    };
  });

  const unmatchedDirected = directed.filter((message) => !consumedDirected.has(message));
  const reviewEpisodes = sessionizeLegacyMessages(unmatchedDirected, gapMs);
  const reviewBlocks = reviewEpisodes.map((episode) => {
    const first = episode.messages[0];
    const start = first.timestamp;
    const opaqueId = stableHash(
      `${episode.provider}:${episode.correlationKey}:${first.timestamp.toISOString()}`
    );
    const derivedId = `chat-${episode.provider}-review-${opaqueId}`;
    return {
      work_block_id: `chat-review-${episode.provider}-${opaqueId}`,
      week_id: options.weekId ?? isoWeekId(start),
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 60_000).toISOString(),
      estimated_capacity_pct: 0,
      category: "Ad hoc stakeholder requests",
      mode: "Reactive",
      planned_status: "unplanned",
      project_name: "Directed chat request",
      stakeholder_group: "Workplace chat",
      derived_from: [derivedId],
      evidence: [
        "A content-free directed chat signal was detected without an observed response",
        "This review card contributes 0% until you correct its time and confirm it"
      ],
      confidence: 0.45,
      user_verified: false,
      blocker_flag: false,
      notes: null
    } satisfies WorkBlock;
  });

  return { imports, reviewBlocks };
}

/** Emit observed, content-free legacy Chat episodes as canonical raw imports. */
export function chatMessagesToImport(
  messages: ChatMessageRecord[],
  options: ChatExportOptions = {}
): RawEventImport[] {
  return buildLegacyAttentionModel(messages, options).imports;
}

/**
 * Full pipeline: parse a metadata-only chat export, apply the reviewed-attention
 * contract, and normalize observed episodes through {@link importRawEvents}.
 * Directed-only signals are returned as zero-capacity review cards; ambient
 * inbound traffic is ignored.
 *
 * A malformed JSON export does NOT throw (aligning with the never-throwing
 * calendar source): it returns an empty result whose `error` the UI can surface.
 */
export function importChatExport(
  content: string | unknown[] | { messages?: unknown[]; events?: unknown[] },
  options: ChatExportOptions = {}
): RawEventImportResult {
  // Parse once, up front, so a malformed string becomes a surfaceable error
  // instead of a thrown SyntaxError. `parseChatExport` then receives the parsed
  // value (never a raw bad string), so it does not re-parse.
  const { data, malformed } = parseImportJson(content);
  if (malformed) {
    return {
      events: [],
      work_blocks: [],
      skipped: 0,
      error: "That chat export could not be read — it isn't valid JSON."
    };
  }
  const messages = parseChatExport(data as string | unknown[] | { messages?: unknown[]; events?: unknown[] });
  const model = buildLegacyAttentionModel(messages, options);
  const imported = importRawEvents(model.imports, {
    weekId: options.weekId,
    userId: options.userId
  });
  const observedBlocks = imported.work_blocks.map((block) => ({
    ...block,
    confidence: 0.82,
    stakeholder_group: "Workplace chat"
  }));
  return {
    ...imported,
    work_blocks: [...observedBlocks, ...model.reviewBlocks].sort((left, right) =>
      left.start_time.localeCompare(right.start_time)
    )
  };
}
