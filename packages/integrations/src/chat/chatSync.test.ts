import assert from "node:assert/strict";
import test from "node:test";

import type { RawEvent, WorkBlock } from "../../../domain/src/models";
import {
  CHAT_PROVIDERS,
  type ChatEvidenceEventV1,
  chatReviewSignalsToWorkBlocks,
  mergeChatWorkBlocks,
  normalizeChatRange,
  providerDescriptor,
  reconcileChatEvidence,
  reconcileChatEvents,
  transformChatEvidence,
} from "./chatSync";

function chatEvent(
  id: string,
  provider: "slack" | "google_chat" | "webex" | "teams",
  start: string,
  end: string,
  metadata: Record<string, string | null> = {},
): RawEvent {
  return {
    event_id: id,
    user_id: "local-user",
    timestamp_start: start,
    timestamp_end: end,
    source_type: "chat",
    app_name: provider === "google_chat" ? "Google Chat" : provider,
    window_title: null,
    domain: null,
    file_path: null,
    project_hint: null,
    metadata: { provider, kind: "message", messages: "1", ...metadata },
    privacy_level: "derived_only",
  };
}

function chatBlock(
  id: string,
  provider: "slack" | "google_chat" | "webex" | "teams",
  start: string,
  end: string,
): WorkBlock {
  return {
    work_block_id: id,
    week_id: "2026-W30",
    start_time: start,
    end_time: end,
    estimated_capacity_pct: 1,
    category: "Ad hoc stakeholder requests",
    mode: "Reactive",
    planned_status: "unplanned",
    project_name: "Reactive messaging",
    stakeholder_group: "Workplace chat",
    derived_from: [`chat-${provider}-${id}`],
    evidence: [`Imported from ${provider}`],
    confidence: 0.55,
    user_verified: false,
    blocker_flag: false,
    notes: null,
  };
}

function evidenceEvent(
  id: string,
  attentionSignal: ChatEvidenceEventV1["attention_signal"],
  attentionGrade: ChatEvidenceEventV1["attention_grade"],
  timestamp: string,
  correlationKey: string,
  conversationDisplayName: string,
): ChatEvidenceEventV1 {
  return {
    schema_version: 1,
    event_id: id,
    provider: "slack",
    timestamp,
    attention_signal: attentionSignal,
    attention_grade: attentionGrade,
    correlation_key: correlationKey,
    conversation_display_name: conversationDisplayName,
    participant_count: 4,
  };
}

test("the Chat connection registry exposes exactly Slack, Google Chat, and Webex", () => {
  assert.deepEqual(
    CHAT_PROVIDERS.map(({ id, label }) => ({ id, label })),
    [
      { id: "slack", label: "Slack" },
      { id: "google_chat", label: "Google Chat" },
      { id: "webex", label: "Webex" },
    ],
  );
  assert.equal(providerDescriptor("slack").label, "Slack");
  assert.equal(providerDescriptor("google_chat").label, "Google Chat");
  assert.equal(providerDescriptor("webex").label, "Webex");
  assert.throws(
    () => providerDescriptor("teams" as never),
    /Unsupported chat provider: teams/,
  );
});

test("normalizeChatRange makes the end date inclusive and caps transfer windows at 90 days", () => {
  const range = normalizeChatRange({ start_date: "2026-07-14", end_date: "2026-07-20" });
  assert.equal(range.start_date, "2026-07-14");
  assert.equal(range.end_date, "2026-07-20");
  assert.equal(range.start, new Date(2026, 6, 14, 0, 0, 0, 0).toISOString());
  assert.equal(range.end_exclusive, new Date(2026, 6, 21, 0, 0, 0, 0).toISOString());
  assert.equal(
    new Date(range.end_exclusive).getTime() - new Date(range.start).getTime(),
    7 * 86_400_000,
  );
  assert.throws(
    () => normalizeChatRange({ start_date: "2026-01-01", end_date: "2026-04-01" }),
    /90 days/,
  );
});

