import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopReviewModelSource = readFileSync(
  new URL("../../desktop/src/services/weeklyReview.ts", import.meta.url),
  "utf8",
);
const webReviewModelSource = readFileSync(
  new URL("./personalWeeklyReviewPresentation.ts", import.meta.url),
  "utf8",
);

const desktopOrder = [...desktopReviewModelSource.matchAll(/\bitem\(\s*"([a-z_]+)"/g)]
  .map((match) => match[1])
  .filter((id): id is string => (
    id !== undefined
    && ["work_blocks", "sensitive_captures", "forecast_accuracy", "narrative"].includes(id)
  ));
const webOrder = [...new Set(
  [...webReviewModelSource.matchAll(/\bid:\s*"([a-z_]+)"/g)]
    .map((match) => match[1])
    .filter((id): id is string => (
      id !== undefined
      && ["work_blocks", "sensitive_captures", "forecast_accuracy", "narrative", "completion"].includes(id)
    )),
)];

test("Desktop Review baseline contains the expected ordered checklist", () => {
  assert.deepEqual(desktopOrder, [
    "work_blocks",
    "sensitive_captures",
    "forecast_accuracy",
    "narrative",
  ]);
});

test("Individual Web Review preserves Desktop's privacy-safe ordered checklist", () => {
  assert.deepEqual(
    webOrder,
    desktopOrder,
    "Web should retain Desktop's Flagged Captures row as an explicit Mac-only boundary; weekly completion belongs in the footer, not a replacement checklist row",
  );
});

test("Web represents Flagged Captures as Mac-only without inventing completion evidence", () => {
  assert.match(webReviewModelSource, /title:\s*"Review flagged captures"/);
  assert.match(webReviewModelSource, /status:\s*"mac_only"/);
  assert.match(webReviewModelSource, /target:\s*"mac"/);
  assert.doesNotMatch(
    webReviewModelSource,
    /id:\s*"completion"/,
    "Web must not invent a fifth review concern to replace Desktop's privacy-safe Flagged Captures boundary",
  );
});
