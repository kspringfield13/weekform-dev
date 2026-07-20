import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const webSource = readFileSync(
  new URL("../components/PersonalTodayScreen.tsx", import.meta.url),
  "utf8",
);

test("Today load failures suppress stale review actions before presenting the error", () => {
  const headerActionsIndex = webSource.indexOf(
    '<div className="review-header-actions">',
  );
  assert.notEqual(
    headerActionsIndex,
    -1,
    "Today must retain the Desktop-shaped review action region for healthy replicas",
  );

  const conditionalStart = webSource.lastIndexOf("{", headerActionsIndex);
  const headerActionCondition = webSource.slice(
    conditionalStart,
    headerActionsIndex,
  );

  assert.match(
    headerActionCondition,
    /!error\b/,
    "a replica load failure must not leave stale approval or Confirm all controls visible above the error alert",
  );
  assert.match(
    headerActionCondition,
    /!reviewCommandsError\b/,
    "an unvalidated command lifecycle must suppress the entire action region, not only its form",
  );

  assert.match(webSource, /role=["']alert["']/);
  assert.match(webSource, /No review request was sent|Actions are unavailable/);
});
