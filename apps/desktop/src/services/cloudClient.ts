// Supabase REST/auth client for the desktop Account & Sharing surface.
//
// Uses only the publishable URL + anon key from Vite env (`VITE_SUPABASE_URL`,
// `VITE_SUPABASE_ANON_KEY`) — the desktop counterpart of `apps/web/lib/supabase/config.ts`
// (`NEXT_PUBLIC_*`). There is NO secret/service key anywhere in this app; every row the
// signed-in user can read or write is decided by Supabase RLS under their own session.
// When the env is absent, `getCloudEnv()` returns null and every cloud feature renders
// an honest "not configured" state — the local-only app is unaffected.
//
// Plain `fetch` on purpose: `@supabase/supabase-js` is not a dependency of the desktop
// app, and the four calls here don't justify adding one.

import { invoke } from "@tauri-apps/api/core";
import type { TeamSharePolicyV1 } from "../../../../packages/domain/src/cloud";
import type {
  PersonalReplicaSyncQueueItemV1,
  PersonalSyncReceiptV1,
  ReviewCommandApplicationPhase,
  ReviewCommandStatus,
  ReviewCommandV1,
} from "../../../../packages/domain/src/personalCloud";
import { parseTeamSharePolicy, type PersistedCloudSession, type WorkloadSnapshotRow } from "./cloudPolicy";

/** Matches `CloudAccountSummary["role"]` (non-null) and the web app's `TeamRole`. */
export type CloudTeamRole = "owner" | "manager" | "member";

export interface CloudEnv {
  url: string;
  anonKey: string;
}

export type CloudOAuthProvider = "google" | "github";

export interface CloudOAuthRequest {
  supabaseUrl: string;
  provider: CloudOAuthProvider;
}

interface CloudOAuthCallback {
  authCode: string;
  codeVerifier: string;
}

export type CloudOAuthTransport = (request: CloudOAuthRequest) => Promise<CloudOAuthCallback>;

/**
 * `status` is the HTTP status of the failed response when one exists (absent for network-level
 * failures, e.g. offline). It exists ONLY so callers can distinguish auth problems (401/403 —
 * not transient, no automatic retry) from transient failures (network/5xx — safe to retry) in
 * `cloudScheduler.ts`. Never surfaced as anything but a plain number.
 */
export type CloudResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; status?: number };

export interface DesktopActionV1 {
  actionId: string;
  action: "start_tracking";
  createdAt: string;
  expiresAt: string;
}

/** Publishable Supabase env, or null when this build has no cloud configured. */
export function getCloudEnv(): CloudEnv | null {
  try {
    const env = import.meta.env as Record<string, string | undefined> | undefined;
    const url = env?.VITE_SUPABASE_URL?.trim().replace(/\/+$/, "");
    const anonKey = env?.VITE_SUPABASE_ANON_KEY?.trim();
    if (!url || !anonKey) return null;
    return { url, anonKey };
  } catch {
    return null;
  }
}

export function isCloudConfigured(): boolean {
  return getCloudEnv() !== null;
}

const NETWORK_ERROR_MESSAGE = "Could not reach the sync service. Check your connection and try again.";

/**
 * Short human-readable failure summary from a Supabase error response. Reads only the
 * known message fields and caps length — never the raw response body (which could echo
 * request content back into local audit/sync state).
 */
async function failureMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const record = body as Record<string, unknown>;
      const candidate = record.error_description ?? record.msg ?? record.message;
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim().slice(0, 200);
      }
    }
  } catch {
    // fall through to the generic message
  }
  return `${fallback} (HTTP ${response.status})`;
}

function authHeaders(env: CloudEnv, accessToken?: string): Record<string, string> {
  return {
    apikey: env.anonKey,
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
  };
}

interface AuthTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  expires_at?: unknown;
  user?: { id?: unknown; email?: unknown; user_metadata?: Record<string, unknown> };
}

function sessionFromTokenResponse(body: AuthTokenResponse, now: number): PersistedCloudSession | null {
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";
  const userId = typeof body.user?.id === "string" ? body.user.id : "";
  const email = typeof body.user?.email === "string" ? body.user.email : "";
  if (!accessToken || !refreshToken || !userId || !email) return null;
  let expiresAt: number | null = null;
  if (typeof body.expires_at === "number" && Number.isFinite(body.expires_at)) {
    expiresAt = body.expires_at * 1000;
  } else if (typeof body.expires_in === "number" && Number.isFinite(body.expires_in)) {
    expiresAt = now + body.expires_in * 1000;
  }
  const displayNameRaw = body.user?.user_metadata?.display_name;
  return {
    accessToken,
    refreshToken,
    expiresAt,
    userId,
    email,
    displayName:
      typeof displayNameRaw === "string" && displayNameRaw.trim().length > 0
        ? displayNameRaw.trim().slice(0, 120)
        : null,
    signedInAt: new Date(now).toISOString()
  };
}

