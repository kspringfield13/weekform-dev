// Focused tests for the pure workload aggregation helpers (no Supabase, no
// network, no wall clock). Run: npx tsx --test apps/web/lib/workload.test.ts
// (root: npm run test:web)

import test from "node:test";
import assert from "node:assert/strict";

import {
  FRESH_MAX_HOURS,
  HIGH_REACTIVE_THRESHOLD_PCT,
  LOW_HEADROOM_THRESHOLD_PCT,
  STALE_AFTER_HOURS,
  approvedSnapshotProvenance,
  classifyFreshness,
  confidenceLabel,
  median,
  memberRiskFlags,
  reviewCoveragePct,
  summarizeLowHeadroom,
  summarizeSharedMetric,
  summarizeTeamWorkload,
  type MemberWorkloadInput,
} from "./workload";

const NOW = "2026-07-19T12:00:00.000Z";

function hoursBefore(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 60 * 60 * 1000).toISOString();
}

function snapshot(
  overrides: Partial<MemberWorkloadInput> & { userId: string },
): MemberWorkloadInput {
  return {
    weekId: "2026-W29",
    observedAt: hoursBefore(2),
    shareLevel: "summary",
    reliableCapacityPct: null,
    reactivePct: null,
    meetingPct: null,
    fragmentedPct: null,
    summaryConfidence: null,
    reviewedBlocks: 0,
    eligibleBlocks: 0,
    ...overrides,
  };
}

test("approved snapshot provenance uses one canonical coverage phrase", () => {
  assert.equal(
    approvedSnapshotProvenance(2, 5),
    "from 2 of 5 teammates' approved snapshots",
  );
  assert.equal(
    approvedSnapshotProvenance(1),
    "from 1 teammate's approved snapshot",
  );
});

test("median handles odd, even, single, and empty inputs", () => {
  assert.equal(median([30, 10, 20]), 20);
  assert.equal(median([10, 20, 30, 40]), 25);
  assert.equal(median([42]), 42);
  assert.equal(median([]), null);
  // Non-finite values are ignored, never coerced.
  assert.equal(median([Number.NaN, 12, Number.POSITIVE_INFINITY]), 12);
});

test("summarizeSharedMetric excludes unshared values instead of zeroing them", () => {
  const summary = summarizeSharedMetric([40, null, 10, undefined, 25]);
  assert.ok(summary);
  assert.equal(summary.median, 25);
  assert.equal(summary.min, 10);
  assert.equal(summary.max, 40);
  assert.equal(summary.sharedCount, 3);
});

test("summarizeSharedMetric is null (not zero) when nobody shared", () => {
  assert.equal(summarizeSharedMetric([null, undefined]), null);
  assert.equal(summarizeSharedMetric([]), null);
});

test("classifyFreshness boundaries: fresh, aging, stale, unknown", () => {
  assert.equal(classifyFreshness(hoursBefore(1), NOW), "fresh");
  assert.equal(classifyFreshness(hoursBefore(FRESH_MAX_HOURS), NOW), "fresh");
  assert.equal(classifyFreshness(hoursBefore(FRESH_MAX_HOURS + 1), NOW), "aging");
  assert.equal(classifyFreshness(hoursBefore(STALE_AFTER_HOURS), NOW), "aging");
  assert.equal(classifyFreshness(hoursBefore(STALE_AFTER_HOURS + 1), NOW), "stale");
  assert.equal(classifyFreshness("not-a-date", NOW), "unknown");
});

