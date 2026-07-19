// Focused tests for the pure planning-scenario assessment (no Supabase, no
// network, no wall clock). Run: npx tsx --test apps/web/lib/scenario.test.ts
// (root: npm run test:web)

import test from "node:test";
import assert from "node:assert/strict";

import {
  LOW_HEADROOM_THRESHOLD_PCT,
  STALE_AFTER_HOURS,
  type MemberWorkloadInput,
} from "./workload";
import {
  MIN_SCENARIO_SHARED_COUNT,
  MIN_SCENARIO_SHARED_RATIO,
  absorptionVerdictLabel,
  assessAbsorption,
} from "./scenario";

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

test("empty team: insufficient shared data, no numeric claim", () => {
  const result = assessAbsorption(0, [], { additionalLoadPct: 10 }, NOW);
  assert.equal(result.verdict, "insufficient-shared-data");
  assert.equal(result.headroom, null);
  assert.equal(result.memberCount, 0);
  assert.equal(result.currentSharedCount, 0);
  assert.equal(result.coverageRatio, 0);
  assert.deepEqual(result.memberStatus, {});
});

test("nobody sharing: insufficient-data verdict, never a numeric absorbability claim", () => {
  const result = assessAbsorption(
    4,
    [
      snapshot({ userId: "a" }), // snapshot present, capacity not shared
      snapshot({ userId: "b" }),
    ],
    { additionalLoadPct: 10 },
    NOW,
  );
  assert.equal(result.verdict, "insufficient-shared-data");
  assert.equal(result.headroom, null); // no median/min/max invented
  assert.equal(result.currentSharedCount, 0);
  assert.equal(result.sharingCount, 2);
  // Two not-shared metrics plus two members with no snapshot: all unknown.
  assert.equal(result.excludedUnknownCount, 4);
  assert.equal(result.memberStatus["a"], "not-shared");
  assert.equal(result.memberStatus["b"], "not-shared");
  assert.ok(result.explanation.includes("0 of 4"));
});

test("all sharing fresh with plenty of headroom: absorbable, denominator honest", () => {
  const result = assessAbsorption(
    3,
    [
      snapshot({ userId: "a", reliableCapacityPct: 40 }),
      snapshot({ userId: "b", reliableCapacityPct: 50 }),
      snapshot({ userId: "c", reliableCapacityPct: 60 }),
    ],
    { additionalLoadPct: 10 },
    NOW,
  );
  assert.equal(result.verdict, "absorbable-within-shared-data");
  assert.ok(result.headroom);
  assert.equal(result.headroom.median, 50);
  assert.equal(result.headroom.min, 40);
  assert.equal(result.headroom.max, 60);
  assert.equal(result.headroom.sharedCount, 3);
  assert.equal(result.currentSharedCount, 3);
  assert.equal(result.coverageRatio, 1);
  assert.deepEqual(result.memberStatus, { a: "fits", b: "fits", c: "fits" });
  assert.ok(result.explanation.includes("3 of 3"));
});

test("mixed stale/fresh: stale excluded from the verdict, labeled per member", () => {
  const result = assessAbsorption(
    4,
    [
      snapshot({ userId: "a", reliableCapacityPct: 40 }),
      snapshot({ userId: "b", reliableCapacityPct: 30 }),
      snapshot({
        userId: "c",
        reliableCapacityPct: 90, // stale: must NOT inflate the median
        observedAt: hoursBefore(STALE_AFTER_HOURS + 24),
      }),
      snapshot({
        userId: "d",
        reliableCapacityPct: 90,
        observedAt: "not-a-date", // unknown timestamp: excluded too
      }),
    ],
    { additionalLoadPct: 10 },
    NOW,
  );
  assert.ok(result.headroom);
  assert.equal(result.headroom.median, 35); // median of 40 and 30 only
  assert.equal(result.currentSharedCount, 2);
  assert.equal(result.excludedStaleCount, 2);
  assert.equal(result.memberStatus["c"], "stale-excluded");
  assert.equal(result.memberStatus["d"], "stale-excluded");
});

test("null metrics are excluded, never treated as zero headroom", () => {
  const withNull = assessAbsorption(
    3,
    [
      snapshot({ userId: "a", reliableCapacityPct: 40 }),
      snapshot({ userId: "b", reliableCapacityPct: 60 }),
      snapshot({ userId: "c", reliableCapacityPct: null }),
    ],
    { additionalLoadPct: 10 },
    NOW,
  );
  assert.ok(withNull.headroom);
  // If null were coerced to zero the median would be 40, not 50.
  assert.equal(withNull.headroom.median, 50);
  assert.equal(withNull.memberStatus["c"], "not-shared");
  assert.equal(withNull.excludedUnknownCount, 1);
  // And "c" is never classified as "exceeds" just for not sharing.
  assert.notEqual(withNull.memberStatus["c"], "exceeds");
});

