import assert from "node:assert/strict";
import test from "node:test";

import {
  importChatExport,
  parseChatExport,
} from "./chatExport";
import { analyzeInterruptionLoad } from "../../../inference/src/capacity";
import {
  sanitizePersistedChatEvents,
  sanitizePersistedWorkBlocks,
} from "../../../../apps/desktop/src/services/localStore";

test("legacy Microsoft Teams rows remain importable after Teams leaves the connection registry", () => {
  const rows = [
    { timestamp: "2026-07-20T12:00:00.000Z", provider: "teams", direction: "sent" },
    { timestamp: "2026-07-20T12:30:00.000Z", provider: "microsoft_teams", direction: "sent" },
    { timestamp: "2026-07-20T13:00:00.000Z", provider: "ms_teams", direction: "sent" },
    { timestamp: "2026-07-20T13:30:00.000Z", provider: "msteams", direction: "sent" },
  ];
  const records = parseChatExport(rows);

  assert.deepEqual(records.map((record) => record.provider), [
    "teams",
    "teams",
    "teams",
    "teams",
  ]);

  const imported = importChatExport(rows);
  assert.equal(imported.events.length, 4);
  assert.equal(imported.work_blocks.length, 4);
  assert.equal(imported.events.every((event) => event.metadata.provider === "teams"), true);
  assert.equal(imported.events.every((event) => event.app_name === "Workplace chat"), true);
  assert.equal(sanitizePersistedChatEvents(imported.events).length, 4);
});

test("Google Chat export aliases normalize to the canonical google_chat provider", () => {
  const records = parseChatExport([
    { timestamp: "2026-07-20T12:00:00.000Z", provider: "google_chat" },
    { timestamp: "2026-07-20T12:30:00.000Z", provider: "Google Chat" },
    { timestamp: "2026-07-20T13:00:00.000Z", provider: "google-chat" },
    { timestamp: "2026-07-20T13:30:00.000Z", provider: "googlechat" },
    { timestamp: "2026-07-20T14:00:00.000Z", provider: "gchat" },
    { timestamp: "2026-07-20T14:30:00.000Z", provider: "hangouts_chat" },
  ]);

  assert.deepEqual(
    records.map((record) => record.provider),
    Array.from({ length: 6 }, () => "google_chat"),
  );
});

test("chat imports derive an ISO week from each burst timestamp unless a week is explicitly overridden", () => {
  const derived = importChatExport([
    {
      timestamp: "2026-07-13T12:00:00.000Z",
      provider: "slack",
      surface: "channel",
      direction: "sent",
      channel_name: "#synthetic-operations",
    },
    {
      timestamp: "2026-07-20T12:00:00.000Z",
      provider: "slack",
      surface: "channel",
      direction: "sent",
      channel_name: "#synthetic-operations",
    },
  ]);

  assert.deepEqual(
    derived.work_blocks.map((block) => block.week_id),
    ["2026-W29", "2026-W30"],
  );

  const overridden = importChatExport([
    { timestamp: "2026-07-13T12:00:00.000Z", provider: "slack", direction: "sent" },
    { timestamp: "2026-07-20T12:00:00.000Z", provider: "slack", direction: "sent" },
  ], { weekId: "2026-W31" });

  assert.deepEqual(
    overridden.work_blocks.map((block) => block.week_id),
    ["2026-W31", "2026-W31"],
  );
});

test("ambient legacy channel traffic does not book workload capacity", () => {
  const result = importChatExport([
    {
      timestamp: "2026-07-20T12:00:00.000Z",
      provider: "slack",
      surface: "channel",
      direction: "received",
      mentioned_me: false,
      channel_name: "#synthetic-ambient-feed",
    },
  ]);

  assert.deepEqual(result.work_blocks, []);
  assert.equal(
    result.work_blocks.reduce((total, block) => total + block.estimated_capacity_pct, 0),
    0,
  );
});

test("a received legacy mention creates only a zero-capacity review card", () => {
  const result = importChatExport([
    {
      timestamp: "2026-07-20T12:00:00.000Z",
      provider: "slack",
      surface: "thread",
      direction: "received",
      mentioned_me: true,
      thread_id: "synthetic-directed-thread",
    },
  ]);

  assert.deepEqual(result.events, []);
  assert.equal(result.work_blocks.length, 1);
  assert.equal(result.work_blocks[0].estimated_capacity_pct, 0);
  assert.equal(result.work_blocks[0].project_name, "Directed chat request");
  assert.equal(result.work_blocks[0].stakeholder_group, "Workplace chat");
  assert.equal(result.work_blocks[0].user_verified, false);
});

