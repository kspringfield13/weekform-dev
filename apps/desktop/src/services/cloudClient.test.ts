// Focused tests for the desktop Supabase REST/auth client's parse/validate layer.
// Run: npm run test:desktop-cloud   (tsx --test)
//
// All network calls are exercised against a stubbed `fetch` with fixture Response
// objects — no live Supabase. The interesting logic under test is deterministic:
// token-response → session mapping, failure-message extraction (which must never
// echo response bodies containing tokens), membership row allowlisting/role
// coercion, and content-range count parsing.

import test from "node:test";
import assert from "node:assert/strict";

import type { PersistedCloudSession } from "./cloudPolicy";
import type { WorkloadSnapshotRow } from "./cloudPolicy";
import {
  claimReviewCommandV2,
  completeReviewCommandV1,
  completeReviewCommandV2,
  deleteMySnapshotsForTeam,
  fetchPendingReviewCommandsV1,
  fetchPendingReviewCommandsV2,
  fetchManagerTeamWorkspace,
  fetchTeamMemberships,
  getCloudEnv,
  isCloudConfigured,
  markReviewCommandAppliedLocallyV2,
  registerWeekformDeviceV2,
  reviewCommandExistsV2,
  refreshSession,
  signInWithOAuth,
  signInWithPassword,
  signOutSession,
  upsertWorkloadSnapshot,
  workloadSnapshotExists,
  type CloudEnv
} from "./cloudClient";

const env: CloudEnv = { url: "https://cloud.example.test", anonKey: "anon-key-123" };

function makeSession(): PersistedCloudSession {
  return {
    accessToken: "SENTINEL_ACCESS_TOKEN",
    refreshToken: "SENTINEL_REFRESH_TOKEN",
    expiresAt: null,
    userId: "user id/9", // deliberately URL-hostile
    email: "member@example.test",
    displayName: null,
    signedInAt: null
  };
}

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

/** Install a fetch stub for the duration of `run`; records every request. */
async function withFetch(
  responder: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
  run: (requests: RecordedRequest[]) => Promise<void>
): Promise<void> {
  const original = globalThis.fetch;
  const requests: RecordedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? "GET",
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: typeof init?.body === "string" ? init.body : null
    });
    return responder(url, init);
  }) as typeof fetch;
  try {
    await run(requests);
  } finally {
    globalThis.fetch = original;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// ---------------------------------------------------------------------------
// Env detection (no Vite env exists under the node test runner)
// ---------------------------------------------------------------------------

test("getCloudEnv returns null (and isCloudConfigured false) outside a Vite build", () => {
  assert.equal(getCloudEnv(), null);
  assert.equal(isCloudConfigured(), false);
});

// ---------------------------------------------------------------------------
// signInWithOAuth: native browser PKCE handoff -> token exchange -> session
// ---------------------------------------------------------------------------

test("signInWithOAuth completes Google PKCE sign-in and maps the session", async () => {
  let nativeRequest: { supabaseUrl: string; provider: string } | null = null;
  await withFetch(
    () =>
      jsonResponse({
        access_token: "oauth-at",
        refresh_token: "oauth-rt",
        expires_in: 3600,
        user: { id: "oauth-user", email: "casey@example.test", user_metadata: { display_name: "Casey" } }
      }),
    async (requests) => {
      const result = await signInWithOAuth(env, "google", async (request) => {
        nativeRequest = request;
        return { authCode: "one-time-code", codeVerifier: "pkce-verifier" };
      });

      assert.ok(result.ok);
      assert.equal(result.value.userId, "oauth-user");
      assert.equal(result.value.displayName, "Casey");
      assert.deepEqual(nativeRequest, { supabaseUrl: env.url, provider: "google" });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, `${env.url}/auth/v1/token?grant_type=pkce`);
      assert.deepEqual(JSON.parse(requests[0].body ?? ""), {
        auth_code: "one-time-code",
        code_verifier: "pkce-verifier"
      });
    }
  );
});

