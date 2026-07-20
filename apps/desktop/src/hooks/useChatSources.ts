import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CHAT_PROVIDERS,
  normalizeChatRange,
  providerDescriptor,
  type ChatAttentionGrade,
  type ChatAttentionSignal,
  type ChatEvidenceEventV1,
  type ChatProviderId,
  type ChatRangeInput,
  type NormalizedChatRange,
} from "../../../../packages/integrations/src/chat/chatSync";

export interface ChatConnectionStatus {
  provider: ChatProviderId;
  available: boolean;
  connected: boolean;
  /** The last successful status read is retained when the native check fails. */
  stale: boolean;
  detail: string;
}

export type ChatCoverageState =
  | "complete"
  | "scope_limited"
  | "partial"
  | "rate_limited"
  | "permission_limited";

/**
 * Local operational evidence for one bounded transfer. Provider cursors and
 * account identifiers intentionally stay behind the native boundary.
 */
export interface ChatSyncReceipt {
  provider: ChatProviderId;
  range: NormalizedChatRange;
  coverage: ChatCoverageState;
  fetched_count: number | null;
  normalized_count: number;
  dropped_count: number | null;
  completed_at: string;
  observed_episode_count: number;
  directed_review_count: number;
  detail: string;
  retry_after_seconds: number | null;
  checkpoint: string | null;
  has_more: boolean;
  resumed: boolean;
  authority_eligible: boolean;
  /** Native proof that this page can participate in a completed workload run. */
  model_eligible: boolean;
  /** True after an intact run from page one finishes, even when replacement is unsafe. */
  transform_ready: boolean;
  /** Set after the completed run has actually been applied to the workload model. */
  workload_applied: boolean;
  /** True only after every page in a run that began at page one is accumulated. */
  authoritative: boolean;
}

export interface ChatSyncApplicationSummary {
  observedEpisodeCount: number;
  directedReviewCount: number;
  workloadApplied: boolean;
}

export interface ChatSourceSyncResult {
  provider: ChatProviderId;
  range: NormalizedChatRange;
  events: ChatEvidenceEventV1[];
  receipt: ChatSyncReceipt;
  mode: "live_sync";
}

export interface ChatProviderActivity {
  phase: "idle" | "connecting" | "syncing" | "disconnecting" | "error";
  message: string | null;
  last_synced_at: string | null;
  receipt: ChatSyncReceipt | null;
}

export interface ChatSourcesController {
  statuses: ChatConnectionStatus[];
  activity: Record<ChatProviderId, ChatProviderActivity>;
  statusError: string | null;
  refreshingStatuses: boolean;
  rangeInput: ChatRangeInput;
  range: NormalizedChatRange | null;
  rangeError: string | null;
  updateRange: (field: keyof ChatRangeInput, value: string) => void;
  refreshStatuses: () => Promise<void>;
  connect: (provider: ChatProviderId) => Promise<void>;
  sync: (provider: ChatProviderId) => Promise<void>;
  disconnect: (provider: ChatProviderId) => Promise<void>;
}

type ConnectionAction = "connect" | "sync" | "disconnect";

const ATTENTION_SIGNALS: readonly ChatAttentionSignal[] = [
  "ambient",
  "direct_mention",
  "direct_message",
  "reply_to_self",
  "self_sent",
  "self_reaction",
  "call_joined",
];

const ATTENTION_GRADES: readonly ChatAttentionGrade[] = ["ambient", "directed", "observed"];
const SURFACES = ["channel", "space", "dm", "group_dm", "thread", "call"] as const;
const DIRECTIONS = ["inbound", "outbound"] as const;
const PARTICIPANT_BUCKETS = ["1", "2-5", "6-20", "21+", "unknown"] as const;
const COVERAGE_STATES: readonly ChatCoverageState[] = [
  "complete",
  "scope_limited",
  "partial",
  "rate_limited",
  "permission_limited",
];

const SAFE_EVENT_KEYS = new Set([
  "schema_version",
  "schemaVersion",
  "event_id",
  "eventId",
  "provider",
  "timestamp",
  "attention_signal",
  "attentionSignal",
  "attention_grade",
  "attentionGrade",
  "correlation_key",
  "correlationKey",
  "conversation_key",
  "conversationKey",
  "thread_key",
  "threadKey",
  "surface",
  "direction",
  "participant_count_bucket",
  "participantCountBucket",
  "silent",
  "tombstone",
  "revision",
  "imported_at",
  "importedAt",
  "local_only",
  "localOnly",
]);