test("unkeyed legacy DMs fail closed instead of guessing that a sent action is the response", () => {
  const result = importChatExport([
    {
      timestamp: "2026-07-20T12:00:00.000Z",
      provider: "slack",
      surface: "dm",
      direction: "received",
      mentioned_me: true,
    },
    {
      timestamp: "2026-07-20T12:05:00.000Z",
      provider: "slack",
      surface: "dm",
      direction: "sent",
    },
  ]);

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].metadata.kind, "coordination_episode");
  assert.equal(result.events[0].metadata.directed_trigger, undefined);
  assert.equal(result.work_blocks.some((block) => block.estimated_capacity_pct === 0), true);
});

test("legacy attention evidence keeps stable semantics through local persistence and metrics", () => {
  const result = importChatExport([
    {
      timestamp: "2026-07-20T09:00:00.000Z",
      provider: "slack",
      surface: "channel",
      direction: "received",
      mentioned_me: false,
    },
    {
      timestamp: "2026-07-20T09:10:00.000Z",
      provider: "slack",
      surface: "thread",
      direction: "received",
      mentioned_me: true,
      thread_id: "synthetic-unanswered-thread",
    },
    {
      timestamp: "2026-07-20T10:00:00.000Z",
      provider: "slack",
      surface: "thread",
      direction: "received",
      mentioned_me: true,
      thread_id: "synthetic-response-thread",
    },
    {
      timestamp: "2026-07-20T10:05:00.000Z",
      provider: "slack",
      surface: "thread",
      direction: "sent",
      thread_id: "synthetic-response-thread",
    },
    {
      timestamp: "2026-07-20T11:00:00.000Z",
      provider: "slack",
      surface: "channel",
      direction: "sent",
    },
    {
      timestamp: "2026-07-20T12:00:00.000Z",
      provider: "slack",
      surface: "huddle",
      direction: "received",
    },
  ]);

  assert.equal(result.events.length, 3);
  assert.equal(result.work_blocks.length, 4);

  const response = result.events.find((event) => event.metadata.kind === "response_episode");
  const coordination = result.events.find((event) => event.metadata.kind === "coordination_episode");
  const call = result.events.find((event) => event.metadata.kind === "call");
  assert.deepEqual(response?.metadata, {
    provider: "slack",
    kind: "response_episode",
    attention_grade: "observed",
    attention_signal: "self_sent",
    coverage: "observed",
    directed_trigger: "true",
  });
  assert.deepEqual(coordination?.metadata, {
    provider: "slack",
    kind: "coordination_episode",
    attention_grade: "observed",
    attention_signal: "self_sent",
    coverage: "observed",
  });
  assert.deepEqual(call?.metadata, {
    provider: "slack",
    kind: "call",
    attention_grade: "observed",
    attention_signal: "call_joined",
    coverage: "observed",
  });
  assert.equal(result.events.every((event) => event.app_name === "Workplace chat"), true);
  assert.equal(
    result.work_blocks.every((block) => block.evidence.every((line) => !line.includes("Slack"))),
    true,
  );

  const reviewCard = result.work_blocks.find((block) => block.estimated_capacity_pct === 0);
  assert.equal(reviewCard?.project_name, "Directed chat request");
  const responseBlock = result.work_blocks.find((block) =>
    response ? block.derived_from.includes(response.event_id) : false
  );
  const coordinationBlock = result.work_blocks.find((block) =>
    coordination ? block.derived_from.includes(coordination.event_id) : false
  );
  const callBlock = result.work_blocks.find((block) =>
    call ? block.derived_from.includes(call.event_id) : false
  );
  assert.equal(responseBlock?.mode, "Reactive");
  assert.equal(coordinationBlock?.category, "Admin / coordination");
  assert.equal(coordinationBlock?.mode, "Collaborative");
  assert.equal(callBlock?.category, "Meetings / stakeholder syncs");
  assert.equal(callBlock?.mode, "Collaborative");
  assert.equal(callBlock?.planned_status, "fixed");

  const hydratedEvents = sanitizePersistedChatEvents(result.events);
  const hydratedBlocks = sanitizePersistedWorkBlocks(result.work_blocks);
  assert.deepEqual(
    hydratedEvents.map((event) => event.metadata),
    result.events.map((event) => event.metadata),
  );
  assert.equal(hydratedEvents.every((event) => event.app_name === "Workplace chat"), true);
  assert.equal(hydratedBlocks.some((block) => block.estimated_capacity_pct === 0), true);
  const hydratedCoordinationBlock = hydratedBlocks.find((block) =>
    coordination ? block.derived_from.includes(coordination.event_id) : false
  );
  assert.equal(hydratedCoordinationBlock?.project_name, "Chat coordination");
  assert.equal(hydratedCoordinationBlock?.category, "Admin / coordination");
  assert.equal(hydratedCoordinationBlock?.mode, "Collaborative");

  const metrics = analyzeInterruptionLoad(hydratedEvents, hydratedBlocks);
  assert.notEqual(metrics, null);
  assert.equal(metrics?.observed_response_episode_count, 1);
  assert.equal(metrics?.directed_response_episode_count, 1);
});

