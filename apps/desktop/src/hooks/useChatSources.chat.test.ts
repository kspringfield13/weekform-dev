import assert from "node:assert/strict";
import test from "node:test";

import { normalizeChatRange, transformChatEvidence } from "../../../../packages/integrations/src/chat/chatSync";
import {
  accumulateChatSyncPage,
  chatSyncApplicationMode,
  chatSyncOperationalState,
  degradeChatStatusesAfterRefreshFailure,
  disconnectThenRefreshChatSource,
  markChatStatusDisconnected,
  normalizeChatStatuses,
  normalizeSyncResponse,
  authorizeThenSyncChatSource,
  type ChatRunAccumulator,
} from "./useChatSources";

const range = normalizeChatRange({ start_date: "2026-07-20", end_date: "2026-07-20" });

function event(
  id: string,
  grade: "directed" | "observed",
  signal: "direct_message" | "self_sent",
  timestamp: string,
) {
  return {
    schemaVersion: 1,
    eventId: id,
    provider: "slack",
    timestamp,
    attentionSignal: signal,
    attentionGrade: grade,
    correlationKey: "same-thread",
    surface: "dm",
    direction: grade === "directed" ? "inbound" : "outbound",
    localOnly: true,
  };
}

function response(input: {
  events: unknown[];
  resumed: boolean;
  hasMore: boolean;
  authorityEligible?: boolean;
  modelEligible?: boolean;
  coverage?: "complete" | "scope_limited" | "partial" | "rate_limited" | "permission_limited";
  provider?: string;
  start?: string;
  endExclusive?: string;
  extraReceipt?: Record<string, unknown>;
}) {
  const provider = input.provider ?? "slack";
  return {
    events: input.events,
    receipt: {
      provider,
      range: {
        start: input.start ?? range.start,
        endExclusive: input.endExclusive ?? range.end_exclusive,
      },
      fetchedCount: input.events.length,
      normalizedCount: input.events.length,
      droppedCount: 0,
      coverage: input.coverage ?? (input.hasMore ? "partial" : input.resumed ? "partial" : "complete"),
      detail: input.hasMore ? "More provider pages remain." : "This provider pass finished.",
      retryAfterSeconds: null,
      checkpoint: input.hasMore ? "opaque-checkpoint" : null,
      hasMore: input.hasMore,
      resumed: input.resumed,
      authorityEligible: input.authorityEligible ?? provider !== "slack",
      modelEligible: input.modelEligible ?? true,
      completedAt: "2026-07-20T16:00:00.000Z",
      contentHandling: "Synthetic content-free fixture",
      ...input.extraReceipt,
    },
  };
}

test("nested receipt provider and exact range are mandatory", () => {
  assert.throws(
    () => normalizeSyncResponse(response({ events: [], resumed: false, hasMore: false, provider: "webex" }), "slack", range),
    /CHAT_EVIDENCE_CONTRACT_VIOLATION/,
  );
  assert.throws(
    () => normalizeSyncResponse(response({ events: [], resumed: false, hasMore: false, start: "2026-07-19T04:00:00.000Z" }), "slack", range),
    /CHAT_EVIDENCE_CONTRACT_VIOLATION/,
  );
});

test("unexpected receipt fields and normalized-count mismatches fail closed", () => {
  assert.throws(
    () => normalizeSyncResponse(response({ events: [], resumed: false, hasMore: false, extraReceipt: { messageBody: "private" } }), "slack", range),
    /CHAT_EVIDENCE_CONTRACT_VIOLATION/,
  );
  const mismatched = response({ events: [event("one", "observed", "self_sent", "2026-07-20T14:05:00.000Z")], resumed: false, hasMore: false });
  mismatched.receipt.normalizedCount = 0;
  assert.throws(
    () => normalizeSyncResponse(mismatched, "slack", range),
    /CHAT_EVIDENCE_CONTRACT_VIOLATION/,
  );
});