test("live reconciliation replaces only the selected provider inside the bounded range and reports its delta", () => {
  const range = normalizeChatRange({ start_date: "2026-07-14", end_date: "2026-07-20" });
  const current = [
    chatEvent("slack-unchanged", "slack", "2026-07-15T12:00:00.000Z", "2026-07-15T12:05:00.000Z"),
    chatEvent("slack-updated", "slack", "2026-07-16T12:00:00.000Z", "2026-07-16T12:05:00.000Z"),
    chatEvent("slack-removed", "slack", "2026-07-17T12:00:00.000Z", "2026-07-17T12:05:00.000Z"),
    chatEvent("slack-outside", "slack", "2026-07-22T12:00:00.000Z", "2026-07-22T12:05:00.000Z"),
    chatEvent("google-kept", "google_chat", "2026-07-17T12:00:00.000Z", "2026-07-17T12:05:00.000Z"),
    chatEvent("webex-kept", "webex", "2026-07-18T12:00:00.000Z", "2026-07-18T12:05:00.000Z"),
  ];
  const incoming = [
    chatEvent("slack-unchanged", "slack", "2026-07-15T12:00:00.000Z", "2026-07-15T12:05:00.000Z"),
    chatEvent("slack-updated", "slack", "2026-07-16T12:00:00.000Z", "2026-07-16T12:12:00.000Z"),
    chatEvent("slack-added", "slack", "2026-07-19T12:00:00.000Z", "2026-07-19T12:05:00.000Z"),
  ];

  const result = reconcileChatEvents(current, incoming, {
    provider: "slack",
    range,
    mode: "live_sync",
  });

  assert.deepEqual(result.delta, { added: 1, updated: 1, unchanged: 1, removed: 1 });
  assert.deepEqual(
    result.events.map((event) => event.event_id).sort(),
    [
      "google-kept",
      "slack-added",
      "slack-outside",
      "slack-unchanged",
      "slack-updated",
      "webex-kept",
    ],
  );
  assert.equal(
    result.events.find((event) => event.event_id === "slack-updated")?.timestamp_end,
    "2026-07-16T12:12:00.000Z",
  );
});

test("canonical Chat evidence is upsert-only until a complete run authorizes replacement", () => {
  const range = normalizeChatRange({ start_date: "2026-07-20", end_date: "2026-07-20" });
  const old = evidenceEvent("old", "self_sent", "observed", "2026-07-20T12:00:00.000Z", "old-thread", "PRIVATE");
  const incoming = evidenceEvent("new", "self_sent", "observed", "2026-07-20T13:00:00.000Z", "new-thread", "PRIVATE");

  assert.deepEqual(
    reconcileChatEvidence([old], [incoming], { provider: "slack", range, mode: "file_import" })
      .map((event) => event.event_id),
    ["old", "new"],
  );
  assert.deepEqual(
    reconcileChatEvidence([old], [incoming], { provider: "slack", range, mode: "live_sync" })
      .map((event) => event.event_id),
    ["new"],
  );
});

test("chat refresh preserves reviewed truth while accepting provider-owned timing and evidence", () => {
  const range = normalizeChatRange({ start_date: "2026-07-14", end_date: "2026-07-20" });
  const reviewed = chatBlock(
    "imported-stable-slack-block",
    "slack",
    "2026-07-16T12:00:00.000Z",
    "2026-07-16T12:05:00.000Z",
  );
  Object.assign(reviewed, {
    category: "Planned analysis / project work",
    mode: "Deep work",
    planned_status: "planned",
    project_name: "Reviewed synthetic project",
    stakeholder_group: "Reviewed stakeholder group",
    confidence: 0.99,
    user_verified: true,
    blocker_flag: true,
    notes: "Keep this reviewed correction",
  } satisfies Partial<WorkBlock>);

  const resynced = chatBlock(
    "imported-stable-slack-block",
    "slack",
    "2026-07-16T13:00:00.000Z",
    "2026-07-16T13:20:00.000Z",
  );
  resynced.estimated_capacity_pct = 2;
  resynced.evidence = ["Fresh provider-owned aggregate evidence"];

  const merged = mergeChatWorkBlocks([reviewed], [resynced], {
    provider: "slack",
    range,
    mode: "live_sync",
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].start_time, "2026-07-16T13:00:00.000Z");
  assert.equal(merged[0].end_time, "2026-07-16T13:20:00.000Z");
  assert.equal(merged[0].estimated_capacity_pct, 2);
  assert.deepEqual(merged[0].evidence, ["Fresh provider-owned aggregate evidence"]);
  assert.equal(merged[0].category, "Planned analysis / project work");
  assert.equal(merged[0].mode, "Deep work");
  assert.equal(merged[0].planned_status, "planned");
  assert.equal(merged[0].project_name, "Reviewed synthetic project");
  assert.equal(merged[0].stakeholder_group, "Reviewed stakeholder group");
  assert.equal(merged[0].confidence, 0.99);
  assert.equal(merged[0].user_verified, true);
  assert.equal(merged[0].blocker_flag, true);
  assert.equal(merged[0].notes, "Keep this reviewed correction");
});

