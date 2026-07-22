import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const desktopSource = readFileSync(
  new URL("../../desktop/src/components/review/WeeklyReviewScreen.tsx", import.meta.url),
  "utf8",
);
const webScreenUrl = new URL(
  "../components/PersonalWeeklyReviewScreen.tsx",
  import.meta.url,
);
const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

function position(source: string, token: string): number {
  const index = source.indexOf(token);
  assert.notEqual(index, -1, `expected Weekly Review landmark: ${token}`);
  return index;
}

test("Week Review mounts a dedicated Desktop-parity component instead of an inline summary", () => {
  assert.equal(existsSync(webScreenUrl), true, "PersonalWeeklyReviewScreen must own the Week → Review surface");
  assert.match(dashboardSource, /<PersonalWeeklyReviewScreen\b/);
  assert.match(dashboardSource, /data-web-subview=["']review["']/);
  assert.doesNotMatch(dashboardSource, /function PersonalReviewSummary\b/);
});

test("Individual Web Review preserves the Desktop close-out composition and accessible states", () => {
  const webSource = existsSync(webScreenUrl) ? readFileSync(webScreenUrl, "utf8") : "";
  const landmarks = [
    "weekly-review-screen",
    "weekly-review-header",
    "weekly-review-summary",
    "weekly-review-list",
    "weekly-review-item",
    "weekly-review-footer",
  ];

  for (const landmark of landmarks) {
    assert.match(desktopSource, new RegExp(landmark));
    assert.match(webSource, new RegExp(landmark), `Web Review must reuse Desktop's ${landmark} seam`);
  }
  const positions = landmarks.map((landmark) => position(webSource, landmark));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));

  assert.match(webSource, /<ol\b[^>]*aria-label=["']Weekly close-out checks["']/s);
  assert.match(webSource, /status-chip/);
  assert.match(webSource, /role=["']status["'][^>]*aria-live=["']polite["']/s);
  assert.match(webSource, /<WeekformDesktopLink\b/);
  assert.doesNotMatch(webSource, />\s*Finish weekly review on Mac\s*</);
  assert.match(webSource, /weekly-review-finish-action/);
  assert.doesNotMatch(
    webSource,
    /<button[^>]*disabled[^>]*>[\s\S]*?Finish weekly review/,
    "Web must not present a dead duplicate completion control beside the truthful Mac handoff",
  );
  assert.match(webSource, /Mac remains authoritative|WeekformDesktopLink/);
  assert.match(webSource, /<WeekformDesktopLink\b/);
});

test("Web Review remains inside the positive-allowlist boundary and has responsive layout", () => {
  const webSource = existsSync(webScreenUrl) ? readFileSync(webScreenUrl, "utf8") : "";

  assert.doesNotMatch(webSource, /localStorage|sessionStorage|fetch\(|createClient\(|supabase/i);
  assert.doesNotMatch(webSource, /completionRecorded|onComplete\s*:/);
  assert.match(webSource, /replicas:\s*PersonalReplicaView\[\]/);
  assert.match(webSource, /error:\s*string\s*\|\s*null/);
  assert.match(webSource, /role=["']alert["']/);
  assert.match(webSource, /could not be loaded|Reload the page/i);
  assert.match(stylesSource, /\.web-individual-app\s+\.weekly-review-screen\b/);
  assert.match(
    stylesSource,
    /@media\s*\(max-width:[^)]+\)[\s\S]*?\.web-individual-app\s+\.weekly-review-(?:item|footer)\b/,
    "Weekly Review must adapt its Desktop composition at the Web narrow breakpoint",
  );
});
