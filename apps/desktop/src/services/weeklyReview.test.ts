// Contract tests for Prompt 15's local-only weekly review checklist.
// Run: node --import tsx --test apps/desktop/src/services/weeklyReview.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { AuditEvent, WorkBlock, VisualContextInsight } from "../../../../packages/domain/src/models";
import type { ForecastTrackRecordEntry } from "../../../../packages/inference/src/capacity";
import { deriveWeeklyReviewState, type WeeklyReviewInput } from "./weeklyReview";

const WEEK_ID = "2026-W29";

function block(_id: string, verified: boolean, weekId = WEEK_ID): Pick<WorkBlock, "week_id" | "user_verified"> {
  return { week_id: weekId, user_verified: verified };
}

function insight(
  sensitive: boolean,
  capturedAt = "2026-07-16T12:00:00.000Z"
): Pick<VisualContextInsight, "captured_at" | "sensitive_content_detected"> {
  return { captured_at: capturedAt, sensitive_content_detected: sensitive };
}

function successfulShareAudit(
  weekId = WEEK_ID,
  snapshotId = "snapshot-29",
  teamId = "team-1"
): Pick<AuditEvent, "type" | "details"> {
  return {
    type: "cloud_sharing",
    details: {
      action: "sync_success",
      week_id: weekId,
      client_snapshot_id: snapshotId,
      team_id: teamId
    }
  };
}

const forecast: ForecastTrackRecordEntry = {
  week_id: WEEK_ID,
  predicted_pct: 31,
  actual_pct: 27,
  error_pts: 4,
  signed_error_pts: 4,
  rating: "on_target"
};

function baseInput(): WeeklyReviewInput {
  return {
    weekId: WEEK_ID,
    blocks: [],
    visualContextInsights: [],
    forecastTrackRecord: [],
    generatedNarrative: null,
    cloudSharing: { enabled: false, teamId: null },
    auditEvents: [],
    consentReceipts: []
  };
}

test("all-done state marks every local review item complete", () => {
  const state = deriveWeeklyReviewState({
    ...baseInput(),
    blocks: [block("one", true), block("two", true), block("other-week", false, "2026-W28")],
    visualContextInsights: [insight(false), insight(true, "2026-07-09T12:00:00.000Z")],
    forecastTrackRecord: [forecast],
    generatedNarrative: { narrative: { week_id: WEEK_ID } },
    cloudSharing: { enabled: true, teamId: "team-1" },
    auditEvents: [successfulShareAudit()],
    consentReceipts: [{
      week_id: WEEK_ID,
      client_snapshot_id: "snapshot-29",
      destination: { team_id: "team-1" }
    }]
  });

  assert.equal(state.isComplete, true);
  assert.equal(state.doneCount, 5);
  assert.equal(state.pendingCount, 0);
  assert.deepEqual(state.items.map((item) => [item.id, item.status]), [
    ["work_blocks", "done"],
    ["sensitive_captures", "done"],
    ["forecast_accuracy", "done"],
    ["narrative", "done"],
    ["cloud_share", "done"]
  ]);
  assert.equal(state.items[0].count, 0);
  assert.equal(state.items[2].count, 4);
});

test("nothing-done state preserves counts and ordered destinations", () => {
  const state = deriveWeeklyReviewState({
    ...baseInput(),
    blocks: [block("one", false), block("two", false)],
    visualContextInsights: [insight(true), insight(false)],
    cloudSharing: { enabled: true, teamId: "team-1" }
  });

  assert.equal(state.isComplete, false);
  assert.equal(state.doneCount, 0);
  assert.equal(state.pendingCount, 5);
  assert.deepEqual(state.items.map((item) => [item.id, item.target, item.count]), [
    ["work_blocks", "ledger", 2],
    ["sensitive_captures", "sensitive", 1],
    ["forecast_accuracy", "forecast", null],
    ["narrative", "narrative", null],
    ["cloud_share", "setup", null]
  ]);
});

test("cloud-disabled state omits the share item instead of failing it", () => {
  const state = deriveWeeklyReviewState({
    ...baseInput(),
    blocks: [block("one", true)],
    forecastTrackRecord: [forecast],
    generatedNarrative: { narrative: { week_id: WEEK_ID } }
  });

  assert.equal(state.items.some((item) => item.id === "cloud_share"), false);
  assert.equal(state.items.length, 4);
  assert.equal(state.isComplete, true);
});

test("same local inputs produce value-identical state without mutating inputs", () => {
  const input: WeeklyReviewInput = {
    ...baseInput(),
    blocks: [block("one", false), block("two", true)],
    visualContextInsights: [insight(true)],
    forecastTrackRecord: [forecast],
    generatedNarrative: { narrative: { week_id: "2026-W29" } }
  };
  const before = structuredClone(input);

  const first = deriveWeeklyReviewState(input);
  const second = deriveWeeklyReviewState(input);

  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.deepEqual(input, before);
});

test("normalizes non-padded week ids across local evidence", () => {
  const state = deriveWeeklyReviewState({
    ...baseInput(),
    weekId: "2026-W5",
    blocks: [block("one", true, "2026-W05")],
    visualContextInsights: [insight(false, "2026-01-29T12:00:00.000Z")],
    forecastTrackRecord: [{ ...forecast, week_id: "2026-W05" }],
    generatedNarrative: { narrative: { week_id: "2026-W05" } },
    cloudSharing: { enabled: true, teamId: "team-1" },
    auditEvents: [successfulShareAudit("2026-W5", "snapshot-5")],
    consentReceipts: [{
      week_id: "2026-W05",
      client_snapshot_id: "snapshot-5",
      destination: { team_id: "team-1" }
    }]
  });

  assert.equal(state.weekId, "2026-W05");
  assert.equal(state.isComplete, true);
});

test("share remains pending unless success audit and receipt prove the same snapshot", () => {
  const state = deriveWeeklyReviewState({
    ...baseInput(),
    cloudSharing: { enabled: true, teamId: "team-1" },
    auditEvents: [successfulShareAudit(WEEK_ID, "snapshot-a")],
    consentReceipts: [{
      week_id: WEEK_ID,
      client_snapshot_id: "snapshot-b",
      destination: { team_id: "team-1" }
    }]
  });

  assert.equal(state.items.find((item) => item.id === "cloud_share")?.status, "pending");
});
