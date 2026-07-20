import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const todaySource = readFileSync(new URL("../components/PersonalTodayScreen.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
const actionsSource = readFileSync(new URL("../app/dashboard/personalActions.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../../../supabase/migrations/202607200005_review_command_two_phase.sql", import.meta.url),
  "utf8",
);

test("Today exposes pending and decided Web-to-Mac review request states", () => {
  assert.match(dashboardSource, /listOwnReviewCommands/);
  assert.match(todaySource, /reviewCommands:/);
  assert.match(todaySource, /reviewCommandsError:/);
  for (const state of ["pending", "applied", "rejected", "conflict"]) {
    assert.match(todaySource, new RegExp(`\\b${state}:\\s*\\{`));
  }
  assert.match(todaySource, /role=["']alert["']/);
  assert.match(todaySource, /Pending Mac approval/);
  assert.match(todaySource, /Applied on Mac/);
  assert.match(todaySource, /COMMAND_ACTION\[command\.action\]/);
  assert.match(todaySource, /Request confirmation again/);
  assert.match(todaySource, /Request relabel again/);
  assert.match(todaySource, /Request exclusion again/);
});

test("review request status owns an explicit responsive card grid row", () => {
  assert.match(globalStyles, /grid-template-areas:\s*[^;]*"status status"/);
  assert.match(globalStyles, /\.web-review-command-status\s*\{[^}]*grid-area:\s*status/);
  assert.match(globalStyles, /@media \(max-width:\s*760px\)[\s\S]*grid-template-areas:\s*"top"\s*"main"\s*"status"\s*"tags"\s*"actions"\s*"private"/);
});

test("pending requests cannot be duplicated through UI, server action, or concurrent RPC calls", () => {
  assert.match(todaySource, /requestLocked\s*=\s*status\s*!==\s*null\s*&&\s*status\s*!==\s*["']rejected["']/);
  assert.match(todaySource, /disabled=\{requestLocked\}/);
  assert.match(actionsSource, /from\(["']review_commands["']\)/);
  assert.match(actionsSource, /from\(["']review_commands_v2["']\)/);
  assert.match(actionsSource, /eq\(["']status["'],\s*["']pending["']\)/);
  assert.match(actionsSource, /already waiting for approval/i);
  assert.match(actionsSource, /rpc\(["']queue_review_command_compatible["']/);
  assert.match(migrationSource, /review_command_pending_targets/);
  assert.match(migrationSource, /review_commands_v1_reserve_pending_target/);
  assert.match(migrationSource, /review_commands_v2_reserve_pending_target/);
  assert.match(migrationSource, /on conflict[\s\S]*do nothing/i);
  assert.match(migrationSource, /for update/i);
  assert.match(migrationSource, /another review protocol already has a pending request for this block revision/i);
});

test("lifecycle view stays review-safe and ephemeral", () => {
  const combined = todaySource + dashboardSource;
  assert.doesNotMatch(combined, /decision_reason|decided_by_device|created_by/);
  assert.doesNotMatch(todaySource, /localStorage|sessionStorage|indexedDB/i);
});

test("compatible queue routes to a validated protocol-specific server boundary", () => {
  assert.match(migrationSource, /create or replace function public\.queue_review_command_compatible/);
  assert.match(migrationSource, /review_protocol_version\s*<>\s*2/);
  assert.match(migrationSource, /from public\.review_commands[\s\S]*status = 'pending'/);
  assert.match(migrationSource, /pg_advisory_xact_lock/);
  assert.match(migrationSource, /return public\.queue_review_command_v2/);
  assert.match(migrationSource, /return public\.queue_review_command\(/);
  assert.match(migrationSource, /actor uuid := auth\.uid\(\)/);
  assert.match(migrationSource, /btrim\(p_block_id\) <> p_block_id/);
  assert.match(migrationSource, /p_week_id !~ ['"]\^\[0-9\]\{4\}-W/);
  assert.match(migrationSource, /p_expected_revision !~ ['"]\^\[0-9a-f\]\{16\}\$/);
  assert.match(
    migrationSource,
    /coalesce\(jsonb_typeof\(p_patch\) = ['"]object['"], false\)/,
    "SQL NULL must not bypass relabel patch validation through three-valued logic",
  );
  assert.match(
    migrationSource,
    /not coalesce\(\s*jsonb_typeof\(p_patch -> ['"]blockerFlag['"]\) = ['"]boolean['"], false\)/,
    "JSON null must not bypass boolean patch validation",
  );
  assert.match(migrationSource, /not coalesce\(p_patch ->> ['"]category['"] in/);
  assert.match(migrationSource, /user_id, block_id, week_id, expected_revision, action, patch, created_by/);
  assert.match(migrationSource, /values\s*\(\s*actor,\s*p_block_id,\s*p_week_id,\s*p_expected_revision,\s*p_action,\s*p_patch,\s*actor/);
  assert.match(migrationSource, /revoke all on function public\.queue_review_command_compatible[\s\S]*from public, anon, authenticated/);
  assert.match(migrationSource, /grant execute on function public\.queue_review_command_compatible[\s\S]*to authenticated/);
});
