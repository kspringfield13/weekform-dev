import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const todaySource = readFileSync(
  new URL("../components/PersonalTodayScreen.tsx", import.meta.url),
  "utf8",
);
const weeklyReviewSource = readFileSync(
  new URL("../components/PersonalWeeklyReviewScreen.tsx", import.meta.url),
  "utf8",
);
const weeklyReviewPresentationSource = readFileSync(
  new URL("./personalWeeklyReviewPresentation.ts", import.meta.url),
  "utf8",
);
const personalSummarySource = readFileSync(
  new URL("../components/PersonalSummaryScreen.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("the authenticated dashboard exposes real workspace destinations", () => {
  for (const view of ["today", "week", "agent", "history", "settings"]) {
    assert.match(dashboardSource + shellSource, new RegExp(`(?:data-web-view=["']${view}["']|id:\\s*["']${view}["'])`));
  }
  assert.doesNotMatch(shellSource, /scrollIntoView|href=["']#/);
  assert.match(shellSource, /teamHref/);
});

test("the authenticated workspace uses ephemeral route state instead of a stored intro", () => {
  assert.match(dashboardSource, /<IndividualWorkspaceShell/);
  assert.match(shellSource, /useState<IndividualDestination>/);
  assert.match(shellSource, /useState<IndividualSubview>/);
  assert.doesNotMatch(dashboardSource + shellSource, /WebWorkspaceIntro|localStorage|sessionStorage/);
});

test("invalid review-safe replica data fails loudly inside each active Individual route", () => {
  assert.doesNotMatch(
    dashboardSource,
    /className=["']form-alert web-replica-alert["']/,
    "a global alert would duplicate the route-local error and shift every destination",
  );
  for (const component of ["PersonalTodayScreen", "PersonalCapacityScreen", "PersonalWeeklyReviewScreen", "PersonalForecastScreen", "PersonalSummaryScreen"]) {
    assert.match(
      dashboardSource,
      new RegExp(`<${component}\\b[\\s\\S]*?error=\\{personalReplicaError\\}`),
      `${component} must receive the existing typed replica failure without another query`,
    );
  }
  assert.match(todaySource, /\{error\s*\?\s*\([\s\S]*?role=["']alert["']/);
  assert.doesNotMatch(todaySource, /\{error\}/,
    "raw API or parser details must not be rendered into the browser");
});

test("replica integrity and load failures expose distinct accessible recovery guidance", () => {
  assert.match(
    dashboardSource,
    /errorKind:\s*personalReplicaErrorKind/,
    "the dashboard must retain the typed replica failure kind",
  );
  assert.match(dashboardSource, /errorKind\s*===\s*["']integrity["']/);
  assert.match(dashboardSource, /Your private Web data could not be validated\./);
  assert.match(dashboardSource, /Resync from Weekform for Mac/);
  assert.match(dashboardSource, /errorKind:\s*["']integrity["']\s*\|\s*["']load["']\s*\|\s*null/);
  assert.match(dashboardSource, /Your private Web data could not be loaded\./);
  assert.match(dashboardSource, /Reload this page or check your connection\./);
  assert.match(
    dashboardSource,
    /role=["']alert["'][\s\S]*?<strong>[\s\S]*?<p>/,
    "recovery guidance must be exposed as an alert with a heading and actionable detail",
  );
});

test("the Web dashboard has the Desktop shell and context-navigation treatment", () => {
  for (const className of [
    "web-individual-app",
    "workspace-shell",
    "sidebar",
    "main-panel",
    "page-context-navigation",
    "context-navigation",
  ]) {
    assert.match(stylesSource, new RegExp(`\\.${className}`));
  }
  assert.match(shellSource, /role="tablist"/);
  assert.match(shellSource, /onKeyDown=/);
});

test("the private workspace preserves the Mac-authoritative approval model", () => {
  const workspaceSource = dashboardSource + shellSource + weeklyReviewSource + weeklyReviewPresentationSource + personalSummarySource;
  for (const phrase of [
    "Mac remains authoritative",
    "requires approval on your Mac",
    "Ephemeral browser view · no workload cache",
    "Web will not invent a summary",
  ]) {
    assert.match(workspaceSource, new RegExp(phrase));
  }

  for (const subview of ["capacity", "forecast", "review", "usage", "summary"]) {
    assert.match(dashboardSource, new RegExp(`data-web-subview=["']${subview}["']`));
  }

  assert.match(dashboardSource, /Get Weekform for Mac/);
  assert.match(stylesSource, /data-active-subview/);
});