test("normalization drops message content, attachments, and provider person identity fields", () => {
  const result = importChatExport([
    {
      timestamp: "2026-07-20T12:00:00.000Z",
      provider: "slack",
      surface: "dm",
      direction: "sent",
      mentioned_me: false,
      channel_name: "PRIVATE_PERSON_DISPLAY_NAME",
      thread_id: "synthetic-thread-1",
      participant_count: 2,
      message: "PRIVATE_MESSAGE_VALUE",
      body: "PRIVATE_BODY_VALUE",
      text: "PRIVATE_TEXT_VALUE",
      html: "PRIVATE_HTML_VALUE",
      attachment: "PRIVATE_ATTACHMENT_VALUE",
      attachments: [{ title: "PRIVATE_ATTACHMENT_TITLE" }],
      sender: "PRIVATE_SENDER_VALUE",
      sender_id: "PRIVATE_SENDER_ID",
      sender_name: "PRIVATE_SENDER_NAME",
      sender_email: "private-sender@example.test",
      person: "PRIVATE_PERSON_VALUE",
      person_id: "PRIVATE_PERSON_ID",
      person_name: "PRIVATE_PERSON_NAME",
      person_email: "private-person@example.test",
      members: [{ id: "PRIVATE_MEMBER_ID", name: "PRIVATE_MEMBER_NAME" }],
      metadata: {
        text: "PRIVATE_NESTED_TEXT",
        person_id: "PRIVATE_NESTED_PERSON_ID",
      },
    },
  ]);

  assert.equal(result.events.length, 1);
  assert.equal(result.work_blocks.length, 1);

  const forbiddenMetadataKeys = new Set([
    "message",
    "body",
    "text",
    "html",
    "attachment",
    "attachments",
    "sender",
    "sender_id",
    "sender_name",
    "sender_email",
    "person",
    "person_id",
    "person_name",
    "person_email",
    "members",
  ]);
  assert.deepEqual(
    Object.keys(result.events[0].metadata).filter((key) => forbiddenMetadataKeys.has(key)),
    [],
  );

  const normalized = JSON.stringify(result);
  for (const forbiddenValue of [
    "PRIVATE_PERSON_DISPLAY_NAME",
    "PRIVATE_MESSAGE_VALUE",
    "PRIVATE_BODY_VALUE",
    "PRIVATE_TEXT_VALUE",
    "PRIVATE_HTML_VALUE",
    "PRIVATE_ATTACHMENT_VALUE",
    "PRIVATE_ATTACHMENT_TITLE",
    "PRIVATE_SENDER_VALUE",
    "PRIVATE_SENDER_ID",
    "PRIVATE_SENDER_NAME",
    "private-sender@example.test",
    "PRIVATE_PERSON_VALUE",
    "PRIVATE_PERSON_ID",
    "PRIVATE_PERSON_NAME",
    "private-person@example.test",
    "PRIVATE_MEMBER_ID",
    "PRIVATE_MEMBER_NAME",
    "PRIVATE_NESTED_TEXT",
    "PRIVATE_NESTED_PERSON_ID",
  ]) {
    assert.equal(normalized.includes(forbiddenValue), false, forbiddenValue);
  }
});
