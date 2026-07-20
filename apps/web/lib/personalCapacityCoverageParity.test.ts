import assert from "node:assert/strict";
import test from "node:test";

import { capacityCoverage, displayPercent, safePercent } from "./personalWeekPresentation";

test("block-empty capacity never invents a protected delivery buffer", () => {
  assert.deepEqual(
    capacityCoverage(
      { committedUtilizationPct: 0, reliableNewWorkCapacityPct: 0 },
      false,
    ),
    { committedPct: 0, availablePct: 0, protectedPct: 0 },
  );
});

test("review-safe current-week capacity retains its modeled protected buffer", () => {
  assert.deepEqual(
    capacityCoverage(
      { committedUtilizationPct: 64, reliableNewWorkCapacityPct: 21 },
      true,
    ),
    { committedPct: 64, availablePct: 21, protectedPct: 15 },
  );
});

test("overload stays honest in labels while all visual geometry remains bounded", () => {
  assert.equal(displayPercent(124.6), 125);
  assert.equal(safePercent(124.6), 100);
  assert.deepEqual(
    capacityCoverage(
      { committedUtilizationPct: 124.6, reliableNewWorkCapacityPct: 18 },
      true,
    ),
    { committedPct: 100, availablePct: 0, protectedPct: 0 },
  );
});