test("boundary: ask at the median is absorbable; ask above it is at-risk", () => {
  const members = [
    snapshot({ userId: "a", reliableCapacityPct: 20 }),
    snapshot({ userId: "b", reliableCapacityPct: 30 }),
    snapshot({ userId: "c", reliableCapacityPct: 40 }),
  ];
  const atMedian = assessAbsorption(3, members, { additionalLoadPct: 30 }, NOW);
  assert.equal(atMedian.verdict, "absorbable-within-shared-data");
  const aboveMedian = assessAbsorption(
    3,
    members,
    { additionalLoadPct: 31 },
    NOW,
  );
  assert.equal(aboveMedian.verdict, "at-risk");
  assert.ok(aboveMedian.headroom); // at-risk is still a shared-data statement
  assert.ok(aboveMedian.explanation.includes("30%"));
});

test("per-member classification: fits, tight, exceeds against own headroom", () => {
  const result = assessAbsorption(
    3,
    [
      snapshot({ userId: "roomy", reliableCapacityPct: 60 }),
      // Covers the ask but the remainder falls below the low-headroom threshold.
      snapshot({
        userId: "tight",
        reliableCapacityPct: 20 + LOW_HEADROOM_THRESHOLD_PCT - 1,
      }),
      snapshot({ userId: "over", reliableCapacityPct: 10 }),
    ],
    { additionalLoadPct: 20 },
    NOW,
  );
  assert.equal(result.memberStatus["roomy"], "fits");
  assert.equal(result.memberStatus["tight"], "tight");
  assert.equal(result.memberStatus["over"], "exceeds");
});

test("coverage ratio below the prototype minimum forces insufficient-data", () => {
  // 2 members share fresh capacity, but the roster is 5: 40% coverage,
  // below MIN_SCENARIO_SHARED_RATIO. The unknown majority blocks a verdict.
  const result = assessAbsorption(
    5,
    [
      snapshot({ userId: "a", reliableCapacityPct: 80 }),
      snapshot({ userId: "b", reliableCapacityPct: 80 }),
    ],
    { additionalLoadPct: 5 },
    NOW,
  );
  assert.ok(2 / 5 < MIN_SCENARIO_SHARED_RATIO);
  assert.ok(2 >= MIN_SCENARIO_SHARED_COUNT);
  assert.equal(result.verdict, "insufficient-shared-data");
  assert.equal(result.headroom, null);
});

test("a single sharer is never presented as a team verdict", () => {
  const result = assessAbsorption(
    1,
    [snapshot({ userId: "a", reliableCapacityPct: 90 })],
    { additionalLoadPct: 5 },
    NOW,
  );
  assert.equal(result.verdict, "insufficient-shared-data");
  assert.equal(result.headroom, null);
});

test("invalid asks are rejected, not silently assessed", () => {
  const members = [
    snapshot({ userId: "a", reliableCapacityPct: 40 }),
    snapshot({ userId: "b", reliableCapacityPct: 40 }),
  ];
  assert.throws(() => assessAbsorption(2, members, { additionalLoadPct: 0 }, NOW), RangeError);
  assert.throws(() => assessAbsorption(2, members, { additionalLoadPct: -5 }, NOW), RangeError);
  assert.throws(
    () => assessAbsorption(2, members, { additionalLoadPct: Number.NaN }, NOW),
    RangeError,
  );
});

test("deterministic: same inputs always produce the same output", () => {
  const members = [
    snapshot({ userId: "a", reliableCapacityPct: 25 }),
    snapshot({ userId: "b", reliableCapacityPct: null }),
    snapshot({
      userId: "c",
      reliableCapacityPct: 55,
      observedAt: hoursBefore(STALE_AFTER_HOURS + 1),
    }),
    snapshot({ userId: "d", reliableCapacityPct: 45 }),
  ];
  const first = assessAbsorption(4, members, { additionalLoadPct: 25 }, NOW);
  const second = assessAbsorption(4, members, { additionalLoadPct: 25 }, NOW);
  assert.deepEqual(first, second);
});

test("verdict labels are stable copy", () => {
  assert.equal(
    absorptionVerdictLabel("absorbable-within-shared-data"),
    "Absorbable within shared data",
  );
  assert.equal(absorptionVerdictLabel("at-risk"), "At risk within shared data");
  assert.equal(
    absorptionVerdictLabel("insufficient-shared-data"),
    "Insufficient shared data",
  );
});