test("low-headroom count excludes stale and not-shared members", () => {
  const summary = summarizeLowHeadroom(
    [
      snapshot({ userId: "a", reliableCapacityPct: 10 }), // low
      snapshot({ userId: "b", reliableCapacityPct: LOW_HEADROOM_THRESHOLD_PCT }), // at threshold: not low
      snapshot({ userId: "c", reliableCapacityPct: null }), // not shared
      snapshot({
        userId: "d",
        reliableCapacityPct: 2,
        observedAt: hoursBefore(STALE_AFTER_HOURS + 24), // stale: excluded, not zero
      }),
    ],
    NOW,
  );
  assert.equal(summary.count, 1);
  assert.equal(summary.consideredCount, 2);
  assert.equal(summary.excludedNotSharedCount, 1);
  assert.equal(summary.excludedStaleCount, 1);
  assert.equal(summary.thresholdPct, LOW_HEADROOM_THRESHOLD_PCT);
});

test("reviewCoveragePct is null when nothing is eligible", () => {
  assert.equal(reviewCoveragePct(0, 0), null);
  assert.equal(reviewCoveragePct(3, 0), null);
  assert.equal(reviewCoveragePct(3, 4), 75);
  // Never above 100 even on malformed counts.
  assert.equal(reviewCoveragePct(9, 4), 100);
});

test("confidenceLabel buckets and refuses to invent confidence", () => {
  assert.equal(confidenceLabel(null), null);
  assert.equal(confidenceLabel(0.2), "low");
  assert.equal(confidenceLabel(0.5), "medium");
  assert.equal(confidenceLabel(0.9), "high");
});

test("memberRiskFlags are deterministic and explain their thresholds", () => {
  const input = snapshot({
    userId: "a",
    reliableCapacityPct: 8,
    reactivePct: HIGH_REACTIVE_THRESHOLD_PCT,
    reviewedBlocks: 1,
    eligibleBlocks: 10,
  });
  const first = memberRiskFlags(input, NOW);
  const second = memberRiskFlags(input, NOW);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((flag) => flag.id),
    ["low-headroom", "high-reactive", "low-review-coverage"],
  );
  for (const flag of first) {
    assert.ok(flag.explanation.includes("%"), "explanations state the numbers");
  }
});

test("unshared metrics never raise workload flags", () => {
  const flags = memberRiskFlags(snapshot({ userId: "a" }), NOW);
  assert.deepEqual(flags, []);
});

test("stale snapshots produce only a stale notice, never workload warnings", () => {
  const flags = memberRiskFlags(
    snapshot({
      userId: "a",
      reliableCapacityPct: 1,
      reactivePct: 99,
      observedAt: hoursBefore(STALE_AFTER_HOURS + 1),
    }),
    NOW,
  );
  assert.equal(flags.length, 1);
  const flag = flags[0];
  assert.ok(flag);
  assert.equal(flag.id, "stale-data");
  assert.equal(flag.severity, "notice");
});

test("team summary uses medians of shared current data, not sums or zeros", () => {
  const summary = summarizeTeamWorkload(
    5,
    [
      snapshot({ userId: "a", reliableCapacityPct: 30, reactivePct: 10 }),
      snapshot({ userId: "b", reliableCapacityPct: 10 }),
      snapshot({
        userId: "c",
        reliableCapacityPct: 50,
        observedAt: hoursBefore(STALE_AFTER_HOURS + 48), // stale: out of aggregates
      }),
    ],
    NOW,
  );
  assert.equal(summary.memberCount, 5);
  assert.equal(summary.sharingCount, 3);
  assert.ok(summary.reliableCapacity);
  assert.equal(summary.reliableCapacity.median, 20); // median of 30 and 10
  assert.equal(summary.reliableCapacity.min, 10);
  assert.equal(summary.reliableCapacity.max, 30);
  assert.equal(summary.reliableCapacity.sharedCount, 2);
  assert.ok(summary.reactive);
  assert.equal(summary.reactive.sharedCount, 1); // b did not share reactive
  assert.equal(summary.meetings, null); // nobody shared: null, not zero
  // Stale snapshot still counts toward "last update" honesty.
  assert.equal(summary.lastUpdatedAt, hoursBefore(2));
  assert.equal(summary.lowHeadroom.count, 1);
});
