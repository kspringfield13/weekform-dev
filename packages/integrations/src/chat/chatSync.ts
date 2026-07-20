import type { RawEvent, WorkBlock } from "../../../domain/src/models";
import { importRawEvents } from "../import/rawEvents";

/** Providers that can be connected from Settings. Legacy Teams files remain import-only. */
export type ChatProviderId = "slack" | "google_chat" | "webex";

export interface ChatProviderDescriptor {
  id: ChatProviderId;
  label: string;
  connection: "oauth_pkce" | "oauth_broker";
  description: string;
  contentBoundary: string;
  requiresBroker: boolean;
}

export const CHAT_PROVIDERS: readonly ChatProviderDescriptor[] = [
  {
    id: "slack",
    label: "Slack",
    connection: "oauth_pkce",
    description: "Sync top-level message evidence from currently listed, non-archived Slack conversations. Thread replies are not included.",
    contentBoundary: "Message content is discarded at the native boundary.",
    requiresBroker: false,
  },
  {
    id: "google_chat",
    label: "Google Chat",
    connection: "oauth_pkce",
    description: "Connect Google Chat and sync attention evidence from spaces and direct messages.",
    contentBoundary: "Message content is discarded at the native boundary.",
    requiresBroker: false,
  },
  {
    id: "webex",
    label: "Webex",
    connection: "oauth_broker",
    description: "Connect Webex and sync attention evidence from rooms and direct messages.",
    contentBoundary: "Message content is discarded at the native boundary.",
    requiresBroker: true,
  },
] as const;

export function providerDescriptor(provider: ChatProviderId): ChatProviderDescriptor {
  const descriptor = CHAT_PROVIDERS.find((candidate) => candidate.id === provider);
  if (!descriptor) {
    throw new Error(`Unsupported chat provider: ${provider}`);
  }
  return descriptor;
}

export interface ChatRangeInput {
  start_date: string;
  end_date: string;
}

export interface NormalizedChatRange extends ChatRangeInput {
  start: string;
  end_exclusive: string;
}

const DAY_MS = 86_400_000;
const MAX_SYNC_DAYS = 90;

function parseDateOnly(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    throw new Error(`${label} is not a valid date.`);
  }
  return parsed;
}

/** Normalize an inclusive date range and keep transfers intentionally bounded. */
export function normalizeChatRange(input: ChatRangeInput): NormalizedChatRange {
  const start = parseDateOnly(input.start_date, "Start date");
  const end = parseDateOnly(input.end_date, "End date");
  if (end.getTime() < start.getTime()) {
    throw new Error("End date must be on or after start date.");
  }
  const endExclusive = new Date(end);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const inclusiveDays = Math.round((endExclusive.getTime() - start.getTime()) / DAY_MS);
  if (inclusiveDays > MAX_SYNC_DAYS) {
    throw new Error(`Chat transfers are limited to ${MAX_SYNC_DAYS} days at a time.`);
  }
  return {
    start_date: input.start_date,
    end_date: input.end_date,
    start: start.toISOString(),
    end_exclusive: endExclusive.toISOString(),
  };
}

export type ChatSyncMode = "live_sync" | "file_import";

interface ChatMergeOptions {
  provider: ChatProviderId;
  range: NormalizedChatRange;
  mode: ChatSyncMode;
}

export interface ChatReconciliationDelta {
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
}

function inRange(timestamp: string, range: NormalizedChatRange): boolean {
  const time = new Date(timestamp).getTime();
  return (
    Number.isFinite(time) &&
    time >= new Date(range.start).getTime() &&
    time < new Date(range.end_exclusive).getTime()
  );
}

function eventProvider(event: RawEvent): string | null {
  return event.source_type === "chat" ? event.metadata.provider ?? null : null;
}

