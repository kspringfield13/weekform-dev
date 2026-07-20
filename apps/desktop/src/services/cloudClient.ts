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

/** Email/password sign-in with the SAME account created on weekform.com. */
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

/** Register or refresh this signed-in Mac device. Server derives user_id from auth.uid(). */
export async function registerWeekformDevice(
  env: CloudEnv,
  session: PersistedCloudSession,
  deviceId: string,
  deviceName: string,
): Promise<CloudResult<null>> {
  try {
    const response = await fetch(`${env.url}/rest/v1/rpc/register_weekform_device`, {
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

function parseReviewCommand(value: unknown): ReviewCommandV1 | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.command_id !== "string" || typeof row.block_id !== "string"
    || typeof row.week_id !== "string" || typeof row.expected_revision !== "string"
    || (row.action !== "confirm" && row.action !== "exclude" && row.action !== "relabel")
    || row.status !== "pending" || typeof row.created_at !== "string"
  ) return null;
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
  };
}

export async function fetchPendingReviewCommands(
  env: CloudEnv,
  session: PersistedCloudSession,
): Promise<CloudResult<ReviewCommandV1[]>> {
  const query = "select=command_id,block_id,week_id,expected_revision,action,patch,status,created_at"
    + "&status=eq.pending&order=created_at.asc&limit=50";
  try {
    const response = await fetch(`${env.url}/rest/v1/review_commands?${query}`, {
      headers: authHeaders(env, session.accessToken),
    });
    if (!response.ok) return { ok: false, message: await failureMessage(response, "Could not load Web review requests"), status: response.status };
    const rows: unknown = await response.json();
    return { ok: true, value: (Array.isArray(rows) ? rows : []).map(parseReviewCommand).filter((value): value is ReviewCommandV1 => value !== null) };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}

export async function completeReviewCommand(
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
    if (!response.ok) return { ok: false, message: await failureMessage(response, "Could not acknowledge the Web review request"), status: response.status };
    return { ok: true, value: (await response.json()) === true };
  } catch {
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
}