/** Email/password sign-in with the SAME account created on weekform.dev. */
export async function signInWithPassword(
  env: CloudEnv,
  email: string,
  password: string
): Promise<CloudResult<PersistedCloudSession>> {
  try {
    const response = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: authHeaders(env),
      body: JSON.stringify({ email, password })
    });
    if (!response.ok) {
      return { ok: false, message: await failureMessage(response, "Sign-in failed") };
    }
    const session = sessionFromTokenResponse((await response.json()) as AuthTokenResponse, Date.now());
    if (!session) return { ok: false, message: "Sign-in response was incomplete. Try again." };
    return { ok: true, value: session };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

async function invokeCloudOAuth(request: CloudOAuthRequest): Promise<CloudOAuthCallback> {
  return invoke<CloudOAuthCallback>("start_cloud_oauth", { request });
}

/**
 * Completes browser OAuth through a short-lived native loopback callback, then
 * exchanges the PKCE code on the same token-parsing path as password sign-in.
 */
export async function signInWithOAuth(
  env: CloudEnv,
  provider: CloudOAuthProvider,
  transport: CloudOAuthTransport = invokeCloudOAuth
): Promise<CloudResult<PersistedCloudSession>> {
  if (provider !== "google" && provider !== "github") {
    return { ok: false, message: "Choose Google or GitHub to continue." };
  }

  let callback: CloudOAuthCallback;
  try {
    callback = await transport({ supabaseUrl: env.url, provider });
  } catch (error) {
    const message = typeof error === "string"
      ? error.trim()
      : error instanceof Error
        ? error.message.trim()
        : "";
    return {
      ok: false,
      message: message ? message.slice(0, 200) : "Browser sign-in did not finish. Try again."
    };
  }

  try {
    const response = await fetch(`${env.url}/auth/v1/token?grant_type=pkce`, {
      method: "POST",
      headers: authHeaders(env),
      body: JSON.stringify({
        auth_code: callback.authCode,
        code_verifier: callback.codeVerifier
      })
    });
    if (!response.ok) {
      return { ok: false, message: await failureMessage(response, "Browser sign-in failed") };
    }
    const session = sessionFromTokenResponse((await response.json()) as AuthTokenResponse, Date.now());
    if (!session) return { ok: false, message: "Browser sign-in response was incomplete. Try again." };
    return { ok: true, value: session };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

/** Exchange the refresh token for a fresh session before an expiring call. */
export async function refreshSession(
  env: CloudEnv,
  refreshToken: string
): Promise<CloudResult<PersistedCloudSession>> {
  try {
    const response = await fetch(`${env.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: authHeaders(env),
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!response.ok) {
      return { ok: false, message: await failureMessage(response, "Your session expired — sign in again") };
    }
    const session = sessionFromTokenResponse((await response.json()) as AuthTokenResponse, Date.now());
    if (!session) return { ok: false, message: "Your session expired — sign in again." };
    return { ok: true, value: session };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

/** Best-effort server-side sign-out; local state is cleared regardless of the result. */
export async function signOutSession(env: CloudEnv, accessToken: string): Promise<void> {
  try {
    await fetch(`${env.url}/auth/v1/logout`, {
      method: "POST",
      headers: authHeaders(env, accessToken)
    });
  } catch {
    // The local session clear is what stops future syncs.
  }
}

export interface CloudTeamMembership {
  teamId: string;
  teamName: string;
  role: CloudTeamRole;
  /**
   * The team's server-side share policy (narrowing-only cap; A6), or null when the team has
   * none. Parsed defensively — this is server input — and applied as member consent ∩ policy
   * by `applyTeamSharePolicy` before any payload is built.
   */
  sharePolicy: TeamSharePolicyV1 | null;
}

export interface CloudManagerSnapshot {
  weekId: string;
  syncedAt: string;
  shareLevel: "summary" | "categories" | "projects";
  reliableCapacityPct: number | null;
  reactivePct: number | null;
  meetingPct: number | null;
  fragmentedPct: number | null;
  summaryConfidence: number | null;
  reviewedBlocks: number;
  eligibleBlocks: number;
}

export interface CloudManagerMember {
  /** Team-scoped identity: one account may appear in more than one managed team. */
  id: string;
  userId: string;
  teamId: string;
  teamName: string;
  role: CloudTeamRole;
  joinedAt: string;
  displayName: string | null;
  email: string | null;
  isSelf: boolean;
  snapshot: CloudManagerSnapshot | null;
}

export interface CloudManagerWorkspaceData {
  members: CloudManagerMember[];
  latestSyncedAt: string | null;
}

export interface CloudTeamTimelineSnapshot {
  userId: string;
  weekId: string;
  syncedAt: string;
  reliableCapacityPct: number | null;
  reactivePct: number | null;
  meetingPct: number | null;
  fragmentedPct: number | null;
  reviewedBlocks: number;
  eligibleBlocks: number;
}

function asTeamRole(value: unknown): CloudTeamRole {
  return value === "owner" || value === "manager" ? value : "member";
}

/** The signed-in user's active team memberships (RLS-scoped; explicit columns only). */
export async function fetchTeamMemberships(
  env: CloudEnv,
  session: PersistedCloudSession
): Promise<CloudResult<CloudTeamMembership[]>> {
  const query =
    "select=team_id,role,teams(id,name,share_policy)" +
    `&user_id=eq.${encodeURIComponent(session.userId)}` +
    "&status=eq.active&order=joined_at.asc";
  try {
    const response = await fetch(`${env.url}/rest/v1/team_memberships?${query}`, {
      headers: authHeaders(env, session.accessToken)
    });
    if (!response.ok) {
      return { ok: false, message: await failureMessage(response, "Could not load your teams") };
    }
    const rows: unknown = await response.json();
    const teams: CloudTeamMembership[] = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      if (typeof row !== "object" || row === null) continue;
      const record = row as Record<string, unknown>;
      const teamId = typeof record.team_id === "string" ? record.team_id : "";
      const teamRaw = Array.isArray(record.teams) ? record.teams[0] : record.teams;
      const teamName =
        typeof teamRaw === "object" && teamRaw !== null && typeof (teamRaw as Record<string, unknown>).name === "string"
          ? ((teamRaw as Record<string, unknown>).name as string)
          : "";
      if (!teamId || !teamName) continue; // team row not visible; skip rather than render a hole
      teams.push({
        teamId,
        teamName,
        role: asTeamRole(record.role),
        // Server input: parsed defensively; malformed content degrades toward narrower sharing.
        sharePolicy: parseTeamSharePolicy((teamRaw as Record<string, unknown>).share_policy)
      });
    }
    return { ok: true, value: teams };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function managerMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function managerShareLevel(value: unknown): CloudManagerSnapshot["shareLevel"] {
  return value === "categories" || value === "projects" ? value : "summary";
}

function managerCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

async function fetchManagerTeam(
  env: CloudEnv,
  session: PersistedCloudSession,
  team: CloudTeamMembership,
): Promise<CloudResult<CloudManagerMember[]>> {
  const teamFilter = encodeURIComponent(team.teamId);
  const membershipQuery =
    "select=user_id,role,joined_at" +
    `&team_id=eq.${teamFilter}&status=eq.active&order=joined_at.asc`;
  const snapshotQuery =
    "select=user_id,team_id,week_id,synced_at,share_level," +
    "reliable_new_work_capacity_pct,reactive_pct,meeting_pct,fragmented_work_pct," +
    "summary_confidence,reviewed_blocks,eligible_blocks" +
    `&team_id=eq.${teamFilter}&order=synced_at.desc`;

  try {
    const membershipResponse = await fetch(
      `${env.url}/rest/v1/team_memberships?${membershipQuery}`,
      { headers: authHeaders(env, session.accessToken) },
    );
    if (!membershipResponse.ok) {
      return { ok: false, message: await failureMessage(membershipResponse, "Could not load the team roster") };
    }
    const rawMemberships: unknown = await membershipResponse.json();
    if (!Array.isArray(rawMemberships)) {
      return { ok: false, message: "The team roster response was incomplete." };
    }

    const memberships = rawMemberships.filter((value): value is Record<string, unknown> => (
      typeof value === "object"
      && value !== null
      && typeof (value as Record<string, unknown>).user_id === "string"
      && UUID_PATTERN.test((value as Record<string, unknown>).user_id as string)
    ));
    const [identitiesResponse, snapshotsResponse] = await Promise.all([
      fetch(`${env.url}/rest/v1/rpc/get_team_roster_identities`, {
        method: "POST",
        headers: authHeaders(env, session.accessToken),
        body: JSON.stringify({ target_team_id: team.teamId }),
      }),
      fetch(`${env.url}/rest/v1/latest_team_snapshots?${snapshotQuery}`, {
        headers: authHeaders(env, session.accessToken),
      }),
    ]);
    if (!identitiesResponse.ok) {
      return { ok: false, message: await failureMessage(identitiesResponse, "Could not load team identities") };
    }
    if (!snapshotsResponse.ok) {
      return { ok: false, message: await failureMessage(snapshotsResponse, "Could not load approved team snapshots") };
    }

    const rawIdentities: unknown = await identitiesResponse.json();
    const rawSnapshots: unknown = await snapshotsResponse.json();
    if (!Array.isArray(rawIdentities) || !Array.isArray(rawSnapshots)) {
      return { ok: false, message: "The approved team data response was incomplete." };
    }

    const identities = new Map<string, { displayName: string | null; email: string | null }>();
    for (const value of rawIdentities) {
      if (typeof value !== "object" || value === null) continue;
      const row = value as Record<string, unknown>;
      const id = typeof row.user_id === "string" ? row.user_id : "";
      const name = typeof row.display_name === "string" ? row.display_name.trim().slice(0, 120) : "";
      const email = typeof row.email === "string" ? row.email.trim().toLocaleLowerCase().slice(0, 320) : "";
      if (id) identities.set(id, { displayName: name || null, email: email || null });
    }

    const snapshots = new Map<string, CloudManagerSnapshot>();
    for (const value of rawSnapshots) {
      if (typeof value !== "object" || value === null) continue;
      const row = value as Record<string, unknown>;
      const userId = typeof row.user_id === "string" ? row.user_id : "";
      const weekId = typeof row.week_id === "string" ? row.week_id : "";
      const syncedAt = typeof row.synced_at === "string" ? row.synced_at : "";
      if (!userId || !weekId || !syncedAt || snapshots.has(userId)) continue;
      snapshots.set(userId, {
        weekId,
        syncedAt,
        shareLevel: managerShareLevel(row.share_level),
        reliableCapacityPct: managerMetric(row.reliable_new_work_capacity_pct),
        reactivePct: managerMetric(row.reactive_pct),
        meetingPct: managerMetric(row.meeting_pct),
        fragmentedPct: managerMetric(row.fragmented_work_pct),
        summaryConfidence: managerMetric(row.summary_confidence),
        reviewedBlocks: managerCount(row.reviewed_blocks),
        eligibleBlocks: managerCount(row.eligible_blocks),
      });
    }

    return {
      ok: true,
      value: memberships.map((row) => {
        const userId = row.user_id as string;
        const isSelf = userId === session.userId;
        const identity = identities.get(userId);
        return {
          id: `${team.teamId}:${userId}`,
          userId,
          teamId: team.teamId,
          teamName: team.teamName,
          role: asTeamRole(row.role),
          joinedAt: typeof row.joined_at === "string" ? row.joined_at : "",
          displayName: isSelf
            ? (session.displayName?.trim() || identity?.displayName || session.email)
            : (identity?.displayName ?? null),
          email: isSelf ? session.email : (identity?.email ?? null),
          isSelf,
          snapshot: snapshots.get(userId) ?? null,
        };
      }),
    };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

/**
 * RLS-scoped production data for Manager Mode. Every managed team is loaded as
 * one fail-closed unit: Weekform never presents a partial roster as complete.
 * The signed-in manager remains in the roster and can have their own approved
 * snapshot, exactly like every other active team member.
 */
export async function fetchManagerTeamWorkspace(
  env: CloudEnv,
  session: PersistedCloudSession,
  teams: CloudTeamMembership[],
): Promise<CloudResult<CloudManagerWorkspaceData>> {
  const managedTeams = teams.filter((team) => team.role === "owner" || team.role === "manager");
  const results = await Promise.all(managedTeams.map((team) => fetchManagerTeam(env, session, team)));
  const failed = results.find((result) => !result.ok);
  if (failed && !failed.ok) return failed;

  const members = results.flatMap((result) => result.ok ? result.value : []);
  const latestSyncedAt = members.reduce<string | null>((latest, member) => {
    const syncedAt = member.snapshot?.syncedAt ?? null;
    return syncedAt && (!latest || syncedAt > latest) ? syncedAt : latest;
  }, null);
  return { ok: true, value: { members, latestSyncedAt } };
}

/**
 * Bounded, RLS-scoped weekly history for the Team workload horizon. Plain members receive only
 * their own rows; managers receive the rows their authenticated team role permits. The query is
 * an explicit summary allowlist and never requests allocation JSON or raw evidence.
 */
export async function fetchTeamWorkloadTimeline(
  env: CloudEnv,
  session: PersistedCloudSession,
  teamId: string,
): Promise<CloudResult<CloudTeamTimelineSnapshot[]>> {
  const query =
    "select=user_id,week_id,synced_at,reliable_new_work_capacity_pct,reactive_pct," +
    "meeting_pct,fragmented_work_pct,reviewed_blocks,eligible_blocks" +
    `&team_id=eq.${encodeURIComponent(teamId)}&order=synced_at.desc&limit=650`;
  try {
    const response = await fetch(`${env.url}/rest/v1/workload_snapshots?${query}`, {
      headers: authHeaders(env, session.accessToken),
    });
    if (!response.ok) {
      return { ok: false, message: await failureMessage(response, "Could not load the team workload horizon") };
    }
    const raw: unknown = await response.json();
    if (!Array.isArray(raw)) {
      return { ok: false, message: "The team workload horizon response was incomplete." };
    }
    const points: CloudTeamTimelineSnapshot[] = [];
    for (const value of raw) {
      if (typeof value !== "object" || value === null) continue;
      const row = value as Record<string, unknown>;
      const userId = typeof row.user_id === "string" ? row.user_id : "";
      const weekId = typeof row.week_id === "string" ? row.week_id : "";
      const syncedAt = typeof row.synced_at === "string" ? row.synced_at : "";
      if (!userId || !weekId || !syncedAt) continue;
      points.push({
        userId,
        weekId,
        syncedAt,
        reliableCapacityPct: managerMetric(row.reliable_new_work_capacity_pct),
        reactivePct: managerMetric(row.reactive_pct),
        meetingPct: managerMetric(row.meeting_pct),
        fragmentedPct: managerMetric(row.fragmented_work_pct),
        reviewedBlocks: managerCount(row.reviewed_blocks),
        eligibleBlocks: managerCount(row.eligible_blocks),
      });
    }
    return { ok: true, value: points };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

/**
 * Insert (idempotent upsert on the per-user client_snapshot_id) one shared snapshot
 * row through RLS. The WITH CHECK policy re-validates that `user_id` is the caller
 * and that the caller holds an active membership in `team_id`.
 */
export async function upsertWorkloadSnapshot(
  env: CloudEnv,
  session: PersistedCloudSession,
  row: WorkloadSnapshotRow
): Promise<CloudResult<null>> {
  try {
    const response = await fetch(
      `${env.url}/rest/v1/workload_snapshots?on_conflict=user_id,client_snapshot_id`,
      {
        method: "POST",
        headers: {
          ...authHeaders(env, session.accessToken),
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(row)
      }
    );
    if (!response.ok) {
      return {
        ok: false,
        message: await failureMessage(response, "The sync service rejected the snapshot"),
        status: response.status
      };
    }
    return { ok: true, value: null };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

/** Authenticated/RLS-scoped existence check used to reconcile an unchanged local sync marker. */
export async function workloadSnapshotExists(
  env: CloudEnv,
  session: PersistedCloudSession,
  clientSnapshotId: string
): Promise<CloudResult<boolean>> {
  const query =
    "select=client_snapshot_id" +
    `&user_id=eq.${encodeURIComponent(session.userId)}` +
    `&client_snapshot_id=eq.${encodeURIComponent(clientSnapshotId)}` +
    "&limit=1";
  try {
    const response = await fetch(`${env.url}/rest/v1/workload_snapshots?${query}`, {
      headers: authHeaders(env, session.accessToken)
    });
    if (!response.ok) {
      return {
        ok: false,
        message: await failureMessage(response, "Could not confirm the synced snapshot"),
        status: response.status
      };
    }
    const rows: unknown = await response.json();
    return { ok: true, value: Array.isArray(rows) && rows.length > 0 };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

/**
 * Delete every snapshot row THIS user previously synced to the given team. RLS's
 * delete policy already restricts deletes to the caller's own rows; the explicit
 * user_id filter keeps the intent obvious and the request minimal.
 */
export async function deleteMySnapshotsForTeam(
  env: CloudEnv,
  session: PersistedCloudSession,
  teamId: string
): Promise<CloudResult<number>> {
  const query =
    `team_id=eq.${encodeURIComponent(teamId)}` +
    `&user_id=eq.${encodeURIComponent(session.userId)}`;
  try {
    const response = await fetch(`${env.url}/rest/v1/workload_snapshots?${query}`, {
      method: "DELETE",
      headers: {
        ...authHeaders(env, session.accessToken),
        Prefer: "count=exact"
      }
    });
    if (!response.ok) {
      return { ok: false, message: await failureMessage(response, "Could not delete your snapshots") };
    }
    const contentRange = response.headers.get("content-range") ?? "";
    const match = /\/(\d+)\s*$/.exec(contentRange);
    return { ok: true, value: match ? Number(match[1]) : 0 };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

/** Register or refresh this signed-in Mac and advertise isolated review protocol v2. */
export async function registerWeekformDeviceV2(
  env: CloudEnv,
  session: PersistedCloudSession,
  deviceId: string,
  deviceName: string,
): Promise<CloudResult<null>> {
  try {
    const response = await fetch(`${env.url}/rest/v1/rpc/register_weekform_device_v2`, {
      method: "POST",
      headers: authHeaders(env, session.accessToken),
      body: JSON.stringify({ p_device_id: deviceId, p_device_name: deviceName }),
    });
    if (!response.ok) return { ok: false, message: await failureMessage(response, "Could not register this Mac"), status: response.status };
    return { ok: true, value: null };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

function parseDesktopAction(value: unknown): DesktopActionV1 | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.action_id !== "string" || !UUID_PATTERN.test(row.action_id)
    || row.action !== "start_tracking"
    || typeof row.created_at !== "string"
    || typeof row.expires_at !== "string"
  ) return null;
  const createdAtMs = Date.parse(row.created_at);
  const expiresAtMs = Date.parse(row.expires_at);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= createdAtMs || expiresAtMs - createdAtMs > 120_000) return null;
  return {
    actionId: row.action_id,
    action: "start_tracking",
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export async function fetchPendingDesktopActions(
  env: CloudEnv,
  session: PersistedCloudSession,
  deviceId: string,
): Promise<CloudResult<DesktopActionV1[]>> {
  const query = `select=action_id,action,created_at,expires_at&device_id=eq.${encodeURIComponent(deviceId)}&order=created_at.asc&limit=10`;
  try {
    const response = await fetch(`${env.url}/rest/v1/desktop_actions?${query}`, {
      headers: authHeaders(env, session.accessToken),
    });
    if (!response.ok) return { ok: false, message: await failureMessage(response, "Could not load Desktop actions"), status: response.status };
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return { ok: false, message: "Desktop action response was incomplete." };
    const actions = body.map(parseDesktopAction);
    if (actions.some((action) => action === null)) {
      return { ok: false, message: "Desktop action response was incomplete." };
    }
    return { ok: true, value: actions as DesktopActionV1[] };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

export async function acknowledgeDesktopAction(
  env: CloudEnv,
  session: PersistedCloudSession,
  deviceId: string,
  actionId: string,
): Promise<CloudResult<boolean>> {
  try {
    const response = await fetch(`${env.url}/rest/v1/rpc/acknowledge_desktop_action`, {
      method: "POST",
      headers: authHeaders(env, session.accessToken),
      body: JSON.stringify({ p_device_id: deviceId, p_action_id: actionId }),
    });
    if (!response.ok) return { ok: false, message: await failureMessage(response, "Could not acknowledge Desktop action"), status: response.status };
    const acknowledged: unknown = await response.json();
    return typeof acknowledged === "boolean"
      ? { ok: true, value: acknowledged }
      : { ok: false, message: "Desktop action acknowledgement was incomplete." };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

export async function syncPersonalReplicaBatch(
  env: CloudEnv,
  session: PersistedCloudSession,
  deviceId: string,
  item: PersonalReplicaSyncQueueItemV1,
): Promise<CloudResult<PersonalSyncReceiptV1>> {
  try {
    const response = await fetch(`${env.url}/rest/v1/rpc/sync_personal_replica_batch`, {
      method: "POST",
      headers: authHeaders(env, session.accessToken),
      body: JSON.stringify({
        p_device_id: deviceId,
        p_batch_id: item.batchId,
        p_fingerprint: item.fingerprint,
        p_payload: item.payload,
      }),
    });
    if (!response.ok) return { ok: false, message: await failureMessage(response, "Could not sync your Web workspace"), status: response.status };
    const rows: unknown = await response.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (typeof row !== "object" || row === null) return { ok: false, message: "Sync receipt was incomplete." };
    const record = row as Record<string, unknown>;
    const cursor = typeof record.cursor === "number" ? record.cursor : Number(record.cursor);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || typeof record.synced_at !== "string") {
      return { ok: false, message: "Sync receipt was incomplete." };
    }
    return { ok: true, value: { batchId: item.batchId, cursor, syncedAt: record.synced_at } };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

function parseReviewCommand(value: unknown, protocolVersion: 1 | 2): ReviewCommandV1 | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.command_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.command_id)
    || typeof row.block_id !== "string" || row.block_id.length === 0 || row.block_id.length > 160
    || typeof row.week_id !== "string" || !/^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/.test(row.week_id)
    || typeof row.expected_revision !== "string" || !/^[0-9a-f]{16}$/.test(row.expected_revision)
    || (row.action !== "confirm" && row.action !== "exclude" && row.action !== "relabel")
    || row.status !== "pending" || typeof row.created_at !== "string"
  ) return null;
  const applicationPhase = protocolVersion === 1
    ? null
    : row.application_phase === null
      ? null
      : row.application_phase === "apply_pending" || row.application_phase === "ack_pending"
        ? row.application_phase
        : undefined;
  const claimedByDevice = protocolVersion === 1
    ? null
    : row.claimed_by_device === null
      ? null
      : typeof row.claimed_by_device === "string"
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.claimed_by_device)
        ? row.claimed_by_device
        : undefined;
  const claimedAt = protocolVersion === 1
    ? null
    : row.claimed_at === null
      ? null
      : typeof row.claimed_at === "string" && Number.isFinite(Date.parse(row.claimed_at))
        ? new Date(row.claimed_at).toISOString()
        : undefined;
  const rawClaimOwner = protocolVersion === 1
    ? null
    : Array.isArray(row.claim_owner)
      ? row.claim_owner[0]
      : row.claim_owner;
  const claimOwnerRecord = typeof rawClaimOwner === "object" && rawClaimOwner !== null
    ? rawClaimOwner as Record<string, unknown>
    : null;
  const claimOwnerRevoked = protocolVersion === 1 || applicationPhase === null
    ? null
    : claimOwnerRecord?.revoked_at === null
      ? false
      : typeof claimOwnerRecord?.revoked_at === "string"
        && Number.isFinite(Date.parse(claimOwnerRecord.revoked_at))
        ? true
        : undefined;
  if (applicationPhase === undefined || claimedByDevice === undefined || claimedAt === undefined
    || claimOwnerRevoked === undefined
    || (applicationPhase === null) !== (claimedByDevice === null)
    || (applicationPhase === null) !== (claimedAt === null)) return null;
  const rawPatch = typeof row.patch === "object" && row.patch !== null
    ? row.patch as Record<string, unknown>
    : null;
  const categoryValues = new Set([
    "Planned analysis / project work", "Ad hoc stakeholder requests", "Recurring reporting",
    "Dashboard development / edits", "SQL / data modeling / query work", "QA / data validation",
    "Debugging / issue investigation", "Documentation / requirement clarification",
    "Meetings / stakeholder syncs", "Admin / coordination", "Blocked / waiting / dependency delay",
  ]);
  const modeValues = new Set(["Deep work", "Reactive", "Collaborative", "Fragmented", "Blocked"]);
  const statusValues = new Set(["planned", "unplanned", "fixed", "blocked"]);
  if (row.action === "relabel" && (!rawPatch
    || Object.keys(rawPatch).length === 0
    || Object.keys(rawPatch).some((key) => !["category", "mode", "plannedStatus", "blockerFlag"].includes(key))
    || (rawPatch.category !== undefined && !categoryValues.has(rawPatch.category as string))
    || (rawPatch.mode !== undefined && !modeValues.has(rawPatch.mode as string))
    || (rawPatch.plannedStatus !== undefined && !statusValues.has(rawPatch.plannedStatus as string))
    || (rawPatch.blockerFlag !== undefined && typeof rawPatch.blockerFlag !== "boolean"))) return null;
  const patch = row.action === "relabel" ? rawPatch as ReviewCommandV1["patch"] : null;
  return {
    schemaVersion: 1,
    protocolVersion,
    commandId: row.command_id,
    blockId: row.block_id,
    weekId: row.week_id,
    expectedRevision: row.expected_revision,
    action: row.action,
    patch,
    status: "pending",
    createdAt: row.created_at,
    decidedAt: null,
    decisionReason: null,
    applicationPhase,
    claimedByDevice,
    claimedAt,
    claimOwnerRevoked,
  };
}

export async function fetchPendingReviewCommandsV1(
  env: CloudEnv,
  session: PersistedCloudSession,
): Promise<CloudResult<ReviewCommandV1[]>> {
  const pageSize = 200;
  const select = "command_id,block_id,week_id,expected_revision,action,patch,status,created_at";
  try {
    const commands: ReviewCommandV1[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const query = `select=${select}&status=eq.pending&order=created_at.asc&limit=${pageSize}&offset=${offset}`;
      const response = await fetch(`${env.url}/rest/v1/review_commands?${query}`, {
        headers: authHeaders(env, session.accessToken),
      });
      if (!response.ok) return { ok: false, message: await failureMessage(response, "Could not load legacy Web review requests"), status: response.status };
      const body: unknown = await response.json();
      const rows = Array.isArray(body) ? body : [];
      commands.push(...rows.map((value) => parseReviewCommand(value, 1)).filter((value): value is ReviewCommandV1 => value !== null));
      if (rows.length < pageSize) break;
    }
    return { ok: true, value: commands };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

export async function fetchPendingReviewCommandsV2(
  env: CloudEnv,
  session: PersistedCloudSession,
): Promise<CloudResult<ReviewCommandV1[]>> {
  const pageSize = 200;
  const select = "command_id,block_id,week_id,expected_revision,action,patch,status,created_at,application_phase,claimed_by_device,claimed_at,claim_owner:weekform_devices!review_commands_v2_claimed_device_fkey(revoked_at)";
  try {
    const commands: ReviewCommandV1[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const query = `select=${select}&status=eq.pending&order=created_at.asc&limit=${pageSize}&offset=${offset}`;
      const response = await fetch(`${env.url}/rest/v1/review_commands_v2?${query}`, {
        headers: authHeaders(env, session.accessToken),
      });
      if (!response.ok) return { ok: false, message: await failureMessage(response, "Could not load Web review requests"), status: response.status };
      const body: unknown = await response.json();
      const rows = Array.isArray(body) ? body : [];
      commands.push(...rows.map((value) => parseReviewCommand(value, 2)).filter((value): value is ReviewCommandV1 => value !== null));
      if (rows.length < pageSize) break;
    }
    return { ok: true, value: commands };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

export async function claimReviewCommandV2(
  env: CloudEnv,
  session: PersistedCloudSession,
  deviceId: string,
  commandId: string,
): Promise<CloudResult<ReviewCommandApplicationPhase | Exclude<ReviewCommandStatus, "pending">>> {
  try {
    const response = await fetch(`${env.url}/rest/v1/rpc/claim_review_command_v2`, {
      method: "POST",
      headers: authHeaders(env, session.accessToken),
      body: JSON.stringify({ p_device_id: deviceId, p_command_id: commandId }),
    });
    if (!response.ok) return { ok: false, message: await failureMessage(response, "Could not claim the Web review request"), status: response.status };
    const phase: unknown = await response.json();
    if (phase !== "apply_pending" && phase !== "ack_pending"
      && phase !== "applied" && phase !== "rejected" && phase !== "conflict") {
      return { ok: false, message: "Review request claim receipt was incomplete." };
    }
    return { ok: true, value: phase };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

export async function markReviewCommandAppliedLocallyV2(
  env: CloudEnv,
  session: PersistedCloudSession,
  deviceId: string,
  commandId: string,
): Promise<CloudResult<boolean>> {
  try {
    const response = await fetch(`${env.url}/rest/v1/rpc/mark_review_command_applied_locally_v2`, {
      method: "POST",
      headers: authHeaders(env, session.accessToken),
      body: JSON.stringify({ p_device_id: deviceId, p_command_id: commandId }),
    });
    if (!response.ok) return { ok: false, message: await failureMessage(response, "Could not record the local review application"), status: response.status };
    const applied: unknown = await response.json();
    return typeof applied === "boolean"
      ? { ok: true, value: applied }
      : { ok: false, message: "Review application receipt was incomplete." };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

/** Confirm whether an outbox command still exists after a false lifecycle receipt. */
export async function reviewCommandExistsV2(
  env: CloudEnv,
  session: PersistedCloudSession,
  commandId: string,
): Promise<CloudResult<boolean>> {
  const query = `select=command_id&command_id=eq.${encodeURIComponent(commandId)}&limit=1`;
  try {
    const response = await fetch(`${env.url}/rest/v1/review_commands_v2?${query}`, {
      headers: authHeaders(env, session.accessToken),
    });
    if (!response.ok) return {
      ok: false,
      message: await failureMessage(response, "Could not verify the Web review request"),
      status: response.status,
    };
    const rows: unknown = await response.json();
    return { ok: true, value: Array.isArray(rows) && rows.length > 0 };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

export async function completeReviewCommandV2(
  env: CloudEnv,
  session: PersistedCloudSession,
  deviceId: string,
  commandId: string,
  status: Exclude<ReviewCommandStatus, "pending">,
  reason: string | null,
): Promise<CloudResult<boolean>> {
  try {
    const response = await fetch(`${env.url}/rest/v1/rpc/complete_review_command_v2`, {
      method: "POST",
      headers: authHeaders(env, session.accessToken),
      body: JSON.stringify({
        p_device_id: deviceId,
        p_command_id: commandId,
        p_status: status,
        p_reason: reason,
      }),
    });
    if (!response.ok) return { ok: false, message: await failureMessage(response, "Could not acknowledge the Web review request"), status: response.status };
    return { ok: true, value: (await response.json()) === true };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

/** Released v1 terminal edge used only for immutable legacy queue rows. */
export async function completeReviewCommandV1(
  env: CloudEnv,
  session: PersistedCloudSession,
  deviceId: string,
  commandId: string,
  status: Exclude<ReviewCommandStatus, "pending">,
  reason: string | null,
): Promise<CloudResult<boolean>> {
  try {
    const response = await fetch(`${env.url}/rest/v1/rpc/complete_review_command`, {
      method: "POST",
      headers: authHeaders(env, session.accessToken),
      body: JSON.stringify({
        p_device_id: deviceId,
        p_command_id: commandId,
        p_status: status,
        p_reason: reason,
      }),
    });
    if (!response.ok) return { ok: false, message: await failureMessage(response, "Could not acknowledge the legacy Web review request"), status: response.status };
    return { ok: true, value: (await response.json()) === true };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}
