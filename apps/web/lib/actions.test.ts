// Focused tests for manager action persistence and deterministic follow-through.
// Run: node --import tsx --test apps/web/lib/actions.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildActionFollowThrough,
  createTeamAction,
  deleteTeamAction,
  listTeamActions,
  sanitizeActionText,
  updateTeamActionStatus,
  type TeamAction,
} from "./actions";
import type { LatestSnapshot } from "./snapshots";

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

interface QueryCall {
  table: string;
  operation: "select" | "insert" | "update" | "delete" | null;
  columns: string | null;
  payload: unknown;
  eq: Array<[string, unknown]>;
  order: [string, { ascending: boolean }] | null;
  single: boolean;
}

interface RpcCall {
  functionName: string;
  args: Record<string, unknown>;
}

function mockSupabase(result: QueryResult = { data: null, error: null }): {
  client: SupabaseClient;
  calls: QueryCall[];
  rpcCalls: RpcCall[];
} {
  const calls: QueryCall[] = [];
  const rpcCalls: RpcCall[] = [];
  const client = {
    rpc(functionName: string, args: Record<string, unknown>) {
      rpcCalls.push({ functionName, args });
      return Promise.resolve(result);
    },
    from(table: string) {
      const call: QueryCall = {
        table,
        operation: null,
        columns: null,
        payload: null,
        eq: [],
        order: null,
        single: false,
      };
      calls.push(call);
      const builder = {
        select(columns: string) {
          call.operation ??= "select";
          call.columns = columns;
          return builder;
        },
        insert(payload: unknown) {
          call.operation = "insert";
          call.payload = payload;
          return builder;
        },
        update(payload: unknown) {
          call.operation = "update";
          call.payload = payload;
          return builder;
        },
        delete() {
          call.operation = "delete";
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
        single() {
          call.single = true;
          return Promise.resolve(result);
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
  return { client: client as unknown as SupabaseClient, calls, rpcCalls };
}

const ROW = {
  id: "action-1",
  team_id: "team-1",
  created_by: "manager-1",
  action_text: "Batch incoming requests",
  risk_flag_key: "high-reactive",
  status: "open",
  created_at: "2026-07-13T12:00:00.000Z",
  resolved_at: null,
};

test("sanitizeActionText trims and clamps action text to 500 characters", () => {
  assert.equal(sanitizeActionText(`  ${"x".repeat(510)}  `).length, 500);
  assert.throws(() => sanitizeActionText("   "), /required/i);
});

test("createTeamAction uses the manager RPC with only team scope, clamped text, and risk key", async () => {
  const { client, calls, rpcCalls } = mockSupabase({
    data: { ...ROW, action_text: "x".repeat(500) },
    error: null,
  });
  const result = await createTeamAction(client, "manager", {
    teamId: "team-1",
    text: `  ${"x".repeat(510)}  `,
    riskFlagKey: "high-reactive",
  });
  assert.equal(result.error, null);
  assert.equal(result.action?.text.length, 500);
  assert.deepEqual(rpcCalls, [{
    functionName: "create_team_action",
    args: {
      p_team_id: "team-1",
      p_action_text: "x".repeat(500),
      p_risk_flag_key: "high-reactive",
    },
  }]);
  assert.deepEqual(calls, []);
});

test("createTeamAction sends null for an omitted risk key without adding identity or state fields", async () => {
  const { client, rpcCalls } = mockSupabase({ data: ROW, error: null });
  await createTeamAction(client, "owner", {
    teamId: "team-1",
    text: "  Protect two focus blocks  ",
  });
  assert.deepEqual(rpcCalls[0], {
    functionName: "create_team_action",
    args: {
      p_team_id: "team-1",
      p_action_text: "Protect two focus blocks",
      p_risk_flag_key: null,
    },
  });
  assert.deepEqual(
    Object.keys(rpcCalls[0]?.args ?? {}).sort(),
    ["p_action_text", "p_risk_flag_key", "p_team_id"],
  );
});

test("every CRUD wrapper denies members before touching Supabase", async () => {
  const { client, calls, rpcCalls } = mockSupabase();
  assert.match((await listTeamActions(client, "member", "team-1")).error ?? "", /manager/i);
  assert.match(
    (await createTeamAction(client, "member", { teamId: "team-1", text: "No" })).error ?? "",
    /manager/i,
  );
  assert.match(
    (await updateTeamActionStatus(client, "member", "team-1", "action-1", "done", "2026-07-20T00:00:00Z")).error ?? "",
    /manager/i,
  );
  assert.match((await deleteTeamAction(client, "member", "team-1", "action-1")).error ?? "", /manager/i);
  assert.equal(calls.length, 0);
  assert.equal(rpcCalls.length, 0);
});

test("create rejects a risk key outside the closed allowlist without querying", async () => {
  const { client, calls, rpcCalls } = mockSupabase();
  const result = await createTeamAction(client, "owner", {
    teamId: "team-1",
    text: "Try something",
    riskFlagKey: "arbitrary-free-form" as "high-reactive",
  });
  assert.match(result.error ?? "", /risk flag/i);
  assert.equal(calls.length, 0);
  assert.equal(rpcCalls.length, 0);
});

test("create rejects whitespace-only text before invoking the RPC", async () => {
  const { client, calls, rpcCalls } = mockSupabase();
  const result = await createTeamAction(client, "manager", {
    teamId: "team-1",
    text: " \n\t ",
    riskFlagKey: null,
  });
  assert.match(result.error ?? "", /required/i);
  assert.equal(result.action, null);
  assert.equal(calls.length, 0);
  assert.equal(rpcCalls.length, 0);
});

test("list, status update, and delete use explicit columns and team plus action scoping", async () => {
  const listed = mockSupabase({ data: [ROW], error: null });
  assert.equal((await listTeamActions(listed.client, "owner", "team-1")).actions.length, 1);
  assert.deepEqual(listed.calls[0]?.eq, [["team_id", "team-1"]]);
  assert.equal(listed.calls[0]?.columns?.includes("*"), false);

  const updated = mockSupabase({ data: { ...ROW, status: "done", resolved_at: "2026-07-20T00:00:00Z" }, error: null });
  await updateTeamActionStatus(updated.client, "manager", "team-1", "action-1", "done", "2026-07-20T00:00:00Z");
  assert.deepEqual(updated.calls[0]?.eq, [["team_id", "team-1"], ["id", "action-1"]]);
  assert.deepEqual(updated.calls[0]?.payload, { status: "done", resolved_at: "2026-07-20T00:00:00Z" });

  const deleted = mockSupabase();
  await deleteTeamAction(deleted.client, "owner", "team-1", "action-1");
  assert.deepEqual(deleted.calls[0]?.eq, [["team_id", "team-1"], ["id", "action-1"]]);
});

function action(overrides: Partial<TeamAction> = {}): TeamAction {
  return {
    id: "action-1",
    teamId: "team-1",
    createdBy: "manager-1",
    text: "Batch incoming requests",
    riskFlagKey: "high-reactive",
    status: "done",
    createdAt: "2026-07-06T12:00:00.000Z", // ISO week 2026-W28
    resolvedAt: "2026-07-27T12:00:00.000Z",
    ...overrides,
  };
}

function snapshot(weekId: string, userId: string, reactivePct: number): LatestSnapshot {
  return {
    userId,
    teamId: "team-1",
    weekId,
    observedAt: `${weekId === "2026-W29" ? "2026-07-15" : "2026-07-22"}T12:00:00.000Z`,
    sourceUpdatedAt: "2026-07-22T12:00:00.000Z",
    shareLevel: "summary",
    reliableCapacityPct: 20,
    reactivePct,
    meetingPct: 20,
    fragmentedPct: 20,
    summaryConfidence: 0.9,
    reviewedBlocks: 9,
    eligibleBlocks: 10,
  };
}

test("follow-through requires two distinct subsequent week ids, not two member rows", () => {
  const result = buildActionFollowThrough(
    [action()],
    [snapshot("2026-W29", "u1", 40), snapshot("2026-W29", "u2", 20)],
  );
  assert.equal(result[0]?.status, "too-early");
  assert.equal(result[0]?.subsequentWeekCount, 1);
});

test("follow-through reports only team aggregate change with correlation-only wording", () => {
  const result = buildActionFollowThrough(
    [action()],
    [
      snapshot("2026-W29", "u1", 50),
      snapshot("2026-W29", "u2", 30),
      snapshot("2026-W30", "u1", 34),
      snapshot("2026-W30", "u2", 26),
    ],
  )[0];
  assert.equal(result?.status, "computed");
  assert.equal(result?.firstTeamMedian, 40);
  assert.equal(result?.latestTeamMedian, 30);
  assert.equal(result?.changePoints, -10);
  assert.match(result?.label ?? "", /what changed after/i);
  assert.match(result?.label ?? "", /does not show.*caused/i);
  assert.doesNotMatch(result?.label ?? "", /u1|u2|member/i);
});

test("dropped actions are excluded from follow-through", () => {
  const result = buildActionFollowThrough(
    [action({ status: "dropped" })],
    [snapshot("2026-W29", "u1", 40), snapshot("2026-W30", "u1", 30)],
  );
  assert.deepEqual(result, []);
});
