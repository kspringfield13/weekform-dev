import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { resolveIndividualSettingsTab } from "./individualSettingsRoute";

const dashboardSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);
const settingsSource = readFileSync(
  new URL("../components/IndividualHistorySettings.tsx", import.meta.url),
  "utf8",
);
const dataControlUrl = new URL(
  "../components/PersonalWebDataControl.tsx",
  import.meta.url,
);

function dataControlSource(): string {
  return existsSync(dataControlUrl) ? readFileSync(dataControlUrl, "utf8") : "";
}

test("Settings Data Control owns the authorized private Web data lifecycle", () => {
  assert.equal(
    existsSync(dataControlUrl),
    true,
    "a dedicated Data Control screen must explain and operate the Web data boundary",
  );
  assert.match(settingsSource, /dataControl\?: ReactNode/);
  assert.match(settingsSource, /initialTab\?:/);
  assert.match(
    settingsSource,
    /item\.id === "data-control" \? dataControl/,
    "Data Control must render the operational server-owned panel instead of a generic Mac handoff",
  );
  assert.match(dashboardSource, /<PersonalWebDataControl\b/);
  assert.match(dashboardSource, /replicaCount=\{personalReplicas\.length\}/);
  assert.match(dashboardSource, /pendingReviewCount=\{reviewCommandsError[\s\S]*\? null/);
  assert.match(dashboardSource, /initialTab=\{resolveIndividualSettingsTab\(params\.settings_tab\)\}/);
});

test("Settings tab routing is allowlisted and fails closed to Data Sources", () => {
  assert.equal(resolveIndividualSettingsTab("data-control"), "data-control");
  assert.equal(resolveIndividualSettingsTab("account"), "account");
  assert.equal(resolveIndividualSettingsTab("made-up"), "data-sources");
  assert.equal(resolveIndividualSettingsTab(["data-control"]), "data-sources");
  assert.equal(resolveIndividualSettingsTab(undefined), "data-sources");

  const actionsSource = readFileSync(
    new URL("../app/dashboard/personalActions.ts", import.meta.url),
    "utf8",
  );
  assert.match(actionsSource, /settings_tab=\$\{settingsTab\}/);
  assert.match(
    actionsSource,
    /deletePersonalReplicaHistory[\s\S]*workspaceNotice\("setup",[\s\S]*"data-control"\)/,
  );
  assert.match(
    actionsSource,
    /all review-request lifecycle records across every week, and sync receipts/,
  );
});

test("Data Control preserves Desktop hierarchy without claiming browser ownership", () => {
  const source = dataControlSource();

  for (const landmark of [
    "Data control",
    "Private Web workspace",
    "Activity retention",
    "Export work ledger",
    "Reset all local data",
  ]) {
    assert.match(source, new RegExp(landmark));
  }

  assert.match(source, /deletePersonalReplicaHistory/);
  assert.match(source, /Delete private Web history/);
  assert.match(source, /confirmMessage=/);
  assert.match(source, /all review-request lifecycle records across every week/);
  assert.match(source, /sync receipts/);
  assert.match(source, /local Mac data, team snapshots, memberships, account, sign-in, and registered desktop devices stay unchanged/i);
  assert.match(source, /Mac can publish a new replica/i);
  assert.match(source, /current-week pending/i);
  assert.match(source, /Current-week request status unavailable/);
  assert.match(source, /recent replica/);
  assert.match(source, /no workload cache/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
});

test("the destructive Web control is not duplicated under Account & Sharing", () => {
  const combinedSource = dashboardSource + dataControlSource();
  const occurrences = combinedSource.match(/Delete private Web history/g) ?? [];

  assert.equal(
    occurrences.length,
    1,
    "private Web history deletion must have one clear settings home",
  );
});
