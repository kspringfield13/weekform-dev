import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  plannedStatuses,
  workCategories,
  workModes,
} from "../../../packages/domain/src/taxonomy";
import {
  reviewCategories,
  reviewPlannedStatuses,
  reviewWorkModes,
} from "./personalReviewTaxonomy";

const todaySource = readFileSync(
  new URL("../components/PersonalTodayScreen.tsx", import.meta.url),
  "utf8",
);

test("Web Today renders correction options from the same canonical taxonomy as Desktop", () => {
  assert.deepEqual(reviewCategories, workCategories);
  assert.deepEqual(reviewPlannedStatuses, plannedStatuses);
  assert.deepEqual(reviewWorkModes, workModes);
  assert.match(todaySource, /from\s*["']@\/lib\/personalReviewTaxonomy["']/);
  assert.match(todaySource, /\{reviewCategories\.map\(\(category\)\s*=>/);
  assert.match(todaySource, /\{reviewPlannedStatuses\.map\(\(statusOption\)\s*=>/);
  assert.match(todaySource, /\{reviewWorkModes\.map\(\(modeOption\)\s*=>/);
  assert.doesNotMatch(
    todaySource,
    /(?:Planned analysis \/ project work|Deep work|["']planned["'])/,
    "Web Today must not fork the correction vocabulary into component-local arrays",
  );
});
