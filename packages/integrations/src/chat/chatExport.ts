import {
  importRawEvents,
  parseImportJson,
  type ImportRawEventsOptions,
  type RawEventImport,
  type RawEventImportResult
} from "../import/rawEvents";

/**
 * Workplace chat → reactive-work signal.
 *
 * Chat is the one source that exposes interruption load and ad-hoc/reactive
 * work — the part of the capacity model that calendar + git can't see. A burst
 * of messages (especially mentions) over a short window is a reactive
 * interruption; this module turns a *provider-neutral, metadata-only* chat
 * export into reactive `WorkBlock`s by:
 *   1. {@link parseChatExport} — JSON export → {@link ChatMessageRecord}[]
 *   2. {@link chatMessagesToImport} — messages → session {@link RawEventImport}[]
 *      (consecutive text pings collapse into one reactive block; `call`/`huddle`
 *      surfaces collapse into collaborative *meeting* blocks instead)
 *   3. {@link importChatExport} — the full pipeline, normalized through the
 *      shared {@link importRawEvents} so capacity/id/dedup heuristics stay
 *      identical to every other source.
 *
 * ## Single generic `chat` source — vendor rides on `provider`
 *
 * There is ONE `chat` `SourceType`, not one per vendor: most orgs standardize
 * on a single chat app, so the workload signal is identical across
 * Slack / Microsoft Teams / Webex. The specific app rides on the per-message
 * `provider` field (and, later, the `ChatSource` descriptor), never as a
 * separate source type.
 *
 * ## Privacy — METADATA ONLY (hard constraint)
 *
 * Message bodies are sensitive like window titles. This whole family is
 * metadata-only: timestamps, channel/DM/thread surface, direction, mention
 * flag, thread id, participant counts, and (non-secret) channel names. The
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
 *   "provider": "slack",        // slack | teams | webex
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
 * The live Slack Web API / Microsoft Graph / Webex fetch is **[manual / Rust]**
 * — it belongs in `apps/desktop/src-tauri/` (OAuth + native fetch) and is a
 * follow-up. This module is the pure, testable half that the Rust side feeds.
 */

/** Supported chat vendors. The signal is vendor-uniform; this only labels it. */
export type ChatProvider = "slack" | "teams" | "webex";

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
  /** Channel/DM display name — a label, never message content. */
  channel_name: string | null;
}

export interface ChatExportOptions extends ImportRawEventsOptions {
  /** Messages more than this many minutes apart start a new reactive block. */
  sessionGapMinutes?: number;
  /** Minutes of attention assumed before a burst's first message. */
  leadMinutes?: number;
}

const CHAT_PROVIDERS: readonly ChatProvider[] = ["slack", "teams", "webex"];
const CHAT_SURFACES: readonly ChatSurface[] = ["channel", "dm", "thread", "call", "huddle"];
const CHAT_DIRECTIONS: readonly ChatDirection[] = ["sent", "received"];

/** Surfaces that represent a synchronous call/meeting rather than a text ping. */
const CALL_SURFACES: readonly ChatSurface[] = ["call", "huddle"];

/** True when a message records participation in a synchronous call/huddle. */
function isCallSurface(surface: ChatSurface): boolean {
  return CALL_SURFACES.includes(surface);
}

/**
 * Surfaces whose `channel_name` is a shared, topic-style label safe to surface
 * as a project name. Only a `channel` name qualifies — it is unambiguously a
 * shared named space (`#data-requests`). Every other surface can be scoped to a
 * person: a `dm`/`call`/`huddle` name is frequently the counterpart's display
 * name (or a sensitive meeting subject), and even a `thread` can be a threaded
 * reply inside a DM whose name is personal. Because the surface alone can't
 * prove such a name is non-personal, those names are treated as PII we must
 * never leak into `project_name`/`project_hint`/evidence (this module's
 * metadata-only privacy constraint) and are dropped — the burst falls back to a
 * generic label instead. A threaded reply in a real channel thus loses only the
 * nicety of a channel label, not correctness.
 */