test("scope-limited Slack pages combine into additive transform readiness without deletion authority", () => {
  const first = normalizeSyncResponse(response({
    events: [event("directed", "directed", "direct_message", "2026-07-20T14:00:00.000Z")],
    resumed: false,
    hasMore: true,
  }), "slack", range);
  const firstRun = accumulateChatSyncPage(null, first);
  assert.equal(firstRun.result.receipt.authoritative, false);

  const second = normalizeSyncResponse(response({
    events: [event("response", "observed", "self_sent", "2026-07-20T14:05:00.000Z")],
    resumed: true,
    hasMore: false,
  }), "slack", range);
  const finalRun = accumulateChatSyncPage(firstRun.accumulator, second);
  assert.equal(finalRun.result.receipt.coverage, "scope_limited");
  assert.match(finalRun.result.receipt.detail, /thread replies.*outside this scope/i);
  assert.equal(finalRun.result.receipt.transform_ready, true);
  assert.equal(finalRun.result.receipt.authoritative, false);
  assert.equal(chatSyncApplicationMode(finalRun.result.receipt), "file_import");
  const transformed = transformChatEvidence(finalRun.result.events);
  assert.equal(transformed.work_blocks.length, 1);
  assert.deepEqual(transformed.review_signals, []);
});

test("Google and Webex complete runs retain live replacement authority", () => {
  for (const provider of ["google_chat", "webex"] as const) {
    const complete = normalizeSyncResponse(response({
      events: [],
      resumed: false,
      hasMore: false,
      provider,
    }), provider, range);
    const run = accumulateChatSyncPage(null, complete);

    assert.equal(run.result.receipt.coverage, "complete", provider);
    assert.equal(run.result.receipt.transform_ready, true, provider);
    assert.equal(run.result.receipt.authoritative, true, provider);
    assert.equal(chatSyncApplicationMode(run.result.receipt), "live_sync", provider);
  }
});

test("a resumable mid-run Slack rate limit does not poison additive transform readiness", () => {
  const first = accumulateChatSyncPage(null, normalizeSyncResponse(response({
    events: [event("first", "observed", "self_sent", "2026-07-20T14:00:00.000Z")],
    resumed: false,
    hasMore: true,
    authorityEligible: false,
  }), "slack", range));
  const throttled = accumulateChatSyncPage(first.accumulator, normalizeSyncResponse(response({
    events: [],
    resumed: true,
    hasMore: true,
    authorityEligible: false,
    modelEligible: true,
    coverage: "rate_limited",
    extraReceipt: { retryAfterSeconds: 60 },
  }), "slack", range));
  const completed = accumulateChatSyncPage(throttled.accumulator, normalizeSyncResponse(response({
    events: [event("last", "observed", "self_sent", "2026-07-20T14:05:00.000Z")],
    resumed: true,
    hasMore: false,
    authorityEligible: false,
    coverage: "scope_limited",
  }), "slack", range));

  assert.equal(completed.result.receipt.transform_ready, true);
  assert.equal(completed.result.receipt.authoritative, false);
  assert.equal(completed.result.events.length, 2);
});

test("first-page throttling and permission or malformed pages prevent workload transformation", () => {
  const initialThrottle = accumulateChatSyncPage(null, normalizeSyncResponse(response({
    events: [],
    resumed: false,
    hasMore: false,
    authorityEligible: false,
    modelEligible: false,
    coverage: "rate_limited",
    extraReceipt: { retryAfterSeconds: 60 },
  }), "slack", range));
  assert.equal(initialThrottle.result.receipt.transform_ready, false);
  assert.equal(chatSyncApplicationMode(initialThrottle.result.receipt), null);
  assert.equal(chatSyncOperationalState(initialThrottle.result.receipt), "blocked");

  for (const coverage of ["permission_limited", "partial"] as const) {
    const first = accumulateChatSyncPage(null, normalizeSyncResponse(response({
      events: [],
      resumed: false,
      hasMore: true,
      authorityEligible: false,
    }), "slack", range));
    const poisoned = accumulateChatSyncPage(first.accumulator, normalizeSyncResponse(response({
      events: [],
      resumed: true,
      hasMore: false,
      authorityEligible: false,
      modelEligible: false,
      coverage,
    }), "slack", range));

    assert.equal(poisoned.result.receipt.transform_ready, false, coverage);
    assert.equal(chatSyncApplicationMode(poisoned.result.receipt), null, coverage);
    assert.equal(chatSyncOperationalState(poisoned.result.receipt), "blocked", coverage);
  }
});