test("signInWithOAuth supports GitHub and surfaces a cancelled browser flow", async () => {
  const result = await signInWithOAuth(env, "github", async (request) => {
    assert.equal(request.provider, "github");
    throw "Sign-in was cancelled before it finished.";
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /cancelled/i);
});

test("signInWithOAuth rejects providers outside the desktop allowlist", async () => {
  let transportCalled = false;
  const result = await signInWithOAuth(
    env,
    "gitlab" as "google",
    async () => {
      transportCalled = true;
      return { authCode: "unused", codeVerifier: "unused" };
    }
  );

  assert.equal(result.ok, false);
  assert.equal(transportCalled, false);
  if (!result.ok) assert.match(result.message, /Google or GitHub/);
});

// ---------------------------------------------------------------------------
// signInWithPassword: token response → session mapping
// ---------------------------------------------------------------------------

test("signInWithPassword maps a complete token response into a session", async () => {
  const before = Date.now();
  await withFetch(
    () =>
      jsonResponse({
        access_token: "at-1",
        refresh_token: "rt-1",
        expires_at: 1_800_000_000, // epoch seconds
        user: { id: "user-1", email: "member@example.test", user_metadata: { display_name: "  Casey Vo  " } }
      }),
    async (requests) => {
      const result = await signInWithPassword(env, "member@example.test", "pw");
      assert.ok(result.ok);
      const session = result.value;
      assert.equal(session.accessToken, "at-1");
      assert.equal(session.refreshToken, "rt-1");
      assert.equal(session.expiresAt, 1_800_000_000 * 1000); // seconds → ms
      assert.equal(session.userId, "user-1");
      assert.equal(session.email, "member@example.test");
      assert.equal(session.displayName, "Casey Vo"); // trimmed
      assert.ok(session.signedInAt);
      assert.ok(Date.parse(session.signedInAt as string) >= before - 1000);
      // Request shape: anon key only, no Authorization on the password grant.
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, `${env.url}/auth/v1/token?grant_type=password`);
      assert.equal(requests[0].method, "POST");
      assert.equal(requests[0].headers.apikey, env.anonKey);
      assert.equal("Authorization" in requests[0].headers, false);
      assert.deepEqual(JSON.parse(requests[0].body ?? ""), { email: "member@example.test", password: "pw" });
    }
  );
});

test("signInWithPassword falls back to expires_in relative to now", async () => {
  await withFetch(
    () =>
      jsonResponse({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        user: { id: "u", email: "e@example.test" }
      }),
    async () => {
      const before = Date.now();
      const result = await signInWithPassword(env, "e@example.test", "pw");
      const after = Date.now();
      assert.ok(result.ok);
      const expiresAt = result.value.expiresAt;
      assert.ok(expiresAt !== null);
      assert.ok(expiresAt >= before + 3600 * 1000 && expiresAt <= after + 3600 * 1000);
      // A very long display name would be capped at 120; absent metadata → null.
      assert.equal(result.value.displayName, null);
    }
  );
});

test("signInWithPassword caps an oversized display name at 120 chars", async () => {
  await withFetch(
    () =>
      jsonResponse({
        access_token: "at",
        refresh_token: "rt",
        user: { id: "u", email: "e@example.test", user_metadata: { display_name: "x".repeat(500) } }
      }),
    async () => {
      const result = await signInWithPassword(env, "e@example.test", "pw");
      assert.ok(result.ok);
      assert.equal(result.value.displayName?.length, 120);
      // Neither expires field present → null, not NaN/0.
      assert.equal(result.value.expiresAt, null);
    }
  );
});

test("signInWithPassword rejects incomplete or wrong-typed token responses", async () => {
  const incompleteBodies: unknown[] = [
    {}, // nothing
    { access_token: "at", user: { id: "u", email: "e@example.test" } }, // no refresh token
    { access_token: "at", refresh_token: "rt", user: { id: "u" } }, // no email
    { access_token: "at", refresh_token: "rt" }, // no user
    { access_token: 42, refresh_token: "rt", user: { id: "u", email: "e@example.test" } } // wrong type
  ];
  for (const body of incompleteBodies) {
    await withFetch(
      () => jsonResponse(body),
      async () => {
        const result = await signInWithPassword(env, "e@example.test", "pw");
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.message, /incomplete/i);
      }
    );
  }
});

