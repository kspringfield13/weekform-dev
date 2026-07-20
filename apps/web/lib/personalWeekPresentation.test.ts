import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateReplicaModes,
  aggregateReplicaCategories,
  capacityForPresentation,
  capacityCoverage,
  displayPercent,
  isElevatedRatioScore,
  ratioScorePercent,
  safePercent,
} from "./personalWeekPresentation";

test("capacity coverage clamps impossible replica values and always totals 100 percent", () => {
  assert.deepEqual(
    capacityCoverage({
      committedUtilizationPct: 76.4,
      reliableNewWorkCapacityPct: 31.8,
    }),
    { committedPct: 76.4, availablePct: 23.6, protectedPct: 0 },
  );

  assert.deepEqual(
    capacityCoverage({
      committedUtilizationPct: Number.NaN,
      reliableNewWorkCapacityPct: -12,
    }),
    { committedPct: 0, availablePct: 0, protectedPct: 100 },
  );
});

test("capacity coverage stays visually empty when the current replica has no review-safe signal", () => {
  assert.deepEqual(
    capacityCoverage({
      committedUtilizationPct: 84,
      reliableNewWorkCapacityPct: 16,
    }, false),
    { committedPct: 0, availablePct: 0, protectedPct: 0 },
  );
});

test("an empty replica zeroes every capacity field in the presentation model", () => {
  const source = {
    allocatedPct: 91,
    deepWorkPct: 22,
    fragmentedWorkPct: 18,
    meetingPct: 31,
    reactivePct: 29,
    plannedPct: 62,
    blockedPct: 12,
    reliableNewWorkCapacityPct: 9,
    committedUtilizationPct: 91,
    carryoverRiskPct: 27,
    wipLoadScore: 0.42,
    contextSwitchScore: 0.38,
    summaryConfidence: 0.93,
  };

  assert.deepEqual(
    capacityForPresentation(source, false),
    Object.fromEntries(Object.keys(source).map((key) => [key, 0])),
  );
  assert.equal(capacityForPresentation(source, true), source);
});

test("safe percent keeps presentation widths finite and bounded", () => {
  assert.equal(safePercent(48.6), 48.6);
  assert.equal(safePercent(-3), 0);
  assert.equal(safePercent(150), 100);
  assert.equal(safePercent(Number.POSITIVE_INFINITY), 0);
});

test("display percentages preserve honest overload while geometry remains bounded", () => {
  assert.equal(displayPercent(125.4), 125);
  assert.equal(displayPercent(99.6), 100);
  assert.equal(displayPercent(-3), 0);
  assert.equal(displayPercent(Number.POSITIVE_INFINITY), 0);

  assert.equal(safePercent(125.4), 100);
});

test("category aggregation uses only allowlisted category and capacity fields", () => {
  const categories = aggregateReplicaCategories([
    { category: "Meetings / stakeholder syncs", estimatedCapacityPct: 8 },
    { category: "QA / data validation", estimatedCapacityPct: 12 },
    { category: "Meetings / stakeholder syncs", estimatedCapacityPct: 7.5 },
    { category: "Admin / coordination", estimatedCapacityPct: -4 },
  ]);

  assert.deepEqual(categories, [
    {
      label: "Meetings / stakeholder syncs",
      capacityPct: 15.5,
      sharePct: 56,
    },
    {
      label: "QA / data validation",
      capacityPct: 12,
      sharePct: 44,
    },
  ]);
});

test("top-category shares retain the full review-safe block total as denominator", () => {
  const categories = aggregateReplicaCategories([
    { category: "Planned analysis / project work", estimatedCapacityPct: 40 },
    { category: "QA / data validation", estimatedCapacityPct: 30 },
    { category: "Meetings / stakeholder syncs", estimatedCapacityPct: 20 },
    { category: "Admin / coordination", estimatedCapacityPct: 10 },
  ], 2);

  assert.deepEqual(categories, [
    { label: "Planned analysis / project work", capacityPct: 40, sharePct: 40 },
    { label: "QA / data validation", capacityPct: 30, sharePct: 30 },
  ]);
});

test("ratio scores use the Desktop 0..1 scale for display and elevated guidance", () => {
  assert.equal(ratioScorePercent(0.38), 38);
  assert.equal(ratioScorePercent(0.42), 42);
  assert.equal(ratioScorePercent(Number.NaN), 0);
  assert.equal(ratioScorePercent(1.4), 100);

  assert.equal(isElevatedRatioScore(0.29, 0.3), false);
  assert.equal(isElevatedRatioScore(0.3, 0.3), true);
  assert.equal(isElevatedRatioScore(0.38, 0.3), true);
});

test("work-mode shares come from disjoint replica blocks instead of overlapping capacity fields", () => {
  const modes = aggregateReplicaModes([
    { mode: "Deep work", estimatedCapacityPct: 30 },
    { mode: "Deep work", estimatedCapacityPct: 10 },
    { mode: "Reactive", estimatedCapacityPct: 20 },
    { mode: "Collaborative", estimatedCapacityPct: 25 },
    { mode: "Fragmented", estimatedCapacityPct: 5 },
    { mode: "Blocked", estimatedCapacityPct: 10 },
  ]);

  assert.deepEqual(modes, [
    { label: "Deep work", capacityPct: 40, sharePct: 40 },
    { label: "Collaborative", capacityPct: 25, sharePct: 25 },
    { label: "Reactive", capacityPct: 20, sharePct: 20 },
    { label: "Blocked", capacityPct: 10, sharePct: 10 },
    { label: "Fragmented", capacityPct: 5, sharePct: 5 },
  ]);
  assert.equal(modes.reduce((sum, mode) => sum + mode.sharePct, 0), 100);
});