test("stable block ids that the user excluded remain suppressed after provider resync", () => {
  const range = normalizeChatRange({ start_date: "2026-07-14", end_date: "2026-07-20" });
  const excluded = chatBlock(
    "imported-excluded-stable-id",
    "webex",
    "2026-07-17T12:00:00.000Z",
    "2026-07-17T12:10:00.000Z",
  );
  const visible = chatBlock(
    "imported-visible-stable-id",
    "webex",
    "2026-07-18T12:00:00.000Z",
    "2026-07-18T12:10:00.000Z",
  );

  const merged = mergeChatWorkBlocks([], [excluded, visible], {
    provider: "webex",
    range,
    mode: "live_sync",
    excludedBlockIds: new Set(["imported-excluded-stable-id"]),
  });

  assert.deepEqual(merged.map((block) => block.work_block_id), ["imported-visible-stable-id"]);
});

test("ambient inbound traffic creates neither retained evidence nor workload capacity", () => {
  const result = transformChatEvidence([
    evidenceEvent(
      "ambient-channel-message",
      "ambient",
      "ambient",
      "2026-07-20T12:00:00.000Z",
      "opaque-conversation-ambient",
      "PRIVATE_AMBIENT_SPACE_NAME",
    ),
  ]);

  assert.deepEqual(result.events, []);
  assert.deepEqual(result.work_blocks, []);
  assert.deepEqual(result.review_signals, []);
  assert.equal(
    result.work_blocks.reduce((total, block) => total + block.estimated_capacity_pct, 0),
    0,
  );
  assert.equal(JSON.stringify(result).includes("PRIVATE_AMBIENT_SPACE_NAME"), false);
});

test("directed inbound evidence without observed self action stays review-only and consumes no capacity", () => {
  const result = transformChatEvidence([
    evidenceEvent(
      "direct-mention-unanswered",
      "direct_mention",
      "directed",
      "2026-07-20T12:00:00.000Z",
      "opaque-conversation-mention",
      "PRIVATE_MENTION_SPACE_NAME",
    ),
    evidenceEvent(
      "direct-message-unanswered",
      "direct_message",
      "directed",
      "2026-07-20T13:00:00.000Z",
      "opaque-conversation-dm",
      "PRIVATE_DM_PERSON_NAME",
    ),
    evidenceEvent(
      "reply-to-self-unanswered",
      "reply_to_self",
      "directed",
      "2026-07-20T14:00:00.000Z",
      "opaque-conversation-reply",
      "PRIVATE_REPLY_SPACE_NAME",
    ),
  ]);

  assert.deepEqual(result.events, []);
  assert.deepEqual(result.work_blocks, []);
  assert.deepEqual(
    result.review_signals.map((signal) => signal.event_id),
    ["direct-mention-unanswered", "direct-message-unanswered", "reply-to-self-unanswered"],
  );
  assert.equal(
    result.work_blocks.reduce((total, block) => total + block.estimated_capacity_pct, 0),
    0,
  );
  const normalized = JSON.stringify(result);
  assert.equal(normalized.includes("PRIVATE_MENTION_SPACE_NAME"), false);
  assert.equal(normalized.includes("PRIVATE_DM_PERSON_NAME"), false);
  assert.equal(normalized.includes("PRIVATE_REPLY_SPACE_NAME"), false);

  const reviewBlocks = chatReviewSignalsToWorkBlocks(result.review_signals);
  assert.equal(reviewBlocks.length, 3);
  assert.equal(reviewBlocks.every((block) => block.estimated_capacity_pct === 0), true);
  assert.equal(reviewBlocks.every((block) => block.user_verified === false), true);
  assert.equal(reviewBlocks.every((block) => block.project_name === "Directed chat request"), true);
  assert.equal(JSON.stringify(reviewBlocks).includes("PRIVATE_"), false);
});

