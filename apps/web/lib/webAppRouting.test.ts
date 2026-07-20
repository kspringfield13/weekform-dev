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
  assert.match(teamPageSource, /<WorkspaceModeToggle/);
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
