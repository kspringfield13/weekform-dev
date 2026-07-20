"use server";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { getOwnMembership, isManagerRole, listTeamRoster } from "@/lib/teams";
import { listLatestTeamSnapshots } from "@/lib/snapshots";
import { classifyFreshness, freshnessLabel, summarizeTeamWorkload } from "@/lib/workload";
import { buildBriefingInput, generateTeamBriefing, getBriefingModelConfig } from "@/lib/briefing";
import {
  AI_RESERVED_TOKEN_UNITS,
  acquireAiRequestControl,
  completeAiRequestControl,
  deriveRequestIdempotencyKey,
  keyRequestIpSubject,
  requestControlFailure,
  resolveServerRequestControlEnvironment,
  type RequestControlOutcomeCode,
  type RequestControlRpcClient,
} from "@/lib/distributedRequestControl";
import { INITIAL_BRIEFING_STATE, type BriefingActionState } from "./briefingState";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const NOT_CONFIGURED =
  "This deployment has no Supabase project configured, so team briefings are unavailable.";

function outcomeForBriefing(
  response: Awaited<ReturnType<typeof generateTeamBriefing>>,
): RequestControlOutcomeCode {
  if (response.mode === "model") return "ok";
  if (response.fallbackReason === "timeout") return "provider_timeout";
  if (response.fallbackReason === "schema_error") return "validation_error";
  return "provider_error";
}

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
  const requestId = String(formData.get("request_id") ?? "").toLowerCase();
  if (!UUID_PATTERN.test(teamId) || !REQUEST_ID_PATTERN.test(requestId)) {
    return {
      ...INITIAL_BRIEFING_STATE,
      status: "error",
      message: "This briefing form is missing required request details. Reload the page.",
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

  const providerConfigured = getBriefingModelConfig() !== null && input.sharingCount > 0;
  if (!providerConfigured) {
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

  const controls = resolveServerRequestControlEnvironment();
  const requestHeaders = await headers();
  const ipSubjectHash = controls ? keyRequestIpSubject(requestHeaders, controls) : null;
  if (!controls || !ipSubjectHash) {
    return {
      ...INITIAL_BRIEFING_STATE,
      status: "error",
      message: "Distributed request controls are unavailable, so no provider request was sent.",
    };
  }
  const controlClient = supabase as unknown as RequestControlRpcClient;
  const acquired = await acquireAiRequestControl(controlClient, "team_briefing", {
    ipSubjectHash,
    idempotencyKey: deriveRequestIdempotencyKey([
      "team_briefing",
      nowIso.slice(0, 10),
      user.id,
      teamId,
      requestId,
    ]),
    reservedTokenUnits: AI_RESERVED_TOKEN_UNITS.team_briefing,
    serverClaim: controls.serverClaim,
  });
  if (acquired.decision !== "acquired") {
    return {
      ...INITIAL_BRIEFING_STATE,
      status: "error",
      message: requestControlFailure(acquired).message,
    };
  }

  const response = await generateTeamBriefing(input);
  const completed = await completeAiRequestControl(controlClient, {
    receiptId: acquired.receiptId,
    leaseToken: acquired.leaseToken,
    serverClaim: controls.serverClaim,
  }, outcomeForBriefing(response));
  if (!completed) {
    return {
      ...INITIAL_BRIEFING_STATE,
      status: "error",
      message: "The provider response could not be safely finalized. Try again shortly.",
    };
  }

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