test("observed self action distinguishes proactive coordination from a directed response", () => {
  const result = transformChatEvidence([
    evidenceEvent(
      "standalone-self-sent",
      "self_sent",
      "observed",
      "2026-07-20T12:00:00.000Z",
      "opaque-conversation-self-sent",
      "PRIVATE_SELF_SENT_SPACE_NAME",
    ),
    evidenceEvent(
      "directed-before-response",
      "direct_mention",
      "directed",
      "2026-07-20T14:00:00.000Z",
      "opaque-conversation-correlated",
      "PRIVATE_CORRELATED_SPACE_NAME",
    ),
    evidenceEvent(
      "observed-response",
      "self_reaction",
      "observed",
      "2026-07-20T14:04:00.000Z",
      "opaque-conversation-correlated",
      "PRIVATE_CORRELATED_SPACE_NAME",
    ),
  ]);

  assert.equal(result.events.length, 2);
  assert.equal(result.work_blocks.length, 2);
  assert.equal(result.work_blocks.every((block) => block.user_verified === false), true);
  assert.equal(result.work_blocks.every((block) => block.estimated_capacity_pct > 0), true);
  assert.deepEqual(
    result.work_blocks.map((block) => block.project_name),
    ["Chat coordination", "Reactive messaging"],
  );
  assert.deepEqual(
    result.work_blocks.map((block) => [block.category, block.mode]),
    [
      ["Admin / coordination", "Collaborative"],
      ["Ad hoc stakeholder requests", "Reactive"],
    ],
  );
  assert.deepEqual(
    result.events.map((event) => event.metadata.kind),
    ["coordination_episode", "response_episode"],
  );
  assert.deepEqual(result.review_signals, []);

  const normalized = JSON.stringify(result);
  assert.equal(normalized.includes("PRIVATE_SELF_SENT_SPACE_NAME"), false);
  assert.equal(normalized.includes("PRIVATE_CORRELATED_SPACE_NAME"), false);
  assert.equal(JSON.stringify(result.work_blocks).includes("Slack"), false);
});

test("nearby observed actions in one conversation collapse into one bounded response episode", () => {
  const result = transformChatEvidence([
    evidenceEvent(
      "self-action-1",
      "self_sent",
      "observed",
      "2026-07-20T12:00:00.000Z",
      "opaque-conversation-session",
      "PRIVATE_SESSION_NAME",
    ),
    evidenceEvent(
      "self-action-2",
      "self_reaction",
      "observed",
      "2026-07-20T12:03:00.000Z",
      "opaque-conversation-session",
      "PRIVATE_SESSION_NAME",
    ),
    evidenceEvent(
      "self-action-3",
      "self_sent",
      "observed",
      "2026-07-20T12:08:00.000Z",
      "opaque-conversation-session",
      "PRIVATE_SESSION_NAME",
    ),
  ]);

  assert.equal(result.events.length, 1);
  assert.equal(result.work_blocks.length, 1);
  assert.equal(result.events[0].metadata.observed_actions, "3");
  assert.equal(JSON.stringify(result).includes("PRIVATE_SESSION_NAME"), false);
});

test("a response consumes every nearby directed precursor without booking response latency as work", () => {
  const result = transformChatEvidence([
    evidenceEvent(
      "directed-1",
      "direct_mention",
      "directed",
      "2026-07-20T14:00:00.000Z",
      "same-correlation",
      "PRIVATE_NAME",
    ),
    evidenceEvent(
      "directed-2",
      "direct_message",
      "directed",
      "2026-07-20T14:02:00.000Z",
      "same-correlation",
      "PRIVATE_NAME",
    ),
    evidenceEvent(
      "observed-at-window-edge",
      "self_sent",
      "observed",
      "2026-07-20T14:29:00.000Z",
      "same-correlation",
      "PRIVATE_NAME",
    ),
  ]);

  assert.deepEqual(result.review_signals, []);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].timestamp_start, "2026-07-20T14:24:00.000Z");
  assert.equal(result.events[0].timestamp_end, "2026-07-20T14:30:00.000Z");
  assert.equal(result.events[0].metadata.directed_trigger, "true");
});

