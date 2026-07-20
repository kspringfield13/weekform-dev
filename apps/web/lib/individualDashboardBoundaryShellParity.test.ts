import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const boundaryShellUrl = new URL(
  "../components/IndividualDashboardBoundaryShell.tsx",
  import.meta.url,
);
const loadingSource = readFileSync(
  new URL("../app/dashboard/loading.tsx", import.meta.url),
  "utf8",
);
const errorSource = readFileSync(
  new URL("../app/dashboard/error.tsx", import.meta.url),
  "utf8",
);

test("dashboard loading and error states share a Desktop-shaped Individual shell", () => {
  assert.equal(
    existsSync(boundaryShellUrl),
    true,
    "a shared boundary shell must keep authenticated navigation geometry stable while the dashboard resolves or fails",
  );

  const boundaryShellSource = readFileSync(boundaryShellUrl, "utf8");
  for (const seam of [
    "web-individual-app app",
    "web-app-toolbar",
    "sidebar",
    "nav-list",
    "main-panel",
  ]) {
    assert.match(
      boundaryShellSource,
      new RegExp(`className=[^\\n]*${seam.replace(" ", "[^\\n]*")}`),
      `the shared dashboard boundary must preserve the Desktop ${seam} seam`,
    );
  }

  for (const label of ["Today", "Week", "Agent", "History", "Settings"]) {
    assert.match(
      boundaryShellSource,
      new RegExp(`>\\s*${label}\\s*<|label:\\s*["']${label}["']`),
      `the boundary shell must preserve the ${label} navigation silhouette`,
    );
  }

  assert.doesNotMatch(
    boundaryShellSource,
    /index\s*===\s*\d+\s*\?\s*["']\s+is-active|className=\{?[^\n]*is-active/,
    "a data-free route boundary must not claim that a specific destination or context tab is active",
  );
});

test("both Next dashboard boundaries compose the shared shell without private-data assumptions", () => {
  for (const [name, source] of [["loading", loadingSource], ["error", errorSource]] as const) {
    assert.match(source, /import\s+\{?\s*IndividualDashboardBoundaryShell\s*\}?\s+from/,
      `${name}.tsx must import the shared Individual dashboard boundary shell`);
    assert.match(source, /<IndividualDashboardBoundaryShell\b/,
      `${name}.tsx must render inside the shared Individual dashboard boundary shell`);
    assert.doesNotMatch(source, /supabase|createClient|managerAccess|managedTeams|teamId/i,
      `${name}.tsx must not guess authenticated backend or Manager Access state`);
  }

  assert.match(loadingSource, /aria-busy=["']true["']/,
    "the loading boundary must continue to announce busy state");
  assert.match(errorSource, /role=["']alert["']/,
    "the error boundary must continue to announce its failure");
  assert.match(errorSource, /onClick=\{\(\)\s*=>\s*reset\(\)\}[\s\S]*Try again/,
    "the Desktop-shaped error boundary must retain the operational Next.js retry action");
});
