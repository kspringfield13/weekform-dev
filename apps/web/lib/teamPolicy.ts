/**
 * Pure helpers for the per-team share policy (A6, docs/EXPANSION_ROADMAP.md).
 *
 * The policy lives in the `teams.share_policy` jsonb column (see
 * supabase/migrations/202607190002_team_share_policy.sql) and is written by
 * team owners/managers under RLS (teams_update_managers). It is a
 * NARROWING-ONLY cap on what members share: each member's desktop client
 * applies it as `member consent ∩ team policy` before any payload is built
 * (`applyTeamSharePolicy` in the desktop `cloudPolicy.ts` — this module
 * mirrors that parser's semantics for the web surface). A team policy can
 * therefore never widen a member's consent: not by extra fields, not by a
 * higher level, not by malformed content — anything uninterpretable degrades
 * toward the narrowest reading.
 *
 * No ranks, scores, or member data appear here; this is policy metadata only.
 */

/** Same ladder as the member share levels — narrowest first. No new names invented. */
export const TEAM_SHARE_LEVELS = ["summary", "categories", "projects"] as const;

export type TeamShareLevel = (typeof TEAM_SHARE_LEVELS)[number];

/**
 * Manager-facing wording per cap level. Matches `shareLevelLabel` in
 * `components/WorkloadSnapshot.tsx` (the member-badge wording) in structure.
 */
export const TEAM_SHARE_LEVEL_LABELS: Record<TeamShareLevel, string> = {
  summary: "Summary metrics only",
  categories: "Summary + category breakdowns",
  projects: "Summary + categories + allowlisted projects"
};

/** Fixed copy: the one honest sentence every policy surface must carry. */
export const TEAM_POLICY_NARROWING_NOTE =
  "A team policy can only narrow what members already consented to share — it never adds data, raises a member's share level, or overrides a member's choices.";

/** The metric consent keys, mirroring the desktop `CloudMetricPolicy`. */
export const TEAM_POLICY_METRIC_KEYS = [
  "reliableCapacity",
  "allocated",
  "reactive",
  "meetings",
  "fragmented",
  "blocked",
  "carryoverRisk",
  "contextSwitching",
  "workInProgress",
  "confidence"
] as const;

export type TeamPolicyMetricKey = (typeof TEAM_POLICY_METRIC_KEYS)[number];

export interface TeamSharePolicy {
  version: 1;
  /** The most structure the team accepts; members' levels are clamped to this. */
  maxShareLevel: TeamShareLevel;
  /** null = every member-consented metric is accepted; otherwise only `true` keys. */
  acceptedMetrics: Record<TeamPolicyMetricKey, boolean> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const LEVEL_SET: ReadonlySet<string> = new Set(TEAM_SHARE_LEVELS);

/**
 * Validate a stored `teams.share_policy` value. Mirrors the desktop parser:
 *  - null/absent/non-object → null (no policy exists; member consent applies unchanged);
 *  - a present object with an unknown version or malformed level → the NARROWEST
 *    level ("summary"), never the widest;
 *  - `acceptedMetrics` present but uninterpretable → every metric rejected;
 *    missing/non-boolean flags → false;
 *  - only whitelisted keys are read into a fresh literal, so
 *    prototype-pollution-style keys can neither pollute nor ride along.
 */
export function parseTeamSharePolicy(value: unknown): TeamSharePolicy | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.version !== 1) {
    return { version: 1, maxShareLevel: "summary", acceptedMetrics: null };
  }
  const maxShareLevel = LEVEL_SET.has(value.maxShareLevel as string)
    ? (value.maxShareLevel as TeamShareLevel)
    : "summary";
  let acceptedMetrics: TeamSharePolicy["acceptedMetrics"] = null;
  if (value.acceptedMetrics !== undefined && value.acceptedMetrics !== null) {
    const record = isRecord(value.acceptedMetrics) ? value.acceptedMetrics : {};
    const metrics = {} as Record<TeamPolicyMetricKey, boolean>;
    for (const key of TEAM_POLICY_METRIC_KEYS) {
      metrics[key] = record[key] === true;
    }
    acceptedMetrics = metrics;
  }
  return { version: 1, maxShareLevel, acceptedMetrics };
}

/**
 * Validate a manager's form selection and build the exact jsonb record to
 * store. Returns null for anything that is not one of the three known levels
 * — the action must refuse, never guess.
 */
export function buildTeamSharePolicyRecord(rawLevel: string): TeamSharePolicy | null {
  const level = rawLevel.trim();
  if (!LEVEL_SET.has(level)) {
    return null;
  }
  return { version: 1, maxShareLevel: level as TeamShareLevel, acceptedMetrics: null };
}

/** One-line description of a team's policy for both member and manager views. */
export function describeTeamSharePolicy(policy: TeamSharePolicy | null): string {
  if (policy === null) {
    return "No team share policy is set — each member's own sharing choices apply unchanged.";
  }
  const base = `Team cap: ${TEAM_SHARE_LEVEL_LABELS[policy.maxShareLevel]}.`;
  if (policy.acceptedMetrics === null) {
    return `${base} Every metric a member consents to is accepted.`;
  }
  const acceptedCount = TEAM_POLICY_METRIC_KEYS.filter(
    (key) => policy.acceptedMetrics?.[key] === true
  ).length;
  return `${base} ${acceptedCount} of ${TEAM_POLICY_METRIC_KEYS.length} metrics accepted; a member's unconsented metrics stay unshared either way.`;
}
