import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Team data reads for the signed-in user. Everything here runs through the
 * user's cookie session — RLS decides row visibility (see
 * docs/hackathon/TEAM_CLAWFATHER_RLS_MATRIX.md). No service key exists.
 *
 * All queries name explicit columns; never SELECT *.
 */

export type TeamRole = "owner" | "manager" | "member";

export interface TeamMembershipSummary {
  teamId: string;
  teamName: string;
  role: TeamRole;
  joinedAt: string;
}

export interface TeamRosterEntry {
  userId: string;
  role: TeamRole;
  joinedAt: string;
  displayName: string | null;
  email: string | null;
  isSelf: boolean;
}

export interface TeamInviteSummary {
  id: string;
  email: string;
  role: TeamRole;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

export function isManagerRole(role: TeamRole): boolean {
  return role === "owner" || role === "manager";
}

function asTeamRole(value: unknown): TeamRole {
  return value === "owner" || value === "manager" ? value : "member";
}

interface MembershipRow {
  team_id: string;
  role: string;
  joined_at: string;
  teams: { id: string; name: string } | { id: string; name: string }[] | null;
}

/**
 * The signed-in user's active teams and role in each. The explicit
 * user_id filter keeps manager accounts from also pulling roster rows
 * (the SELECT policy grants managers their whole team's rows).
 */
export async function listUserTeams(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ teams: TeamMembershipSummary[]; error: string | null }> {
  const { data, error } = await supabase
    .from("team_memberships")
    .select("team_id, role, joined_at, teams(id, name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("joined_at", { ascending: true });

  if (error) {
    return { teams: [], error: error.message };
  }

  const teams: TeamMembershipSummary[] = [];
  for (const row of (data ?? []) as MembershipRow[]) {
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
    if (!team) {
      continue; // team row not visible; skip rather than render a hole
    }
    teams.push({
      teamId: row.team_id,
      teamName: team.name,
      role: asTeamRole(row.role),
      joinedAt: row.joined_at,
    });
  }
  return { teams, error: null };
}

/**
 * The caller's own active membership in one team (plus the team name).
 * Returns null when the caller has no active membership there — which is
 * also what an outsider probing a random team id sees (RLS returns 0 rows).
 */
export async function getOwnMembership(
  supabase: SupabaseClient,
  teamId: string,
  userId: string,
): Promise<{ teamName: string; role: TeamRole } | null> {
  const { data, error } = await supabase
    .from("team_memberships")
    .select("role, teams(id, name)")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  const teamRel = (data as unknown as MembershipRow).teams;
  const team = Array.isArray(teamRel) ? teamRel[0] : teamRel;
  if (!team) {
    return null;
  }
  return { teamName: team.name, role: asTeamRole(data.role) };
}

/**
 * Active roster of a team, with manager-authorized account identities.
 * RLS returns the membership rows only to owners/managers. Email addresses
 * remain in auth.users and cross that boundary only through the manager-only
 * get_team_roster_identities RPC; they are not copied into a public table.
 */
export async function listTeamRoster(
  supabase: SupabaseClient,
  teamId: string,
  viewerId: string,
): Promise<{ roster: TeamRosterEntry[]; error: string | null }> {
  const { data: memberships, error } = await supabase
    .from("team_memberships")
    .select("user_id, role, joined_at")
    .eq("team_id", teamId)
    .eq("status", "active")
    .order("joined_at", { ascending: true });

  if (error) {
    return { roster: [], error: error.message };
  }

  const rows = memberships ?? [];
  const userIds = rows.map((row) => row.user_id as string);
  const identities = new Map<
    string,
    { displayName: string | null; email: string | null }
  >();

  if (userIds.length > 0) {
    const { data: identityRows, error: identityError } = await supabase.rpc(
      "get_team_roster_identities",
      { target_team_id: teamId },
    );
    if (identityError) {
      return { roster: [], error: identityError.message };
    }
    for (const identity of identityRows ?? []) {
      const name =
        typeof identity.display_name === "string"
          ? identity.display_name.trim()
          : "";
      const email =
        typeof identity.email === "string" ? identity.email.trim() : "";
      identities.set(identity.user_id as string, {
        displayName: name || null,
        email: email || null,
      });
    }
  }

  const roster: TeamRosterEntry[] = rows.map((row) => {
    const userId = row.user_id as string;
    const identity = identities.get(userId);
    return {
      userId,
      role: asTeamRole(row.role),
      joinedAt: row.joined_at as string,
      displayName: identity?.displayName ?? null,
      email: identity?.email ?? null,
      isSelf: userId === viewerId,
    };
  });
  return { roster, error: null };
}

/**
 * The team's share policy (A6), readable by every active member via
 * teams_select_members. Returns the raw jsonb value for the pure parser in
 * `lib/teamPolicy.ts`; `error` distinguishes "could not load" from "no
 * policy set" so the UI never renders an honest-looking default over a
 * failed read.
 */
export async function getTeamSharePolicyValue(
  supabase: SupabaseClient,
  teamId: string,
): Promise<{ value: unknown; error: string | null }> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, share_policy")
    .eq("id", teamId)
    .maybeSingle();

  if (error) {
    return { value: null, error: error.message };
  }
  return { value: data?.share_policy ?? null, error: null };
}

/**
 * Invites for a team, newest first. RLS restricts this to owners/managers.
 * The stored row only ever contains the token hash — there is nothing
 * secret to display here beyond the invitee email.
 */
export async function listTeamInvites(
  supabase: SupabaseClient,
  teamId: string,
): Promise<{ invites: TeamInviteSummary[]; error: string | null }> {
  const { data, error } = await supabase
    .from("team_invites")
    .select("id, email, role, created_at, expires_at, accepted_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });

  if (error) {
    return { invites: [], error: error.message };
  }

  const invites: TeamInviteSummary[] = (data ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string,
    role: asTeamRole(row.role),
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    acceptedAt: (row.accepted_at as string | null) ?? null,
  }));
  return { invites, error: null };
}
