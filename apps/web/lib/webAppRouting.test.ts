import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { safeNextPath } from "./safeNextPath";

const appEntrySource = readFileSync(
  new URL("../app/app/page.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const managerAccessSource = readFileSync(
  new URL("../app/manager-access/page.tsx", import.meta.url),
  "utf8",
);
const teamPageSource = readFileSync(
  new URL("../app/teams/[teamId]/page.tsx", import.meta.url),
  "utf8",
);
const modeToggleUrl = new URL(
  "../components/WorkspaceModeToggle.tsx",
  import.meta.url,
);
const individualShellSource = readFileSync(
  new URL("../components/IndividualWorkspaceShell.tsx", import.meta.url),
  "utf8",
);
const personalActionsSource = readFileSync(
  new URL("../app/dashboard/personalActions.ts", import.meta.url),
  "utf8",
);

test("/app renders the authenticated Weekform workspace instead of redirecting to the legacy dashboard URL", () => {
  assert.doesNotMatch(appEntrySource, /redirect\(["']\/dashboard/);
  assert.match(appEntrySource, /DashboardPage/);
  assert.equal(safeNextPath(null), "/app");
});

test("Individual and Manager web surfaces expose the shared mode switch", () => {
  assert.equal(existsSync(modeToggleUrl), true);
  const modeToggleSource = readFileSync(modeToggleUrl, "utf8");

  assert.match(modeToggleSource, /Individual/);
  assert.match(modeToggleSource, /Manager mode/);
  assert.match(modeToggleSource, /aria-current/);
  assert.match(dashboardSource, /<WorkspaceModeToggle/);
  assert.match(managerAccessSource, /<WorkspaceModeToggle/);
  assert.match(teamPageSource, /<IndividualWorkspaceShell/);
  assert.match(individualShellSource, /<WorkspaceModeToggle/);
});

test("primary Web app return paths target /app rather than /dashboard", () => {
  for (const relativePath of [
    "../app/dashboard/personalActions.ts",
    "../app/teams/actions.ts",
    "../app/manager-access/page.tsx",
    "../components/SiteHeader.tsx",
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(source, /["'`]\/dashboard(?:[?"'`])/);
  }
});

test("/app restores a validated Desktop-equivalent screen from the URL", () => {
  assert.match(
    dashboardSource,
    /searchParams:\s*Promise<\{[^}]*screen\?:\s*string/s,
    "the authenticated route must accept the same screen query contract as Desktop",
  );
  assert.match(
    dashboardSource,
    /<IndividualWorkspaceShell[\s\S]*initialScreen=\{params\.screen\}/,
    "the server route must pass the requested screen into the client shell",
  );
  assert.match(individualShellSource, /initialScreen:\s*string\s*\|\s*undefined/);
  assert.match(
    individualShellSource,
    /resolveIndividualWorkspaceRoute\(initialScreen\)/,
    "the shell must validate URL state through the shared route contract",
  );
  assert.match(
    individualShellSource,
    /useEffect\(\(\) => \{[\s\S]*?resolveIndividualWorkspaceRoute\(initialScreen\)[\s\S]*?setActive\([\s\S]*?setActiveSubview\([\s\S]*?\}, \[initialScreen\]\)/,
    "the preserved client shell must reconcile its visible surface when a Next query-link supplies a new initialScreen",
  );
});

test("Individual workspace navigation remains addressable through browser history", () => {
  assert.match(
    individualShellSource,
    /history\.pushState\(/,
    "primary and context navigation must write a canonical screen URL",
  );
  assert.match(
    individualShellSource,
    /addEventListener\(["']popstate["']/,
    "Back and Forward must restore the matching Individual surface",
  );
  assert.match(
    individualShellSource,
    /screenForIndividualWorkspaceRoute\(/,
    "URL writes must use the same canonical mapping as URL reads",
  );
  assert.doesNotMatch(
    individualShellSource,
    /onClick=\{\(\) => setActiveSubview\(view\.id\)\}/,
    "mouse and keyboard context navigation must share the addressable route path",
  );
});

test("Settings always uses its canonical Web route", () => {
  assert.match(
    individualShellSource,
    /const settingsHref = workspaceHref\([\s\S]*?destination: "settings"[\s\S]*?subview: "settings"/,
    "Settings must have an addressable URL in Individual, Manager, and Team modes",
  );
  assert.match(
    individualShellSource,
    /route\.destination === "settings"[\s\S]*?window\.location\.assign\(settingsHref\)/,
    "Settings navigation must not depend on transient in-memory view state",
  );
});

test("approval-gated Web actions return feedback to the surface that initiated them", () => {
  assert.match(personalActionsSource, /workspaceNotice\(["']daily["']/);
  assert.match(personalActionsSource, /workspaceNotice\(["']setup["']/);
  assert.match(
    dashboardSource,
    /<div className=["']container workspace-shell["']>[\s\S]*?params\.notice[\s\S]*?<div data-web-view=["']today["']>/,
    "action feedback must be visible before the conditional surface trees, not only inside Week Capacity",
  );
});
