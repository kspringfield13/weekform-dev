import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemberWorkloadInput } from "./workload";

/**
 * Reads of shared workload snapshots for the dashboards. Everything runs
 * through the signed-in user's cookie session: RLS decides row visibility
 * (members see their own rows; owners/managers additionally see their team's
 * rows). Queries still filter explicitly by team/user — RLS is the guarantee,
 * the filter is the intent.
 *
 * The latest_team_snapshots view (security_invoker) returns each member's
 * newest snapshot per team. Columns are named explicitly; never SELECT *.
 * jsonb allocation columns are deliberately NOT selected here — the v1
 * dashboards render only summary metrics, so we fetch only what we show.
 */

const SNAPSHOT_COLUMNS =
  "user_id, team_id, week_id, observed_at, source_updated_at, share_level, " +
  "reliable_new_work_capacity_pct, reactive_pct, meeting_pct, " +
  "fragmented_work_pct, summary_confidence, reviewed_blocks, eligible_blocks";

export interface LatestSnapshot extends MemberWorkloadInput {
  teamId: string;
  sourceUpdatedAt: string;
}

export interface SnapshotRow {
  user_id: string;
  team_id: string;
  week_id: string;
  observed_at: string;
  source_updated_at: string;
  share_level: string;
  reliable_new_work_capacity_pct: number | string | null;
  reactive_pct: number | string | null;
  meeting_pct: number | string | null;
  fragmented_work_pct: number | string | null;
  summary_confidence: number | string | null;
  reviewed_blocks: number | null;
  eligible_blocks: number | null;
}

/** Postgres numeric can arrive as a string; absent metrics stay null. */
export function asMetric(value: number | string | null): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mapRow(row: SnapshotRow): LatestSnapshot {
  return {
    userId: row.user_id,
    teamId: row.team_id,
    weekId: row.week_id,
    observedAt: row.observed_at,
    sourceUpdatedAt: row.source_updated_at,
    shareLevel: row.share_level,
    reliableCapacityPct: asMetric(row.reliable_new_work_capacity_pct),
    reactivePct: asMetric(row.reactive_pct),
    meetingPct: asMetric(row.meeting_pct),
    fragmentedPct: asMetric(row.fragmented_work_pct),
    summaryConfidence: asMetric(row.summary_confidence),
    reviewedBlocks: row.reviewed_blocks ?? 0,
    eligibleBlocks: row.eligible_blocks ?? 0,
  };
}

/**
 * Latest shared snapshot per member of one team. RLS returns the full set
 * only to that team's owners/managers; a plain member sees only their own
 * row here, and an outsider sees none.
 */
export async function listLatestTeamSnapshots(
  supabase: SupabaseClient,
  teamId: string,
): Promise<{ snapshots: LatestSnapshot[]; error: string | null }> {
  const { data, error } = await supabase
    .from("latest_team_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("team_id", teamId)
    .order("observed_at", { ascending: false });

  if (error) {
    return { snapshots: [], error: error.message };
  }
  return {
    snapshots: ((data ?? []) as unknown as SnapshotRow[]).map(mapRow),
    error: null,
  };
}

/**
 * Hard cap on history rows fetched per team: ~8 weeks of weekly snapshots for
 * a 50-member team. A bound, not a promise of completeness — the trend module
 * only ever compares the two most recent weeks it actually receives.
 */
export const HISTORY_ROW_LIMIT = 400;

/**
 * Bounded snapshot history for one team, newest first. Queries the underlying
 * workload_snapshots TABLE (not the latest_team_snapshots view, which keeps
 * only each member's newest row) so prior weeks are visible for trends. The
 * snapshots_select_authorized RLS policy applies unchanged: members see their
 * own rows, owners/managers see their team's.
 */
export async function listTeamSnapshotHistory(
  supabase: SupabaseClient,
  teamId: string,
  limit: number = HISTORY_ROW_LIMIT,
): Promise<{ snapshots: LatestSnapshot[]; error: string | null }> {
  // Clamp the caller's limit into [1, HISTORY_ROW_LIMIT]; a bad limit must
  // never turn a bounded query into an unbounded one.
  const cappedLimit = Math.min(
    Math.max(Math.floor(Number.isFinite(limit) ? limit : HISTORY_ROW_LIMIT), 1),
    HISTORY_ROW_LIMIT,
  );
  const { data, error } = await supabase
    .from("workload_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("team_id", teamId)
    .order("observed_at", { ascending: false })
    .limit(cappedLimit);

  if (error) {
    return { snapshots: [], error: error.message };
  }
  return {
    snapshots: ((data ?? []) as unknown as SnapshotRow[]).map(mapRow),
    error: null,
  };
}

/**
 * The signed-in member's own latest snapshot in each team they share with.
 * The explicit user_id filter keeps manager accounts from also pulling their
 * team's rows into their personal dashboard.
 */
export async function listOwnLatestSnapshots(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ snapshots: LatestSnapshot[]; error: string | null }> {
  const { data, error } = await supabase
    .from("latest_team_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("user_id", userId)
    .order("observed_at", { ascending: false });

  if (error) {
    return { snapshots: [], error: error.message };
  }
  return {
    snapshots: ((data ?? []) as unknown as SnapshotRow[]).map(mapRow),
    error: null,
  };
}
