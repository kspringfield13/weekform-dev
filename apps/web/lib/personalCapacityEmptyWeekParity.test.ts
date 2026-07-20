import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const capacitySource = readFileSync(
  new URL("../components/PersonalWeekOverview.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);

test("Individual Web Capacity renders an honest Desktop-equivalent empty current week", () => {
  assert.match(capacitySource, /const hasCurrentWeekSignal = replica\.blocks\.length > 0/);
  assert.match(capacitySource, /const displayCapacity = capacityForPresentation\(capacity, hasCurrentWeekSignal\)/);
  assert.match(capacitySource, /No review-safe work this week yet\./);
  assert.match(capacitySource, /capacityCoverage\(displayCapacity, hasCurrentWeekSignal\)/);
  assert.match(capacitySource, /Enable Private Web workspace in Weekform for Mac/);
  assert.doesNotMatch(
    capacitySource,
    /capacityCoverage\(capacity\);/,
    "an empty replica must not silently render the remainder as a real protected buffer",
  );
});

test("Capacity names modeled review-safe allocation without claiming raw Mac evidence", () => {
  assert.match(capacitySource, /Tracked time by work mode:/);
  assert.match(capacitySource, /<small>tracked<\/small>/);
  assert.match(capacitySource, /aggregateReplicaModes\(replica\.blocks\)/);
  assert.doesNotMatch(capacitySource, /aggregateReplicaTrackedModes/);
});

test("Capacity fails loudly and distinguishes invalid replicas from load failures", () => {
  const capacityScreen = dashboardSource.slice(
    dashboardSource.indexOf("function PersonalCapacityScreen"),
    dashboardSource.indexOf("function SharedWorkloadSection"),
  );

  assert.match(capacityScreen, /errorKind:\s*"integrity" \| "load" \| null/);
  assert.match(capacityScreen, /Your private Web data could not be validated\./);
  assert.match(capacityScreen, /Your private Web data could not be loaded\./);
  assert.match(capacityScreen, /role="alert"/);
  assert.match(
    dashboardSource,
    /<PersonalCapacityScreen[\s\S]*?errorKind=\{personalReplicaErrorKind\}/,
  );
});
