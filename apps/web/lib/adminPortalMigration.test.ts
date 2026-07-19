import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const MIGRATION_URL = new URL(
  "../../../supabase/migrations/202607190006_simulator_admin_access.sql",
  import.meta.url,
);
const RLS_CONTRACT_URL = new URL(
  "../../../supabase/tests/simulator_admin_access.sql",
  import.meta.url,
);

function executableSql(url: URL): string {
  return readFileSync(url, "utf8")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

test("production admin access RPC is current-user-only and authenticated-only", () => {
  const sql = executableSql(MIGRATION_URL);

  assert.match(
    sql,
    /create or replace function public\.has_simulator_admin_access\(\) returns boolean language sql stable security invoker set search_path = ''/,
  );
  assert.match(sql, /select private\.is_simulator_admin\(auth\.uid\(\)\)/);
  assert.doesNotMatch(sql, /has_simulator_admin_access\([^)]*uuid/);
  assert.match(
    sql,
    /revoke all on function public\.has_simulator_admin_access\(\) from public, anon, authenticated/,
  );
  assert.match(
    sql,
    /grant execute on function public\.has_simulator_admin_access\(\) to authenticated/,
  );
});

test("live pgTAP contract covers grants, denials, and immediate revocation", () => {
  const contract = executableSql(RLS_CONTRACT_URL);

  for (const expected of [
    "ordinary member is not a simulator admin",
    "team manager metadata does not grant simulator access",
    "explicit simulator administrator is recognized",
    "authenticated users cannot read the simulator admin registry",
    "authenticated users cannot grant themselves simulator access",
    "revoking the trusted grant takes effect immediately",
  ]) {
    assert.match(contract, new RegExp(expected));
  }
  assert.match(
    contract,
    /has_function_privilege\('anon', 'public\.has_simulator_admin_access\(\)', 'execute'\)\s*,\s*false/,
  );
  assert.match(
    contract,
    /has_function_privilege\('authenticated', 'public\.has_simulator_admin_access\(\)', 'execute'\)\s*,\s*true/,
  );
});
