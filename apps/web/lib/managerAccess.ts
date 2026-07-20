import type { TeamMembershipSummary } from "./teams";
import { isManagerRole } from "./teams";

export function managerAccessMemberships(
  memberships: TeamMembershipSummary[],
): TeamMembershipSummary[] {
  return memberships.filter(({ role }) => isManagerRole(role));
}

export function getSingleManagerTeamPath(
  memberships: TeamMembershipSummary[],
): string | null {
  const managed = managerAccessMemberships(memberships);
  return managed.length === 1
    ? `/teams/${encodeURIComponent(managed[0]!.teamId)}`
    : null;
}

/**
 * Route every active team member into their Team workspace. A sole
 * membership can open directly; multiple memberships use the role-aware
 * selector retained at the legacy /manager-access URL for compatibility.
 */
export function getTeamWorkspacePath(
  memberships: TeamMembershipSummary[],
): string | null {
  if (memberships.length === 0) return null;
  return memberships.length === 1
    ? `/teams/${encodeURIComponent(memberships[0]!.teamId)}`
    : "/manager-access";
}