/** Replace only one provider's bounded live-sync slice and report the exact delta. */
export function reconcileChatEvents(
  current: RawEvent[],
  incoming: RawEvent[],
  options: ChatMergeOptions,
): { events: RawEvent[]; delta: ChatReconciliationDelta } {
  const currentSlice = current.filter(
    (event) => eventProvider(event) === options.provider && inRange(event.timestamp_start, options.range),
  );
  const incomingSlice = incoming.filter(
    (event) => eventProvider(event) === options.provider && inRange(event.timestamp_start, options.range),
  );
  const currentById = new Map(currentSlice.map((event) => [event.event_id, event]));
  const incomingById = new Map(incomingSlice.map((event) => [event.event_id, event]));

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const [id, event] of incomingById) {
    const existing = currentById.get(id);
    if (!existing) {
      added += 1;
    } else if (JSON.stringify(existing) === JSON.stringify(event)) {
      unchanged += 1;
    } else {
      updated += 1;
    }
  }

  const removed = options.mode === "live_sync"
    ? [...currentById.keys()].filter((id) => !incomingById.has(id)).length
    : 0;
  const retained = current.filter((event) => {
    if (eventProvider(event) !== options.provider || !inRange(event.timestamp_start, options.range)) {
      return true;
    }
    return options.mode !== "live_sync" && !incomingById.has(event.event_id);
  });
  const events = [...retained, ...incomingById.values()].sort(
    (left, right) => new Date(left.timestamp_start).getTime() - new Date(right.timestamp_start).getTime(),
  );
  return { events, delta: { added, updated, unchanged, removed } };
}

function blockProvider(block: WorkBlock): string | null {
  for (const sourceId of block.derived_from) {
    for (const provider of [...CHAT_PROVIDERS.map(({ id }) => id), "teams"] as const) {
      if (sourceId.includes(`chat-${provider}-`) || sourceId.includes(`chat-call-${provider}-`)) {
        return provider;
      }
    }
  }
  return null;
}

const REVIEWED_FIELDS = [
  "category",
  "mode",
  "planned_status",
  "project_name",
  "stakeholder_group",
  "confidence",
  "user_verified",
  "blocker_flag",
  "notes",
] as const satisfies readonly (keyof WorkBlock)[];

/**
 * Merge chat-derived blocks while preserving reviewed truth. Provider timing and
 * evidence may refresh; user corrections remain authoritative.
 */
