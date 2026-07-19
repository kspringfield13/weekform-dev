// Static contract tests for the manager-only team action creation boundary.
// Run: node --import tsx --test apps/web/lib/teamActionsMigration.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MIGRATION_URL = new URL(
  "../../../supabase/migrations/202607190003_team_actions.sql",
  import.meta.url,
);
const RLS_TEST_URL = new URL(
  "../../../supabase/tests/team_cloud_rls.sql",
  import.meta.url,
);

function executableSql(): string {
  return readFileSync(MIGRATION_URL, "utf8")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function creationFunction(sql: string): { header: string; body: string } {
  const match = sql.match(
    /create or replace function public\.create_team_action\s*\(\s*p_team_id uuid\s*,\s*p_action_text text\s*,\s*p_risk_flag_key text default null\s*\)\s*(returns public\.team_actions language plpgsql security definer set search_path\s*=\s*''\s*as)\s*\$\$(.*?)\$\$\s*;/,
  );
  assert.ok(match, "create_team_action must keep its exact narrow signature and hardened header");
  return { header: match[1]!, body: match[2]! };
}

test("team action creation is RPC-only and authenticated-only", () => {
  const sql = executableSql();
  assert.doesNotMatch(
    sql,
    /create policy [^;]+ on public\.team_actions [^;]* for insert\b/,
    "no INSERT RLS policy may create a direct table write path",
  );

  assert.match(
    sql,
    /revoke all on table public\.team_actions from public, anon, authenticated\s*;/,
    "the migration must explicitly clear every direct table privilege before adding the narrow read/update grants",
  );

  const tableGrants = [...sql.matchAll(/grant\s+([^;]+?)\s+on table public\.team_actions\s+to\s+([^;]+);/g)];
  assert.ok(tableGrants.length > 0, "table privileges must be explicit");
  for (const grant of tableGrants) {
    assert.doesNotMatch(
      grant[1]!,
      /\b(?:all|insert)\b/,
      "no role may receive INSERT directly or through GRANT ALL",
    );
  }

  assert.match(
    sql,
    /revoke all on function public\.create_team_action\(uuid, text, text\) from public, anon, authenticated\s*;/,
  );
  assert.match(
    sql,
    /grant execute on function public\.create_team_action\(uuid, text, text\) to authenticated\s*;/,
  );
});

test("live RLS contract checks both client roles have no direct INSERT privilege", () => {
  const rlsContract = readFileSync(RLS_TEST_URL, "utf8")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  for (const role of ["anon", "authenticated"]) {
    assert.match(
      rlsContract,
      new RegExp(
        `has_table_privilege\\('${role}', 'public\\.team_actions', 'insert'\\)\\s*,\\s*false`,
      ),
      `pgTAP must prove ${role} has no direct team_actions INSERT privilege`,
    );
  }
});

test("create_team_action authenticates and authorizes inside a hardened definer function", () => {
  const sql = executableSql();
  const fn = creationFunction(sql);
  assert.match(fn.header, /security definer/);
  assert.match(fn.header, /set search_path\s*=\s*''/);
  assert.match(fn.body, /caller uuid\s*:=\s*auth\.uid\(\)/);
  assert.match(fn.body, /if caller is null then raise exception/);
  assert.match(
    fn.body,
    /if p_team_id is null or not private\.is_team_manager\(p_team_id, caller\) then raise exception/,
  );
});

test("create_team_action fully trims and clamps text and keeps the risk key allowlist closed", () => {
  const sql = executableSql();
  const { body } = creationFunction(sql);
  assert.match(
    body,
    /normalized_action_text := btrim\(p_action_text, e' \\t\\n\\r\\f\\013'\)/,
    "normalization must remove spaces, tabs, line breaks, form feeds, and vertical tabs",
  );
  assert.match(
    body,
    /if normalized_action_text is null or char_length\(normalized_action_text\) = 0 then raise exception/,
    "blank validation must use the fully normalized value",
  );
  assert.match(
    body,
    /normalized_action_text := left\(normalized_action_text, 500\)/,
    "the fully trimmed value must be clamped to 500 characters",
  );
  assert.match(
    sql,
    /char_length\(btrim\(action_text, e' \\t\\n\\r\\f\\013'\)\) between 1 and 500/,
    "the table constraint must enforce the same full-whitespace boundary",
  );

  const allowlistMatch = body.match(/p_risk_flag_key not in\s*\(([^)]+)\)/);
  assert.ok(allowlistMatch, "risk key validation must use a closed NOT IN allowlist");
  const keys = [...allowlistMatch[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(keys, [
    "low-headroom",
    "high-reactive",
    "high-meetings",
    "high-fragmentation",
    "low-review-coverage",
    "stale-data",
  ]);
});

test("create_team_action server-sets identity and lifecycle fields", () => {
  const { body } = creationFunction(executableSql());
  const insert = body.match(
    /insert into public\.team_actions\s*\(([^)]+)\)\s*values\s*\((.*?)\)\s*returning \* into created_action/,
  );
  assert.ok(insert, "RPC must contain one inspectable team_actions INSERT");

  const columns = insert[1]!.split(",").map((value) => value.trim());
  assert.deepEqual(columns, [
    "team_id",
    "created_by",
    "action_text",
    "risk_flag_key",
    "status",
    "created_at",
    "resolved_at",
  ]);
  const values = insert[2]!.split(",").map((value) => value.trim());
  assert.deepEqual(values, [
    "p_team_id",
    "caller",
    "normalized_action_text",
    "p_risk_flag_key",
    "'open'",
    "now()",
    "null",
  ]);
});
