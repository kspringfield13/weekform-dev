import assert from "node:assert/strict";
import test from "node:test";

import {
  getSingleManagerTeamPath,
  getTeamWorkspacePath,
  managerAccessMemberships,
} from "./managerAccess";

const memberships = [
  { teamId: "member-team", teamName: "Member team", role: "member" as const, joinedAt: "2026-07-01" },
  { teamId: "managed-team", teamName: "Managed team", role: "manager" as const, joinedAt: "2026-07-02" },
  { teamId: "owned-team", teamName: "Owned team", role: "owner" as const, joinedAt: "2026-07-03" },
];

test("web Manager Access includes only teams the signed-in user manages", () => {
  assert.deepEqual(
    managerAccessMemberships(memberships).map(({ teamId }) => teamId),
    ["managed-team", "owned-team"],
  );
});

test("web Manager Access opens a sole managed team directly", () => {
  assert.equal(getSingleManagerTeamPath(memberships.slice(1, 2)), "/teams/managed-team");
  assert.equal(getSingleManagerTeamPath(memberships), null);
  assert.equal(getSingleManagerTeamPath(memberships.slice(0, 1)), null);
});

test("Team navigation is available to every active team member", () => {
  assert.equal(getTeamWorkspacePath([]), null);
  assert.equal(
    getTeamWorkspacePath(memberships.slice(0, 1)),
    "/teams/member-team",
  );
  assert.equal(
    getTeamWorkspacePath(memberships.slice(1, 2)),
    "/teams/managed-team",
  );
  assert.equal(getTeamWorkspacePath(memberships), "/manager-access");
});
