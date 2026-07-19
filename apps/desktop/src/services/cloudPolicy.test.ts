// Focused tests for the desktop Account & Sharing pure helpers.
// Run: npm run test:desktop-cloud   (tsx --test)

import test from "node:test";
import assert from "node:assert/strict";

import type {
  SharedWorkloadSnapshotV1,
  TeamSharePolicyV1
} from "../../../../packages/domain/src/cloud";
import {
  applyTeamSharePolicy,
  buildCloudBackupMetadata,
  CLOUD_METRIC_KEYS,
  createDefaultCloudSharePolicy,
  createEmptyCloudSyncState,
  narrowerShareLevel,
  parseCloudSession,
  parseCloudPendingSnapshot,
  parseCloudSharePolicy,
  parseCloudSyncState,
  parsePersistedCloudState,
  parseTeamSharePolicy,
  resolveClientSnapshotId,
  sharedSnapshotToRow
} from "./cloudPolicy";

// ---------------------------------------------------------------------------
// Defaults: sharing must start OFF
// ---------------------------------------------------------------------------

test("default policy is disabled, teamless, unconsented, manual-sync only", () => {
  const policy = createDefaultCloudSharePolicy();
  assert.equal(policy.enabled, false);
  assert.equal(policy.teamId, null);
  assert.equal(policy.consentedAt, null);
  assert.equal(policy.autoSyncEnabled, false);
  assert.equal(policy.shareLevel, "summary");
  assert.equal(policy.intervalMinutes, 60);
  assert.deepEqual(policy.allowedProjectNames, []);
});

// ---------------------------------------------------------------------------
// Policy parsing
// ---------------------------------------------------------------------------

test("parseCloudSharePolicy degrades garbage to the safe default", () => {
  for (const garbage of [null, undefined, 42, "policy", []]) {
    const policy = parseCloudSharePolicy(garbage);
    assert.equal(policy.enabled, false);
    assert.equal(policy.teamId, null);
    assert.equal(policy.consentedAt, null);
  }
});

test("parseCloudSharePolicy round-trips a valid policy", () => {
  const original = {
    ...createDefaultCloudSharePolicy(),
    enabled: true,
    teamId: "team-1",
    shareLevel: "projects" as const,
    allowedProjectNames: ["Quarterly forecast refresh"],
    autoSyncEnabled: true,
    consentedAt: "2026-07-19T10:00:00.000Z"
  };
  assert.deepEqual(parseCloudSharePolicy(original), original);
});

test("a missing or malformed metric flag parses to false (omitted, never sent)", () => {
  const parsed = parseCloudSharePolicy({
    version: 1,
    enabled: true,
    teamId: "team-1",
    shareLevel: "summary",
    metrics: { reliableCapacity: true, allocated: "yes", reactive: 1 }, // partial + wrong types
    allowedProjectNames: [],
    autoSyncEnabled: false,
    intervalMinutes: 60,
    consentedAt: null
  });
  assert.equal(parsed.metrics.reliableCapacity, true);
  assert.equal(parsed.metrics.allocated, false);
  assert.equal(parsed.metrics.reactive, false);
  for (const key of CLOUD_METRIC_KEYS) {
    assert.equal(typeof parsed.metrics[key], "boolean");
  }
});

test("malformed shareLevel/teamId/allowlist fields degrade conservatively", () => {
  const parsed = parseCloudSharePolicy({
    enabled: "true", // not a boolean → false
    teamId: "   ",
    shareLevel: "everything",
    allowedProjectNames: ["  Apollo  ", "", 7, "Apollo"],
    autoSyncEnabled: "on",
    consentedAt: ""
  });
  assert.equal(parsed.enabled, false);
  assert.equal(parsed.teamId, null);
  assert.equal(parsed.shareLevel, "summary");
  assert.deepEqual(parsed.allowedProjectNames, ["Apollo"]);
  assert.equal(parsed.autoSyncEnabled, false);
  assert.equal(parsed.consentedAt, null);
});