test("non-JSON success body degrades to a failure result, not a throw", async () => {
  await withFetch(
    () => new Response("<html>gateway</html>", { status: 200 }),
    async () => {
      const result = await signInWithPassword(env, "e@example.test", "pw");
      assert.equal(result.ok, false);
    }
  );
});

// ---------------------------------------------------------------------------
// Failure-message extraction: known fields only, capped, never body echo
// ---------------------------------------------------------------------------

test("failure messages come from error_description/msg/message, trimmed and capped at 200", async () => {
  const cases: Array<{ body: unknown; expected: RegExp }> = [
    { body: { error_description: "  Invalid login credentials  " }, expected: /^Invalid login credentials$/ },
    { body: { msg: "Rate limited" }, expected: /^Rate limited$/ },
    { body: { message: "Row level security violation" }, expected: /^Row level security violation$/ }
  ];
  for (const { body, expected } of cases) {
    await withFetch(
      () => jsonResponse(body, 400),
      async () => {
        const result = await signInWithPassword(env, "e@example.test", "pw");
        assert.equal(result.ok, false);
        if (!result.ok) assert.match(result.message, expected);
      }
    );
  }
  // Cap: a huge server message is truncated to 200 chars.
  await withFetch(
    () => jsonResponse({ message: "e".repeat(1000) }, 400),
    async () => {
      const result = await signInWithPassword(env, "e@example.test", "pw");
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.message.length, 200);
    }
  );
});

test("a failure body that echoes tokens never reaches the returned message", async () => {
  await withFetch(
    () =>
      jsonResponse(
        { detail: "access_token=SENTINEL_LEAKED_TOKEN refresh_token=SENTINEL_LEAKED_REFRESH" },
        400
      ),
    async () => {
      // No known message field → generic fallback with status; the echoed body is dropped.
      const result = await signInWithPassword(env, "e@example.test", "pw");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(!result.message.includes("SENTINEL_LEAKED_TOKEN"));
        assert.ok(!result.message.includes("SENTINEL_LEAKED_REFRESH"));
        assert.match(result.message, /HTTP 400/);
      }
    }
  );
});

test("unparseable failure bodies fall back to the generic message with the HTTP status", async () => {
  await withFetch(
    () => new Response("not json", { status: 503 }),
    async () => {
      const result = await refreshSession(env, "rt");
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /HTTP 503/);
    }
  );
});

test("a thrown fetch (offline) maps to the friendly network message, never a raw error", async () => {
  await withFetch(
    () => {
      throw new Error("ECONNREFUSED SENTINEL_INTERNAL");
    },
    async () => {
      for (const result of [
        await signInWithPassword(env, "e@example.test", "pw"),
        await refreshSession(env, "rt"),
        await fetchTeamMemberships(env, makeSession()),
        await upsertWorkloadSnapshot(env, makeSession(), {} as WorkloadSnapshotRow),
        await deleteMySnapshotsForTeam(env, makeSession(), "team-1")
      ]) {
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.match(result.message, /Could not reach the sync service/);
          assert.ok(!result.message.includes("SENTINEL_INTERNAL"));
        }
      }
    }
  );
});

// ---------------------------------------------------------------------------
// refreshSession / signOutSession request shapes
// ---------------------------------------------------------------------------

test("refreshSession posts the refresh token and maps the new session", async () => {
  await withFetch(
    () =>
      jsonResponse({
        access_token: "at-2",
        refresh_token: "rt-2",
        expires_in: 3600,
        user: { id: "u", email: "e@example.test" }
      }),
    async (requests) => {
      const result = await refreshSession(env, "rt-old");
      assert.ok(result.ok);
      assert.equal(result.value.accessToken, "at-2");
      assert.equal(requests[0].url, `${env.url}/auth/v1/token?grant_type=refresh_token`);
      assert.deepEqual(JSON.parse(requests[0].body ?? ""), { refresh_token: "rt-old" });
    }
  );
});