const SHAREABLE_LABEL_SURFACES: readonly ChatSurface[] = ["channel"];

/** True when a surface's `channel_name` is a shared topic label, not a person. */
function surfaceHasShareableLabel(surface: ChatSurface): boolean {
  return SHAREABLE_LABEL_SURFACES.includes(surface);
}

/** Human label for a provider, used in the imported event's `app_name`. */
const PROVIDER_LABEL: Record<ChatProvider, string> = {
  slack: "Slack",
  teams: "Microsoft Teams",
  webex: "Webex"
};

// Chat bursts are tighter than coding sessions, so the default gap is shorter
// than gitLog's 90m and the lead is small (a reactive ping costs a few minutes
// of context switch, not a half-hour of ramp-up).
// Exported so the Weekly interruption-load copy renders the burst-clustering
// window from this one source instead of hand-mirroring "20 minutes" — a magic
// value that would silently lie if the default gap ever moves.
export const DEFAULT_SESSION_GAP_MINUTES = 20;
const DEFAULT_LEAD_MINUTES = 5;

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
      channel_name: normalizeLabel(message.channel_name)
    });
  }

  return records;
}

/**
 * Group messages into bursts and emit one `RawEventImport` per burst.
 *
 * Messages are grouped by provider AND kind (text vs. `call`/`huddle`), sorted
 * by time, then split wherever two consecutive messages are more than
 * `sessionGapMinutes` apart — exactly how {@link gitCommitsToImport} splits
 * commits. Keying on kind keeps a synchronous call from merging into an adjacent
 * text burst. Each burst spans `leadMinutes` before its first message through its
 * last message, so even a lone ping gets a non-zero block.
 *
 * Text bursts become reactive interruption blocks (`Ad hoc stakeholder
 * requests` / `Reactive`); call/huddle bursts become collaborative *meeting*
 * blocks (`Meetings / stakeholder syncs` / `Collaborative` / `fixed`), tagged
 * `metadata.kind = "call"` so callers can route them to calendar dedup. The
 * emitted metadata is counts + channel/participant labels only; no message text.
 */