const SAFE_RESPONSE_KEYS = new Set(["provider", "events", "receipt"]);
const SAFE_RECEIPT_KEYS = new Set([
  "provider",
  "range",
  "coverage",
  "fetched_count",
  "fetchedCount",
  "normalized_count",
  "normalizedCount",
  "dropped_count",
  "droppedCount",
  "completed_at",
  "completedAt",
  "detail",
  "retry_after_seconds",
  "retryAfterSeconds",
  "checkpoint",
  "has_more",
  "hasMore",
  "resumed",
  "authority_eligible",
  "authorityEligible",
  "model_eligible",
  "modelEligible",
  "content_handling",
  "contentHandling",
]);
const SAFE_RECEIPT_RANGE_KEYS = new Set(["start", "end_exclusive", "endExclusive"]);

function dateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The default is deliberately retrospective and bounded: fourteen days back through today. */
export function defaultChatRangeInput(now = new Date()): ChatRangeInput {
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - 14);
  return { start_date: dateKey(start), end_date: dateKey(end) };
}

function emptyActivity(): ChatProviderActivity {
  return { phase: "idle", message: null, last_synced_at: null, receipt: null };
}

function initialActivity(): Record<ChatProviderId, ChatProviderActivity> {
  return {
    slack: emptyActivity(),
    google_chat: emptyActivity(),
    webex: emptyActivity(),
  };
}

function unavailableStatuses(detail: string): ChatConnectionStatus[] {
  return CHAT_PROVIDERS.map((provider) => ({
    provider: provider.id,
    available: false,
    connected: false,
    stale: false,
    detail,
  }));
}

