"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  INVITE_TTL_DAYS,
  buildInviteUrl,
  extractInviteToken,
  generateInviteToken,
  inviteExpiresAt,
  mapAcceptInviteError,
  normalizeInviteEmail,
  sha256Hex,
} from "@/lib/invites";
import {
  INITIAL_INVITE_STATE,
  type InviteActionState,
} from "./inviteState";
import { buildTeamSharePolicyRecord } from "@/lib/teamPolicy";
import { resolveTeamInviteOrigin } from "@/lib/teamInviteOrigin";

const NOT_CONFIGURED =
  "This deployment has no Supabase project configured yet, so teams are unavailable. See apps/web/README.md.";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodeMessage(message: string): string {
  return encodeURIComponent(message);
}

/** Pinned public, preview, or explicit development origin for invite links. */
async function requestOrigin(): Promise<string> {
  return resolveTeamInviteOrigin(await headers(), {
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
  });
}

/**
 * Create a team via the create_team_with_owner RPC. The RPC inserts the
 * team and the caller's owner membership in one transaction; direct table
 * inserts are denied by RLS for everyone.
 */
export async function createTeam(formData: FormData): Promise<void> {
  const supabase = await createClient();
  if (!supabase) {
    redirect(`/app?team_error=${encodeMessage(NOT_CONFIGURED)}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/app");
  }

  const name = String(formData.get("team_name") ?? "").trim();
  if (name.length < 1 || name.length > 120) {
    redirect(
      `/app?team_error=${encodeMessage(
        "Give your team a name between 1 and 120 characters.",
      )}`,
    );
  }

  const { data: teamId, error } = await supabase.rpc("create_team_with_owner", {
    team_name: name,
  });

  if (error || typeof teamId !== "string") {
    redirect(
      `/app?team_error=${encodeMessage(
        error?.message?.includes("Team name")
          ? "Give your team a name between 1 and 120 characters."
          : "The team could not be created. Try again in a moment.",
      )}`,
    );
  }

  revalidatePath("/app");
  redirect(`/teams/${teamId}?notice=${encodeMessage(`Team “${name}” created. You are the owner.`)}`);
}

/**
 * Mint a member-role invite for an email address.
 *
 * The raw token is generated server-side, returned once in the action state
 * (never placed in a URL we control, never logged, never persisted), and only
 * its SHA-256 hex hash is inserted into team_invites. The insert runs under
 * the signed-in user's session, so RLS enforces that only owners/managers of
 * the team can create invites — no service key is involved.
 */
export async function createInvite(
  _previous: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  const supabase = await createClient();
  if (!supabase) {
    return { ...INITIAL_INVITE_STATE, status: "error", message: NOT_CONFIGURED };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ...INITIAL_INVITE_STATE,
      status: "error",
      message: "Your session has expired. Sign in again to send invites.",
    };
  }

  const teamId = String(formData.get("team_id") ?? "");
  if (!UUID_PATTERN.test(teamId)) {
    return {
      ...INITIAL_INVITE_STATE,
      status: "error",
      message: "This invite form is missing its team. Reload the page.",
    };
  }

  const email = normalizeInviteEmail(String(formData.get("email") ?? ""));
  if (!email) {
    return {
      ...INITIAL_INVITE_STATE,
      status: "error",
      message: "Enter a valid email address for your teammate.",
    };
  }

  const token = generateInviteToken();
  const { error } = await supabase.from("team_invites").insert({
    team_id: teamId,
    email,
    role: "member",
    token_hash: sha256Hex(token),
    invited_by: user.id,
    expires_at: inviteExpiresAt(new Date()),
  });

  if (error) {
    const denied =
      error.code === "42501" ||
      error.message.toLowerCase().includes("row-level security");
    return {
      ...INITIAL_INVITE_STATE,
      status: "error",
      message: denied
        ? "Only team owners and managers can create invites for this team."
        : "The invite could not be created. Try again in a moment.",
    };
  }

  revalidatePath(`/teams/${teamId}`);
  return {
    status: "success",
    message: null,
    inviteUrl: buildInviteUrl(await requestOrigin(), token),
    email,
  };
}

/**
 * Leave a team via the leave_team RPC (marks the caller's own membership
 * "removed"; owners are refused in SQL until ownership is transferred).
 * Runs under the caller's session — nobody can remove anyone else here.
 */
export async function leaveTeam(formData: FormData): Promise<void> {
  const supabase = await createClient();
  if (!supabase) {
    redirect(`/app?team_error=${encodeMessage(NOT_CONFIGURED)}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/app");
  }

  const teamId = String(formData.get("team_id") ?? "");
  if (!UUID_PATTERN.test(teamId)) {
    redirect(
      `/app?team_error=${encodeMessage(
        "This leave form is missing its team. Reload the page.",
      )}`,
    );
  }

  const { error } = await supabase.rpc("leave_team", {
    target_team_id: teamId,
  });

  if (error) {
    const message = error.message.includes("owner cannot leave")
      ? "As the team owner you can't leave without transferring ownership first."
      : error.message.includes("membership not found")
        ? "You're not an active member of that team anymore."
        : "Leaving the team didn't work. Try again in a moment.";
    redirect(`/app?team_error=${encodeMessage(message)}`);
  }

  revalidatePath("/", "layout");
  redirect(
    `/app?notice=${encodeMessage(
      "You left the team. Snapshots you shared earlier still exist; use “Delete my cloud history” to remove them.",
    )}`,
  );
}

/**
 * Set or clear the team's share policy (A6). The UPDATE runs under the
 * caller's session, so RLS (teams_update_managers) is what decides whether
 * they may write it — no role check is trusted client-side. The stored value
 * is built exclusively by `buildTeamSharePolicyRecord` from a whitelisted
 * level name; free-form input never reaches the column. The policy is a
 * narrowing-only cap: members' desktop clients apply it as
 * consent ∩ policy, so this action can never widen what anyone shares.
 */
export async function updateTeamSharePolicy(formData: FormData): Promise<void> {
  const supabase = await createClient();
  if (!supabase) {
    redirect(`/app?team_error=${encodeMessage(NOT_CONFIGURED)}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/app");
  }

  const teamId = String(formData.get("team_id") ?? "");
  if (!UUID_PATTERN.test(teamId)) {
    redirect(
      `/app?team_error=${encodeMessage(
        "This policy form is missing its team. Reload the page.",
      )}`,
    );
  }

  const rawLevel = String(formData.get("share_policy_level") ?? "");
  const clearing = rawLevel === "none";
  const record = clearing ? null : buildTeamSharePolicyRecord(rawLevel);
  if (!clearing && record === null) {
    redirect(
      `/teams/${teamId}?notice=${encodeMessage(
        "That share policy level is not recognized, so nothing was changed.",
      )}`,
    );
  }

  // `.select("id")` makes an RLS-filtered no-op UPDATE detectable: a
  // non-manager's update matches zero rows without raising an error, and
  // claiming success over that would be dishonest.
  const { data, error } = await supabase
    .from("teams")
    .update({ share_policy: record })
    .eq("id", teamId)
    .select("id");

  if (error || (data ?? []).length === 0) {
    const denied =
      !error ||
      error.code === "42501" ||
      error.message.toLowerCase().includes("row-level security");
    redirect(
      `/teams/${teamId}?notice=${encodeMessage(
        denied
          ? "Only team owners and managers can change the team share policy."
          : "The share policy could not be saved. Try again in a moment.",
      )}`,
    );
  }

  revalidatePath(`/teams/${teamId}`);
  redirect(
    `/teams/${teamId}?notice=${encodeMessage(
      clearing
        ? "Team share policy cleared. Each member's own sharing choices apply unchanged."
        : "Team share policy saved. It caps future syncs from members' devices; it never adds anything a member didn't consent to.",
    )}`,
  );
}

/**
 * Delete every workload snapshot the signed-in user ever shared with one
 * team. The DELETE runs under the caller's session and is scoped by
 * user_id + team_id; RLS (snapshots_delete_self) independently guarantees
 * only the caller's own rows can go — managers cannot delete member history.
 */
export async function deleteCloudHistory(formData: FormData): Promise<void> {
  const supabase = await createClient();
  if (!supabase) {
    redirect(`/app?team_error=${encodeMessage(NOT_CONFIGURED)}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/app");
  }

  const teamId = String(formData.get("team_id") ?? "");
  if (!UUID_PATTERN.test(teamId)) {
    redirect(
      `/app?team_error=${encodeMessage(
        "This delete form is missing its team. Reload the page.",
      )}`,
    );
  }

  const { error } = await supabase
    .from("workload_snapshots")
    .delete()
    .eq("user_id", user.id)
    .eq("team_id", teamId);

  if (error) {
    redirect(
      `/app?team_error=${encodeMessage(
        "Your cloud history could not be deleted. Try again in a moment.",
      )}`,
    );
  }

  revalidatePath("/", "layout");
  redirect(
    `/app?notice=${encodeMessage(
      "Your shared snapshots for that team were deleted from the cloud. Local data on your Mac is untouched.",
    )}`,
  );
}

/**
 * Sign the current user out and return to the sign-in page with the invite
 * as the return path. Needed for the "this invite is for a different email"
 * case: middleware bounces already-signed-in users away from /login, so
 * switching accounts must go through an explicit sign-out first.
 */
export async function switchAccountForInvite(formData: FormData): Promise<void> {
  const token = extractInviteToken(String(formData.get("token") ?? ""));
  const supabase = await createClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  revalidatePath("/", "layout");
  const returnPath = token
    ? `/invite?token=${encodeURIComponent(token)}`
    : "/invite";
  redirect(`/login?next=${encodeURIComponent(returnPath)}`);
}

/**
 * Accept an invite via the accept_team_invite RPC (atomic, one-time,
 * email- and expiry-checked in SQL). Failures redirect back to /invite with
 * a mapped human message; the token stays only where it already lives — in
 * the invite URL itself.
 */
export async function acceptInvite(formData: FormData): Promise<void> {
  const raw = String(formData.get("token") ?? "");
  const token = extractInviteToken(raw);

  if (!token) {
    redirect(
      `/invite?error=${encodeMessage(
        "That invite link is missing its token. Paste the full link exactly as it was shared with you.",
      )}`,
    );
  }

  const supabase = await createClient();
  if (!supabase) {
    redirect(`/invite?error=${encodeMessage(NOT_CONFIGURED)}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/invite?token=${encodeURIComponent(token)}`)}`);
  }

  const { data: teamId, error } = await supabase.rpc("accept_team_invite", {
    raw_token: token,
  });

  if (error || typeof teamId !== "string") {
    redirect(
      `/invite?token=${encodeURIComponent(token)}&error=${encodeMessage(
        mapAcceptInviteError(error?.message),
      )}`,
    );
  }

  revalidatePath("/", "layout");
  redirect(
    `/teams/${teamId}?notice=${encodeMessage(
      "Invitation accepted — welcome to the team.",
    )}`,
  );
}
