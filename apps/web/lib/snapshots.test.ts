// Focused tests for the snapshot helpers (no network). The row-mapping
// helpers are tested directly; the query wrappers are exercised against a
// tiny hand-rolled mock SupabaseClient that records the query chain and
// resolves preset results.
// Run: npx tsx --test apps/web/lib/snapshots.test.ts  (root: npm run test:web)

import test from "node:test";
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  HISTORY_ROW_LIMIT,
  asMetric,
  listLatestTeamSnapshots,
  listOwnLatestSnapshots,
  listTeamSnapshotHistory,
  mapRow,
  type SnapshotRow,
} from "./snapshots";

// --- tiny mock Supabase -----------------------------------------------------
// `.from(table)` returns a chainable builder that records every call and is
// itself thenable, so `await chain` resolves the preset {data, error}.

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

interface QueryCall {
  table: string;
  select: string | null;
  eq: Array<[string, unknown]>;
  order: [string, { ascending: boolean }] | null;
  limit: number | null;
}

function mockSupabase(results: QueryResult[]): {
  client: SupabaseClient;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  let next = 0;
  const client = {
    from(table: string) {
      const call: QueryCall = {
        table,
        select: null,
        eq: [],
        order: null,
        limit: null,
      };
      calls.push(call);
      const result = results[next++] ?? { data: null, error: null };
      const builder = {
        select(columns: string) {
          call.select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eq.push([column, value]);
          return builder;
        },
        order(column: string, options: { ascending: boolean }) {
          call.order = [column, options];
          return builder;
        },
        limit(count: number) {
          call.limit = count;
          return builder;
        },
        then(
          resolve: (value: QueryResult) => unknown,
          reject?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function row(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    user_id: "user-1",
    team_id: "team-1",
    week_id: "2026-W29",
    observed_at: "2026-07-19T10:00:00.000Z",
    source_updated_at: "2026-07-19T09:00:00.000Z",
    share_level: "summary",
    reliable_new_work_capacity_pct: 40,
    reactive_pct: 25,
    meeting_pct: 20,
    fragmented_work_pct: 15,
    summary_confidence: 0.8,
    reviewed_blocks: 12,
    eligible_blocks: 16,
    ...overrides,
  };
}

test("asMetric passes finite numbers through unchanged", () => {
  assert.equal(asMetric(0), 0);
  assert.equal(asMetric(42.5), 42.5);
  assert.equal(asMetric(-3), -3);
});

test("asMetric parses Postgres numeric strings", () => {
  assert.equal(asMetric("37.5"), 37.5);
  assert.equal(asMetric("0"), 0);
  assert.equal(asMetric("100"), 100);
});

test("asMetric keeps absent metrics null, never zero", () => {
  assert.equal(asMetric(null), null);
  // Defensive: undefined can leak from a malformed row shape.
  assert.equal(asMetric(undefined as unknown as null), null);
});

test("asMetric rejects non-finite garbage instead of propagating NaN", () => {
  assert.equal(asMetric("not-a-number"), null);
  assert.equal(asMetric("NaN"), null);
  assert.equal(asMetric("Infinity"), null);
  assert.equal(asMetric(Number.NaN), null);
  assert.equal(asMetric(Number.POSITIVE_INFINITY), null);
});

test("mapRow maps every snake_case column to its camelCase field", () => {
  const mapped = mapRow(row());
  assert.deepEqual(mapped, {
    userId: "user-1",
    teamId: "team-1",
    weekId: "2026-W29",
    observedAt: "2026-07-19T10:00:00.000Z",
    sourceUpdatedAt: "2026-07-19T09:00:00.000Z",
    shareLevel: "summary",
    reliableCapacityPct: 40,
    reactivePct: 25,
    meetingPct: 20,
    fragmentedPct: 15,
    summaryConfidence: 0.8,
    reviewedBlocks: 12,
    eligibleBlocks: 16,
  });
});

test("mapRow coerces numeric-string metrics to numbers", () => {
  const mapped = mapRow(
    row({
      reliable_new_work_capacity_pct: "12.5",
      reactive_pct: "60",
      summary_confidence: "0.4",
    }),
  );
  assert.equal(mapped.reliableCapacityPct, 12.5);
  assert.equal(mapped.reactivePct, 60);
  assert.equal(mapped.summaryConfidence, 0.4);
});

test("mapRow keeps unshared metrics null instead of inventing zeros", () => {
  const mapped = mapRow(
    row({
      reliable_new_work_capacity_pct: null,
      reactive_pct: null,
      meeting_pct: null,
      fragmented_work_pct: null,
      summary_confidence: null,
    }),
  );
  assert.equal(mapped.reliableCapacityPct, null);
  assert.equal(mapped.reactivePct, null);
  assert.equal(mapped.meetingPct, null);
  assert.equal(mapped.fragmentedPct, null);
  assert.equal(mapped.summaryConfidence, null);
});

test("mapRow defaults missing block counts to 0, not null", () => {
  const mapped = mapRow(row({ reviewed_blocks: null, eligible_blocks: null }));
  assert.equal(mapped.reviewedBlocks, 0);
  assert.equal(mapped.eligibleBlocks, 0);
});

test("mapRow nulls malformed metric values instead of throwing", () => {
  const mapped = mapRow(
    row({
      reliable_new_work_capacity_pct: "garbage",
      summary_confidence: "NaN",
    }),
  );
  assert.equal(mapped.reliableCapacityPct, null);
  assert.equal(mapped.summaryConfidence, null);
  // The rest of the row still maps.
  assert.equal(mapped.userId, "user-1");
  assert.equal(mapped.reactivePct, 25);
});

test("mapping an empty result set yields an empty array", () => {
  const rows: SnapshotRow[] = [];
  assert.deepEqual(rows.map(mapRow), []);
});

// --- listLatestTeamSnapshots ------------------------------------------------

test("listLatestTeamSnapshots maps rows and filters by team_id", async () => {
  const { client, calls } = mockSupabase([
    { data: [row(), row({ user_id: "user-2", reactive_pct: "55" })], error: null },
  ]);
  const { snapshots, error } = await listLatestTeamSnapshots(client, "team-1");
  assert.equal(error, null);
  assert.deepEqual(snapshots, [
    mapRow(row()),
    mapRow(row({ user_id: "user-2", reactive_pct: "55" })),
  ]);
  const second = snapshots[1];
  assert.ok(second);
  assert.equal(second.reactivePct, 55, "numeric strings coerced via mapRow");
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.table, "latest_team_snapshots");
  assert.deepEqual(call.eq, [["team_id", "team-1"]]);
  assert.deepEqual(call.order, ["observed_at", { ascending: false }]);
});

test("listLatestTeamSnapshots returns the error message and no rows on failure", async () => {
  const { client } = mockSupabase([
    { data: null, error: { message: "view denied" } },
  ]);
  const result = await listLatestTeamSnapshots(client, "team-1");
  assert.deepEqual(result, { snapshots: [], error: "view denied" });
});

test("listLatestTeamSnapshots treats null data as an empty list", async () => {
  const { client } = mockSupabase([{ data: null, error: null }]);
  const result = await listLatestTeamSnapshots(client, "team-1");
  assert.deepEqual(result, { snapshots: [], error: null });
});

// --- listTeamSnapshotHistory --------------------------------------------------

test("listTeamSnapshotHistory queries the base table with team filter, order, and hard limit", async () => {
  const { client, calls } = mockSupabase([
    { data: [row(), row({ week_id: "2026-W28" })], error: null },
  ]);
  const { snapshots, error } = await listTeamSnapshotHistory(client, "team-1");
  assert.equal(error, null);
  assert.deepEqual(snapshots, [mapRow(row()), mapRow(row({ week_id: "2026-W28" }))]);
  const call = calls[0];
  assert.ok(call);
  // History needs prior weeks, so it reads workload_snapshots directly — the
  // latest_team_snapshots view keeps only each member's newest row.
  assert.equal(call.table, "workload_snapshots");
  assert.deepEqual(call.eq, [["team_id", "team-1"]]);
  assert.deepEqual(call.order, ["observed_at", { ascending: false }]);
  assert.equal(call.limit, HISTORY_ROW_LIMIT);
});

test("listTeamSnapshotHistory clamps the limit into [1, HISTORY_ROW_LIMIT]", async () => {
  const { client, calls } = mockSupabase([
    { data: [], error: null },
    { data: [], error: null },
    { data: [], error: null },
  ]);
  await listTeamSnapshotHistory(client, "team-1", 50);
  await listTeamSnapshotHistory(client, "team-1", 0);
  await listTeamSnapshotHistory(client, "team-1", HISTORY_ROW_LIMIT + 1000);
  assert.equal(calls[0]?.limit, 50);
  assert.equal(calls[1]?.limit, 1); // never unbounded, never zero/negative
  assert.equal(calls[2]?.limit, HISTORY_ROW_LIMIT);
});

test("listTeamSnapshotHistory never issues an unbounded query for a garbage limit", async () => {
  const { client, calls } = mockSupabase([{ data: [], error: null }]);
  await listTeamSnapshotHistory(client, "team-1", Number.NaN);
  assert.equal(calls[0]?.limit, HISTORY_ROW_LIMIT);
});

test("listTeamSnapshotHistory returns the error message and no rows on failure", async () => {
  const { client } = mockSupabase([
    { data: null, error: { message: "table denied" } },
  ]);
  const result = await listTeamSnapshotHistory(client, "team-1");
  assert.deepEqual(result, { snapshots: [], error: "table denied" });
});

test("listTeamSnapshotHistory treats null data as an empty list", async () => {
  const { client } = mockSupabase([{ data: null, error: null }]);
  const result = await listTeamSnapshotHistory(client, "team-1");
  assert.deepEqual(result, { snapshots: [], error: null });
});

// --- listOwnLatestSnapshots -------------------------------------------------

test("listOwnLatestSnapshots filters by user_id and maps rows", async () => {
  const { client, calls } = mockSupabase([{ data: [row()], error: null }]);
  const { snapshots, error } = await listOwnLatestSnapshots(client, "user-1");
  assert.equal(error, null);
  assert.deepEqual(snapshots, [mapRow(row())]);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.table, "latest_team_snapshots");
  assert.deepEqual(call.eq, [["user_id", "user-1"]]);
  assert.deepEqual(call.order, ["observed_at", { ascending: false }]);
});

test("listOwnLatestSnapshots returns the error message and no rows on failure", async () => {
  const { client } = mockSupabase([
    { data: null, error: { message: "session expired" } },
  ]);
  const result = await listOwnLatestSnapshots(client, "user-1");
  assert.deepEqual(result, { snapshots: [], error: "session expired" });
});
