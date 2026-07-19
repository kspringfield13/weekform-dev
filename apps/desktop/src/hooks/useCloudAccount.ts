// Account & Sharing state: the signed-in Weekform Cloud session, the member's
// CloudSharePolicyV1, sync bookkeeping, and the reserved clientSnapshotId — all
// persisted in local prototype storage (`cloudStore.ts`) and NEVER inside the
// exported JSON backups. Sharing is off by default; nothing here uploads anything
// (uploads live in `useCloudSync`).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AuditEvent } from "../../../../packages/domain/src/models";
import type {
  CloudAccountSummary,
  CloudSharePolicyV1,
  CloudSyncState
} from "../../../../packages/domain/src/cloud";
import {
  buildCloudBackupMetadata,
  createDefaultCloudSharePolicy,
  createEmptyCloudSyncState,
  type CloudBackupMetadata,
  type CloudPendingSnapshot,
  type PersistedCloudSession
} from "../services/cloudPolicy";
import {
  clearPersistedCloudState,
  readPersistedCloudState,
  writePersistedCloudState
} from "../services/cloudStore";
import {
  fetchTeamMemberships,
  getCloudEnv,
  refreshSession,
  signInWithPassword,
  signOutSession,
  type CloudTeamMembership
} from "../services/cloudClient";
import {
  boundaryRequiresConsentReset,
  checkFreshUploadBoundary,
  type FreshUploadBoundaryResult
} from "../services/cloudSyncGuard";
import { createCloudSharingAuditEvent, type CloudSharingAuditAction } from "../lib/audit";

export interface CloudAccountController {
  /** True when this build carries publishable Supabase env; false = cloud UI renders "not configured". */
  configured: boolean;
  isDemoMode: boolean;
  account: CloudAccountSummary | null;
  teams: CloudTeamMembership[];
  teamsError: string | null;
  policy: CloudSharePolicyV1;
  syncState: CloudSyncState;
  pendingSnapshot: CloudPendingSnapshot | null;
  authBusy: boolean;
  authError: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  refreshTeams: () => Promise<void>;
  updatePolicy: (patch: Partial<CloudSharePolicyV1>) => void;
  /** Records "I reviewed what will be shared with this team" with a timestamp. */
  recordConsent: () => void;
  /** For useCloudSync: sync bookkeeping + reserved clientSnapshotId setters. */
  setSyncState: (updater: (current: CloudSyncState) => CloudSyncState) => void;
  setPendingSnapshot: (value: CloudPendingSnapshot | null) => void;
  /** Session for an authenticated call, refreshed when near expiry; null = signed out. */
  getFreshSession: () => Promise<PersistedCloudSession | null>;
  /** Fail-closed recipient/policy refresh immediately before a snapshot upload. */
  checkFreshUpload: (
    session: PersistedCloudSession,
    cachedEffectivePolicy: CloudSharePolicyV1
  ) => Promise<FreshUploadBoundaryResult>;
  emitAudit: (action: CloudSharingAuditAction, summary: string, details?: Record<string, unknown>) => void;
  /** Reset Local Data: clears session, policy, sync state, and reserved ids. */
  clearAll: () => Promise<boolean>;
  /** Export projection for the full backup — policy + sync metadata, never tokens. */
  backupMetadata: () => CloudBackupMetadata;
}

/** Policy fields whose change alters WHAT is shared or WHO receives it → consent resets. */
const CONSENT_SENSITIVE_FIELDS = [
  "teamId",
  "shareLevel",
  "metrics",
  "allowedProjectNames"
] as const;

