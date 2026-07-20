import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const desktopShellSource = readFileSync(
  new URL("../../desktop/src/components/shell/AppShell.tsx", import.meta.url),
  "utf8",
);
const webShellSource = readFileSync(
  new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("Individual Week exposes the Desktop active-week context without inventing local evidence", () => {
  assert.match(desktopShellSource, /className="page-week-context"/);
  assert.match(desktopShellSource, /Viewing week/);

  assert.match(webShellSource, /activeWeekLabel:\s*string\s*\|\s*null/);
  assert.match(webShellSource, /active\s*===\s*"week"\s*&&\s*activeWeekLabel/);
  assert.match(webShellSource, /className="page-week-context"/);
  assert.match(webShellSource, /Viewing week/);
  assert.match(dashboardSource, /activeWeekLabel=\{currentReplica\?\.weekId\s*\?\?\s*null\}/);
  assert.doesNotMatch(webShellSource, /localStorage|sessionStorage|indexedDB/i);
});

test("active-week context uses the Desktop strip geometry and collapses safely", () => {
  assert.match(
    stylesSource,
    /\.web-individual-app\s+\.page-week-context\s*\{[^}]*margin:\s*0\s+0\s+0\s+auto;[^}]*white-space:\s*nowrap;/s,
  );
  assert.match(
    stylesSource,
    /@media\s*\(max-width:\s*760px\)[\s\S]*?\.web-individual-app\s+\.page-week-context\s*\{[^}]*margin-left:\s*0;/,
  );
});

test("Today, Capacity, and Review retain one shared Desktop content rail", () => {
  for (const selector of [
    ".web-today-screen",
    ".personal-week-overview",
    ".web-individual-app .weekly-review-screen",
  ]) {
    assert.match(
      stylesSource,
      new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\{[^}]*max-width:\\s*1200px;`),
      `${selector} must share the Desktop 1200px content rail`,
    );
  }
});

test("Weekly Review keeps the Desktop's single consequential action slot", () => {
  const reviewSource = readFileSync(
    new URL("../components/PersonalWeeklyReviewScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(reviewSource, /Get Weekform for Mac/);
  assert.match(reviewSource, /weekly-review-finish-action/);
  assert.doesNotMatch(reviewSource, /<button[^>]*disabled[^>]*>[\s\S]*?Finish weekly review/);
  assert.doesNotMatch(reviewSource, />\s*Finish weekly review on Mac\s*</);
});

test("replica failures render once inside the active route instead of above every route", () => {
  assert.doesNotMatch(dashboardSource, /className="form-alert web-replica-alert"/);
  assert.match(dashboardSource, /<PersonalTodayScreen[\s\S]*?error=\{personalReplicaError\}/);
  assert.match(dashboardSource, /<PersonalCapacityScreen[\s\S]*?error=\{personalReplicaError\}/);
  assert.match(dashboardSource, /<PersonalWeeklyReviewScreen[^>]*error=\{personalReplicaError\}/);
});
