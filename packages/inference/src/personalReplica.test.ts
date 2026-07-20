import test from "node:test";
import assert from "node:assert/strict";

import type { WeeklyCapacitySnapshot, WorkBlock } from "../../domain/src/models";
import {
  buildPersonalWorkloadReplica,
  replicaContentFingerprint,
} from "./personalReplica";

const snapshot: WeeklyCapacitySnapshot = {
  week_id: "2026-W29",
  allocated_pct: 72,
  deep_work_pct: 38,
  fragmented_work_pct: 18,
  meeting_pct: 20,
  reactive_pct: 24,
  planned_pct: 54,
  blocked_pct: 4,
  recurring_pct: 10,
  reliable_new_work_capacity_pct: 8,
  committed_utilization_pct: 72,
  carryover_risk_pct: 12,
  wip_load_score: 42,
  context_switch_score: 36,
  fragmentation_penalty_pct: 4,
  wip_penalty_pct: 4,
  summary_confidence: 0.82,
  category_allocation: [],
  work_mode_allocation: [],
};

const block: WorkBlock = {
  work_block_id: "block-1",
  week_id: "2026-W29",
  start_time: "2026-07-14T13:00:00.000Z",
  end_time: "2026-07-14T14:30:00.000Z",
  estimated_capacity_pct: 4,
  category: "SQL / data modeling / query work",
  mode: "Deep work",
  planned_status: "planned",
  project_name: "Private roadmap",
  stakeholder_group: "Customer Alpha",
  derived_from: ["session-sensitive-1"],
  evidence: ["Secret App — Customer Alpha renewal"],
  confidence: 0.88,
  user_verified: false,
  blocker_flag: false,
  notes: "Call Jane about contract",
};

test("personal replica is a review-safe allowlist, never a filtered WorkBlock", () => {
  const replica = buildPersonalWorkloadReplica({
    weekId: "2026-W29",
    blocks: [block],
    snapshot,
    now: "2026-07-19T20:00:00.000Z",
  });

  assert.equal(replica.schemaVersion, 1);
  assert.equal(replica.blocks.length, 1);
  assert.deepEqual(Object.keys(replica.blocks[0]).sort(), [
    "blockId",
    "blockerFlag",
    "category",
    "confidence",
    "endTime",
    "estimatedCapacityPct",
    "mode",
    "plannedStatus",
    "revision",
    "startTime",
    "userVerified",
    "weekId",
  ]);
  const serialized = JSON.stringify(replica);
  for (const forbidden of [
    "Private roadmap",
    "Customer Alpha",
    "session-sensitive-1",
    "Secret App",
    "Call Jane",
    "window_title",
    "evidence",
    "notes",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `replica leaked ${forbidden}`);
  }
});

test("replica revisions are stable across timestamps and change with reviewable content", () => {
  const first = buildPersonalWorkloadReplica({
    weekId: "2026-W29",
    blocks: [block],
    snapshot,
    now: "2026-07-19T20:00:00.000Z",
  });
  const retry = buildPersonalWorkloadReplica({
    weekId: "2026-W29",
    blocks: [block],
    snapshot,
    now: "2026-07-19T20:05:00.000Z",
  });
  const reviewed = buildPersonalWorkloadReplica({
    weekId: "2026-W29",
    blocks: [{ ...block, user_verified: true }],
    snapshot,
    now: "2026-07-19T20:05:00.000Z",
  });

  assert.equal(replicaContentFingerprint(first), replicaContentFingerprint(retry));
  assert.equal(first.blocks[0].revision, retry.blocks[0].revision);
  assert.notEqual(first.blocks[0].revision, reviewed.blocks[0].revision);
  assert.notEqual(replicaContentFingerprint(first), replicaContentFingerprint(reviewed));
});

test("personal replica replaces every Chat-derived local id with a stable provider-free id", () => {
  const chatBlocks: WorkBlock[] = [
    {
      ...block,
      work_block_id: "chat-review-slack-canonical-chat-hash-slack",
      derived_from: ["chat-slack-review-canonical-chat-hash-slack"],
    },
    {
      ...block,
      work_block_id: "imported-observed-google",
      derived_from: ["chat-google_chat-canonical-chat-hash-google"],
    },
    {
      ...block,
      work_block_id: "chat-teams-legacy-provider-id",
      derived_from: ["chat-teams-legacy-source-id"],
    },
    {
      ...block,
      work_block_id: "imported-observed-webex",
      derived_from: ["chat-webex-canonical-chat-hash-webex"],
    },
  ];
  const local = { ...block, work_block_id: "local-id-remains-stable" };
  const first = buildPersonalWorkloadReplica({
    weekId: "2026-W29",
    blocks: [...chatBlocks, local],
    snapshot,
    now: "2026-07-19T20:00:00.000Z",
  });
  const retry = buildPersonalWorkloadReplica({
    weekId: "2026-W29",
    blocks: [...chatBlocks, local],
    snapshot,
    now: "2026-07-19T20:05:00.000Z",
  });

  const chatReplicaBlocks = first.blocks.filter((entry) => entry.blockId !== local.work_block_id);
  assert.equal(chatReplicaBlocks.length, 4);
  assert.equal(new Set(chatReplicaBlocks.map((entry) => entry.blockId)).size, 4);
  assert.equal(chatReplicaBlocks.every((entry) => /^wfb-[a-f0-9]{64}$/.test(entry.blockId)), true);
  assert.deepEqual(first.blocks.map((entry) => entry.blockId), retry.blocks.map((entry) => entry.blockId));
  assert.equal(first.blocks.some((entry) => entry.blockId === local.work_block_id), true);
  const serialized = JSON.stringify(first);
  for (const forbidden of [
    "slack",
    "google_chat",
    "webex",
    "teams",
    "canonical-chat-hash",
    "legacy-provider-id",
    "legacy-source-id",
  ]) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false, `replica leaked ${forbidden}`);
  }
});