export function mergeChatWorkBlocks(
  current: WorkBlock[],
  incoming: WorkBlock[],
  options: ChatMergeOptions & { excludedBlockIds?: ReadonlySet<string> },
): WorkBlock[] {
  const incomingSlice = incoming.filter(
    (block) => blockProvider(block) === options.provider && inRange(block.start_time, options.range),
  );
  const incomingById = new Map(incomingSlice.map((block) => [block.work_block_id, block]));
  const currentById = new Map(current.map((block) => [block.work_block_id, block]));

  const retained = current.filter((block) => {
    if (blockProvider(block) !== options.provider || !inRange(block.start_time, options.range)) {
      return true;
    }
    if (incomingById.has(block.work_block_id)) {
      return false;
    }
    // A reviewed block is durable reviewed truth even when provider retention
    // or permissions make its original evidence disappear on a later sync.
    return block.user_verified || options.mode !== "live_sync";
  });

  for (const incomingBlock of incomingById.values()) {
    if (options.excludedBlockIds?.has(incomingBlock.work_block_id)) {
      continue;
    }
    const existing = currentById.get(incomingBlock.work_block_id);
    if (!existing?.user_verified) {
      retained.push(incomingBlock);
      continue;
    }
    const merged = { ...incomingBlock };
    for (const field of REVIEWED_FIELDS) {
      // TypeScript cannot express assignment across a heterogeneous key tuple.
      Object.assign(merged, { [field]: existing[field] });
    }
    retained.push(merged);
  }

  return retained.sort(
    (left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime(),
  );
}

export type ChatAttentionSignal =
  | "ambient"
  | "direct_mention"
  | "direct_message"
  | "reply_to_self"
  | "self_sent"
  | "self_reaction"
  | "call_joined";

export type ChatAttentionGrade = "ambient" | "directed" | "observed";

/**
 * Versioned, content-free evidence contract. Native adapters may receive
 * content from provider APIs, but only this projected shape crosses into React.
 */
export interface ChatEvidenceEventV1 {
  schema_version: 1;
  event_id: string;
  provider: ChatProviderId;
  timestamp: string;
  attention_signal: ChatAttentionSignal;
  attention_grade: ChatAttentionGrade;
  correlation_key: string;
  conversation_key?: string;
  thread_key?: string | null;
  surface?: "channel" | "space" | "dm" | "group_dm" | "thread" | "call";
  direction?: "inbound" | "outbound";
  participant_count_bucket?: "1" | "2-5" | "6-20" | "21+" | "unknown";
  silent?: boolean;
  tombstone?: boolean;
  revision?: string | null;
  imported_at?: string;
  local_only?: true;
  /** Accepted only so legacy/test inputs can prove it is discarded. */
  conversation_display_name?: string | null;
  /** Accepted only to bucket locally; the exact count is never retained. */
  participant_count?: number | null;
}

/** Reconcile the canonical content-free evidence that precedes episode transformation. */
export function reconcileChatEvidence(
  current: readonly ChatEvidenceEventV1[],
  incoming: readonly ChatEvidenceEventV1[],
  options: ChatMergeOptions,
): ChatEvidenceEventV1[] {
  const incomingSlice = incoming.filter(
    (event) => event.provider === options.provider && inRange(event.timestamp, options.range),
  );
  const incomingById = new Map(incomingSlice.map((event) => [event.event_id, event]));
  const retained = current.filter((event) => {
    if (event.provider !== options.provider || !inRange(event.timestamp, options.range)) {
      return true;
    }
    return options.mode !== "live_sync" && !incomingById.has(event.event_id);
  });
  return [...retained, ...incomingById.values()].sort(
    (left, right) => left.timestamp.localeCompare(right.timestamp),
  );
}

export interface ChatReviewSignal {
  event_id: string;
  provider: ChatProviderId;
  timestamp: string;
  attention_signal: Extract<ChatAttentionSignal, "direct_mention" | "direct_message" | "reply_to_self">;
  reason: "directed_unconfirmed";
}

export interface ChatTransformResult {
  events: RawEvent[];
  work_blocks: WorkBlock[];
  review_signals: ChatReviewSignal[];
  skipped: number;
}

/**
 * Materialize directed-only signals as zero-capacity review cards. They enter
 * the existing Today review flow but cannot change capacity unless the user
 * edits the time span and confirms the block.
 */
export function chatReviewSignalsToWorkBlocks(
  signals: readonly ChatReviewSignal[],
): WorkBlock[] {
  return signals.flatMap((signal) => {
    const start = new Date(signal.timestamp);
    if (!Number.isFinite(start.getTime())) return [];
    const end = new Date(start.getTime() + 60_000);
    return [{
      work_block_id: `chat-review-${signal.provider}-${signal.event_id}`,
      week_id: isoWeekId(start),
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      estimated_capacity_pct: 0,
      category: "Ad hoc stakeholder requests",
      mode: "Reactive",
      planned_status: "unplanned",
      project_name: "Directed chat request",
      stakeholder_group: "Workplace chat",
      derived_from: [`chat-${signal.provider}-review-${signal.event_id}`],
      evidence: [
        "A content-free directed chat signal was detected without an observed response",
        "This review card contributes 0% until you correct its time and confirm it",
      ],
      confidence: 0.45,
      user_verified: false,
      blocker_flag: false,
      notes: null,
    } satisfies WorkBlock];
  }).sort((left, right) => left.start_time.localeCompare(right.start_time));
}

function participantBucket(event: ChatEvidenceEventV1): string | null {
  if (event.participant_count_bucket) {
    return event.participant_count_bucket;
  }
  const count = event.participant_count;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return null;
  if (count <= 1) return "1";
  if (count <= 5) return "2-5";
  if (count <= 20) return "6-20";
  return "21+";
}

function isoWeekId(date: Date): string {
  // Workload weeks follow the Mac user's local calendar day. Convert that local
  // date to a UTC-only scratch value for ISO-week arithmetic so a Sunday-evening
  // event is not silently filed into Monday's week by its UTC instant.
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function sharesDirectedContext(
  directed: ChatEvidenceEventV1,
  observed: ChatEvidenceEventV1,
): boolean {
  if (
    directed.provider !== observed.provider ||
    directed.correlation_key !== observed.correlation_key
  ) return false;

  // A one-to-one DM is a bounded conversation context. In channels and spaces,
  // however, two nearby top-level messages can be unrelated even when they
  // share the same conversation key. Consume a directed review signal there
  // only when the provider supplied the same explicit thread identifier.
  if (directed.surface === "dm" && observed.surface === "dm") return true;
  if (directed.thread_key && observed.thread_key) {
    return directed.thread_key === observed.thread_key;
  }

  // Legacy normalized imports predate surface/thread fields. Preserve their
  // established correlation behavior without weakening the native contract.
  return !directed.surface && !observed.surface;
}

/**
 * Convert content-free evidence into reviewable workload episodes. Ambient
 * traffic is ignored. Directed-only evidence is review-only. Capacity is
 * booked only for an observed self action (or a joined call).
 */
export function transformChatEvidence(
  evidence: readonly ChatEvidenceEventV1[],
  options: {
    userId?: string;
    responseWindowMinutes?: number;
    leadMinutes?: number;
    sessionGapMinutes?: number;
  } = {},
): ChatTransformResult {
  const responseWindowMs = Math.max(1, options.responseWindowMinutes ?? 30) * 60_000;
  const leadMs = Math.max(1, options.leadMinutes ?? 5) * 60_000;
  const sessionGapMs = Math.max(1, options.sessionGapMinutes ?? 20) * 60_000;
  const valid = evidence
    .filter((event) => {
      const time = new Date(event.timestamp).getTime();
      return Number.isFinite(time) && event.schema_version === 1 && !event.tombstone && !event.silent;
    })
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
  const skipped = evidence.length - valid.length;
  const directed = valid.filter((event) => event.attention_grade === "directed");
  const observed = valid.filter(
    (event) => event.attention_grade === "observed" && event.attention_signal !== "ambient",
  );
  const consumedDirected = new Set<string>();
  const episodes: Array<{
    provider: ChatProviderId;
    correlationKey: string;
    events: ChatEvidenceEventV1[];
  }> = [];
  const latestEpisodeByKey = new Map<string, (typeof episodes)[number]>();
  for (const event of observed) {
    const episodeKey = `${event.provider}:${event.correlation_key}`;
    const previous = latestEpisodeByKey.get(episodeKey);
    const previousEvent = previous?.events[previous.events.length - 1];
    if (
      previous &&
      previousEvent &&
      new Date(event.timestamp).getTime() - new Date(previousEvent.timestamp).getTime() <= sessionGapMs
    ) {
      previous.events.push(event);
    } else {
      const episode = { provider: event.provider, correlationKey: event.correlation_key, events: [event] };
      episodes.push(episode);
      latestEpisodeByKey.set(episodeKey, episode);
    }
  }

  const imports = episodes.map((episode) => {
    const first = episode.events[0];
    const last = episode.events[episode.events.length - 1];
    const firstObservedAt = new Date(first.timestamp).getTime();
    const lastObservedAt = new Date(last.timestamp).getTime();
    const precursors = directed.filter((candidate) => {
      const directedAt = new Date(candidate.timestamp).getTime();
      return episode.events.some((observedEvent) => {
        if (!sharesDirectedContext(candidate, observedEvent)) return false;
        const observedAt = new Date(observedEvent.timestamp).getTime();
        return directedAt <= observedAt && observedAt - directedAt <= responseWindowMs;
      });
    });
    precursors.forEach((precursor) => consumedDirected.add(precursor.event_id));
    // A directed request establishes context, not elapsed work. Book only the
    // bounded observed-action episode; never turn response latency into labor.
    const startMs = firstObservedAt - leadMs;
    const endMs = Math.max(lastObservedAt + 60_000, startMs + 60_000);
    const bucket = participantBucket(last);
    const isCall = episode.events.some((event) => event.attention_signal === "call_joined");
    const isResponse = precursors.length > 0 || episode.events.some(
      (event) => event.attention_signal === "self_reaction",
    );
    const kind = isCall ? "call" : isResponse ? "response_episode" : "coordination_episode";
    const projectName = isCall
      ? "Chat call"
      : isResponse
        ? "Reactive messaging"
        : "Chat coordination";
    const metadata: Record<string, string> = {
      provider: episode.provider,
      kind,
      attention_grade: "observed",
      attention_signal: last.attention_signal,
      observed_actions: String(episode.events.length),
      coverage: "observed",
    };
    if (precursors.length > 0) metadata.directed_trigger = "true";
    if (bucket) metadata.participant_bucket = bucket;
    return {
      event_id: `chat-${episode.provider}-${first.event_id}`,
      timestamp_start: new Date(startMs).toISOString(),
      timestamp_end: new Date(endMs).toISOString(),
      source_type: "chat" as const,
      // Provider remains local canonical metadata for the individual's source
      // breakdown; generic block evidence prevents it from riding into an AI
      // prompt or the optional private Web replica as display copy.
      app_name: "Workplace chat",
      project_name: projectName,
      privacy_level: "derived_only" as const,
      metadata,
      ...(isCall
        ? {
            category: "Meetings / stakeholder syncs" as const,
            mode: "Collaborative" as const,
            planned_status: "fixed" as const,
          }
        : !isResponse
          ? {
              category: "Admin / coordination" as const,
              mode: "Collaborative" as const,
              planned_status: "unplanned" as const,
            }
        : {}),
    };
  });

  const imported = importRawEvents(imports, { userId: options.userId });
  const work_blocks = imported.work_blocks.map((block) => ({
    ...block,
    week_id: isoWeekId(new Date(block.start_time)),
    // Observed action is strong enough to avoid treating the episode as
    // low-confidence carryover, but remains explicitly reviewable.
    confidence: 0.82,
    stakeholder_group: "Workplace chat",
  }));
  const unconsumedDirected = directed
    .filter((event) => !consumedDirected.has(event.event_id))
    .filter(
      (event): event is ChatEvidenceEventV1 & {
        attention_signal: ChatReviewSignal["attention_signal"];
      } =>
        event.attention_signal === "direct_mention" ||
        event.attention_signal === "direct_message" ||
        event.attention_signal === "reply_to_self",
    );
  const review_signals: ChatReviewSignal[] = [];
  const latestReviewByKey = new Map<string, {
    signal: ChatReviewSignal;
    lastTimestamp: number;
  }>();
  for (const event of unconsumedDirected) {
    const key = `${event.provider}:${event.correlation_key}`;
    const timestamp = new Date(event.timestamp).getTime();
    const prior = latestReviewByKey.get(key);
    if (prior && timestamp - prior.lastTimestamp <= sessionGapMs) {
      prior.lastTimestamp = timestamp;
      // Keep one review card per directed burst while retaining the most recent
      // attention kind as the best available content-free context.
      prior.signal.attention_signal = event.attention_signal;
      continue;
    }
    const signal: ChatReviewSignal = {
      event_id: event.event_id,
      provider: event.provider,
      timestamp: new Date(timestamp).toISOString(),
      attention_signal: event.attention_signal,
      reason: "directed_unconfirmed",
    };
    review_signals.push(signal);
    latestReviewByKey.set(key, { signal, lastTimestamp: timestamp });
  }

  return { events: imported.events, work_blocks, review_signals, skipped: skipped + imported.skipped };
}