test("signOutSession sends the bearer token and swallows network failures", async () => {
  await withFetch(
    () => new Response(null, { status: 204 }),
    async (requests) => {
      await signOutSession(env, "at-3");
      assert.equal(requests[0].url, `${env.url}/auth/v1/logout`);
      assert.equal(requests[0].headers.Authorization, "Bearer at-3");
    }
  );
  await withFetch(
    () => {
      throw new Error("offline");
    },
    async () => {
      await assert.doesNotReject(signOutSession(env, "at-3"));
    }
  );
});

// ---------------------------------------------------------------------------
// fetchTeamMemberships: defensive row parsing
// ---------------------------------------------------------------------------

test("fetchTeamMemberships keeps only fully-visible rows and coerces roles safely", async () => {
  const rows = [
    { team_id: "team-1", role: "owner", teams: { id: "team-1", name: "Alpha" } },
    { team_id: "team-2", role: "manager", teams: [{ id: "team-2", name: "Beta" }] }, // embedded as array
    { team_id: "team-3", role: "superadmin", teams: { id: "team-3", name: "Gamma" } }, // unknown role
    { team_id: "team-4", role: "member", teams: null }, // team row not visible → skipped
    { team_id: "", role: "member", teams: { name: "NoId" } }, // missing team_id → skipped
    "garbage", // non-object row → skipped
    null,
    { team_id: "team-5", role: "member", teams: { name: 42 } } // wrong name type → skipped
  ];
  await withFetch(
    () => jsonResponse(rows),
    async (requests) => {
      const session = makeSession();
      const result = await fetchTeamMemberships(env, session);
      assert.ok(result.ok);
      assert.deepEqual(result.value, [
        { teamId: "team-1", teamName: "Alpha", role: "owner", sharePolicy: null },
        { teamId: "team-2", teamName: "Beta", role: "manager", sharePolicy: null },
        { teamId: "team-3", teamName: "Gamma", role: "member", sharePolicy: null } // unknown role degrades to member
      ]);
      // Request: bearer auth, explicit columns, URL-encoded user id.
      assert.equal(requests[0].headers.Authorization, `Bearer ${session.accessToken}`);
      assert.ok(requests[0].url.includes("select=team_id,role,teams(id,name,share_policy)"));
      assert.ok(requests[0].url.includes(`user_id=eq.${encodeURIComponent(session.userId)}`));
      assert.ok(!requests[0].url.includes("user id/9")); // raw unencoded id never appears
    }
  );
});

test("fetchTeamMemberships tolerates a non-array body as zero teams", async () => {
  await withFetch(
    () => jsonResponse({ unexpected: "shape" }),
    async () => {
      const result = await fetchTeamMemberships(env, makeSession());
      assert.ok(result.ok);
      assert.deepEqual(result.value, []);
    }
  );
});

test("fetchTeamMemberships parses server share_policy defensively (A6)", async () => {
  const rows = [
    {
      team_id: "team-1",
      role: "member",
      teams: {
        id: "team-1",
        name: "Alpha",
        share_policy: { version: 1, maxShareLevel: "categories" }
      }
    },
    {
      team_id: "team-2",
      role: "member",
      // Hostile/malformed policy from the server: unknown version + junk fields. It must
      // parse to the NARROWEST level, never widen or crash the team list.
      teams: {
        id: "team-2",
        name: "Beta",
        share_policy: { version: 99, maxShareLevel: "projects", enabled: true }
      }
    }
  ];
  await withFetch(
    () => jsonResponse(rows),
    async () => {
      const result = await fetchTeamMemberships(env, makeSession());
      assert.ok(result.ok);
      assert.deepEqual(result.value[0].sharePolicy, {
        version: 1,
        maxShareLevel: "categories",
        acceptedMetrics: null
      });
      assert.deepEqual(result.value[1].sharePolicy, {
        version: 1,
        maxShareLevel: "summary",
        acceptedMetrics: null
      });
    }
  );
});

