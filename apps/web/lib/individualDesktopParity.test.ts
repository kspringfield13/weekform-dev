import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const dashboardUrl = new URL("../app/dashboard/page.tsx", import.meta.url);
const individualShellUrl = new URL(
  "../components/IndividualWorkspaceShell.tsx",
  import.meta.url,
);
const dashboardSource = readFileSync(dashboardUrl, "utf8");

function occurrenceCount(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length;
}

test("the authenticated Individual workspace mounts a dedicated Desktop-parity shell", () => {
  assert.equal(
    existsSync(individualShellUrl),
    true,
    "IndividualWorkspaceShell must own the authenticated /app chrome",
  );
  assert.match(dashboardSource, /<IndividualWorkspaceShell\b/);
});

test("the Individual Web shell preserves the Desktop primary navigation and layout hierarchy", () => {
  const shellSource = existsSync(individualShellUrl)
    ? readFileSync(individualShellUrl, "utf8")
    : "";

  assert.match(shellSource, /aria-label=["']Primary navigation["']/);
  for (const label of ["Today", "Week", "Agent", "History", "Settings"]) {
    assert.match(
      shellSource,
      new RegExp(`(?:label:\\s*["']${label}["']|>\\s*${label}\\s*<)`),
      `Individual Web navigation must expose the Desktop ${label} destination`,
    );
  }

  for (const className of ["app", "sidebar", "nav-list", "main-panel"]) {
    assert.match(
      shellSource,
      new RegExp(`className=[^\\n]*\\b${className}\\b`),
      `Individual Web must retain the Desktop ${className} layout seam`,
    );
  }

  assert.match(shellSource, /managerAccessAvailable\s*&&/);
  assert.match(shellSource, /Manager Access/);
});

test("the configured authenticated workspace replaces public site chrome with app chrome", () => {
  assert.equal(
    occurrenceCount(dashboardSource, /<SiteHeader\s*\/>/g),
    1,
    "only the unconfigured deployment branch may render SiteHeader",
  );
  assert.equal(
    occurrenceCount(dashboardSource, /<SiteFooter\s*\/>/g),
    1,
    "only the unconfigured deployment branch may render SiteFooter",
  );
});

test("Desktop destinations select honest, distinct Individual views instead of scrolling aliases", () => {
  const shellSource = readFileSync(individualShellUrl, "utf8");

  assert.match(shellSource, /data-active-view=\{active\}/);
  assert.doesNotMatch(shellSource, /scrollIntoView/);
  assert.match(shellSource, /Capacity/);
  assert.match(shellSource, /Forecast/);
  assert.doesNotMatch(shellSource, /aria-disabled="true"/);

  for (const view of ["today", "week", "history", "settings"]) {
    assert.match(
      dashboardSource,
      new RegExp(`data-web-view=["']${view}["']`),
      `the dashboard must own a distinct ${view} view`,
    );
  }
});

test("Individual Web exposes the Desktop context-view taxonomy with real tab semantics", () => {
  const shellSource = readFileSync(individualShellUrl, "utf8");

  for (const label of [
    "Capacity",
    "Forecast",
    "Review",
    "AI Usage",
    "Summary",
    "Ask",
    "Accelerate",
    "Skills",
    "Activity",
    "Audit",
  ]) {
    assert.match(
      shellSource,
      new RegExp(`(?:label:\\s*["']${label}["']|>\\s*${label}\\s*<)`),
      `the Web shell must expose the Desktop ${label} context view`,
    );
  }

  assert.match(shellSource, /role=["']tablist["']/);
  assert.match(shellSource, /role=["']tab["']/);
  assert.match(shellSource, /aria-selected=/);
  assert.match(shellSource, /onKeyDown=/);
});

test("review-safe parity views are mounted distinctly while Mac-only views fail honestly", () => {
  const shellSource = readFileSync(individualShellUrl, "utf8");

  for (const view of ["forecast", "agent", "accelerate", "skills", "activity", "audit"]) {
    assert.match(
      dashboardSource + shellSource,
      new RegExp(`(?:data-web-subview=["']${view}["']|id:\\s*["']${view}["'])`),
      `the ${view} surface must have a distinct Web route state`,
    );
  }

  assert.match(dashboardSource, /Mac-only|Get Weekform for Mac/);
  assert.doesNotMatch(shellSource, /Forecast requires the full local workload model/);
});
