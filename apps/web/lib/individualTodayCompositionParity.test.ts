import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const desktopTodaySource = readFileSync(
  new URL("../../desktop/src/components/review/DailyReviewScreen.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const todayComponentUrl = new URL(
  "../components/PersonalTodayScreen.tsx",
  import.meta.url,
);
const todaySource = existsSync(todayComponentUrl)
  ? readFileSync(todayComponentUrl, "utf8")
  : dashboardSource;
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("Individual Web Today follows the Desktop Daily review composition", () => {
  for (const className of [
    "review-screen",
    "screen-header compact",
    "review-progress",
    "review-progress-track",
    "review-progress-fill",
    "ledger-list",
  ]) {
    assert.match(
      desktopTodaySource,
      new RegExp(`className=[^\\n]*${className.replace(" ", "[^\\n]*")}`),
      `Desktop must retain the ${className} composition seam`,
    );
    assert.match(
      todaySource,
      new RegExp(`className=[^\\n]*${className.replace(" ", "[^\\n]*")}`),
      `Individual Web Today must reuse the Desktop ${className} composition seam`,
    );
  }

  assert.match(todaySource, /Daily review/);
  assert.match(todaySource, /Blocks to review/);
  assert.match(todaySource, /className=["'](?:sr-only|visually-hidden)["']/);
  assert.doesNotMatch(
    todaySource,
    /member-grid personal-review-grid/,
    "Today must not retain the generic team-member grid as its primary review body",
  );
});

test("Individual Web Today exposes the same inspectable review progress semantics", () => {
  assert.match(todaySource, /presentPersonalToday\(blocks\)/);
  for (const value of ["reviewQueue", "verifiedCount", "totalCount", "progressPct", "heading"]) {
    assert.match(
      todaySource,
      new RegExp(`\\b${value}\\b`),
      `Today must consume the tested ${value} presentation value`,
    );
  }
  assert.match(todaySource, /role=["']status["']/);
  assert.match(todaySource, /role=["']progressbar["']/);
  assert.match(todaySource, /aria-valuenow=\{progressPct\}/);
  assert.match(todaySource, /aria-valuemin=\{0\}/);
  assert.match(todaySource, /aria-valuemax=\{100\}/);
  assert.match(
    todaySource,
    /reviewQueue\.map\(\(block\)\s*=>/,
    "the visible queue must match the pending count instead of rendering verified blocks as editable work",
  );
});

test("Individual Web Today presents review-safe blocks with Desktop block-card semantics", () => {
  for (const className of [
    "block-card",
    "block-topline",
    "block-main",
    "block-capacity",
    "tag-grid",
    "block-actions",
  ]) {
    assert.match(
      todaySource,
      new RegExp(`className=[^\\n]*\\b${className}\\b`),
      `Web review blocks must expose the Desktop ${className} style seam`,
    );
    assert.match(
      stylesSource,
      new RegExp(`\\.${className}\\b`),
      `Web CSS must style the Desktop ${className} seam`,
    );
  }

  assert.match(todaySource, /<article\b/);
  assert.match(todaySource, /Work category/);
  assert.match(todaySource, /of week/);
  assert.match(todaySource, /(?:Request confirmation|>\s*Confirm\s*<)/);
  assert.match(todaySource, /(?:Request exclusion|>\s*Exclude\s*<)/);
  assert.match(todaySource, /(?:Request category change|Request relabel)/);
});

test("Today parity preserves the existing API-backed Mac approval boundary", () => {
  const combinedSource = dashboardSource + todaySource;

  assert.match(combinedSource, /queuePersonalReviewCommand/);
  for (const field of ["block_id", "week_id", "expected_revision", "action"]) {
    assert.match(
      todaySource,
      new RegExp(`name=["']${field}["']`),
      `each review request must keep the server action field ${field}`,
    );
  }
  assert.match(todaySource, /name=["']action["']\s+value=\{action\}/);
  for (const action of ["confirm", "exclude", "relabel"]) {
    assert.match(
      todaySource,
      new RegExp(`action=["']${action}["']`),
      `the shared server-action field helper must be instantiated for ${action}`,
    );
  }
  assert.match(todaySource, /FormSubmitButton/);
  assert.match(todaySource, /(?:requires approval|approval required) on (?:your )?Mac/i);
  assert.doesNotMatch(todaySource, /localStorage|sessionStorage|indexedDB/i);
});