test("fetchManagerTeamWorkspace includes the signed-in manager and joins approved snapshots", async () => {
  const managerId = "10000000-0000-4000-8000-000000000001";
  const memberId = "10000000-0000-4000-8000-000000000002";
  const teamId = "20000000-0000-4000-8000-000000000001";
  const session: PersistedCloudSession = {
    ...makeSession(),
    userId: managerId,
    email: "manager@example.test",
    displayName: "Morgan Manager",
  };

  await withFetch(
    (url) => {
      if (url.includes("/team_memberships?")) {
        return jsonResponse([
          { user_id: managerId, role: "manager", joined_at: "2026-07-01T12:00:00.000Z" },
          { user_id: memberId, role: "member", joined_at: "2026-07-02T12:00:00.000Z" },
        ]);
      }
      if (url.includes("/rpc/get_team_roster_identities")) {
        return jsonResponse([
          { user_id: managerId, display_name: "Morgan Manager", email: "manager@example.test" },
          { user_id: memberId, display_name: "  Riley Member  ", email: "riley@example.test" },
        ]);
      }
      if (url.includes("/latest_team_snapshots?")) {
        return jsonResponse([
          {
            user_id: managerId,
            team_id: teamId,
            week_id: "2026-W30",
            synced_at: "2026-07-20T21:10:00.000Z",
            share_level: "summary",
            reliable_new_work_capacity_pct: "32",
            reactive_pct: "18",
            meeting_pct: null,
            fragmented_work_pct: "21",
            summary_confidence: "0.84",
            reviewed_blocks: 9,
            eligible_blocks: 10,
          },
        ]);
      }
      return jsonResponse({ message: "unexpected request" }, 500);
    },
    async (requests) => {
      const result = await fetchManagerTeamWorkspace(env, session, [{
        teamId,
        teamName: "Delivery",
        role: "manager",
        sharePolicy: null,
      }]);

      assert.ok(result.ok);
      assert.equal(result.value.members.length, 2);
      assert.deepEqual(result.value.members[0], {
        id: `${teamId}:${managerId}`,
        userId: managerId,
        teamId,
        teamName: "Delivery",
        role: "manager",
        joinedAt: "2026-07-01T12:00:00.000Z",
        displayName: "Morgan Manager",
        email: "manager@example.test",
        isSelf: true,
        snapshot: {
          weekId: "2026-W30",
          syncedAt: "2026-07-20T21:10:00.000Z",
          shareLevel: "summary",
          reliableCapacityPct: 32,
          reactivePct: 18,
          meetingPct: null,
          fragmentedPct: 21,
          summaryConfidence: 0.84,
          reviewedBlocks: 9,
          eligibleBlocks: 10,
        },
      });
      assert.equal(result.value.members[1]?.displayName, "Riley Member");
      assert.equal(result.value.members[1]?.email, "riley@example.test");
      assert.equal(result.value.members[1]?.snapshot, null);
      assert.equal(result.value.latestSyncedAt, "2026-07-20T21:10:00.000Z");
      assert.equal(requests.length, 3);
      assert.ok(requests.every((request) => request.headers.Authorization === `Bearer ${session.accessToken}`));
      assert.ok(requests.some((request) => request.url.includes("select=user_id,role,joined_at")));
      const identityRequest = requests.find((request) => request.url.includes("/rpc/get_team_roster_identities"));
      assert.equal(identityRequest?.method, "POST");
      assert.deepEqual(JSON.parse(identityRequest?.body ?? ""), { target_team_id: teamId });
      assert.ok(requests.some((request) => request.url.includes("select=user_id,team_id,week_id,synced_at,share_level")));
    },
  );
});

