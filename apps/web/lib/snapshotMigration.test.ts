import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MIGRATION_URL = new URL(
  "../../../supabase/migrations/202607190001_team_cloud_v1.sql",
  import.meta.url,
);
const ADDITIVE_MIGRATION_URL = new URL(
  "../../../supabase/migrations/202607190004_snapshot_sync_receipt.sql",
  import.meta.url,
);

function executableSql(): string {
  return readFileSync(MIGRATION_URL, "utf8")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

test("snapshot latest/freshness ordering uses a server-owned receipt clock", () => {
  const sql = executableSql();
  assert.match(
    sql,
    /synced_at timestamptz not null default now\(\)/,
    "snapshots need a server default receipt timestamp",
  );
  assert.match(
    sql,
    /create trigger workload_snapshots_stamp_sync_time before insert or update on public\.workload_snapshots for each row execute function private\.stamp_snapshot_sync_time\(\)/,
    "every insert and idempotent update must receive a new server timestamp",
  );
  assert.match(
    sql,
    /new\.synced_at := statement_timestamp\(\)/,
    "the trigger must ignore a client-provided receipt timestamp",
  );
  assert.match(
    sql,
    /order by snapshot\.team_id, snapshot\.user_id, snapshot\.synced_at desc, snapshot\.created_at desc/,
    "the latest view must not trust client observed_at ordering",
  );
});

test("already-provisioned databases receive the server receipt clock additively", () => {
  const sql = readFileSync(ADDITIVE_MIGRATION_URL, "utf8")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  assert.match(sql, /alter table public\.workload_snapshots add column if not exists synced_at timestamptz/);
  assert.match(sql, /update public\.workload_snapshots set synced_at = coalesce\(synced_at, created_at, statement_timestamp\(\)\) where synced_at is null/);
  assert.match(sql, /alter table public\.workload_snapshots alter column synced_at set not null/);
  assert.match(sql, /create or replace view public\.latest_team_snapshots/);
  assert.match(sql, /order by snapshot\.team_id, snapshot\.user_id, snapshot\.synced_at desc, snapshot\.created_at desc/);
});
