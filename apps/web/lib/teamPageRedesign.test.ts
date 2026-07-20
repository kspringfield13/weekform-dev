import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../app/teams/[teamId]/page.tsx", import.meta.url),
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