test("fetchManagerTeamWorkspace fails closed instead of rendering a partial roster", async () => {
  await withFetch(
    (url) => url.includes("/rpc/get_team_roster_identities")
      ? jsonResponse({ message: "roster identities denied" }, 403)
      : jsonResponse([]),
    async () => {
      const result = await fetchManagerTeamWorkspace(env, makeSession(), [{
        teamId: "20000000-0000-4000-8000-000000000001",
        teamName: "Delivery",
        role: "manager",
        sharePolicy: null,
      }]);
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /roster identities denied/i);
    },
  );
});

// ---------------------------------------------------------------------------
// upsertWorkloadSnapshot / deleteMySnapshotsForTeam
// ---------------------------------------------------------------------------

test("upsertWorkloadSnapshot posts exactly the given row with merge-duplicates upsert", async () => {
  const row = { client_snapshot_id: "id-1", team_id: "team-1", user_id: "user-1" } as unknown as WorkloadSnapshotRow;
  await withFetch(
    () => new Response(null, { status: 201 }),
    async (requests) => {
      const result = await upsertWorkloadSnapshot(env, makeSession(), row);
      assert.deepEqual(result, { ok: true, value: null });
      assert.equal(
        requests[0].url,
        `${env.url}/rest/v1/workload_snapshots?on_conflict=user_id,client_snapshot_id`
      );
      assert.equal(requests[0].headers.Prefer, "resolution=merge-duplicates,return=minimal");
      assert.deepEqual(JSON.parse(requests[0].body ?? ""), row);
    }
  );
});

test("workloadSnapshotExists performs an authenticated, user-scoped, body-free read", async () => {
  for (const [rows, expected] of [[[{ client_snapshot_id: "snapshot/1" }], true], [[], false]] as const) {
    await withFetch(
      () => jsonResponse(rows),
      async (requests) => {
        const session = makeSession();
        const result = await workloadSnapshotExists(env, session, "snapshot/1");
        assert.deepEqual(result, { ok: true, value: expected });
        assert.equal(requests[0].method, "GET");
        assert.equal(requests[0].body, null);
        assert.equal(requests[0].headers.Authorization, `Bearer ${session.accessToken}`);
        assert.ok(requests[0].url.includes(`user_id=eq.${encodeURIComponent(session.userId)}`));
        assert.ok(requests[0].url.includes(`client_snapshot_id=eq.${encodeURIComponent("snapshot/1")}`));
      }
    );
  }
});

test("deleteMySnapshotsForTeam parses the exact count from content-range", async () => {
  const cases: Array<{ header: string | null; expected: number }> = [
    { header: "0-4/5", expected: 5 },
    { header: "*/0", expected: 0 },
    { header: "malformed", expected: 0 },
    { header: null, expected: 0 }
  ];
  for (const { header, expected } of cases) {
    await withFetch(
      () =>
        new Response(null, {
          status: 204,
          headers: header === null ? {} : { "content-range": header }
        }),
      async (requests) => {
        const session = makeSession();
        const result = await deleteMySnapshotsForTeam(env, session, "team id&1");
        assert.deepEqual(result, { ok: true, value: expected });
        assert.equal(requests[0].method, "DELETE");
        assert.ok(requests[0].url.includes(`team_id=eq.${encodeURIComponent("team id&1")}`));
        assert.ok(requests[0].url.includes(`user_id=eq.${encodeURIComponent(session.userId)}`));
      }
    );
  }
});

test("delete/upsert failures surface the server message without throwing", async () => {
  await withFetch(
    () => jsonResponse({ message: "permission denied for table workload_snapshots" }, 403),
    async () => {
      const upsert = await upsertWorkloadSnapshot(env, makeSession(), {} as WorkloadSnapshotRow);
      assert.equal(upsert.ok, false);
      if (!upsert.ok) assert.match(upsert.message, /permission denied/);
      const del = await deleteMySnapshotsForTeam(env, makeSession(), "team-1");
      assert.equal(del.ok, false);
      if (!del.ok) assert.match(del.message, /permission denied/);
    }
  );
});