export function chatMessagesToImport(
  messages: ChatMessageRecord[],
  options: ChatExportOptions = {}
): RawEventImport[] {
  const gapMs = Math.max(0, options.sessionGapMinutes ?? DEFAULT_SESSION_GAP_MINUTES) * 60_000;
  const leadMs = Math.max(0, options.leadMinutes ?? DEFAULT_LEAD_MINUTES) * 60_000;

  // Group by provider + kind so a call never sessionizes together with the text
  // pings around it. The key embeds both; the value carries the typed pieces.
  const groups = new Map<string, { provider: ChatProvider; isCall: boolean; messages: ChatMessageRecord[] }>();
  for (const message of messages) {
    const isCall = isCallSurface(message.surface);
    const key = `${message.provider}::${isCall ? "call" : "text"}`;
    const group = groups.get(key);
    if (group) {
      group.messages.push(message);
    } else {
      groups.set(key, { provider: message.provider, isCall, messages: [message] });
    }
  }

  const imports: RawEventImport[] = [];
  for (const { provider, isCall, messages: groupMessages } of groups.values()) {
    const sorted = [...groupMessages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    let session: ChatMessageRecord[] = [];

    const flush = () => {
      if (session.length === 0) {
        return;
      }
      const first = session[0];
      const last = session[session.length - 1];
      const end = last.timestamp;
      // Pad backwards by leadMs, but never collapse to a zero-length span:
      // importRawEvents drops any record with end <= start, which would
      // silently lose a lone message.
      const start = new Date(Math.min(first.timestamp.getTime() - leadMs, end.getTime() - 60_000));

      const received = session.filter((m) => m.direction === "received").length;
      const sent = session.length - received;
      const mentions = session.filter((m) => m.mentioned_me).length;
      // Only a `channel` surface contributes a channel_name label — a
      // dm/thread/call/huddle name can be a counterpart's display name (PII)
      // or a sensitive meeting subject, so it is excluded here, before it can
      // reach project_name/project_hint/evidence. A burst with no shareable
      // name falls back to the generic `fallbackName` below.
      const channels = [
        ...new Set(
          session
            .filter((m) => surfaceHasShareableLabel(m.surface))
            .map((m) => m.channel_name)
            .filter((c): c is string => c !== null)
        )
      ];
      const surfaces = [...new Set(session.map((m) => m.surface))];
      const threads = new Set(session.map((m) => m.thread_id).filter((t): t is string => t !== null)).size;
      const participantCounts = session
        .map((m) => m.participant_count)
        .filter((n): n is number => n !== null);
      const maxParticipants = participantCounts.length > 0 ? Math.max(...participantCounts) : null;

      // Metadata-only: counts + channel/participant labels. NO message text.
      const metadata: Record<string, string> = {
        provider,
        kind: isCall ? "call" : "message",
        messages: String(session.length),
        received: String(received),
        sent: String(sent),
        mentions: String(mentions),
        surfaces: surfaces.join(", ")
      };
      if (channels.length > 0) {
        // Join with a newline, NOT ", ": a channel/space display name can itself
        // contain a comma (Webex spaces, free-form Teams channels), so a comma
        // delimiter would let `capacity.ts#parseChannelLabels` split one real
        // channel into phantom stakeholder groups. A display name is single-line,
        // so a newline is an unambiguous separator. Parser must split on the same.
        metadata.channels = channels.join("\n");
      }
      if (threads > 0) {
        metadata.threads = String(threads);
      }
      if (maxParticipants !== null) {
        metadata.participants = String(maxParticipants);
      }

      // A single dominant channel labels the block; mixed-channel bursts fall
      // back to a generic name (call vs. reactive messaging).
      const singleChannel = channels.length === 1 ? channels[0] : null;
      const fallbackName = isCall ? `${PROVIDER_LABEL[provider]} call` : "Reactive messaging";

      imports.push({
        // Sessions within a provider+kind never overlap (sorted + gap-split), so
        // the first message's instant keys the burst uniquely. Only call bursts
        // take a prefix — text bursts keep the original `chat-<provider>-<iso>`
        // id so a re-import upserts existing reactive blocks instead of
        // duplicating them, while a call and a text burst that start at the same
        // instant still resolve to distinct ids.
        event_id: `chat-${isCall ? "call-" : ""}${provider}-${first.timestamp.toISOString()}`,
        timestamp_start: start.toISOString(),
        timestamp_end: end.toISOString(),
        source_type: "chat",
        app_name: PROVIDER_LABEL[provider],
        project_hint: singleChannel,
        project_name: singleChannel ?? fallbackName,
        // Call/huddle bursts are synchronous meetings, not reactive pings.
        ...(isCall
          ? {
              category: "Meetings / stakeholder syncs" as const,
              mode: "Collaborative" as const,
              planned_status: "fixed" as const
            }
          : {}),
        metadata
      });
      session = [];
    };

    for (const message of sorted) {
      if (
        session.length > 0 &&
        message.timestamp.getTime() - session[session.length - 1].timestamp.getTime() > gapMs
      ) {
        flush();
      }
      session.push(message);
    }
    flush();
  }

  return imports;
}

/**
 * Full pipeline: parse a metadata-only chat export, sessionize it into reactive
 * bursts, and normalize through {@link importRawEvents}. Returns
 * `{ events, work_blocks, skipped }` exactly like every other source import —
 * the work blocks are reactive (`Ad hoc stakeholder requests` / `Reactive` /
 * `unplanned`), keyed by provider → burst.
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
  const imports = chatMessagesToImport(messages, options);
  return importRawEvents(imports, { weekId: options.weekId, userId: options.userId });
}