test("sync operational state separates completed, resumable, and blocked transfers", () => {
  const complete = accumulateChatSyncPage(null, normalizeSyncResponse(response({
    events: [],
    resumed: false,
    hasMore: false,
    provider: "google_chat",
  }), "google_chat", range));
  assert.equal(chatSyncOperationalState(complete.result.receipt), "completed");

  const resumable = accumulateChatSyncPage(null, normalizeSyncResponse(response({
    events: [event("page-one", "observed", "self_sent", "2026-07-20T14:05:00.000Z")],
    resumed: false,
    hasMore: true,
  }), "slack", range));
  assert.equal(chatSyncOperationalState(resumable.result.receipt), "in_progress");

  const permissionDenied = accumulateChatSyncPage(null, normalizeSyncResponse(response({
    events: [],
    resumed: false,
    hasMore: false,
    authorityEligible: false,
    modelEligible: false,
    coverage: "permission_limited",
  }), "slack", range));
  assert.equal(chatSyncOperationalState(permissionDenied.result.receipt), "blocked");
});

test("an orphaned or degraded resumed run can never become authoritative", () => {
  const finalPage = normalizeSyncResponse(response({ events: [], resumed: true, hasMore: false }), "slack", range);
  assert.equal(accumulateChatSyncPage(null, finalPage).result.receipt.authoritative, false);
  assert.equal(accumulateChatSyncPage(null, finalPage).result.receipt.transform_ready, false);

  const degradedFirst = normalizeSyncResponse(response({
    events: [],
    resumed: false,
    hasMore: true,
    authorityEligible: false,
  }), "slack", range);
  const degradedRun = accumulateChatSyncPage(null, degradedFirst);
  const eligibleFinal = normalizeSyncResponse(response({ events: [], resumed: true, hasMore: false }), "slack", range);
  const completed = accumulateChatSyncPage(
    degradedRun.accumulator as ChatRunAccumulator,
    eligibleFinal,
  );
  assert.equal(completed.result.receipt.authoritative, false);
});

test("a failed initial sync does not turn a saved authorization into a failed connection", async () => {
  const events: string[] = [];
  const syncError = new Error("provider temporarily unavailable");

  const result = await authorizeThenSyncChatSource({
    onPhase: (phase) => events.push(phase),
    authorize: async () => {
      events.push("authorized");
    },
    onAuthorized: () => {
      events.push("connection-audited");
    },
    initialSync: async () => {
      events.push("sync-attempted");
      throw syncError;
    },
  });

  assert.deepEqual(events, [
    "browser_authorization",
    "authorized",
    "connection-audited",
    "native_filtering",
    "sync-attempted",
    "transfer_error",
  ]);
  assert.equal(result.syncCompleted, false);
  assert.equal(result.syncError, syncError);
});

test("an authorization failure never starts sync or records a successful connection", async () => {
  const events: string[] = [];
  const authorizationError = new Error("authorization denied");

  await assert.rejects(
    authorizeThenSyncChatSource({
      onPhase: (phase) => events.push(phase),
      authorize: async () => {
        throw authorizationError;
      },
      onAuthorized: () => {
        events.push("connection-audited");
      },
      initialSync: async () => {
        events.push("sync-attempted");
      },
    }),
    authorizationError,
  );

  assert.deepEqual(events, ["browser_authorization", "authorization_error"]);
});

test("connection lifecycle reaches completion only after the initial native transfer", async () => {
  const phases: string[] = [];

  const result = await authorizeThenSyncChatSource({
    onPhase: (phase) => phases.push(phase),
    authorize: async () => undefined,
    onAuthorized: () => undefined,
    initialSync: async () => undefined,
  });

  assert.deepEqual(phases, ["browser_authorization", "native_filtering", "complete"]);
  assert.equal(result.syncCompleted, true);
  assert.equal(result.syncError, null);
});

test("a retained resumable page keeps the initial transfer in progress", async () => {
  const phases: string[] = [];

  const result = await authorizeThenSyncChatSource({
    onPhase: (phase) => phases.push(phase),
    authorize: async () => undefined,
    onAuthorized: () => undefined,
    initialSync: async () => "in_progress" as const,
  });

  assert.deepEqual(phases, ["browser_authorization", "native_filtering"]);
  assert.equal(result.syncCompleted, false);
  assert.equal(result.syncError, null);
});

