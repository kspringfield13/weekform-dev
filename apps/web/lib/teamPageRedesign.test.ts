import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../app/teams/[teamId]/page.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const identityMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/202607200008_team_roster_identity.sql",
    import.meta.url,
  ),
  "utf8",
);

test("manager team page uses the Desktop-parity workspace hierarchy", () => {
  for (const className of [
    "IndividualWorkspaceShell",
    "team-workspace-view",
    "team-status-rail",
    "team-roster-section",
    "team-decision-grid",
    "team-controls-grid",
  ]) {
    assert.match(source, new RegExp(className), `missing ${className}`);
  }
});

test("Web Team uses the Desktop Team screen header, evidence, and decision geometry", () => {
  for (const className of [
    "team-screen",
    "team-screen-header",
    "team-screen-actions",
    "team-role-indicator",
    "team-evidence-rail",
    "team-decision-layout",
    "team-decision-card",
    "team-decision-card--primary",
  ]) {
    assert.match(source, new RegExp(className), `missing Desktop Team class ${className}`);
  }
  assert.match(source, /function TeamWorkspaceHeader/);
  assert.match(source, /manager \? "Team workload intelligence" : "Your team connection"/);
  assert.match(source, /manager \? `\$\{teamName\} workload` : `Your place in \$\{teamName\}`/);
  assert.match(styles, /\.team-screen\s*\{[\s\S]*?width:\s*min\(100%,\s*1180px\)/);
  assert.match(styles, /\.team-screen-header h1\s*\{[\s\S]*?margin:\s*0/);
  assert.match(styles, /\.team-decision-layout\s*\{[\s\S]*?minmax\(0,\s*1\.6fr\)/);
  assert.match(
    styles,
    /\.web-individual-app\[data-workspace-mode="manager"\]\[data-active-view="today"\]\s+\[data-web-view="today"\][\s\S]*?\{[\s\S]*?display:\s*grid/,
    "the active Manager Today view must retain its grid so section gaps are rendered",
  );
  assert.match(
    styles,
    /\.team-workspace-view\s*\{[\s\S]*?gap:\s*22px/,
    "the Teams page must own spacing between its top-level sections",
  );
  assert.match(
    styles,
    /\.team-workspace-view\s*>\s*\.team-screen-header[\s\S]*?\.team-workspace-view\s*>\s*\.team-evidence-rail\.team-status-rail[\s\S]*?margin-bottom:\s*0/,
    "legacy child margins must not stack on top of the Teams section gap",
  );
});

test("member cards render the manager-authorized member email", () => {
  assert.match(source, /entry\.email/);
  assert.match(source, /member-card-email/);
});

test("member email projection reauthorizes managers and excludes anonymous callers", () => {
  assert.match(
    identityMigration,
    /private\.is_team_manager\(target_team_id, auth\.uid\(\)\)/,
  );
  assert.match(
    identityMigration,
    /revoke all on function public\.get_team_roster_identities\(uuid\) from anon/,
  );
  assert.match(
    identityMigration,
    /grant execute on function public\.get_team_roster_identities\(uuid\) to authenticated/,
  );
});

test("manager sharing policy is an accessible descriptive card choice instead of a dropdown", () => {
  assert.match(source, /<fieldset className="team-share-choice-fieldset">/);
  assert.match(source, /<legend>Choose the team maximum<\/legend>/);
  assert.doesNotMatch(
    source,
    /<select[\s\S]*?name="share_policy_level"/,
    "the sharing policy should not hide its choices in a dropdown",
  );
  assert.match(source, /TEAM_SHARE_POLICY_OPTIONS\.map/);
  assert.match(source, /type="radio"[\s\S]*?name="share_policy_level"/);
  for (const value of ["none", "summary", "categories", "projects"]) {
    assert.match(source, new RegExp(`value: ["']${value}["']`));
  }
  for (const description of [
    "Keep every member’s own sharing choice unchanged",
    "Capacity, allocation, and workload signals",
    "Adds category-level workload patterns",
    "Adds only projects each member explicitly allowlisted",
  ]) {
    assert.match(source, new RegExp(description));
  }
  assert.match(styles, /\.team-share-choice-grid\s*\{[\s\S]*?display:\s*grid/);
  assert.match(styles, /\.team-share-choice-card:has\(input:checked\)/);
  assert.match(styles, /\.team-share-choice-card:has\(input:focus-visible\)/);
});
