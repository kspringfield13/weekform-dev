import assert from "node:assert/strict";
import test from "node:test";

import type {
  AccelerationSignal,
  UserCorrection,
  WeeklyCapacitySnapshot,
  WorkBlock,
} from "../../../../packages/domain/src/models";
import { buildForecastAgentPrompt } from "./forecastAgentPrompt";
import { buildWeeklyNarrativePrompt } from "./narrativePrompt";
import { buildReviewCopilotPrompt } from "./reviewCopilotPrompt";
import { buildWorkBlockClassifierPrompt } from "./workBlockClassifierPrompt";
import { buildAccelerationPrompt } from "./accelerationPrompt";
import { getPrimaryFocus, getRecentCorrections, getWeekWorkload } from "./agentTools";
import {
  externalSafeAccelerationSignal,
  externalSafeCorrections,
  externalSafeWorkBlock,
  externalWorkBlockId,
  resolveExternalWorkBlockIds,
} from "../../../../packages/inference/src/externalWorkBlock";

const snapshot: WeeklyCapacitySnapshot = {
  week_id: "2026-W30",
  allocated_pct: 8,
  deep_work_pct: 0,
  fragmented_work_pct: 0,
  meeting_pct: 0,
  reactive_pct: 8,
  planned_pct: 0,
  blocked_pct: 0,
  recurring_pct: 0,
  reliable_new_work_capacity_pct: 30,
  committed_utilization_pct: 8,
  carryover_risk_pct: 0,
  wip_load_score: 8,
  context_switch_score: 4,
  fragmentation_penalty_pct: 0,
  wip_penalty_pct: 0,
  summary_confidence: 0.8,
  category_allocation: [],
  work_mode_allocation: [],
};

function block(overrides: Partial<WorkBlock>): WorkBlock {
  return {
    work_block_id: "local-block",
    week_id: "2026-W30",
    start_time: "2026-07-20T13:00:00.000Z",
    end_time: "2026-07-20T13:30:00.000Z",
    estimated_capacity_pct: 2,
    category: "Admin / coordination",
    mode: "Reactive",
    planned_status: "unplanned",
    project_name: "Local coordination",
    stakeholder_group: "Local team",
    derived_from: ["session-local"],
    evidence: ["Local activity"],
    confidence: 0.8,
    user_verified: false,
    blocker_flag: false,
    notes: null,
    ...overrides,
  };
}

const directedSlack = block({
  work_block_id: "chat-review-slack-canonical-chat-hash-slack",
  estimated_capacity_pct: 0,
  project_name: "Slack directed request",
  stakeholder_group: "Slack workspace",
  derived_from: ["chat-slack-review-canonical-chat-hash-slack"],
  evidence: ["Slack source canonical-chat-hash-slack"],
});
const observedGoogle = block({
  work_block_id: "imported-observed-google",
  project_name: "Google Chat response",
  stakeholder_group: "Google Chat space",
  derived_from: ["chat-google_chat-canonical-chat-hash-google"],
  evidence: ["App: Google Chat", "canonical-chat-hash-google"],
});
const legacyTeams = block({
  work_block_id: "chat-teams-legacy-provider-id",
  project_name: "Microsoft Teams legacy response",
  stakeholder_group: "Teams channel",
  derived_from: ["chat-teams-legacy-source-id"],
  evidence: ["Microsoft Teams legacy-source-id"],
});
const observedWebex = block({
  work_block_id: "imported-observed-webex",
  project_name: "Webex response",
  stakeholder_group: "Webex room",
  derived_from: ["chat-webex-canonical-chat-hash-webex"],
  evidence: ["App: Webex", "canonical-chat-hash-webex"],
});
const localBlock = block({ work_block_id: "local-block-stays-stable" });
const blocks = [directedSlack, observedGoogle, legacyTeams, observedWebex, localBlock];

const corrections: UserCorrection[] = [directedSlack, observedGoogle, legacyTeams, observedWebex].map(
  (source, index) => ({
    correction_id: `correction-${index}`,
    work_block_id: source.work_block_id,
    field: "project_name",
    old_value: source.project_name,
    new_value: `${source.project_name} corrected`,
    timestamp: `2026-07-20T14:0${index}:00.000Z`,
    reason: `Corrected provider label ${source.project_name}`,
  }),
);

function context(prompt: string): Record<string, any> {
  const payload = prompt.split("\n\n").at(-1);
  assert.ok(payload);
  return JSON.parse(payload) as Record<string, any>;
}