test("a status refresh failure preserves a saved connection only as last-known state", () => {
  const degraded = degradeChatStatusesAfterRefreshFailure(
    [
      {
        provider: "slack",
        available: true,
        connected: true,
        stale: false,
        readinessCode: "ready",
        detail: "Connected in this macOS app.",
      },
      {
        provider: "google_chat",
        available: true,
        connected: false,
        stale: false,
        readinessCode: "ready",
        detail: "Ready to connect.",
      },
    ],
    "Current status could not be read.",
  );

  assert.deepEqual(degraded[0], {
    provider: "slack",
    available: true,
    connected: true,
    stale: true,
    readinessCode: "ready",
    detail: "Last known connected; current status could not be read.",
  });
  assert.deepEqual(degraded[1], {
    provider: "google_chat",
    available: false,
    connected: false,
    stale: true,
    readinessCode: "ready",
    detail: "Current status could not be read.",
  });
});

test("connection status uses typed readiness and never forwards native setup detail", () => {
  const statuses = normalizeChatStatuses([
    {
      provider: "slack",
      available: false,
      connected: false,
      readinessCode: "missing_client_id",
      detail: "SLACK_CHAT_CLIENT_ID=/private/operator/value",
    },
    {
      provider: "webex",
      available: false,
      connected: false,
      readiness_code: "not_a_real_code",
      detail: "WEBEX_CHAT_CLIENT_ID is missing",
    },
    {
      provider: "google_chat",
      available: false,
      connected: false,
      readinessCode: "missing_client_id",
      detail: "GOOGLE_CHAT_CLIENT_ID=/private/operator/value",
    },
  ]);

  const slack = statuses.find((status) => status.provider === "slack");
  const google = statuses.find((status) => status.provider === "google_chat");
  const webex = statuses.find((status) => status.provider === "webex");
  assert.equal(slack?.readinessCode, "missing_client_id");
  assert.equal(
    slack?.detail,
    "Add the public Client ID from your Slack app to continue.",
  );
  assert.equal(google?.readinessCode, "missing_client_id");
  assert.equal(google?.detail, "Add the public Desktop app Client ID from Google Cloud to continue.");
  assert.equal(webex?.readinessCode, "unknown");
  assert.equal(webex?.detail, "This connector is unavailable in this build.");
  assert.doesNotMatch(statuses.map((status) => status.detail).join(" "), /CLIENT_ID|private/i);
});

test("Webex broker review status stays actionable without exposing deployment values", () => {
  const statuses = normalizeChatStatuses([{
    provider: "webex",
    available: false,
    connected: false,
    readinessCode: "broker_security_review_required",
    detail: "WEBEX_CHAT_BROKER_SECURITY_VERIFIED=false at /private/value",
  }]);

  const webex = statuses.find((status) => status.provider === "webex");
  assert.equal(webex?.readinessCode, "broker_security_review_required");
  assert.match(webex?.detail ?? "", /security review/i);
  assert.doesNotMatch(webex?.detail ?? "", /WEBEX_CHAT_|private|false/i);
});

test("a post-disconnect status failure cannot turn the completed mutation into a failed disconnect", async () => {
  const events: string[] = [];
  const refreshError = new Error("status unavailable");

  const result = await disconnectThenRefreshChatSource({
    disconnect: async () => {
      events.push("disconnected");
    },
    onDisconnected: () => {
      events.push("disconnect-audited");
    },
    refresh: async () => {
      events.push("status-refresh-attempted");
      throw refreshError;
    },
  });

  assert.deepEqual(events, ["disconnected", "disconnect-audited", "status-refresh-attempted"]);
  assert.equal(result.refreshError, refreshError);
});

test("a completed disconnect clears last-known connected state before a secondary status refresh", () => {
  const statuses = markChatStatusDisconnected(
    [
      {
        provider: "slack",
        available: true,
        connected: true,
        stale: true,
        readinessCode: "ready",
        detail: "Last known connected; current status could not be read.",
      },
      {
        provider: "google_chat",
        available: true,
        connected: false,
        stale: false,
        readinessCode: "ready",
        detail: "Ready to connect.",
      },
    ],
    "slack",
  );

  assert.deepEqual(statuses[0], {
    provider: "slack",
    available: true,
    connected: false,
    stale: false,
    readinessCode: "ready",
    detail: "This connector is ready for authorization.",
  });
  assert.equal(statuses[1].provider, "google_chat");
  assert.equal(statuses[1].detail, "Ready to connect.");
});
