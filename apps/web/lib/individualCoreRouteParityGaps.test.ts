import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopCapacitySource = readFileSync(
  new URL("../../desktop/src/components/capacity/WeeklyCapacityScreen.tsx", import.meta.url),
  "utf8",
);
const desktopShellSource = readFileSync(
  new URL("../../desktop/src/components/shell/AppShell.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const capacitySource = readFileSync(
  new URL("../components/PersonalWeekOverview.tsx", import.meta.url),
  "utf8",
);
const reviewSource = readFileSync(
  new URL("../components/PersonalWeeklyReviewScreen.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source boundary: ${start}`);
  assert.notEqual(endIndex, -1, `missing source boundary: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("Capacity restores Desktop's screen header before the dashboard hero", () => {
  assert.match(desktopCapacitySource, /className="screen-header capacity-dashboard-header"/);

  const webScreen = sliceBetween(
    dashboardSource,
    "function PersonalCapacityScreen",
    "function SharedWorkloadSection",
  );
  assert.match(
    webScreen,
    /className=["'][^"']*screen-header[^"']*capacity-dashboard-header[^"']*["']/,
    "Capacity needs the same compact screen-header landmark and vertical offset as Desktop",
  );
  assert.match(webScreen, /<p\s+className=["']eyebrow["']>Weekly capacity<\/p>/);
  assert.ok(
    webScreen.indexOf("capacity-dashboard-header") < webScreen.indexOf("<PersonalWeekOverview"),
    "the page heading must precede the capacity hero",
  );
  assert.match(
    capacitySource,
    /<h1\s+id=["']week-capacity-headline["']>/,
    "the Capacity hero must retain Desktop's primary hero-heading semantics instead of skipping to h4",
  );
});

test("Capacity uses Desktop's judge-visible hero and chart geometry", () => {
  assert.match(
    stylesSource,
    /\.personal-week-hero\s*\{[^}]*grid-template-columns:\s*168px\s+minmax\(300px,\s*1fr\)\s+minmax\(220px,\s*300px\)[^}]*min-height:\s*190px/s,
  );
  assert.match(
    stylesSource,
    /\.personal-week-gauge\s*\{[^}]*width:\s*154px[^}]*height:\s*154px/s,
  );
  assert.match(
    stylesSource,
    /\.personal-week-metric\s*\{[^}]*min-height:\s*132px/s,
  );
  assert.match(
    stylesSource,
    /\.personal-week-metric-icon\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/s,
  );
  assert.match(
    stylesSource,
    /\.personal-week-donut\s*\{[^}]*width:\s*min\(100%,\s*172px\)/s,
  );
  assert.match(
    stylesSource,
    /\.personal-week-donut\s+circle\s*\{[^}]*stroke-width:\s*24/s,
  );
});

test("Week context exposes the current review-safe week beside the Desktop-parity tabs", () => {
  assert.match(desktopShellSource, /className="page-week-context"/);
  assert.match(desktopShellSource, /<span className="sr-only">Viewing week <\/span>/);

  assert.match(shellSource, /activeWeekLabel:\s*string\s*\|\s*null/);
  assert.match(
    dashboardSource,
    /activeWeekLabel=\{currentReplica\?\.weekId\s*\?\?\s*null\}/,
    "the shell must use the already-loaded review-safe replica; this must not add another query or cache",
  );
  assert.match(shellSource, /className=["']page-week-context["']/);
  assert.match(shellSource, /<span className=["'](?:sr-only|visually-hidden)["']>Viewing week <\/span>/);
  assert.match(shellSource, /formatActiveWeekLabel\(activeWeekLabel\)/);
  assert.match(stylesSource, /\.web-individual-app\s+\.page-week-context\s*\{/);
});

test("Individual primary destinations preserve Desktop's discoverable keyboard metadata", () => {
  for (const shortcut of ["Meta+1", "Meta+2", "Meta+3", "Meta+4", "Meta+9"]) {
    assert.match(
      desktopShellSource,
      new RegExp(`shortcutKey:\\s*["']${shortcut.replace("+", "\\+")}["']`),
      `Desktop must retain the ${shortcut} destination binding that Web mirrors`,
    );
    assert.match(
      shellSource,
      new RegExp(`(?:shortcutKey:\\s*["']${shortcut.replace("+", "\\+")}["']|aria-keyshortcuts=[^\\n]*${shortcut.replace("+", "\\+")})`),
      `Web must expose ${shortcut} on the matching primary destination`,
    );
  }
  assert.match(
    shellSource,
    /title=\{[^\n]*(?:shortcut|⌘)/,
    "keyboard shortcuts need a visible hover hint as well as assistive metadata",
  );
});

test("Weekly Review never reports a numeric ready count when replica loading failed", () => {
  assert.match(reviewSource, /error:\s*string\s*\|\s*null/);
  assert.match(
    reviewSource,
    /\{error\s*\?\s*["']—["']\s*:\s*presentation\.doneCount\}/,
    "a load failure must show an unavailable count rather than a misleading zero",
  );
  assert.match(
    reviewSource,
    /\{error\s*\?\s*["']checks unavailable["']\s*:\s*<>of \{presentation\.items\.length\} checks ready<\/>\}/,
    "the summary label must announce that readiness is unavailable while the error alert is active",
  );
});

test("Weekly Review ends with one truthful Mac handoff and no dead completion control", () => {
  const footer = sliceBetween(reviewSource, '<footer className="weekly-review-footer">', "</footer>");
  assert.doesNotMatch(
    footer,
    /<button\b[^>]*\bdisabled\b/s,
    "Web must not present a disabled Finish control that can never complete the local audit event",
  );
  assert.equal(
    [...footer.matchAll(/<WeekformDesktopLink\b/g)].length,
    1,
    "the terminal action region must contain one honest Mac handoff",
  );
  assert.match(footer, /Mac remains authoritative/);
});

test("route-local replica errors are not duplicated by a global workspace alert", () => {
  assert.doesNotMatch(
    dashboardSource,
    /className=["']form-alert web-replica-alert["']/,
    "each Individual route already owns its error state; a global alert duplicates it and shifts every page",
  );
  for (const component of ["PersonalTodayScreen", "PersonalCapacityScreen", "PersonalWeeklyReviewScreen"]) {
    assert.match(
      dashboardSource,
      new RegExp(`<${component}\\b[\\s\\S]*?error=\\{personalReplicaError\\}`),
      `${component} must keep receiving the existing backend error without a parallel query`,
    );
  }
});

test("the narrow Individual overlay keeps toolbar and content rows stable", () => {
  for (const breakpoint of [760, 820]) {
    assert.match(
      stylesSource,
      new RegExp(`@media\\s*\\(max-width:\\s*${breakpoint}px\\)[\\s\\S]*?\\.web-individual-app\\.app\\s*\\{[^}]*grid-template-rows:\\s*44px\\s+minmax\\(0,\\s*1fr\\)`),
      `the ${breakpoint}px layout must not retain an obsolete auto navigation row after the sidebar becomes an overlay`,
    );
  }
});