test("an early response remains correlated when later actions extend the same episode", () => {
  const result = transformChatEvidence([
    {
      ...evidenceEvent(
        "thread-request",
        "direct_mention",
        "directed",
        "2026-07-20T14:00:00.000Z",
        "same-thread",
        "PRIVATE_NAME",
      ),
      surface: "thread" as const,
      conversation_key: "same-channel",
      thread_key: "same-thread",
    },
    ...[
      ["reply", "2026-07-20T14:05:00.000Z"],
      ["follow-up", "2026-07-20T14:24:00.000Z"],
      ["close-out", "2026-07-20T14:43:00.000Z"],
    ].map(([id, timestamp]) => ({
      ...evidenceEvent(id, "self_sent", "observed", timestamp, "same-thread", "PRIVATE_NAME"),
      surface: "thread" as const,
      conversation_key: "same-channel",
      thread_key: "same-thread",
    })),
  ]);

  assert.deepEqual(result.review_signals, []);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].metadata.kind, "response_episode");
  assert.equal(result.events[0].metadata.directed_trigger, "true");
});

test("an unrelated top-level channel action cannot clear a directed review signal", () => {
  const directed = {
    ...evidenceEvent(
      "channel-mention",
      "direct_mention",
      "directed",
      "2026-07-20T14:00:00.000Z",
      "same-channel",
      "PRIVATE_CHANNEL",
    ),
    surface: "channel" as const,
    conversation_key: "same-channel",
    thread_key: null,
  };
  const unrelatedAction = {
    ...evidenceEvent(
      "unrelated-channel-message",
      "self_sent",
      "observed",
      "2026-07-20T14:04:00.000Z",
      "same-channel",
      "PRIVATE_CHANNEL",
    ),
    surface: "channel" as const,
    conversation_key: "same-channel",
    thread_key: null,
  };

  const result = transformChatEvidence([directed, unrelatedAction]);

  assert.equal(result.work_blocks.length, 1);
  assert.deepEqual(result.review_signals.map((signal) => signal.event_id), ["channel-mention"]);
  assert.equal(result.events[0]?.metadata.directed_trigger, undefined);
});

test("a reply in the same explicit thread can clear its directed review signal", () => {
  const directed = {
    ...evidenceEvent(
      "thread-mention",
      "direct_mention",
      "directed",
      "2026-07-20T15:00:00.000Z",
      "same-thread",
      "PRIVATE_CHANNEL",
    ),
    surface: "thread" as const,
    conversation_key: "same-channel",
    thread_key: "same-thread",
  };
  const reply = {
    ...evidenceEvent(
      "thread-reply",
      "self_sent",
      "observed",
      "2026-07-20T15:04:00.000Z",
      "same-thread",
      "PRIVATE_CHANNEL",
    ),
    surface: "thread" as const,
    conversation_key: "same-channel",
    thread_key: "same-thread",
  };

  const result = transformChatEvidence([directed, reply]);

  assert.equal(result.work_blocks.length, 1);
  assert.deepEqual(result.review_signals, []);
  assert.equal(result.events[0]?.metadata.directed_trigger, "true");
});

test("nearby unanswered directed signals on one correlation become one review card", () => {
  const result = transformChatEvidence([
    evidenceEvent("directed-burst-1", "direct_message", "directed", "2026-07-20T15:00:00.000Z", "same-thread", "PRIVATE_NAME"),
    evidenceEvent("directed-burst-2", "direct_mention", "directed", "2026-07-20T15:04:00.000Z", "same-thread", "PRIVATE_NAME"),
    evidenceEvent("directed-burst-3", "reply_to_self", "directed", "2026-07-20T15:09:00.000Z", "same-thread", "PRIVATE_NAME"),
  ]);

  assert.equal(result.review_signals.length, 1);
  assert.equal(chatReviewSignalsToWorkBlocks(result.review_signals).length, 1);
});

test("Chat work blocks use the user's local ISO week at a Sunday-night boundary", () => {
  const localSundayNight = new Date(2026, 6, 19, 23, 30, 0, 0);
  const result = transformChatEvidence([
    evidenceEvent(
      "local-sunday-response",
      "self_sent",
      "observed",
      localSundayNight.toISOString(),
      "local-week",
      "PRIVATE_NAME",
    ),
  ]);

  assert.equal(result.work_blocks[0]?.week_id, "2026-W29");
});
