// Focused tests for the team helpers (no network). Pure helpers are tested
// directly; the query wrappers are exercised against a tiny hand-rolled mock
// SupabaseClient that records the query chain and resolves preset results.
// Run: npx tsx --test apps/web/lib/teams.test.ts  (root: npm run test:web)

import test from "node:test";
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getOwnMembership,
  isManagerRole,
  listTeamInvites,
  listTeamRoster,
  listUserTeams,
  type TeamRole,
} from "./teams";

// --- tiny mock Supabase -----------------------------------------------------
// `.from(table)` returns a chainable builder that records every call and is
// itself thenable, so both `await chain` and `await chain.maybeSingle()` work.

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

interface QueryCall {
  table: string;
  rpc: [string, Record<string, unknown>] | null;
  select: string | null;
  eq: Array<[string, unknown]>;
  order: [string, { ascending: boolean }] | null;
  in: [string, unknown[]] | null;
  maybeSingle: boolean;
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
        rpc: null,
        select: null,
        eq: [],
        order: null,
        in: null,
        maybeSingle: false,
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
        in(column: string, values: unknown[]) {
          call.in = [column, values];
          return builder;
        },
        maybeSingle() {
          call.maybeSingle = true;
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
    rpc(name: string, args: Record<string, unknown>) {
      const call: QueryCall = {
        table: "rpc",
        rpc: [name, args],
        select: null,
        eq: [],
        order: null,
        in: null,
        maybeSingle: false,
      };
      calls.push(call);
      const result = results[next++] ?? { data: null, error: null };
      return Promise.resolve(result);
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function ok(data: unknown): QueryResult {
  return { data, error: null };
}

function fail(message: string): QueryResult {
  return { data: null, error: { message } };
}

test("isManagerRole grants owners and managers, never plain members", () => {
  assert.equal(isManagerRole("owner"), true);
  assert.equal(isManagerRole("manager"), true);
  assert.equal(isManagerRole("member"), false);
});

test("isManagerRole is exhaustive over the TeamRole union", () => {
  const roles: TeamRole[] = ["owner", "manager", "member"];
  const managerCount = roles.filter(isManagerRole).length;
  assert.equal(managerCount, 2, "exactly owner and manager are managers");
});

// --- listUserTeams ----------------------------------------------------------

test("listUserTeams maps rows when the teams embed is an object", async () => {
  const { client, calls } = mockSupabase([
    ok([
      {
        team_id: "team-1",
        role: "owner",
        joined_at: "2026-07-01T00:00:00.000Z",
        teams: { id: "team-1", name: "Alpha" },
      },
    ]),
  ]);
  const { teams, error } = await listUserTeams(client, "user-1");
  assert.equal(error, null);
  assert.deepEqual(teams, [
    {
      teamId: "team-1",
      teamName: "Alpha",
      role: "owner",
      joinedAt: "2026-07-01T00:00:00.000Z",
    },
  ]);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.table, "team_memberships");
  assert.deepEqual(call.eq, [
    ["user_id", "user-1"],
    ["status", "active"],
  ]);
  assert.deepEqual(call.order, ["joined_at", { ascending: true }]);
});

test("listUserTeams maps rows when the teams embed is an array", async () => {
  const { client } = mockSupabase([
    ok([
      {
        team_id: "team-2",
        role: "manager",
        joined_at: "2026-07-02T00:00:00.000Z",
        teams: [{ id: "team-2", name: "Beta" }],
      },
    ]),
  ]);
  const { teams, error } = await listUserTeams(client, "user-1");
  assert.equal(error, null);
  assert.equal(teams.length, 1);
  const team = teams[0];
  assert.ok(team);
  assert.equal(team.teamName, "Beta");
  assert.equal(team.role, "manager");
});

test("listUserTeams skips rows whose team embed is null", async () => {
  const { client } = mockSupabase([
    ok([
      {
        team_id: "team-hidden",
        role: "member",
        joined_at: "2026-07-03T00:00:00.000Z",
        teams: null,
      },
      {
        team_id: "team-3",
        role: "member",
        joined_at: "2026-07-04T00:00:00.000Z",
        teams: { id: "team-3", name: "Gamma" },
      },
    ]),
  ]);
  const { teams } = await listUserTeams(client, "user-1");
  assert.deepEqual(
    teams.map((t) => t.teamId),
    ["team-3"],
  );
});

test("listUserTeams coerces unknown roles to member", async () => {
  const { client } = mockSupabase([
    ok([
      {
        team_id: "team-4",
        role: "superadmin",
        joined_at: "2026-07-05T00:00:00.000Z",
        teams: { id: "team-4", name: "Delta" },
      },
    ]),
  ]);
  const { teams } = await listUserTeams(client, "user-1");
  const team = teams[0];
  assert.ok(team);
  assert.equal(team.role, "member");
});

test("listUserTeams returns the error message and no teams on failure", async () => {
  const { client } = mockSupabase([fail("permission denied")]);
  const result = await listUserTeams(client, "user-1");
  assert.deepEqual(result, { teams: [], error: "permission denied" });
});

// --- getOwnMembership -------------------------------------------------------

test("getOwnMembership returns the team name and coerced role", async () => {
  const { client, calls } = mockSupabase([
    ok({ role: "manager", teams: { id: "team-1", name: "Alpha" } }),
  ]);
  const membership = await getOwnMembership(client, "team-1", "user-1");
  assert.deepEqual(membership, { teamName: "Alpha", role: "manager" });
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.table, "team_memberships");
  assert.deepEqual(call.eq, [
    ["team_id", "team-1"],
    ["user_id", "user-1"],
    ["status", "active"],
  ]);
  assert.equal(call.maybeSingle, true);
});

test("getOwnMembership returns null on query error", async () => {
  const { client } = mockSupabase([fail("boom")]);
  assert.equal(await getOwnMembership(client, "team-1", "user-1"), null);
});

test("getOwnMembership returns null when no row is visible", async () => {
  const { client } = mockSupabase([ok(null)]);
  assert.equal(await getOwnMembership(client, "team-x", "user-1"), null);
});

test("getOwnMembership returns null when the team embed is missing", async () => {
  const { client } = mockSupabase([ok({ role: "owner", teams: null })]);
  assert.equal(await getOwnMembership(client, "team-1", "user-1"), null);
});

// --- listTeamRoster ---------------------------------------------------------

test("listTeamRoster joins memberships with trimmed profile names", async () => {
  const { client, calls } = mockSupabase([
    ok([
      { user_id: "user-1", role: "owner", joined_at: "2026-07-01T00:00:00.000Z" },
      { user_id: "user-2", role: "member", joined_at: "2026-07-02T00:00:00.000Z" },
      { user_id: "user-3", role: "member", joined_at: "2026-07-03T00:00:00.000Z" },
    ]),
    ok([
      {
        user_id: "user-1",
        role: "owner",
        joined_at: "2026-07-01T00:00:00.000Z",
        display_name: "  Ada Lovelace  ",
        email: "ada@example.test",
      },
      {
        user_id: "user-2",
        role: "member",
        joined_at: "2026-07-02T00:00:00.000Z",
        display_name: "   ",
        email: "grace@example.test",
      },
      {
        user_id: "user-3",
        role: "member",
        joined_at: "2026-07-03T00:00:00.000Z",
        display_name: null,
        email: "linus@example.test",
      },
    ]),
  ]);
  const { roster, error } = await listTeamRoster(client, "team-1", "user-2");
  assert.equal(error, null);
  assert.deepEqual(roster, [
    {
      userId: "user-1",
      role: "owner",
      joinedAt: "2026-07-01T00:00:00.000Z",
      displayName: "Ada Lovelace",
      email: "ada@example.test",
      isSelf: false,
    },
    {
      userId: "user-2",
      role: "member",
      joinedAt: "2026-07-02T00:00:00.000Z",
      displayName: null, // blank display name stays null
      email: "grace@example.test",
      isSelf: true,
    },
    {
      userId: "user-3",
      role: "member",
      joinedAt: "2026-07-03T00:00:00.000Z",
      displayName: null, // no profile row at all
      email: "linus@example.test",
      isSelf: false,
    },
  ]);
  assert.equal(calls.length, 2);
  const [membershipCall, rosterIdentityCall] = calls;
  assert.ok(membershipCall);
  assert.ok(rosterIdentityCall);
  assert.equal(membershipCall.table, "team_memberships");
  assert.deepEqual(rosterIdentityCall.rpc, [
    "get_team_roster_identities",
    { target_team_id: "team-1" },
  ]);
});

test("listTeamRoster skips the identity RPC for an empty roster", async () => {
  const { client, calls } = mockSupabase([ok([])]);
  const { roster, error } = await listTeamRoster(client, "team-1", "user-1");
  assert.equal(error, null);
  assert.deepEqual(roster, []);
  assert.equal(calls.length, 1, "no identity RPC for an empty roster");
});

test("listTeamRoster returns the error message and no roster on failure", async () => {
  const { client, calls } = mockSupabase([fail("not allowed")]);
  const result = await listTeamRoster(client, "team-1", "user-1");
  assert.deepEqual(result, { roster: [], error: "not allowed" });
  assert.equal(calls.length, 1);
});

// --- listTeamInvites --------------------------------------------------------

test("listTeamInvites maps rows and defaults accepted_at to null", async () => {
  const { client, calls } = mockSupabase([
    ok([
      {
        id: "invite-1",
        email: "new@example.com",
        role: "member",
        created_at: "2026-07-10T00:00:00.000Z",
        expires_at: "2026-07-17T00:00:00.000Z",
        accepted_at: undefined,
      },
      {
        id: "invite-2",
        email: "boss@example.com",
        role: "manager",
        created_at: "2026-07-09T00:00:00.000Z",
        expires_at: "2026-07-16T00:00:00.000Z",
        accepted_at: "2026-07-11T00:00:00.000Z",
      },
    ]),
  ]);
  const { invites, error } = await listTeamInvites(client, "team-1");
  assert.equal(error, null);
  assert.deepEqual(invites, [
    {
      id: "invite-1",
      email: "new@example.com",
      role: "member",
      createdAt: "2026-07-10T00:00:00.000Z",
      expiresAt: "2026-07-17T00:00:00.000Z",
      acceptedAt: null,
    },
    {
      id: "invite-2",
      email: "boss@example.com",
      role: "manager",
      createdAt: "2026-07-09T00:00:00.000Z",
      expiresAt: "2026-07-16T00:00:00.000Z",
      acceptedAt: "2026-07-11T00:00:00.000Z",
    },
  ]);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.table, "team_invites");
  assert.deepEqual(call.eq, [["team_id", "team-1"]]);
  assert.deepEqual(call.order, ["created_at", { ascending: false }]);
});

test("listTeamInvites returns the error message and no invites on failure", async () => {
  const { client } = mockSupabase([fail("invites hidden")]);
  const result = await listTeamInvites(client, "team-1");
  assert.deepEqual(result, { invites: [], error: "invites hidden" });
});
