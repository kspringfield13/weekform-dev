import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopSource = readFileSync(
  new URL("../../desktop/src/components/capacity/WeeklyCapacityScreen.tsx", import.meta.url),
  "utf8",
);
const webCapacitySource = readFileSync(
  new URL("../components/PersonalWeekOverview.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);

function position(source: string, token: string): number {
  const index = source.indexOf(token);
  assert.notEqual(index, -1, `expected visible Capacity landmark: ${token}`);
  return index;
}

test("Individual Web Capacity follows the Desktop's visible dashboard hierarchy", () => {
  const landmarks = [
    { desktop: "Weekly capacity", web: "Weekly capacity" },
    { desktop: "capacity for new planned work", web: "capacity for new planned work" },
    { desktop: "Capacity summary", web: "Capacity summary" },
    { desktop: "Commitment and headroom", web: "Commitment and headroom" },
    { desktop: "Top categories", web: "Top categories" },
    { desktop: "How tracked time is spent", web: "Derived work patterns" },
    { desktop: "How this estimate is built", web: "How this estimate is built" },
  ];

  for (const landmark of landmarks) {
    assert.match(desktopSource, new RegExp(landmark.desktop));
    assert.match(
      webCapacitySource,
      new RegExp(landmark.web),
      `Individual Web must expose the honest equivalent of Desktop Capacity landmark: ${landmark.desktop}`,
    );
  }

  const webPositions = landmarks.map((landmark) => position(webCapacitySource, landmark.web));
  assert.deepEqual(
    webPositions,
    [...webPositions].sort((left, right) => left - right),
    "Capacity landmarks must appear in the same top-to-bottom order as Desktop",
  );
});

test("Individual Web Capacity reuses the Desktop dashboard styling seams", () => {
  for (const className of [
    "capacity-dashboard",
    "week-dashboard-hero",
    "week-dashboard-gauge",
    "week-dashboard-metrics",
    "week-dashboard-main-grid",
    "week-dashboard-panel",
    "week-dashboard-explainability",
  ]) {
    assert.match(
      desktopSource,
      new RegExp(`className=[^\\n]*\\b${className}\\b`),
      `Desktop must retain the ${className} style seam that Web mirrors`,
    );
    assert.match(
      webCapacitySource,
      new RegExp(`className=[^\\n]*\\b${className}\\b`),
      `Individual Web Capacity must reuse the Desktop ${className} style seam`,
    );
  }
});

test("Capacity semantics remain inspectable and avoid a competing Web-only hero", () => {
  assert.match(webCapacitySource, /aria-labelledby=["']week-capacity-headline["']/);
  assert.match(webCapacitySource, /aria-labelledby=["']week-summary-heading["']/);
  assert.match(webCapacitySource, /role=["'](?:group|img)["'][^>]*aria-label=/s);
  assert.match(webCapacitySource, /<details\b[^>]*className=["'][^"']*week-dashboard-explainability/);
  assert.match(webCapacitySource, /<summary>/);
  assert.match(webCapacitySource, /displayPercent/);
  assert.match(
    webCapacitySource,
    /const value = safePercent\(metric\.value\)/,
    "progress and SVG geometry must remain clamped even when displayed workload exceeds 100%",
  );
  assert.match(
    webCapacitySource,
    /<strong>\{pct\(metric\.value\)\}<\/strong>/,
    "metric labels must preserve honest overload rather than reuse the clamped geometry value",
  );
  assert.match(webCapacitySource, /style=\{\{ width: `\$\{value\}%` \}\}/);
  assert.match(webCapacitySource, /Review-safe block modes/);
  assert.doesNotMatch(
    webCapacitySource,
    /Reviewed block modes/,
    "the replica contains review-safe blocks, not exclusively user-verified blocks",
  );
  assert.doesNotMatch(
    webCapacitySource,
    /How tracked time is spent/,
    "the positive-allowlist Web replica must not claim overlapping capacity fields are tracked-time allocation",
  );

  const capacityScreen = dashboardSource.slice(
    position(dashboardSource, "function PersonalCapacityScreen"),
    position(dashboardSource, "function SharedWorkloadSection"),
  );
  assert.doesNotMatch(
    capacityScreen,
    /Know what fits before you commit\./,
    "the Web route must not add a second hero above the Desktop-parity Capacity dashboard",
  );
});
