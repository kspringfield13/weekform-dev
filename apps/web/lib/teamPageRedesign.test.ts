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
    "team-view-toggle",
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
