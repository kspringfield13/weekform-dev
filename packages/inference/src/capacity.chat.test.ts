// Contract tests for content-free chat evidence in the deterministic capacity layer.
// Run: node --import tsx --test packages/inference/src/capacity.chat.test.ts

import assert from "node:assert/strict";
import test from "node:test";

import type { RawEvent, WorkBlock } from "../../domain/src/models";
import {
  analyzeInterruptionLoad,
  computeWeeklyCapacitySnapshot,
  summarizeChatStakeholders,
} from "./capacity";

type ConnectedChatProvider = "slack" | "google_chat" | "webex";

function responseEpisode(
  provider: ConnectedChatProvider,
  overrides: Partial<RawEvent> = {},
): RawEvent {
  return {
    event_id: `chat-${provider}-observed-response`,
    user_id: "local-user",
    timestamp_start: "2026-07-20T14:00:00.000Z",
    timestamp_end: "2026-07-20T14:05:00.000Z",
    source_type: "chat",
    app_name:
      provider === "google_chat" ? "Google Chat" : provider === "slack" ? "Slack" : "Webex",
    window_title: null,
    domain: null,
    file_path: null,
    project_hint: null,
    metadata: {
      provider,
      kind: "response_episode",
      attention_grade: "observed",
      attention_signal: "self_reaction",
      coverage: "observed",
      // Deliberately no `messages`, body, channel, person, or workspace field. One event is one
      // observed response episode; message volume is neither available nor a capacity multiplier.
    },
    privacy_level: "derived_only",
    ...overrides,
  };
}

function deepWorkBlock(overrides: Partial<WorkBlock> = {}): WorkBlock {
  return {
    work_block_id: "deep-work-1",
    week_id: "2026-W30",
    start_time: "2026-07-20T13:00:00.000Z",
    end_time: "2026-07-20T15:00:00.000Z",
    estimated_capacity_pct: 5,
    category: "Planned analysis / project work",
    mode: "Deep work",
    planned_status: "planned",
    project_name: "Synthetic forecast model",
    stakeholder_group: "Individual",
    derived_from: ["synthetic-session-1"],
    evidence: ["Synthetic reviewed evidence"],
    confidence: 0.95,
    user_verified: true,
    blocker_flag: false,
    notes: null,
    ...overrides,
  };
}

function responseWorkBlock(provider: ConnectedChatProvider): WorkBlock {
  return {
    work_block_id: `chat-${provider}-response-block`,
    week_id: "2026-W30",
    start_time: "2026-07-20T14:00:00.000Z",
    end_time: "2026-07-20T14:05:00.000Z",
    estimated_capacity_pct: 1,
    category: "Ad hoc stakeholder requests",
    mode: "Reactive",
    planned_status: "unplanned",
    project_name: "Reactive messaging",
    stakeholder_group: "Workplace chat",
    derived_from: [`chat-${provider}-observed-response`],
    evidence: [`Observed response episode from ${provider}`],
    confidence: 0.82,
    user_verified: false,
    blocker_flag: false,
    notes: null,
  };
}

test("a content-free observed response episode contributes one observed chat episode", () => {
  const analysis = analyzeInterruptionLoad([responseEpisode("slack")], []);

  assert.notEqual(
    analysis,
    null,
    "content-free canonical response episodes are valid evidence without a legacy messages count",
  );
  if (!analysis) return;

  const contract = analysis as unknown as Record<string, unknown>;
  assert.equal(contract.observed_response_episode_count, 1);
  assert.equal(contract.active_hours, 0.08);
});

test("focus overlap is represented as co-occurrence, never as proved interruption causation", () => {
  const analysis = analyzeInterruptionLoad(
    [responseEpisode("slack")],
    [deepWorkBlock()],
  );

  assert.notEqual(analysis, null);
  if (!analysis) return;

  const contract = analysis as unknown as Record<string, unknown>;
  assert.equal(contract.focus_overlap_block_count, 1);
  assert.equal(contract.focus_overlap_pct, 100);
  assert.equal(
    Object.keys(contract).some((key) => key.includes("interrupted_deep_work")),
    false,
    "an overlap can establish co-occurrence, not that chat caused an interruption",
  );
});

