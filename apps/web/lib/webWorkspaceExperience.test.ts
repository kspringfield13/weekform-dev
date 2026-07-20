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
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("the authenticated dashboard exposes real workspace destinations", () => {
  for (const view of ["today", "week", "agent", "history", "settings"]) {
    assert.match(dashboardSource + shellSource, new RegExp(`(?:data-web-view=["']${view}["']|id:\\s*["']${view}["'])`));
  }
  assert.doesNotMatch(shellSource, /scrollIntoView|href=["']#/);
  assert.match(shellSource, /managerHref/);
});

test("the authenticated workspace uses ephemeral route state instead of a stored intro", () => {
  assert.match(dashboardSource, /<IndividualWorkspaceShell/);
  assert.match(shellSource, /useState<IndividualDestination>/);
  assert.match(shellSource, /useState<IndividualSubview>/);
  assert.doesNotMatch(dashboardSource + shellSource, /WebWorkspaceIntro|localStorage|sessionStorage/);
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
  for (const phrase of [
    "Mac remains authoritative",
    "requires approval on your Mac",
    "Ephemeral browser view · no workload cache",
    "Web will not invent a summary",
  ]) {
    assert.match(dashboardSource, new RegExp(phrase));
  }

  for (const subview of ["capacity", "forecast", "review", "usage", "summary"]) {
    assert.match(dashboardSource, new RegExp(`data-web-subview=["']${subview}["']`));
  }

  assert.match(dashboardSource, /Open Weekform for Mac/);
  assert.match(stylesSource, /data-active-subview/);
});