// ---------------------------------------------------------------------------
// Review command two-phase claim/application lifecycle
// ---------------------------------------------------------------------------

test("registerWeekformDeviceV2 advertises protocol support before reading the isolated inbox", async () => {
  await withFetch(
    () => jsonResponse({ id: "82000000-0000-4000-8000-000000000001" }),
    async (requests) => {
      const result = await registerWeekformDeviceV2(
        env,
        makeSession(),
        "82000000-0000-4000-8000-000000000001",
        "Synthetic Mac",
      );
      assert.deepEqual(result, { ok: true, value: null });
      assert.equal(requests[0].url, `${env.url}/rest/v1/rpc/register_weekform_device_v2`);
      assert.deepEqual(JSON.parse(requests[0].body ?? ""), {
        p_device_id: "82000000-0000-4000-8000-000000000001",
        p_device_name: "Synthetic Mac",
      });
    },
  );
});

test("fetchPendingReviewCommandsV1 keeps legacy rows on the released table and tags protocol explicitly", async () => {
  const row = {
    command_id: "81000000-0000-4000-8000-000000000001",
    block_id: "block-1",
    week_id: "2026-W29",
    expected_revision: "0123456789abcdef",
    action: "confirm",
    patch: null,
    status: "pending",
    created_at: "2026-07-20T12:00:00.000Z",
  };
  await withFetch(
    () => jsonResponse([row]),
    async (requests) => {
      const result = await fetchPendingReviewCommandsV1(env, makeSession());
      assert.ok(result.ok);
      assert.equal(result.value[0]?.protocolVersion, 1);
      assert.equal(result.value[0]?.applicationPhase, null);
      assert.match(requests[0].url, /\/rest\/v1\/review_commands\?/);
      assert.doesNotMatch(requests[0].url, /application_phase|claimed_by_device|review_commands_v2/);
    },
  );
});

test("completeReviewCommandV1 drains legacy work only through the released completion RPC", async () => {
  await withFetch(
    () => jsonResponse(true),
    async (requests) => {
      const result = await completeReviewCommandV1(
        env,
        makeSession(),
        "82000000-0000-4000-8000-000000000001",
        "81000000-0000-4000-8000-000000000001",
        "applied",
        "Approved on this Mac.",
      );
      assert.deepEqual(result, { ok: true, value: true });
      assert.equal(requests[0].url, `${env.url}/rest/v1/rpc/complete_review_command`);
      assert.doesNotMatch(requests[0].url, /_v2$/);
    },
  );
});

test("fetchPendingReviewCommandsV2 accepts only allowlisted isolated-v2 lifecycle fields", async () => {
  const row = {
    command_id: "81000000-0000-4000-8000-000000000001",
    block_id: "block-1",
    week_id: "2026-W29",
    expected_revision: "0123456789abcdef",
    action: "confirm",
    patch: null,
    status: "pending",
    created_at: "2026-07-20T12:00:00.000Z",
    application_phase: "apply_pending",
    claimed_by_device: "82000000-0000-4000-8000-000000000001",
    claimed_at: "2026-07-20T12:00:01.000Z",
    claim_owner: { revoked_at: null },
  };
  await withFetch(
    () => jsonResponse([row, { ...row, command_id: "bad", application_phase: "unknown" }]),
    async (requests) => {
      const result = await fetchPendingReviewCommandsV2(env, makeSession());
      assert.ok(result.ok);
      assert.equal(result.value.length, 1);
      assert.equal(result.value[0].protocolVersion, 2);
      assert.equal(result.value[0].applicationPhase, "apply_pending");
      assert.equal(result.value[0].claimedByDevice, row.claimed_by_device);
      assert.equal(result.value[0].claimedAt, row.claimed_at);
      assert.equal(result.value[0].claimOwnerRevoked, false);
      assert.match(requests[0].url, /application_phase,claimed_by_device,claimed_at/);
      assert.match(requests[0].url, /\/rest\/v1\/review_commands_v2\?/);
    },
  );
});