// ---------------------------------------------------------------------------
// Sync-state parsing
// ---------------------------------------------------------------------------

test("parseCloudSyncState normalizes an interrupted 'syncing' status to idle", () => {
  const parsed = parseCloudSyncState({ status: "syncing", lastAttemptAt: "2026-07-19T09:00:00Z" });
  assert.equal(parsed.status, "idle");
  assert.equal(parsed.lastAttemptAt, "2026-07-19T09:00:00Z");
});

test("parseCloudSyncState degrades garbage to the empty state", () => {
  assert.deepEqual(parseCloudSyncState("nope"), createEmptyCloudSyncState());
  assert.deepEqual(parseCloudSyncState(null), createEmptyCloudSyncState());
});

// ---------------------------------------------------------------------------
// Session parsing (tokens stay local; incomplete blobs are dropped)
// ---------------------------------------------------------------------------

test("parseCloudSession rejects a blob missing any required credential field", () => {
  assert.equal(parseCloudSession(null), null);
  assert.equal(parseCloudSession({ accessToken: "a", refreshToken: "r", userId: "u" }), null);
  const full = parseCloudSession({
    accessToken: "a",
    refreshToken: "r",
    expiresAt: 123,
    userId: "u",
    email: "member@example.test",
    displayName: null,
    signedInAt: null
  });
  assert.ok(full);
  assert.equal(full?.email, "member@example.test");
});

// ---------------------------------------------------------------------------
// Stable clientSnapshotId across retries
// ---------------------------------------------------------------------------

test("parseCloudPendingSnapshot rejects a non-UUID id so corrupt retries can recover", () => {
  assert.equal(
    parseCloudPendingSnapshot({ fingerprint: "fp-1", clientSnapshotId: "not-a-uuid" }),
    null
  );
  assert.deepEqual(
    parseCloudPendingSnapshot({
      fingerprint: "fp-1",
      clientSnapshotId: "11111111-2222-4333-8444-555555555555"
    }),
    {
      fingerprint: "fp-1",
      clientSnapshotId: "11111111-2222-4333-8444-555555555555"
    }
  );
});

test("resolveClientSnapshotId reuses the reserved id for an unchanged fingerprint", () => {
  let counter = 0;
  const generate = () => `uuid-${(counter += 1)}`;
  const first = resolveClientSnapshotId(null, "fp-1", generate);
  assert.deepEqual(first, { fingerprint: "fp-1", clientSnapshotId: "uuid-1" });
  // Retry of the same content: SAME id, no new generation.
  const retry = resolveClientSnapshotId(first, "fp-1", generate);
  assert.equal(retry, first);
  assert.equal(counter, 1);
  // Changed content: new id.
  const changed = resolveClientSnapshotId(first, "fp-2", generate);
  assert.deepEqual(changed, { fingerprint: "fp-2", clientSnapshotId: "uuid-2" });
});

// ---------------------------------------------------------------------------
// Backup projection: policy + sync metadata, NEVER tokens
// ---------------------------------------------------------------------------

test("buildCloudBackupMetadata never carries tokens or session fields", () => {
  const policy = { ...createDefaultCloudSharePolicy(), enabled: true, teamId: "team-1" };
  const syncState = {
    ...createEmptyCloudSyncState(),
    lastSuccessAt: "2026-07-19T10:00:00.000Z",
    lastSyncedFingerprint: "fp-1",
    lastSyncedClientSnapshotId: "uuid-1"
  };
  // Simulate a hostile future where token-ish fields sit NEXT to the inputs: the
  // projection is field-by-field, so they cannot ride along.
  const poisonedPolicy = Object.assign({}, policy, { accessToken: "SENTINEL_ACCESS" });
  const poisonedSync = Object.assign({}, syncState, { refreshToken: "SENTINEL_REFRESH" });
  const metadata = buildCloudBackupMetadata(poisonedPolicy, poisonedSync);
  const serialized = JSON.stringify(metadata);
  assert.ok(!serialized.includes("SENTINEL_ACCESS"));
  assert.ok(!serialized.includes("SENTINEL_REFRESH"));
  assert.ok(!/accessToken|refreshToken|token/i.test(serialized));
  // …while the legitimate metadata survives.
  assert.equal(metadata.policy.teamId, "team-1");
  assert.equal(metadata.syncState.lastSyncedClientSnapshotId, "uuid-1");
});

