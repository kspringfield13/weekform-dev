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

import type { TeamSharePolicyV1 } from "../../../../packages/domain/src/cloud";
import { parseTeamSharePolicy, type PersistedCloudSession, type WorkloadSnapshotRow } from "./cloudPolicy";

/** Matches `CloudAccountSummary["role"]` (non-null) and the web app's `TeamRole`. */
export type CloudTeamRole = "owner" | "manager" | "member";

export interface CloudEnv {
  url: string;
  anonKey: string;
}

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