function assertNoProviderIdentity(value: unknown, label: string) {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    "Slack",
    "Google Chat",
    "Webex",
    "Microsoft Teams",
    "Teams channel",
    "chat-slack-",
    "chat-google_chat-",
    "chat-webex-",
    "chat-teams-",
    "canonical-chat-hash-",
    "legacy-source-id",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${label} leaked ${forbidden}`);
  }
}

test("all WorkBlock AI prompt serializers use the same provider-free Chat projection", () => {
  const classifier = context(buildWorkBlockClassifierPrompt({
    weekId: "2026-W30",
    weekRangeLabel: "Jul 20–26",
    sessions: [],
    visualContextInsights: [],
    existingBlocks: blocks,
    calendarEvents: [],
    corrections,
  }));
  const review = context(buildReviewCopilotPrompt({
    weekId: "2026-W30",
    weekRangeLabel: "Jul 20–26",
    snapshot,
    reviewQueue: blocks,
    allBlocks: blocks,
    activeWindowSessions: [],
    calendarEvents: [],
    corrections,
  }));
  const forecast = context(buildForecastAgentPrompt({
    currentWeekId: "2026-W30",
    currentWeekRangeLabel: "Jul 20–26",
    nextWeekId: "2026-W31",
    nextWeekRangeLabel: "Jul 27–Aug 2",
    snapshot,
    blocks,
    activeWindowSessions: [],
    calendarEvents: [],
    corrections,
  }));
  const narrative = context(buildWeeklyNarrativePrompt({
    weekId: "2026-W30",
    weekRangeLabel: "Jul 20–26",
    snapshot,
    blocks,
    activeWindowSessions: [],
    calendarEvents: [],
    visualContextInsights: [],
    corrections,
  }));

  const promptContexts = { classifier, review, forecast, narrative };
  for (const [label, promptContext] of Object.entries(promptContexts)) {
    assertNoProviderIdentity(promptContext, label);
    assert.equal(JSON.stringify(promptContext).includes(localBlock.work_block_id), true);
  }

  const idSets = [
    classifier.existing_work_blocks.map((entry: any) => entry.work_block_id),
    review.all_work_blocks.map((entry: any) => entry.work_block_id),
    forecast.current_work_blocks.map((entry: any) => entry.work_block_id),
    narrative.ledger_context.work_blocks.map((entry: any) => entry.id),
  ];
  const expectedChatIds = idSets[0].filter((id: string) => id !== localBlock.work_block_id);
  assert.equal(expectedChatIds.length, 4);
  assert.equal(new Set(expectedChatIds).size, 4);
  assert.equal(expectedChatIds.every((id: string) => /^wfb-[a-f0-9]{64}$/.test(id)), true);
  for (const ids of idSets.slice(1)) assert.deepEqual(ids, idSets[0]);
});

test("conversational Agent tool results keep Chat provider identity local", async () => {
  const [workload, focus, recentCorrections] = await Promise.all([
    getWeekWorkload.execute({}, { blocks }),
    getPrimaryFocus.execute({}, { blocks }),
    getRecentCorrections.execute({ limit: 10 }, { corrections, blocks }),
  ]);

  assertNoProviderIdentity({ workload, focus, recentCorrections }, "Agent tools");
  assert.equal(JSON.stringify({ workload, focus }).includes(localBlock.project_name), true);
});

test("Review Copilot external ids resolve to local ids while provider-bearing ids fail closed", () => {
  const externalIds = [
    externalWorkBlockId(directedSlack),
    externalWorkBlockId(observedGoogle),
    localBlock.work_block_id,
    directedSlack.work_block_id,
    "unknown-external-id",
  ];

  assert.deepEqual(resolveExternalWorkBlockIds(blocks, externalIds), [
    directedSlack.work_block_id,
    observedGoogle.work_block_id,
    localBlock.work_block_id,
  ]);
});

test("Acceleration synthesis removes provider project labels from Chat-derived signals", () => {
  const signal: AccelerationSignal = {
    signal_id: "tool-chat-derived",
    type: "tool",
    title: "Webex coordination time sink",
    detail: "Webex response work repeated across the week.",
    evidence: [
      "Most of it sits in \"Webex response\"",
      "chat-webex-canonical-chat-hash-webex",
    ],
    estimated_minutes_saved_per_week: 60,
    confidence: 0.8,
    derived_from: [observedWebex.work_block_id],
  };
  const acceleration = context(buildAccelerationPrompt({
    weekRangeLabel: "Jul 20–26",
    signals: [signal],
    blocks,
  }));

  assertNoProviderIdentity(acceleration, "Acceleration prompt");
});

test("external boundary projection leaves non-Chat blocks, corrections, and signals unchanged", () => {
  const nonChat = block({
    work_block_id: "local-slack-api-project",
    project_name: "Slack API migration",
    evidence: ["Foreground IDE work on a Slack integration"],
    derived_from: ["session-local-slack-api"],
  });
  const correction: UserCorrection = {
    correction_id: "local-correction",
    work_block_id: nonChat.work_block_id,
    field: "project_name",
    old_value: "Slack API",
    new_value: "Slack API migration",
    timestamp: "2026-07-20T15:00:00.000Z",
    reason: "Local reviewed project name",
  };
  const signal: AccelerationSignal = {
    signal_id: "local-signal",
    type: "tool",
    title: "Slack API migration helper",
    detail: "Local non-Chat source signal",
    evidence: ["Slack integration repeated"],
    estimated_minutes_saved_per_week: 60,
    confidence: 0.8,
    derived_from: [nonChat.work_block_id],
  };

  assert.equal(externalSafeWorkBlock(nonChat), nonChat);
  assert.equal(externalWorkBlockId(nonChat), nonChat.work_block_id);
  assert.equal(externalSafeCorrections([correction], [nonChat])[0], correction);
  assert.equal(externalSafeAccelerationSignal(signal, [nonChat]), signal);
});