// ---------------------------------------------------------------------------
// Persisted envelope
// ---------------------------------------------------------------------------

test("parsePersistedCloudState degrades unknown versions/garbage to safe defaults", () => {
  const fromGarbage = parsePersistedCloudState("corrupt");
  assert.equal(fromGarbage.session, null);
  assert.equal(fromGarbage.policy.enabled, false);
  const fromWrongVersion = parsePersistedCloudState({ version: 2, session: { accessToken: "a" } });
  assert.equal(fromWrongVersion.session, null);
});

// ---------------------------------------------------------------------------
// Team share policy (A6): parse defensively, clamp narrowing-only
// ---------------------------------------------------------------------------

/** A member policy that consented to everything the schema allows. */
function fullConsentMemberPolicy() {
  const policy = createDefaultCloudSharePolicy();
  policy.enabled = true;
  policy.teamId = "team-1";
  policy.shareLevel = "projects";
  policy.allowedProjectNames = ["Apollo", "Zephyr"];
  policy.consentedAt = "2026-07-19T10:00:00.000Z";
  for (const key of CLOUD_METRIC_KEYS) policy.metrics[key] = true;
  return policy;
}

test("narrowerShareLevel picks the lower rung of the existing ladder", () => {
  assert.equal(narrowerShareLevel("summary", "projects"), "summary");
  assert.equal(narrowerShareLevel("projects", "categories"), "categories");
  assert.equal(narrowerShareLevel("categories", "categories"), "categories");
  assert.equal(narrowerShareLevel("projects", "projects"), "projects");
});

test("parseTeamSharePolicy: absent/garbage input means NO policy (null), never a made-up one", () => {
  for (const absent of [null, undefined, 42, "cap", [], true]) {
    assert.equal(parseTeamSharePolicy(absent), null);
  }
});

test("parseTeamSharePolicy round-trips a valid v1 policy", () => {
  const acceptedMetrics = { ...createDefaultCloudSharePolicy().metrics, reliableCapacity: true };
  const parsed = parseTeamSharePolicy({
    version: 1,
    maxShareLevel: "categories",
    acceptedMetrics
  });
  assert.deepEqual(parsed, { version: 1, maxShareLevel: "categories", acceptedMetrics });
  // null acceptedMetrics = "accept whatever the member consented to".
  assert.deepEqual(parseTeamSharePolicy({ version: 1, maxShareLevel: "projects" }), {
    version: 1,
    maxShareLevel: "projects",
    acceptedMetrics: null
  });
});

test("parseTeamSharePolicy: unknown version or malformed level degrades to the NARROWEST level", () => {
  // A policy object we cannot fully interpret still exists — share the least, not the most.
  assert.deepEqual(parseTeamSharePolicy({ version: 2, maxShareLevel: "projects" }), {
    version: 1,
    maxShareLevel: "summary",
    acceptedMetrics: null
  });
  assert.deepEqual(parseTeamSharePolicy({ maxShareLevel: "projects" }), {
    version: 1,
    maxShareLevel: "summary",
    acceptedMetrics: null
  });
  const malformedLevel = parseTeamSharePolicy({ version: 1, maxShareLevel: "everything" });
  assert.equal(malformedLevel?.maxShareLevel, "summary");
});