export function useCloudAccount({
  isDemoMode,
  onAuditEvent
}: {
  isDemoMode: boolean;
  onAuditEvent: (event: AuditEvent) => void;
}): CloudAccountController {
  const configured = useMemo(() => getCloudEnv() !== null, []);
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<PersistedCloudSession | null>(null);
  const [policy, setPolicy] = useState<CloudSharePolicyV1>(() => createDefaultCloudSharePolicy());
  const [syncState, setSyncStateRaw] = useState<CloudSyncState>(() => createEmptyCloudSyncState());
  const [pendingSnapshot, setPendingSnapshot] = useState<CloudPendingSnapshot | null>(null);
  const [teams, setTeams] = useState<CloudTeamMembership[]>([]);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  // Serialize refresh attempts so parallel callers don't burn the one-time refresh token.
  const refreshInFlight = useRef<Promise<PersistedCloudSession | null> | null>(null);

  const emitAudit = useCallback(
    (action: CloudSharingAuditAction, summary: string, details?: Record<string, unknown>) => {
      onAuditEvent(createCloudSharingAuditEvent({ action, summary, details }));
    },
    [onAuditEvent]
  );

  const loadTeams = useCallback(async (activeSession: PersistedCloudSession) => {
    const env = getCloudEnv();
    if (!env) return;
    const result = await fetchTeamMemberships(env, activeSession);
    if (result.ok) {
      setTeams(result.value);
      setTeamsError(null);
    } else {
      setTeamsError(result.message);
    }
  }, []);

  // Hydrate once from local prototype storage. The demo path deliberately skips it,
  // so the demo always starts signed out with cloud sharing disabled.
  useEffect(() => {
    if (isDemoMode || !configured) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    readPersistedCloudState().then((state) => {
      if (cancelled) return;
      if (state) {
        setSession(state.session);
        setPolicy(state.policy);
        setSyncStateRaw(state.syncState);
        setPendingSnapshot(state.pendingSnapshot);
        if (state.session) void loadTeams(state.session);
      }
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isDemoMode, configured, loadTeams]);

  // Persist after hydration; a failed write leaves in-memory state working.
  useEffect(() => {
    if (isDemoMode || !configured || !hydrated) return;
    void writePersistedCloudState({ version: 1, session, policy, syncState, pendingSnapshot });
  }, [isDemoMode, configured, hydrated, session, policy, syncState, pendingSnapshot]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      const env = getCloudEnv();
      if (!env || isDemoMode) return false;
      setAuthBusy(true);
      setAuthError(null);
      try {
        const result = await signInWithPassword(env, email.trim(), password);
        if (!result.ok) {
          setAuthError(result.message);
          return false;
        }
        setSession(result.value);
        emitAudit("connect", `Signed in to Weekform Cloud as ${result.value.email}`, {
          user_id: result.value.userId
        });
        void loadTeams(result.value);
        return true;
      } finally {
        setAuthBusy(false);
      }
    },
    [isDemoMode, emitAudit, loadTeams]
  );

  const signOut = useCallback(async () => {
    const env = getCloudEnv();
    const active = session;
    // Local clear first — disconnect must stop future syncs even offline.
    setSession(null);
    setTeams([]);
    setTeamsError(null);
    setAuthError(null);
    setPolicy((current) => ({
      ...current,
      enabled: false,
      autoSyncEnabled: false,
      consentedAt: null
    }));
    setSyncStateRaw((current) => ({ ...current, status: "idle", nextScheduledAt: null }));
    emitAudit("disconnect", "Signed out of Weekform Cloud; sharing disabled and future syncs stopped");
    const cleared = await clearPersistedCloudState();
    if (!cleared) {
      setAuthError(
        "Signed out for this session, but Weekform could not confirm durable credential removal. Retry Reset Local Data before closing the app."
      );
    }
    if (env && active) await signOutSession(env, active.accessToken);
  }, [session, emitAudit]);

  const refreshTeams = useCallback(async () => {
    if (session) await loadTeams(session);
  }, [session, loadTeams]);

  const updatePolicy = useCallback(
    (patch: Partial<CloudSharePolicyV1>) => {
      setPolicy((current) => {
        const next: CloudSharePolicyV1 = { ...current, ...patch, version: 1, intervalMinutes: 60 };
        // Changing the recipient team or the shared fields invalidates the previous
        // consent — the user must re-review the exact payload before the next sync.
        const consentSensitiveChange = CONSENT_SENSITIVE_FIELDS.some(
          (field) => field in patch && JSON.stringify(next[field]) !== JSON.stringify(current[field])
        );
        if (consentSensitiveChange && patch.consentedAt === undefined) {
          next.consentedAt = null;
        }
        if (JSON.stringify(next) === JSON.stringify(current)) return current;
        const changedFields = (Object.keys(patch) as Array<keyof CloudSharePolicyV1>).filter(
          (field) => JSON.stringify(next[field]) !== JSON.stringify(current[field])
        );
        if (current.enabled && next.enabled === false) {
          emitAudit("pause", "Cloud sharing turned off — nothing further will be uploaded");
        } else if (changedFields.length > 0) {
          emitAudit("policy_change", `Updated ${changedFields.join(", ")}`, {
            changed_fields: changedFields,
            enabled: next.enabled,
            team_id: next.teamId,
            share_level: next.shareLevel,
            shared_metric_count: Object.values(next.metrics).filter(Boolean).length,
            allowed_project_name_count: next.allowedProjectNames.length,
            auto_sync_enabled: next.autoSyncEnabled,
            consent_reset: consentSensitiveChange
          });
        }
        return next;
      });
    },
    [emitAudit]
  );

  const recordConsent = useCallback(() => {
    const consentedAt = new Date().toISOString();
    setPolicy((current) => ({ ...current, consentedAt }));
    emitAudit("policy_change", "Reviewed the exact shared payload and recorded consent", {
      changed_fields: ["consentedAt"],
      consented_at: consentedAt
    });
  }, [emitAudit]);

  const getFreshSession = useCallback(async (): Promise<PersistedCloudSession | null> => {
    const env = getCloudEnv();
    if (!env || !session) return null;
    const nearExpiry =
      typeof session.expiresAt === "number" && session.expiresAt - Date.now() < 60_000;
    if (!nearExpiry) return session;
    if (!refreshInFlight.current) {
      refreshInFlight.current = (async () => {
        const result = await refreshSession(env, session.refreshToken);
        refreshInFlight.current = null;
        if (!result.ok) {
          setSession(null);
          setTeams([]);
          setAuthError(result.message);
          return null;
        }
        const refreshed: PersistedCloudSession = {
          ...result.value,
          signedInAt: session.signedInAt ?? result.value.signedInAt
        };
        setSession(refreshed);
        return refreshed;
      })();
    }
    return refreshInFlight.current;
  }, [session]);

  const checkFreshUpload = useCallback(
    async (
      activeSession: PersistedCloudSession,
      cachedEffectivePolicy: CloudSharePolicyV1
    ): Promise<FreshUploadBoundaryResult> => {
      const env = getCloudEnv();
      if (!env) {
        return {
          ok: false,
          reason: "refresh_failed",
          message: "Cloud sharing is not configured in this build."
        };
      }
      const result = await checkFreshUploadBoundary({
        session: activeSession,
        memberPolicy: policy,
        cachedEffectivePolicy,
        fetchMemberships: (freshSession) => fetchTeamMemberships(env, freshSession)
      });
      if (result.teams) {
        setTeams(result.teams);
      }
      if (boundaryRequiresConsentReset(result)) {
        setPolicy((current) => ({ ...current, consentedAt: null }));
        emitAudit(
          "policy_change",
          "Team sharing policy changed; review the refreshed preview before syncing",
          { changed_fields: ["consentedAt"], consent_reset: true, team_id: policy.teamId }
        );
      }
      setTeamsError(result.ok ? null : result.message);
      return result;
    },
    [emitAudit, policy]
  );

  const clearAll = useCallback(async () => {
    setSession(null);
    setTeams([]);
    setTeamsError(null);
    setAuthError(null);
    setPolicy(createDefaultCloudSharePolicy());
    setSyncStateRaw(createEmptyCloudSyncState());
    setPendingSnapshot(null);
    const cleared = await clearPersistedCloudState();
    if (!cleared) {
      setAuthError(
        "Local state was cleared in this session, but durable credential removal could not be confirmed. Retry Reset Local Data before closing the app."
      );
    }
    return cleared;
  }, []);

  const account = useMemo<CloudAccountSummary | null>(() => {
    if (!session) return null;
    const team = policy.teamId ? teams.find((entry) => entry.teamId === policy.teamId) ?? null : null;
    return {
      userId: session.userId,
      email: session.email,
      displayName: session.displayName,
      teamId: policy.teamId,
      teamName: team?.teamName ?? null,
      role: team?.role ?? null,
      signedInAt: session.signedInAt
    };
  }, [session, teams, policy.teamId]);

  const setSyncState = useCallback(
    (updater: (current: CloudSyncState) => CloudSyncState) => {
      setSyncStateRaw(updater);
    },
    []
  );

  const backupMetadata = useCallback(
    () => buildCloudBackupMetadata(policy, syncState),
    [policy, syncState]
  );

  // A stable controller reference (App memoizes on it, and the auto-sync
  // effect in useCloudSync depends on pieces of it) — only re-create when a
  // constituent actually changes.
  return useMemo(
    () => ({
      configured,
      isDemoMode,
      account,
      teams,
      teamsError,
      policy,
      syncState,
      pendingSnapshot,
      authBusy,
      authError,
      signIn,
      signOut,
      refreshTeams,
      updatePolicy,
      recordConsent,
      setSyncState,
      setPendingSnapshot,
      getFreshSession,
      checkFreshUpload,
      emitAudit,
      clearAll,
      backupMetadata
    }),
    [
      configured,
      isDemoMode,
      account,
      teams,
      teamsError,
      policy,
      syncState,
      pendingSnapshot,
      authBusy,
      authError,
      signIn,
      signOut,
      refreshTeams,
      updatePolicy,
      recordConsent,
      setSyncState,
      setPendingSnapshot,
      getFreshSession,
      checkFreshUpload,
      emitAudit,
      clearAll,
      backupMetadata
    ]
  );
}
