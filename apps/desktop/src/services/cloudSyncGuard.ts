import type { CloudSharePolicyV1 } from "../../../../packages/domain/src/cloud";
import { applyTeamSharePolicy, type PersistedCloudSession } from "./cloudPolicy";
import type { CloudResult, CloudTeamMembership } from "./cloudClient";

export type FreshUploadBoundaryResult =
  | { ok: true; teams: CloudTeamMembership[] }
  | {
      ok: false;
      reason: "refresh_failed" | "membership_revoked" | "policy_changed";
      message: string;
      teams?: CloudTeamMembership[];
    };

export interface FreshUploadBoundaryInput {
  session: PersistedCloudSession;
  memberPolicy: CloudSharePolicyV1;
  /** The effective policy used to construct the exact preview currently on screen. */
  cachedEffectivePolicy: CloudSharePolicyV1;
  fetchMemberships: (
    session: PersistedCloudSession
  ) => Promise<CloudResult<CloudTeamMembership[]>>;
}

/** Policy drift changes the exact preview, so prior consent cannot authorize a retry. */
export function boundaryRequiresConsentReset(result: FreshUploadBoundaryResult): boolean {
  return !result.ok && result.reason === "policy_changed";
}

function samePolicy(a: CloudSharePolicyV1, b: CloudSharePolicyV1): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Revalidate the recipient and its narrowing policy immediately before upload.
 * A changed server policy deliberately aborts this attempt: the returned teams
 * update the React state, which rebuilds the exact preview before the user tries
 * again. Thus no stale/wider payload crosses the boundary and preview === upload.
 */
export async function checkFreshUploadBoundary(
  input: FreshUploadBoundaryInput
): Promise<FreshUploadBoundaryResult> {
  const refreshed = await input.fetchMemberships(input.session);
  if (!refreshed.ok) {
    return { ok: false, reason: "refresh_failed", message: refreshed.message };
  }
  const teamId = input.memberPolicy.teamId;
  const selected = teamId
    ? refreshed.value.find((team) => team.teamId === teamId) ?? null
    : null;
  if (!selected) {
    return {
      ok: false,
      reason: "membership_revoked",
      message: "Your membership in the selected team is no longer active.",
      teams: refreshed.value
    };
  }
  const freshEffectivePolicy = applyTeamSharePolicy(input.memberPolicy, selected.sharePolicy);
  if (!samePolicy(freshEffectivePolicy, input.cachedEffectivePolicy)) {
    return {
      ok: false,
      reason: "policy_changed",
      message: "The team sharing policy changed. Review the refreshed preview before syncing.",
      teams: refreshed.value
    };
  }
  return { ok: true, teams: refreshed.value };
}

export type FreshGuardedUploadResult<T> =
  | { ok: true; value: T }
  | { ok: false; boundary: Extract<FreshUploadBoundaryResult, { ok: false }> };

/** Keep request-body construction behind the successful fresh-boundary decision. */
export async function runFreshGuardedUpload<T>(
  checkBoundary: () => Promise<FreshUploadBoundaryResult>,
  upload: () => Promise<T>
): Promise<FreshGuardedUploadResult<T>> {
  const boundary = await checkBoundary();
  if (!boundary.ok) return { ok: false, boundary };
  return { ok: true, value: await upload() };
}
