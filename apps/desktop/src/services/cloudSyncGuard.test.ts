import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultCloudSharePolicy, type PersistedCloudSession } from "./cloudPolicy";
import type { CloudTeamMembership } from "./cloudClient";
import {
  boundaryRequiresConsentReset,
  checkFreshUploadBoundary,
  runFreshGuardedUpload
} from "./cloudSyncGuard";

const session: PersistedCloudSession = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: null,
  userId: "user-1",
  email: "member@example.com",
  displayName: null,
  signedInAt: "2026-07-19T10:00:00.000Z"
};

const memberPolicy = {
  ...createDefaultCloudSharePolicy(),
  enabled: true,
  teamId: "team-1",
  shareLevel: "projects" as const,
  allowedProjectNames: ["Allowed project"],
  consentedAt: "2026-07-19T10:00:00.000Z"
};

const cachedTeam: CloudTeamMembership = {
  teamId: "team-1",
  teamName: "Team One",
  role: "member",
  sharePolicy: null
};

test("fresh upload boundary fails closed when memberships cannot be refreshed", async () => {
  const result = await checkFreshUploadBoundary({
    session,
    memberPolicy,
    cachedEffectivePolicy: memberPolicy,
    fetchMemberships: async () => ({ ok: false, message: "offline" })
  });

  assert.deepEqual(result, { ok: false, reason: "refresh_failed", message: "offline" });
});

test("fresh upload boundary rejects revoked membership before an upload can be prepared", async () => {
  const result = await checkFreshUploadBoundary({
    session,
    memberPolicy,
    cachedEffectivePolicy: memberPolicy,
    fetchMemberships: async () => ({ ok: true, value: [] })
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "membership_revoked");
});

test("fresh upload boundary stops when the server policy changed so the preview can refresh", async () => {
  const narrowed: CloudTeamMembership = {
    ...cachedTeam,
    sharePolicy: { version: 1, maxShareLevel: "summary", acceptedMetrics: null }
  };
  const result = await checkFreshUploadBoundary({
    session,
    memberPolicy,
    cachedEffectivePolicy: memberPolicy,
    fetchMemberships: async () => ({ ok: true, value: [narrowed] })
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "policy_changed");
    assert.deepEqual(result.teams, [narrowed]);
    assert.equal(boundaryRequiresConsentReset(result), true);
  }
});

test("only policy drift invalidates consent; offline and membership failures do not rewrite it", () => {
  assert.equal(
    boundaryRequiresConsentReset({
      ok: false,
      reason: "refresh_failed",
      message: "offline"
    }),
    false
  );
  assert.equal(
    boundaryRequiresConsentReset({
      ok: false,
      reason: "membership_revoked",
      message: "revoked"
    }),
    false
  );
});

test("fresh upload boundary returns the freshly fetched teams only when effective policy is unchanged", async () => {
  const result = await checkFreshUploadBoundary({
    session,
    memberPolicy,
    cachedEffectivePolicy: memberPolicy,
    fetchMemberships: async () => ({ ok: true, value: [cachedTeam] })
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.teams, [cachedTeam]);
});

test("guarded upload never constructs or sends a request body when fresh validation fails", async () => {
  let uploads = 0;
  const result = await runFreshGuardedUpload(
    async () => ({ ok: false, reason: "membership_revoked", message: "revoked" }),
    async () => {
      uploads += 1;
      return "uploaded";
    }
  );

  assert.equal(result.ok, false);
  assert.equal(uploads, 0);
});
