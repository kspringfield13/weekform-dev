"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createTeamAction,
  isActionRiskFlagKey,
  updateTeamActionStatus as persistTeamActionStatus,
  type ActionRiskFlagKey,
} from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { getOwnMembership, isManagerRole } from "@/lib/teams";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actionUrl(teamId: string, kind: "notice" | "action_error", message: string) {
  return `/teams/${teamId}?${kind}=${encodeURIComponent(message)}`;
}

async function requireManager(teamId: string) {
  if (!UUID_PATTERN.test(teamId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const membership = await getOwnMembership(supabase, teamId, user.id);
  if (!membership || !isManagerRole(membership.role)) return null;
  return { supabase, user, membership };
}

/**
 * The route's hidden team id is routing context only. The manager membership
 * is re-established on the server before the role-gated wrapper and RLS see
 * the write. The persisted payload is limited to text plus one allowlisted
 * briefing risk key.
 */
export async function createManagerAction(formData: FormData): Promise<void> {
  const teamId = String(formData.get("team_id") ?? "");
  const context = await requireManager(teamId);
  if (!context) {
    redirect("/app?team_error=You%20do%20not%20have%20permission%20to%20manage%20that%20team.");
  }

  const text = String(formData.get("action_text") ?? "").trim();
  const riskInput = String(formData.get("risk_flag_key") ?? "");
  if (riskInput && !isActionRiskFlagKey(riskInput)) {
    redirect(actionUrl(teamId, "action_error", "Choose a recognized briefing risk signal."));
  }
  const riskFlagKey: ActionRiskFlagKey | null = riskInput
    ? (riskInput as ActionRiskFlagKey)
    : null;

  const result = await createTeamAction(context.supabase, context.membership.role, {
    teamId,
    text,
    riskFlagKey,
  });
  if (result.error) {
    redirect(
      actionUrl(
        teamId,
        "action_error",
        "The action could not be logged. Try again in a moment.",
      ),
    );
  }
  revalidatePath(`/teams/${teamId}`);
  redirect(actionUrl(teamId, "notice", "Action logged."));
}

export async function updateManagerActionStatus(formData: FormData): Promise<void> {
  const teamId = String(formData.get("team_id") ?? "");
  const context = await requireManager(teamId);
  if (!context) {
    redirect("/app?team_error=You%20do%20not%20have%20permission%20to%20manage%20that%20team.");
  }

  const actionId = String(formData.get("action_id") ?? "");
  const rawStatus = String(formData.get("status") ?? "");
  if (!UUID_PATTERN.test(actionId) || (rawStatus !== "done" && rawStatus !== "dropped")) {
    redirect(actionUrl(teamId, "action_error", "That action update was not recognized."));
  }

  const result = await persistTeamActionStatus(
    context.supabase,
    context.membership.role,
    teamId,
    actionId,
    rawStatus,
  );
  if (result.error) {
    redirect(
      actionUrl(
        teamId,
        "action_error",
        "The action could not be updated. Try again in a moment.",
      ),
    );
  }
  revalidatePath(`/teams/${teamId}`);
  redirect(
    actionUrl(
      teamId,
      "notice",
      rawStatus === "done" ? "Action resolved." : "Action dropped.",
    ),
  );
}