test("parseTeamSharePolicy: malformed acceptedMetrics degrade to false (rejected), never true", () => {
  const parsed = parseTeamSharePolicy({
    version: 1,
    maxShareLevel: "projects",
    acceptedMetrics: { reliableCapacity: true, allocated: "yes", meetings: 1 }
  });
  assert.ok(parsed && parsed.acceptedMetrics);
  assert.equal(parsed.acceptedMetrics.reliableCapacity, true);
  assert.equal(parsed.acceptedMetrics.allocated, false);
  assert.equal(parsed.acceptedMetrics.meetings, false);
  // Present-but-uninterpretable acceptedMetrics: reject every metric, don't accept all.
  const garbageMetrics = parseTeamSharePolicy({
    version: 1,
    maxShareLevel: "projects",
    acceptedMetrics: "all"
  });
  assert.ok(garbageMetrics && garbageMetrics.acceptedMetrics);
  for (const key of CLOUD_METRIC_KEYS) {
    assert.equal(garbageMetrics.acceptedMetrics[key], false);
  }
});

test("parseTeamSharePolicy ignores prototype-pollution-style keys and does not pollute", () => {
  const hostile = JSON.parse(
    '{"version":1,"maxShareLevel":"summary","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"acceptedMetrics":{"__proto__":{"reliableCapacity":true}}}'
  );
  const parsed = parseTeamSharePolicy(hostile);
  assert.ok(parsed);
  assert.equal(parsed.maxShareLevel, "summary");
  // The hostile acceptedMetrics record carries no recognized metric key, so every
  // metric is REJECTED (false) — the conservative reading, never acceptance.
  assert.ok(parsed.acceptedMetrics);
  for (const key of CLOUD_METRIC_KEYS) {
    assert.equal(parsed.acceptedMetrics[key], false);
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.ok(!JSON.stringify(parsed).includes("polluted"));
});

test("applyTeamSharePolicy with no team policy is the identity on member consent", () => {
  const member = fullConsentMemberPolicy();
  const effective = applyTeamSharePolicy(member, null);
  assert.deepEqual(effective, member);
  assert.notEqual(effective, member); // a copy, so callers can't mutate the stored policy
});

test("ADVERSARIAL: a server policy trying to WIDEN scope is clamped to member consent", () => {
  const member = createDefaultCloudSharePolicy();
  member.enabled = true;
  member.teamId = "team-1";
  member.shareLevel = "summary"; // member chose the narrowest level
  member.metrics = { ...member.metrics, fragmented: false, blocked: false };
  member.consentedAt = "2026-07-19T10:00:00.000Z";
  // Hostile team policy: highest level, all metrics accepted, plus junk fields that try to
  // flip consent switches the schema does not even give a team policy.
  const hostile = parseTeamSharePolicy({
    version: 1,
    maxShareLevel: "projects",
    acceptedMetrics: Object.fromEntries(CLOUD_METRIC_KEYS.map((key) => [key, true])),
    enabled: true,
    allowedProjectNames: ["Secret Project"],
    consentedAt: "2026-01-01T00:00:00.000Z",
    autoSyncEnabled: true
  });
  const effective = applyTeamSharePolicy(member, hostile);
  // Nothing widened: the effective policy equals the member's own consent.
  assert.deepEqual(effective, member);
});

test("applyTeamSharePolicy narrows level, intersects metrics, and drops project names below 'projects'", () => {
  const member = fullConsentMemberPolicy();
  const teamPolicy: TeamSharePolicyV1 = {
    version: 1,
    maxShareLevel: "categories",
    acceptedMetrics: {
      ...Object.fromEntries(CLOUD_METRIC_KEYS.map((key) => [key, false])),
      reliableCapacity: true,
      meetings: true
    } as TeamSharePolicyV1["acceptedMetrics"] & object
  };
  const effective = applyTeamSharePolicy(member, teamPolicy);
  assert.equal(effective.shareLevel, "categories"); // projects ∩ categories
  assert.equal(effective.metrics.reliableCapacity, true); // consented AND accepted
  assert.equal(effective.metrics.meetings, true);
  assert.equal(effective.metrics.allocated, false); // consented but team rejected
  assert.equal(effective.metrics.confidence, false);
  // Effective level cannot use project names, so none survive into the effective policy.
  assert.deepEqual(effective.allowedProjectNames, []);
  // Consent bookkeeping is the member's, untouched.
  assert.equal(effective.enabled, true);
  assert.equal(effective.teamId, "team-1");
  assert.equal(effective.consentedAt, "2026-07-19T10:00:00.000Z");
});

test("applyTeamSharePolicy: team acceptedMetrics can never turn ON an unconsented metric", () => {
  const member = createDefaultCloudSharePolicy(); // finer-grained metrics start false
  member.enabled = true;
  member.teamId = "team-1";
  member.consentedAt = "2026-07-19T10:00:00.000Z";
  const teamPolicy = parseTeamSharePolicy({
    version: 1,
    maxShareLevel: "projects",
    acceptedMetrics: Object.fromEntries(CLOUD_METRIC_KEYS.map((key) => [key, true]))
  });
  const effective = applyTeamSharePolicy(member, teamPolicy);
  for (const key of CLOUD_METRIC_KEYS) {
    assert.equal(effective.metrics[key], member.metrics[key]);
  }
});

test("parseTeamSharePolicy and applyTeamSharePolicy are deterministic", () => {
  const raw = {
    version: 1,
    maxShareLevel: "categories",
    acceptedMetrics: { reliableCapacity: true, meetings: true }
  };
  assert.deepEqual(parseTeamSharePolicy(raw), parseTeamSharePolicy(raw));
  const member = fullConsentMemberPolicy();
  const teamPolicy = parseTeamSharePolicy(raw);
  assert.deepEqual(
    applyTeamSharePolicy(member, teamPolicy),
    applyTeamSharePolicy(member, teamPolicy)
  );
});

// ---------------------------------------------------------------------------
// Payload → row mapping
// ---------------------------------------------------------------------------

test("sharedSnapshotToRow maps allowlisted fields only; absent metrics become NULL columns", () => {
  const payload: SharedWorkloadSnapshotV1 = {
    schemaVersion: 1,
    clientSnapshotId: "11111111-2222-3333-4444-555555555555",
    teamId: "team-1",
    weekId: "2026-W29",
    observedAt: "2026-07-19T10:00:00.000Z",
    sourceUpdatedAt: "2026-07-18T17:00:00.000Z",
    shareLevel: "categories",
    metrics: { reliableNewWorkCapacityPct: 12.5, meetingPct: 22 },
    categoryAllocation: [{ label: "Meetings / stakeholder syncs", value: 22 }],
    workModeAllocation: [{ label: "Deep work", value: 30 }],
    reviewCoverage: { reviewedBlocks: 5, eligibleBlocks: 8 }
  };
  const row = sharedSnapshotToRow(payload, "fp-abc", "user-9");
  assert.equal(row.client_snapshot_id, payload.clientSnapshotId);
  assert.equal(row.team_id, "team-1");
  assert.equal(row.user_id, "user-9");
  assert.equal(row.week_id, "2026-W29");
  assert.equal(row.share_level, "categories");
  assert.equal(row.reliable_new_work_capacity_pct, 12.5);
  assert.equal(row.meeting_pct, 22);
  // Disabled metrics: NULL, never zero.
  assert.equal(row.reactive_pct, null);
  assert.equal(row.allocated_pct, null);
  assert.equal(row.summary_confidence, null);
  // Projects level absent → NULL column.
  assert.equal(row.project_allocation, null);
  assert.deepEqual(row.category_allocation, [{ label: "Meetings / stakeholder syncs", value: 22 }]);
  assert.equal(row.reviewed_blocks, 5);
  assert.equal(row.eligible_blocks, 8);
  assert.equal(row.content_fingerprint, "fp-abc");
  // No forbidden/local fields ride along.
  const keys = Object.keys(row);
  for (const forbidden of ["evidence", "notes", "title", "samples", "sessions", "apiKey", "user_metadata"]) {
    assert.ok(!keys.includes(forbidden));
  }
});