test("fetchPendingReviewCommandsV2 paginates so claimed rows cannot starve later requests", async () => {
  const row = (index: number) => ({
    command_id: `${(0x81000000 + index).toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`,
    block_id: `block-${index}`,
    week_id: "2026-W29",
    expected_revision: "0123456789abcdef",
    action: "confirm",
    patch: null,
    status: "pending",
    created_at: "2026-07-20T12:00:00.000Z",
    application_phase: null,
    claimed_by_device: null,
    claimed_at: null,
    claim_owner: null,
  });
  await withFetch(
    (url) => jsonResponse(url.includes("offset=200") ? [row(200)] : Array.from({ length: 200 }, (_, index) => row(index))),
    async (requests) => {
      const result = await fetchPendingReviewCommandsV2(env, makeSession());
      assert.ok(result.ok);
      assert.equal(result.value.length, 201);
      assert.equal(requests.length, 2);
      assert.match(requests[1].url, /offset=200/);
    },
  );
});

test("reviewCommandExistsV2 distinguishes a deleted command from a live isolated-v2 row", async () => {
  let call = 0;
  await withFetch(
    () => jsonResponse(call++ === 0 ? [{ command_id: "81000000-0000-4000-8000-000000000001" }] : []),
    async (requests) => {
      assert.deepEqual(
        await reviewCommandExistsV2(env, makeSession(), "81000000-0000-4000-8000-000000000001"),
        { ok: true, value: true },
      );
      assert.deepEqual(
        await reviewCommandExistsV2(env, makeSession(), "81000000-0000-4000-8000-000000000002"),
        { ok: true, value: false },
      );
      assert.match(requests[0].url, /command_id=eq\.81000000-0000-4000-8000-000000000001/);
      assert.match(requests[0].url, /\/rest\/v1\/review_commands_v2\?/);
    },
  );
});

test("claimReviewCommandV2 obtains server acknowledgement before local application", async () => {
  await withFetch(
    () => jsonResponse("apply_pending"),
    async (requests) => {
      const result = await claimReviewCommandV2(
        env,
        makeSession(),
        "82000000-0000-4000-8000-000000000001",
        "81000000-0000-4000-8000-000000000001",
      );
      assert.deepEqual(result, { ok: true, value: "apply_pending" });
      assert.equal(requests[0].url, `${env.url}/rest/v1/rpc/claim_review_command_v2`);
      assert.deepEqual(JSON.parse(requests[0].body ?? ""), {
        p_device_id: "82000000-0000-4000-8000-000000000001",
        p_command_id: "81000000-0000-4000-8000-000000000001",
      });
    },
  );
});

test("claimReviewCommandV2 recognizes an idempotent terminal conflict receipt", async () => {
  await withFetch(
    () => jsonResponse("conflict"),
    async () => {
      assert.deepEqual(await claimReviewCommandV2(
        env,
        makeSession(),
        "82000000-0000-4000-8000-000000000001",
        "81000000-0000-4000-8000-000000000001",
      ), { ok: true, value: "conflict" });
    },
  );
});

test("application recording and terminal completion are separate idempotent acknowledgements", async () => {
  await withFetch(
    () => jsonResponse(true),
    async (requests) => {
      const marked = await markReviewCommandAppliedLocallyV2(
        env,
        makeSession(),
        "82000000-0000-4000-8000-000000000001",
        "81000000-0000-4000-8000-000000000001",
      );
      const completed = await completeReviewCommandV2(
        env,
        makeSession(),
        "82000000-0000-4000-8000-000000000001",
        "81000000-0000-4000-8000-000000000001",
        "applied",
        "Approved on this Mac.",
      );
      assert.deepEqual(marked, { ok: true, value: true });
      assert.deepEqual(completed, { ok: true, value: true });
      assert.equal(requests[0].url, `${env.url}/rest/v1/rpc/mark_review_command_applied_locally_v2`);
      assert.equal(requests[1].url, `${env.url}/rest/v1/rpc/complete_review_command_v2`);
    },
  );
});
