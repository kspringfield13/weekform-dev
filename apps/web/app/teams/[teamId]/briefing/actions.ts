"use server";

import { createClient } from "@/lib/supabase/server";
import { getOwnMembership, isManagerRole, listTeamRoster } from "@/lib/teams";
import { listLatestTeamSnapshots } from "@/lib/snapshots";
import { classifyFreshness, freshnessLabel, summarizeTeamWorkload } from "@/lib/workload";
import { buildBriefingInput, generateTeamBriefing } from "@/lib/briefing";
import { INITIAL_BRIEFING_STATE, type BriefingActionState } from "./briefingState";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_CONFIGURED =
  "This deployment has no Supabase project configured, so team briefings are unavailable.";

/**
 * Generates a Team Briefing for one team.
 *
 * Authorization: requires an active session AND an active owner/manager
 * membership on `teamId`, checked the same way as the team page itself
 * (getOwnMembership + isManagerRole). A plain member or an outsider gets
 * the same "no access" message a probing request would get elsewhere in
 * this app — RLS backs every read this pulls from.
 *
 * Everything sent to the model is built by lib/briefing.ts from
 * roster/snapshot data that already passed through RLS; no raw activity,
 * evidence, or credentials are constructed here.
 */
export async function generateBriefingAction(
  _previous: BriefingActionState,
  formData: FormData,
): Promise<BriefingActionState> {
  const supabase = await createClient();
  if (!supabase) {
    return { ...INITIAL_BRIEFING_STATE, status: "error", message: NOT_CONFIGURED };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ...INITIAL_BRIEFING_STATE,
      status: "error",
      message: "Your session has expired. Sign in again to generate a briefing.",
    };
  }

  const teamId = String(formData.get("team_id") ?? "");
  if (!UUID_PATTERN.test(teamId)) {
    return {
      ...INITIAL_BRIEFING_STATE,
      status: "error",
      message: "This briefing form is missing its team. Reload the page.",
    };
  }

  const membership = await getOwnMembership(supabase, teamId, user.id);
  if (!membership || !isManagerRole(membership.role)) {
    // Same message whether the team doesn't exist, the caller isn't a
    // member, or the caller is a plain member — never confirm which.
    return {
      ...INITIAL_BRIEFING_STATE,
      status: "error",
      message: "Only team owners and managers can generate a Team Briefing.",
    };
  }

  const [{ roster, error: rosterError }, { snapshots, error: snapshotsError }] =
    await Promise.all([
      listTeamRoster(supabase, teamId, user.id),
      listLatestTeamSnapshots(supabase, teamId),
    ]);

  if (rosterError || snapshotsError) {
    return {
      ...INITIAL_BRIEFING_STATE,
      status: "error",
      message: "Team data could not be loaded right now. Try again in a moment.",
    };
  }

  const nowIso = new Date().toISOString();
  const aggregates = summarizeTeamWorkload(roster.length, snapshots, nowIso);
  const snapshotsByUser = new Map(
    snapshots.map((snapshot) => [
      snapshot.userId,
      { ...snapshot, freshnessLabelText: freshnessLabel(classifyFreshness(snapshot.observedAt, nowIso)) },
    ]),
  );

  const input = buildBriefingInput({
    teamName: membership.teamName,
    nowIso,
    memberCount: roster.length,
    roster: roster.map((entry) => ({ userId: entry.userId, displayName: entry.displayName })),
    snapshotsByUser,
    aggregates,
  });

  const response = await generateTeamBriefing(input);

  return {
    status: "success",
    message: null,
    result: response.result,
    mode: response.mode,
    fallbackReason: response.fallbackReason ?? null,
    model: response.model ?? null,
    generatedAt: nowIso,
  };
}
