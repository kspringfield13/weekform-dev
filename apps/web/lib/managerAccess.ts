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
