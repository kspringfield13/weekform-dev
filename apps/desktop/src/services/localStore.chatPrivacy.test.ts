import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizePersistedChatEvents,
  sanitizePersistedWorkBlocks,
} from "./localStore";

const privateLabel = "PRIVATE_CHANNEL acquisition-war-room";

test("legacy persisted Chat events discard conversation labels and volume metadata", () => {
  const events = sanitizePersistedChatEvents([{
    event_id: "chat-slack-legacy",
    user_id: "local-user",
    timestamp_start: "2026-07-20T12:00:00.000Z",
    timestamp_end: "2026-07-20T12:05:00.000Z",
    source_type: "chat",
    app_name: "Slack",
    window_title: privateLabel,
    domain: privateLabel,
    file_path: null,
    project_hint: privateLabel,
    metadata: {
      provider: "slack",
      kind: "message",
      channels: privateLabel,
      messages: "47",
      participant_bucket: "2-5",
    },
    raw_message_body: privateLabel,
    conversation_name: privateLabel,
    privacy_level: "derived_only",
  }]);

  assert.equal(events.length, 1);
  assert.equal(JSON.stringify(events).includes(privateLabel), false);
  assert.deepEqual(events[0].metadata, {
    provider: "slack",
    kind: "message",
    participant_bucket: "2-5",
  });
  assert.deepEqual(Object.keys(events[0]).sort(), [
    "app_name",
    "domain",
    "event_id",
    "file_path",
    "metadata",
    "privacy_level",
    "project_hint",
    "source_type",
    "timestamp_end",
    "timestamp_start",
    "user_id",
    "window_title",
  ]);
});

test("legacy Chat metadata fails closed when safe-looking keys carry unknown values", () => {
  const events = sanitizePersistedChatEvents([{
    event_id: "chat-private-legacy",
    user_id: "local-user",
    timestamp_start: "2026-07-20T12:00:00.000Z",
    timestamp_end: "2026-07-20T12:05:00.000Z",
    source_type: "chat",
    app_name: privateLabel,
    metadata: {
      provider: privateLabel,
      kind: privateLabel,
      attention_grade: privateLabel,
      attention_signal: privateLabel,
      coverage: privateLabel,
      participant_bucket: privateLabel,
      directed_trigger: privateLabel,
    },
    privacy_level: "derived_only",
  }]);

  assert.deepEqual(events, []);
});

test("upgrade sanitizes auto-derived Chat labels but preserves reviewed truth", () => {
  const base = {
    work_block_id: "imported-chat-legacy",
    week_id: "2026-W30",
    start_time: "2026-07-20T12:00:00.000Z",
    end_time: "2026-07-20T12:05:00.000Z",
    estimated_capacity_pct: 1,
    category: "Ad hoc stakeholder requests",
    mode: "Reactive",
    planned_status: "unplanned",
    project_name: privateLabel,
    stakeholder_group: privateLabel,
    derived_from: ["chat-slack-legacy"],
    evidence: [`Project hint: ${privateLabel}`],
    confidence: 0.55,
    user_verified: false,
    blocker_flag: false,
    notes: null,
  } as const;
  const [automatic, reviewed] = sanitizePersistedWorkBlocks([
    base,
    { ...base, work_block_id: "reviewed", user_verified: true, project_name: "User correction" },
  ]);

  assert.equal(JSON.stringify(automatic).includes(privateLabel), false);
  assert.equal(automatic.project_name, "Reactive messaging");
  assert.equal(reviewed.project_name, "User correction");
});