export function degradeChatStatusesAfterRefreshFailure(
  current: ChatConnectionStatus[],
  detail: string,
): ChatConnectionStatus[] {
  return current.map((status) => status.connected
    ? {
        ...status,
        stale: true,
        detail: `Last known connected; ${detail.charAt(0).toLowerCase()}${detail.slice(1)}`,
      }
    : {
        ...status,
        available: false,
        connected: false,
        stale: true,
        detail,
      });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, snake: string, camel = snake): string | null {
  const value = record[snake] ?? record[camel];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanField(record: Record<string, unknown>, snake: string, camel = snake): boolean | undefined {
  const value = record[snake] ?? record[camel];
  return typeof value === "boolean" ? value : undefined;
}

function integerField(record: Record<string, unknown>, snake: string, camel = snake): number | null {
  const value = record[snake] ?? record[camel];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function isProvider(value: unknown): value is ChatProviderId {
  return CHAT_PROVIDERS.some((provider) => provider.id === value);
}

function safeNativeError(error: unknown, action: ConnectionAction | "status"): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const normalized = raw.toUpperCase();
  if (normalized.includes("AUTH_CANCEL")) return "Authorization was canceled. No chat data was transferred.";
  if (normalized.includes("NOT_CONFIGURED")) return "This connector is not configured in this build.";
  if (normalized.includes("BROKER_REQUIRED")) return "A secure OAuth token broker must be configured for Webex.";
  if (normalized.includes("PERMISSION")) return "The provider did not grant the required read permissions.";
  if (normalized.includes("RATE_LIMIT")) return "The provider rate-limited this transfer. Narrow the range and try again later.";
  if (normalized.includes("OFFLINE") || normalized.includes("NETWORK")) return "The provider could not be reached. Check your connection and try again.";
  if (action === "status") return "Chat connection status is unavailable. Refresh after checking the connector configuration.";
  if (action === "disconnect") return "Weekform could not disconnect this provider. Try again.";
  if (action === "sync") return "Weekform could not sync this range. No new chat evidence was imported.";
  return "Weekform could not complete the connection. No chat evidence was imported.";
}

function nativeStatusDetail(provider: ChatProviderId, available: boolean, connected: boolean): string {
  if (connected) return "Authorization is saved; Sync verifies current provider access.";
  if (!available) {
    return providerDescriptor(provider).requiresBroker
      ? "Unavailable until a secure Webex OAuth token broker is configured."
      : "Unavailable until this provider's OAuth client is configured.";
  }
  return providerDescriptor(provider).requiresBroker
    ? "Broker URL configured; Connect verifies Webex before saving authorization."
    : "OAuth client configured; Connect verifies provider authorization before saving it.";
}

/** Apply the known successful mutation before the best-effort status refresh. */
export function markChatStatusDisconnected(
  current: ChatConnectionStatus[],
  provider: ChatProviderId,
): ChatConnectionStatus[] {
  return current.map((status) => status.provider === provider
    ? {
        ...status,
        connected: false,
        stale: false,
        detail: nativeStatusDetail(provider, status.available, false),
      }
    : status);
}

export function normalizeChatStatuses(value: unknown): ChatConnectionStatus[] {
  if (!Array.isArray(value)) throw new Error("CHAT_STATUS_INVALID");
  const received = new Map<ChatProviderId, {
    available: boolean;
    connected: boolean;
    detail: string | null;
  }>();
  for (const candidate of value) {
    const record = asRecord(candidate);
    if (!record || !isProvider(record.provider)) continue;
    const available = record.available === true;
    const detail = stringField(record, "detail");
    received.set(record.provider, {
      available,
      connected: available && record.connected === true,
      detail: detail && detail.length <= 1_000 ? detail : null,
    });
  }
  return CHAT_PROVIDERS.map(({ id }) => {
    const status = received.get(id) ?? { available: false, connected: false, detail: null };
    return {
      provider: id,
      available: status.available,
      connected: status.connected,
      stale: false,
      detail: status.detail ?? nativeStatusDetail(id, status.available, status.connected),
    };
  });
}

function normalizeEvidenceEvent(value: unknown, expectedProvider: ChatProviderId): ChatEvidenceEventV1 {
  const record = asRecord(value);
  if (!record || Object.keys(record).some((key) => !SAFE_EVENT_KEYS.has(key))) {
    throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  }

  const schemaVersion = record.schema_version ?? record.schemaVersion;
  const provider = record.provider;
  const eventId = stringField(record, "event_id", "eventId");
  const timestamp = isoTimestamp(record.timestamp);
  const attentionSignal = stringField(record, "attention_signal", "attentionSignal");
  const attentionGrade = stringField(record, "attention_grade", "attentionGrade");
  const correlationKey = stringField(record, "correlation_key", "correlationKey");
  if (
    schemaVersion !== 1 ||
    provider !== expectedProvider ||
    !eventId ||
    !timestamp ||
    !attentionSignal ||
    !ATTENTION_SIGNALS.includes(attentionSignal as ChatAttentionSignal) ||
    !attentionGrade ||
    !ATTENTION_GRADES.includes(attentionGrade as ChatAttentionGrade) ||
    !correlationKey
  ) {
    throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  }

  const surface = stringField(record, "surface");
  const direction = stringField(record, "direction");
  const participantBucket = stringField(record, "participant_count_bucket", "participantCountBucket");
  if (surface && !SURFACES.includes(surface as (typeof SURFACES)[number])) {
    throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  }
  if (direction && !DIRECTIONS.includes(direction as (typeof DIRECTIONS)[number])) {
    throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  }
  if (participantBucket && !PARTICIPANT_BUCKETS.includes(participantBucket as (typeof PARTICIPANT_BUCKETS)[number])) {
    throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  }

  const conversationKey = stringField(record, "conversation_key", "conversationKey");
  const threadKey = stringField(record, "thread_key", "threadKey");
  const revision = stringField(record, "revision");
  const importedAt = isoTimestamp(record.imported_at ?? record.importedAt);
  return {
    schema_version: 1,
    event_id: eventId,
    provider: expectedProvider,
    timestamp,
    attention_signal: attentionSignal as ChatAttentionSignal,
    attention_grade: attentionGrade as ChatAttentionGrade,
    correlation_key: correlationKey,
    ...(conversationKey ? { conversation_key: conversationKey } : {}),
    ...(threadKey ? { thread_key: threadKey } : {}),
    ...(surface ? { surface: surface as ChatEvidenceEventV1["surface"] } : {}),
    ...(direction ? { direction: direction as ChatEvidenceEventV1["direction"] } : {}),
    ...(participantBucket
      ? { participant_count_bucket: participantBucket as ChatEvidenceEventV1["participant_count_bucket"] }
      : {}),
    ...(booleanField(record, "silent") !== undefined ? { silent: booleanField(record, "silent") } : {}),
    ...(booleanField(record, "tombstone") !== undefined ? { tombstone: booleanField(record, "tombstone") } : {}),
    ...(revision ? { revision } : {}),
    ...(importedAt ? { imported_at: importedAt } : {}),
    local_only: true,
  };
}

export function normalizeSyncResponse(
  value: unknown,
  provider: ChatProviderId,
  range: NormalizedChatRange,
): ChatSourceSyncResult {
  const response = asRecord(value);
  if (!response || Object.keys(response).some((key) => !SAFE_RESPONSE_KEYS.has(key))) {
    throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  }
  if (response?.provider !== undefined && response.provider !== provider) {
    throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  }
  const rawEvents = response.events;
  if (!Array.isArray(rawEvents)) throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  const events = rawEvents.map((event) => normalizeEvidenceEvent(event, provider));

  const rawReceipt = asRecord(response.receipt);
  if (!rawReceipt || Object.keys(rawReceipt).some((key) => !SAFE_RECEIPT_KEYS.has(key))) {
    throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  }
  if (rawReceipt.provider !== provider) throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  const receiptRange = asRecord(rawReceipt.range);
  if (
    !receiptRange ||
    Object.keys(receiptRange).some((key) => !SAFE_RECEIPT_RANGE_KEYS.has(key)) ||
    receiptRange.start !== range.start ||
    (receiptRange.end_exclusive ?? receiptRange.endExclusive) !== range.end_exclusive
  ) {
    throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  }
  const rawCoverage = rawReceipt.coverage;
  if (typeof rawCoverage !== "string" || !COVERAGE_STATES.includes(rawCoverage as ChatCoverageState)) {
    throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  }
  const coverage = rawCoverage as ChatCoverageState;
  const completedAt = isoTimestamp(rawReceipt.completed_at ?? rawReceipt.completedAt);
  const normalizedCount = integerField(rawReceipt, "normalized_count", "normalizedCount");
  const resumed = booleanField(rawReceipt, "resumed");
  const hasMore = booleanField(rawReceipt, "has_more", "hasMore");
  const authorityEligible = booleanField(
    rawReceipt,
    "authority_eligible",
    "authorityEligible",
  );
  const modelEligible = booleanField(rawReceipt, "model_eligible", "modelEligible");
  const detail = stringField(rawReceipt, "detail");
  const checkpoint = stringField(rawReceipt, "checkpoint");
  if (
    !completedAt ||
    normalizedCount !== events.length ||
    resumed === undefined ||
    hasMore === undefined ||
    authorityEligible === undefined ||
    modelEligible === undefined ||
    !detail ||
    detail.length > 1_000 ||
    (checkpoint?.length ?? 0) > 512 ||
    hasMore !== Boolean(checkpoint) ||
    ((coverage === "complete" || coverage === "scope_limited") && hasMore) ||
    (coverage === "scope_limited" && provider !== "slack") ||
    (provider === "slack" && authorityEligible) ||
    (coverage === "permission_limited" && modelEligible) ||
    (coverage === "rate_limited" && !hasMore && modelEligible)
  ) {
    throw new Error("CHAT_EVIDENCE_CONTRACT_VIOLATION");
  }
  const receipt: ChatSyncReceipt = {
    provider,
    range,
    coverage,
    fetched_count: rawReceipt ? integerField(rawReceipt, "fetched_count", "fetchedCount") : null,
    normalized_count: normalizedCount,
    dropped_count: rawReceipt ? integerField(rawReceipt, "dropped_count", "droppedCount") : null,
    completed_at: completedAt,
    observed_episode_count: 0,
    directed_review_count: 0,
    detail,
    retry_after_seconds: integerField(
      rawReceipt,
      "retry_after_seconds",
      "retryAfterSeconds",
    ),
    checkpoint,
    has_more: hasMore,
    resumed,
    authority_eligible: authorityEligible,
    model_eligible: modelEligible,
    transform_ready: false,
    workload_applied: false,
    authoritative: false,
  };
  return { provider, range, events, receipt, mode: "live_sync" };
}

export interface ChatRunAccumulator {
  key: string;
  events: ChatEvidenceEventV1[];
  started_at_beginning: boolean;
  authority_eligible: boolean;
  model_eligible: boolean;
}

function chatRunKey(result: ChatSourceSyncResult): string {
  return `${result.provider}:${result.range.start}:${result.range.end_exclusive}`;
}

/** Accumulate cursor pages without letting an orphaned/faulted run gain deletion authority. */
export function accumulateChatSyncPage(
  current: ChatRunAccumulator | null,
  page: ChatSourceSyncResult,
): { accumulator: ChatRunAccumulator | null; result: ChatSourceSyncResult } {
  const key = chatRunKey(page);
  const continuesCurrent = page.receipt.resumed && current?.key === key;
  const startedAtBeginning = page.receipt.resumed
    ? Boolean(continuesCurrent && current?.started_at_beginning)
    : true;
  const authorityEligible = page.receipt.authority_eligible && (
    continuesCurrent ? Boolean(current?.authority_eligible) : !page.receipt.resumed
  );
  const modelEligible = page.receipt.model_eligible && (
    continuesCurrent ? Boolean(current?.model_eligible) : !page.receipt.resumed
  );
  const byId = new Map<string, ChatEvidenceEventV1>();
  if (continuesCurrent) {
    current?.events.forEach((event) => byId.set(event.event_id, event));
  }
  page.events.forEach((event) => byId.set(event.event_id, event));
  const events = [...byId.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const runComplete = !page.receipt.has_more && startedAtBeginning;
  const transformReady = runComplete && modelEligible;
  const authoritative = transformReady && authorityEligible;
  const coverage: ChatCoverageState = authoritative
    ? "complete"
    : transformReady && page.provider === "slack"
      ? "scope_limited"
      : page.receipt.coverage === "complete" || page.receipt.coverage === "scope_limited"
        ? "partial"
        : page.receipt.coverage;
  const detail = coverage === "scope_limited"
    ? "Slack's currently listed top-level conversation history was read for this range. Thread replies and inaccessible history are outside this scope."
    : coverage === "complete"
      ? "The requested provider range was read completely."
      : page.receipt.detail;
  const result: ChatSourceSyncResult = {
    ...page,
    events,
    receipt: {
      ...page.receipt,
      coverage,
      detail,
      normalized_count: events.length,
      transform_ready: transformReady,
      workload_applied: false,
      authoritative,
    },
  };
  return {
    accumulator: page.receipt.has_more
      ? {
          key,
          events,
          started_at_beginning: startedAtBeginning,
          authority_eligible: authorityEligible,
          model_eligible: modelEligible,
        }
      : null,
    result,
  };
}

export function chatSyncApplicationMode(
  receipt: Pick<ChatSyncReceipt, "transform_ready" | "authoritative">,
): "live_sync" | "file_import" | null {
  if (!receipt.transform_ready) return null;
  return receipt.authoritative ? "live_sync" : "file_import";
}

export type ChatSyncOperationalState = "completed" | "in_progress" | "blocked";

/**
 * Keep provider transport truth separate from workload application. A valid
 * empty completed range is successful, a resumable page is still in progress,
 * and a terminal non-transformable receipt is a blocked transfer.
 */
export function chatSyncOperationalState(
  receipt: Pick<ChatSyncReceipt, "transform_ready" | "has_more" | "model_eligible">,
): ChatSyncOperationalState {
  if (receipt.transform_ready) return "completed";
  if (receipt.has_more && receipt.model_eligible) return "in_progress";
  return "blocked";
}

/**
 * Authorization and the first provider read are separate operational edges.
 * Once authorization is durably saved, a provider/read failure must remain a
 * retryable sync failure instead of making the user authorize again.
 */
export async function authorizeThenSyncChatSource(input: {
  authorize: () => Promise<void>;
  onAuthorized: () => void;
  initialSync: () => Promise<void>;
}): Promise<{ syncCompleted: boolean; syncError: unknown | null }> {
  await input.authorize();
  input.onAuthorized();
  try {
    await input.initialSync();
    return { syncCompleted: true, syncError: null };
  } catch (syncError) {
    return { syncCompleted: false, syncError };
  }
}

/** A secondary status read can become stale, but it cannot undo a completed disconnect. */
export async function disconnectThenRefreshChatSource(input: {
  disconnect: () => Promise<void>;
  onDisconnected: () => void;
  refresh: () => Promise<void>;
}): Promise<{ refreshError: unknown | null }> {
  await input.disconnect();
  input.onDisconnected();
  try {
    await input.refresh();
    return { refreshError: null };
  } catch (refreshError) {
    return { refreshError };
  }
}

export function useChatSources(input: {
  enabled: boolean;
  onSyncResult: (result: ChatSourceSyncResult) => ChatSyncApplicationSummary | void;
  onDisconnected?: (provider: ChatProviderId) => void;
  onConnectionEvent?: (
    provider: ChatProviderId,
    action: ConnectionAction,
    success: boolean,
  ) => void;
}): ChatSourcesController {
  const [statuses, setStatuses] = useState<ChatConnectionStatus[]>(() => (
    unavailableStatuses(input.enabled
      ? "Checking native connector availability…"
      : "Live chat connections are available only in the macOS app; web and demo modes do not sync chat data.")
  ));
  const [activity, setActivity] = useState<Record<ChatProviderId, ChatProviderActivity>>(initialActivity);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [refreshingStatuses, setRefreshingStatuses] = useState(false);
  const [rangeInput, setRangeInput] = useState<ChatRangeInput>(() => defaultChatRangeInput());
  const callbacksRef = useRef({
    onSyncResult: input.onSyncResult,
    onDisconnected: input.onDisconnected,
    onConnectionEvent: input.onConnectionEvent,
  });
  callbacksRef.current = {
    onSyncResult: input.onSyncResult,
    onDisconnected: input.onDisconnected,
    onConnectionEvent: input.onConnectionEvent,
  };
  const runAccumulatorsRef = useRef<Record<ChatProviderId, ChatRunAccumulator | null>>({
    slack: null,
    google_chat: null,
    webex: null,
  });
  const retryUntilRef = useRef<Record<ChatProviderId, number>>({
    slack: 0,
    google_chat: 0,
    webex: 0,
  });

  const rangeResult = useMemo(() => {
    try {
      return { range: normalizeChatRange(rangeInput), error: null };
    } catch (error) {
      return {
        range: null,
        error: error instanceof Error ? error.message : "Choose a valid chat transfer range.",
      };
    }
  }, [rangeInput]);

  const setProviderActivity = useCallback((
    provider: ChatProviderId,
    update: Partial<ChatProviderActivity>,
  ) => {
    setActivity((current) => ({
      ...current,
      [provider]: { ...current[provider], ...update },
    }));
  }, []);

  const refreshStatuses = useCallback(async () => {
    setRefreshingStatuses(true);
    setStatusError(null);
    if (!input.enabled) {
      setStatuses(unavailableStatuses(
        "Live chat connections are available only in the macOS app; web and demo modes do not sync chat data.",
      ));
      setRefreshingStatuses(false);
      return;
    }
    try {
      const result = await invoke<unknown>("chat_source_statuses");
      setStatuses(normalizeChatStatuses(result));
    } catch (error) {
      const message = safeNativeError(error, "status");
      setStatuses((current) => degradeChatStatusesAfterRefreshFailure(current, message));
      setStatusError(message);
      throw error;
    } finally {
      setRefreshingStatuses(false);
    }
  }, [input.enabled]);

  const transfer = useCallback(async (provider: ChatProviderId) => {
    const range = rangeResult.range;
    if (!range) throw new Error(rangeResult.error ?? "Choose a valid chat transfer range.");
    const remainingWaitSeconds = Math.ceil(
      (retryUntilRef.current[provider] - Date.now()) / 1_000,
    );
    if (remainingWaitSeconds > 0) {
      const message = `The provider asked Weekform to wait ${remainingWaitSeconds} more second${remainingWaitSeconds === 1 ? "" : "s"} before retrying.`;
      setProviderActivity(provider, { phase: "error", message });
      throw new Error("RATE_LIMIT_WAIT");
    }
    setProviderActivity(provider, {
      phase: "syncing",
      message: null,
    });
    try {
      const nativeResult = await invoke<unknown>("sync_chat_source", {
        request: { provider, start: range.start, endExclusive: range.end_exclusive },
      });
      const page = normalizeSyncResponse(nativeResult, provider, range);
      retryUntilRef.current[provider] = page.receipt.retry_after_seconds === null
        ? 0
        : Date.now() + page.receipt.retry_after_seconds * 1_000;
      const accumulated = accumulateChatSyncPage(runAccumulatorsRef.current[provider], page);
      runAccumulatorsRef.current[provider] = accumulated.accumulator;
      const result = accumulated.result;
      const applied = callbacksRef.current.onSyncResult(result);
      const receipt: ChatSyncReceipt = {
        ...result.receipt,
        observed_episode_count: applied?.observedEpisodeCount ?? 0,
        directed_review_count: applied?.directedReviewCount ?? 0,
        workload_applied: applied?.workloadApplied ?? false,
      };
      const operationalState = chatSyncOperationalState(receipt);
      const transferSucceeded = operationalState !== "blocked";
      callbacksRef.current.onConnectionEvent?.(provider, "sync", transferSucceeded);
      setProviderActivity(provider, {
        phase: transferSucceeded ? "idle" : "error",
        message: transferSucceeded
          ? null
          : `Transfer did not complete: ${receipt.detail}`,
        ...(operationalState === "completed"
          ? { last_synced_at: receipt.completed_at }
          : {}),
        receipt,
      });
      if (!transferSucceeded) {
        // Authorization may still be valid, but this read did not constitute a
        // successful transfer. Reject so connect's initial-sync boundary records
        // it as retryable without asking the user to authorize again.
        throw new Error("CHAT_SYNC_BLOCKED_RECEIPT");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "CHAT_SYNC_BLOCKED_RECEIPT") {
        throw error;
      }
      const message = error instanceof Error && error.message === "CHAT_EVIDENCE_CONTRACT_VIOLATION"
        ? "The provider returned data outside Weekform's content-free evidence contract. Nothing was imported."
        : safeNativeError(error, "sync");
      setProviderActivity(provider, { phase: "error", message });
      callbacksRef.current.onConnectionEvent?.(provider, "sync", false);
      throw error;
    }
  }, [rangeResult, setProviderActivity]);

  const connect = useCallback(async (provider: ChatProviderId) => {
    setProviderActivity(provider, { phase: "connecting", message: null });
    try {
      await authorizeThenSyncChatSource({
        authorize: () => invoke<void>("connect_chat_source", { provider }),
        onAuthorized: () => {
          callbacksRef.current.onConnectionEvent?.(provider, "connect", true);
          setStatuses((current) => current.map((status) => (
            status.provider === provider
              ? {
                  ...status,
                  available: true,
                  connected: true,
                  stale: false,
                  detail: nativeStatusDetail(provider, true, true),
                }
              : status
          )));
          // Authorization is already saved. Status refresh is secondary and
          // cannot retroactively make the connection or its audit fail.
          void refreshStatuses().catch(() => undefined);
        },
        initialSync: () => transfer(provider),
      });
    } catch (error) {
      setProviderActivity(provider, {
        phase: "error",
        message: safeNativeError(error, "connect"),
      });
      callbacksRef.current.onConnectionEvent?.(provider, "connect", false);
      // A failed Keychain write is not proof that no credential state changed.
      // Refresh the display independently, while retaining the failed action.
      void refreshStatuses().catch(() => undefined);
      throw error;
    }
  }, [refreshStatuses, setProviderActivity, transfer]);

  const sync = useCallback(
    (provider: ChatProviderId) => transfer(provider),
    [transfer],
  );

  const disconnect = useCallback(async (provider: ChatProviderId) => {
    setProviderActivity(provider, { phase: "disconnecting", message: null });
    try {
      await disconnectThenRefreshChatSource({
        disconnect: () => invoke("disconnect_chat_source", { provider }),
        onDisconnected: () => {
          runAccumulatorsRef.current[provider] = null;
          retryUntilRef.current[provider] = 0;
          setStatuses((current) => markChatStatusDisconnected(current, provider));
          callbacksRef.current.onDisconnected?.(provider);
          callbacksRef.current.onConnectionEvent?.(provider, "disconnect", true);
          setProviderActivity(provider, {
            phase: "idle",
            message: null,
            last_synced_at: null,
            receipt: null,
          });
        },
        refresh: refreshStatuses,
      });
    } catch (error) {
      setProviderActivity(provider, {
        phase: "error",
        message: safeNativeError(error, "disconnect"),
      });
      callbacksRef.current.onConnectionEvent?.(provider, "disconnect", false);
      throw error;
    }
  }, [refreshStatuses, setProviderActivity]);

  const updateRange = useCallback((field: keyof ChatRangeInput, value: string) => {
    setRangeInput((current) => ({ ...current, [field]: value }));
  }, []);

  useEffect(() => {
    void refreshStatuses().catch(() => undefined);
  }, [refreshStatuses]);

  return {
    statuses,
    activity,
    statusError,
    refreshingStatuses,
    rangeInput,
    range: rangeResult.range,
    rangeError: rangeResult.error,
    updateRange,
    refreshStatuses,
    connect,
    sync,
    disconnect,
  };
}
