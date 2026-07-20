// Regression contract for the member-approved manager sharing boundary when local chat evidence
// contributes to capacity. Run:
// node --import tsx --test packages/inference/src/sharedSnapshot.chatPrivacy.test.ts

import assert from "node:assert/strict";
import test from "node:test";

import type { WorkBlock } from "../../domain/src/models";
import type { CloudSharePolicyV1 } from "../../domain/src/cloud";
import { computeWeeklyCapacitySnapshot } from "./capacity";
import { buildSharedWorkloadSnapshot } from "./sharedSnapshot";

const CHAT_SENTINELS = {
  provider: "PRIVATE_PROVIDER_SLACK",
  workspace: "PRIVATE_WORKSPACE acquisition-team",
  channel: "PRIVATE_CHANNEL merger-war-room",
  dm: "PRIVATE_DM_PERSON finance-counsel",
  rawEvent: "PRIVATE_RAW_EVENT evt-provider-123",
  message: "PRIVATE_MESSAGE confidential launch text",
  mention: "PRIVATE_MENTION chief-legal-officer",
  responseTime: "PRIVATE_RESPONSE_TIME 47-seconds",
  hourly: "PRIVATE_HOURLY 14:00-volume",
  afterHours: "PRIVATE_AFTER_HOURS 23:15",
} as const;

function localChatBlock(): WorkBlock & Record<string, unknown> {
  return {
    work_block_id: "chat-slack-observed-response",
    week_id: "2026-W30",
    start_time: "2026-07-20T14:00:00.000Z",
    end_time: "2026-07-20T14:05:00.000Z",
    estimated_capacity_pct: 1,
    category: "Ad hoc stakeholder requests",
    mode: "Reactive",
    planned_status: "unplanned",
    project_name: "Reactive messaging",
    stakeholder_group: "Workplace chat",
    derived_from: [CHAT_SENTINELS.rawEvent],
    evidence: [CHAT_SENTINELS.message, CHAT_SENTINELS.channel],
    confidence: 0.82,
    user_verified: true,
    blocker_flag: false,
    notes: CHAT_SENTINELS.dm,
    provider: CHAT_SENTINELS.provider,
    workspace_id: CHAT_SENTINELS.workspace,
    channel_name: CHAT_SENTINELS.channel,
    dm_identity: CHAT_SENTINELS.dm,
    raw_event: CHAT_SENTINELS.rawEvent,
    message_body: CHAT_SENTINELS.message,
    mention_identity: CHAT_SENTINELS.mention,
    response_time: CHAT_SENTINELS.responseTime,
    hourly_activity: CHAT_SENTINELS.hourly,
    after_hours_activity: CHAT_SENTINELS.afterHours,
  };
}

const policy: CloudSharePolicyV1 = {
  version: 1,
  enabled: true,
  teamId: "team-synthetic",
  shareLevel: "categories",
  metrics: {
    reliableCapacity: true,
    allocated: true,
    reactive: true,
    meetings: true,
    fragmented: true,
    blocked: true,
    carryoverRisk: true,
    contextSwitching: true,
    workInProgress: true,
    confidence: true,
  },
  allowedProjectNames: [],
  autoSyncEnabled: false,
  intervalMinutes: 60,
  consentedAt: "2026-07-20T12:00:00.000Z",
};

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  for (const [key, nested] of Object.entries(value)) {
    keys.push(key);
    collectKeys(nested, keys);
  }
  return keys;
}

test("manager serialization shares approved workload aggregates but no local chat details", () => {
  const block = localChatBlock();
  const localSnapshot = computeWeeklyCapacitySnapshot("2026-W30", [block]) as ReturnType<
    typeof computeWeeklyCapacitySnapshot
  > & Record<string, unknown>;

  // Defense-in-depth: even if future local analysis places richer chat rollups beside capacity,
  // the explicit manager allowlist must prevent those properties from crossing the boundary.
  Object.assign(localSnapshot, {
    provider: CHAT_SENTINELS.provider,
    workspace: CHAT_SENTINELS.workspace,
    channel: CHAT_SENTINELS.channel,
    dm: CHAT_SENTINELS.dm,
    raw_events: [CHAT_SENTINELS.rawEvent],
    messages: [CHAT_SENTINELS.message],
    mentions: [CHAT_SENTINELS.mention],
    response_time: CHAT_SENTINELS.responseTime,
    hourly: CHAT_SENTINELS.hourly,
    after_hours: CHAT_SENTINELS.afterHours,
  });

  const result = buildSharedWorkloadSnapshot({
    snapshot: localSnapshot,
    workBlocks: [block],
    policy,
    now: "2026-07-20T16:00:00.000Z",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  // The allowed derived reactive aggregate remains useful to a manager, while every source-level
  // detail stays local to the individual.
  assert.equal(result.snapshot.metrics.reactivePct, 1);

  const normalizedKeys = collectKeys(result.snapshot).map((key) =>
    key.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
  for (const forbiddenKey of [
    "provider",
    "workspace",
    "channel",
    "dm",
    "rawevent",
    "message",
    "mention",
    "responsetime",
    "hourly",
    "afterhours",
  ]) {
    assert.equal(
      normalizedKeys.some((key) => key.includes(forbiddenKey)),
      false,
      `manager payload contains forbidden chat key: ${forbiddenKey}`,
    );
  }

  const serialized = JSON.stringify(result.snapshot);
  for (const sentinel of Object.values(CHAT_SENTINELS)) {
    assert.equal(serialized.includes(sentinel), false, `manager payload leaked: ${sentinel}`);
  }
  for (const providerValue of ["slack", "google_chat", "webex"]) {
    assert.equal(serialized.toLowerCase().includes(providerValue), false);
  }
});

test("manager review coverage cannot reveal directed-only Chat card volume", () => {
  const measured = localChatBlock();
  const directedReviewCards = [1, 2, 3].map((index): WorkBlock => ({
    ...localChatBlock(),
    work_block_id: `chat-review-directed-${index}`,
    start_time: `2026-07-20T15:0${index}:00.000Z`,
    end_time: `2026-07-20T15:0${index + 1}:00.000Z`,
    estimated_capacity_pct: 0,
    project_name: "Directed chat request",
    user_verified: false,
    confidence: 0.45,
  }));
  const localSnapshot = computeWeeklyCapacitySnapshot("2026-W30", [
    measured,
    ...directedReviewCards,
  ]);
  const result = buildSharedWorkloadSnapshot({
    snapshot: localSnapshot,
    workBlocks: [measured, ...directedReviewCards],
    policy,
    now: "2026-07-20T16:00:00.000Z",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    result.snapshot.reviewCoverage,
    { reviewedBlocks: 1, eligibleBlocks: 1 },
    "zero-capacity directed signals stay local and cannot inflate a manager-visible count",
  );
});