test("a zero-capacity review card cannot count as a focus block or focus overlap", () => {
  const reviewOnly = deepWorkBlock({
    work_block_id: "chat-review-zero-focus",
    estimated_capacity_pct: 0,
    confidence: 0.45,
    user_verified: false,
  });
  const analysis = analyzeInterruptionLoad([responseEpisode("slack")], [reviewOnly]);

  assert.notEqual(analysis, null);
  if (!analysis) return;
  assert.equal(analysis.focus_block_count, 0);
  assert.equal(analysis.focus_overlap_block_count, 0);
  assert.equal(analysis.focus_overlap_pct, 0);
});

test("Slack, Google Chat, and Webex canonical response evidence produces identical metrics and capacity", () => {
  const providers: ConnectedChatProvider[] = ["slack", "google_chat", "webex"];
  const analyses = providers.map((provider) =>
    analyzeInterruptionLoad([responseEpisode(provider)], []),
  );

  assert.equal(analyses.every((analysis) => analysis !== null), true);
  const comparableAnalyses = analyses.map((analysis) => {
    const contract = analysis as unknown as Record<string, unknown>;
    return {
      observed_response_episode_count: contract.observed_response_episode_count,
      active_hours: contract.active_hours,
      focus_overlap_block_count: contract.focus_overlap_block_count,
      focus_overlap_pct: contract.focus_overlap_pct,
    };
  });
  assert.deepEqual(comparableAnalyses[1], comparableAnalyses[0]);
  assert.deepEqual(comparableAnalyses[2], comparableAnalyses[0]);

  // Once the same provider-neutral response episode is reviewed into a WorkBlock, provider
  // identity must not alter any deterministic workload/capacity metric.
  const capacitySnapshots = providers.map((provider) => {
    const snapshot = computeWeeklyCapacitySnapshot("2026-W30", [responseWorkBlock(provider)]);
    return {
      allocated_pct: snapshot.allocated_pct,
      reactive_pct: snapshot.reactive_pct,
      carryover_risk_pct: snapshot.carryover_risk_pct,
      context_switch_score: snapshot.context_switch_score,
      reliable_new_work_capacity_pct: snapshot.reliable_new_work_capacity_pct,
    };
  });
  assert.deepEqual(capacitySnapshots[1], capacitySnapshots[0]);
  assert.deepEqual(capacitySnapshots[2], capacitySnapshots[0]);
});

test("a directed-only zero-capacity review card cannot change the weekly workload model", () => {
  const empty = computeWeeklyCapacitySnapshot("2026-W30", []);
  const directedReviewCard = responseWorkBlock("slack");
  directedReviewCard.work_block_id = "chat-provider-review-slack-directed-request";
  directedReviewCard.estimated_capacity_pct = 0;
  directedReviewCard.confidence = 0.45;
  directedReviewCard.project_name = "Directed chat request";
  directedReviewCard.evidence = ["Directed Chat evidence — review before counting workload"];

  assert.deepEqual(
    computeWeeklyCapacitySnapshot("2026-W30", [directedReviewCard]),
    empty,
    "review-only Chat evidence must remain outside capacity, confidence, WIP, and allocation until the user confirms time",
  );
});

test("legacy chat metadata cannot promote private channel or space labels into stakeholder output", () => {
  const privateChannel = "PRIVATE_CHANNEL acquisition-war-room";
  const privateSpace = "PRIVATE_SPACE confidential-reorganization";
  const legacyEvent = responseEpisode("slack", {
    metadata: {
      provider: "slack",
      kind: "response_episode",
      attention_grade: "observed",
      messages: "4",
      channels: `${privateChannel}\n${privateSpace}`,
    },
  });

  const summary = summarizeChatStakeholders([legacyEvent]);
  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes(privateChannel), false);
  assert.equal(serialized.includes(privateSpace), false);

  // A local individual view may retain a provider-level grouping, or omit stakeholder grouping
  // entirely. It may never derive a stakeholder/project identity from provider display labels.
  if (summary) {
    const safeProviderLabels = new Set(["Slack", "Google Chat", "Webex"]);
    assert.equal(
      summary.groups.every((group) => safeProviderLabels.has(group.label)),
      true,
    );
  }
});
