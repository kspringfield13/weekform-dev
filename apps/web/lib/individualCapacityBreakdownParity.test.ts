import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { categoryColors } from "../../../packages/domain/src/taxonomy";
import { aggregateReplicaModes, categoryColor } from "./personalWeekPresentation";

const desktopSource = readFileSync(
  new URL("../../desktop/src/components/capacity/WeeklyCapacityScreen.tsx", import.meta.url),
  "utf8",
);
const webSource = readFileSync(
  new URL("../components/PersonalWeekOverview.tsx", import.meta.url),
  "utf8",
);
const presentationSource = readFileSync(
  new URL("./personalWeekPresentation.ts", import.meta.url),
  "utf8",
);

test("Capacity categories default to Desktop's top five and expose the full allocation on request", () => {
  assert.match(desktopSource, /const \[showAllCategories, setShowAllCategories\] = useState\(false\)/);
  assert.match(webSource, /const \[showAllCategories, setShowAllCategories\] = useState\(false\)/);
  assert.match(
    webSource,
    /aggregateReplicaCategories\(replica\.blocks,\s*Number\.POSITIVE_INFINITY\)/,
    "Web needs the full review-safe category allocation before applying the visible top-five slice",
  );
  assert.match(webSource, /const visibleCategories = showAllCategories \? categories : categories\.slice\(0, 5\)/);
  assert.match(webSource, /categories\.length > 5[\s\S]*?aria-expanded=\{showAllCategories\}/);
  assert.match(webSource, /aria-controls="personal-week-category-list"/);
  assert.match(webSource, /showAllCategories \? "Show top 5" : "View all"/);
  assert.match(webSource, /id="personal-week-category-list"/);
  assert.match(webSource, /visibleCategories\.map\(/);
});

test("category marks use the stable Desktop taxonomy colors instead of changing with rank", () => {
  for (const [category, color] of Object.entries(categoryColors)) {
    assert.equal(categoryColor(category), color, `${category} must retain its Desktop taxonomy color`);
  }
  assert.ok(
    (webSource.match(/background:\s*categoryColor\(category\.label\)/g) ?? []).length >= 2,
    "both the category dot and bar must retain the category's stable taxonomy color",
  );
  assert.doesNotMatch(
    webSource,
    /data-tone=\{index\s*%\s*5\}/,
    "a category must not change color when its rank changes",
  );
});

test("Desktop-parity mode allocation remains based on deterministic estimated capacity", () => {
  const modes = aggregateReplicaModes([
    { mode: "Deep work", estimatedCapacityPct: 30 },
    { mode: "Deep work", estimatedCapacityPct: 10 },
    { mode: "Collaborative", estimatedCapacityPct: 25 },
    { mode: "Reactive", estimatedCapacityPct: 20 },
    { mode: "Blocked", estimatedCapacityPct: 15 },
  ]);

  assert.deepEqual(modes, [
    { label: "Deep work", capacityPct: 40, sharePct: 40 },
    { label: "Collaborative", capacityPct: 25, sharePct: 25 },
    { label: "Reactive", capacityPct: 20, sharePct: 20 },
    { label: "Blocked", capacityPct: 15, sharePct: 15 },
  ]);
  assert.match(webSource, /aggregateReplicaModes\(replica\.blocks\)/);
  assert.doesNotMatch(webSource, /aggregateReplicaTrackedModes/);
  assert.doesNotMatch(presentationSource, /aggregateReplicaTrackedModes|trackedDurationMinutes/);
});

test("Capacity donut formats modeled allocation against Desktop's 40-hour baseline", () => {
  assert.match(
    webSource,
    /function formatCapacityHours\(value: number\): string \{[\s\S]*?\(Math\.max\(0, value\) \/ 100\) \* 40/,
  );
  assert.match(
    webSource,
    /const allocatedModeTotal = workModes\.reduce\(\(sum, mode\) => sum \+ mode\.value, 0\)/,
  );
  assert.match(webSource, /How tracked time is spent/);
  assert.match(webSource, /Tracked time by work mode:/);
  assert.match(webSource, /formatCapacityHours\(allocatedModeTotal\)/);
  assert.match(webSource, /<small>tracked<\/small>/);
  assert.match(webSource, /formatCapacityHours\(mode\.value\)/);
  assert.doesNotMatch(webSource, /formatTrackedMinutes|trackedMinutes|durationMinutes/);
  assert.doesNotMatch(presentationSource, /startTime|endTime/);
});

test("Capacity breakdown remains within the review-safe Individual projection", () => {
  assert.doesNotMatch(webSource, /fetch\(|createClient\(|localStorage|sessionStorage/);
  assert.doesNotMatch(webSource, /windowTitle|screenshot|notes|evidence/);
});
