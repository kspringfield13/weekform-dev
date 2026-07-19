import type { SupabaseClient } from "@supabase/supabase-js";

import type { RiskFlag } from "./workload";
import { median } from "./workload";
import type { LatestSnapshot } from "./snapshots";
import type { TeamRole } from "./teams";
import { isManagerRole } from "./teams";

/** The action input is intentionally limited to one sentence and one known flag. */
export type ActionRiskFlagKey = RiskFlag["id"];
export type TeamActionStatus = "open" | "done" | "dropped";
export type ResolvedActionStatus = Exclude<TeamActionStatus, "open">;

export const ACTION_RISK_FLAG_KEYS: readonly ActionRiskFlagKey[] = [
  "low-headroom",
  "high-reactive",
  "high-meetings",
  "high-fragmentation",
  "low-review-coverage",
  "stale-data",
] as const;

export type ActionTrendMetric =
  | "reliableCapacityPct"
  | "reactivePct"
  | "meetingPct"
  | "fragmentedPct";

export interface TrackableActionRisk {
  metric: ActionTrendMetric;
  metricLabel: string;
  improvementDirection: "higher" | "lower";
}

/** Only flags backed by a team-aggregate shared trend can produce follow-through. */
export const TRACKABLE_ACTION_RISKS: Readonly<
  Partial<Record<ActionRiskFlagKey, TrackableActionRisk>>
> = {
  "low-headroom": {
    metric: "reliableCapacityPct",
    metricLabel: "reliable new-work capacity",
    improvementDirection: "higher",
  },
  "high-reactive": {
    metric: "reactivePct",
    metricLabel: "reactive load",
    improvementDirection: "lower",
  },
  "high-meetings": {
    metric: "meetingPct",
    metricLabel: "meeting load",
    improvementDirection: "lower",
  },
  "high-fragmentation": {
    metric: "fragmentedPct",
    metricLabel: "fragmented work",
    improvementDirection: "lower",
  },
};

export interface TeamAction {
  id: string;
  teamId: string;
  createdBy: string;
  text: string;
  riskFlagKey: ActionRiskFlagKey | null;
  status: TeamActionStatus;
  createdAt: string;
  resolvedAt: string | null;
}

interface TeamActionRow {
  id: string;
  team_id: string;
  created_by: string;
  action_text: string;
  risk_flag_key: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
}

export interface CreateTeamActionInput {
  teamId: string;
  text: string;
  riskFlagKey?: ActionRiskFlagKey | null;
}

export interface ActionFollowThrough {
  actionId: string;
  status: "too-early" | "computed" | "not-trackable";
  subsequentWeekCount: number;
  metric: ActionTrendMetric | null;
  metricLabel: string | null;
  firstWeekId: string | null;
  latestWeekId: string | null;
  firstTeamMedian: number | null;
  latestTeamMedian: number | null;
  changePoints: number | null;
  label: string;
}

const ACTION_COLUMNS =
  "id, team_id, created_by, action_text, risk_flag_key, status, created_at, resolved_at";
const MANAGER_REQUIRED = "An active team manager or owner role is required.";

export function isActionRiskFlagKey(value: unknown): value is ActionRiskFlagKey {
  return (
    typeof value === "string" &&
    (ACTION_RISK_FLAG_KEYS as readonly string[]).includes(value)
  );
}

export function sanitizeActionText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Action text is required.");
  }
  return trimmed.slice(0, 500);
}

function asStatus(value: unknown): TeamActionStatus {
  return value === "done" || value === "dropped" ? value : "open";
}

function mapActionRow(row: TeamActionRow): TeamAction {
  return {
    id: row.id,
    teamId: row.team_id,
    createdBy: row.created_by,
    text: row.action_text,
    riskFlagKey: isActionRiskFlagKey(row.risk_flag_key)
      ? row.risk_flag_key
      : null,
    status: asStatus(row.status),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

export async function createTeamAction(
  supabase: SupabaseClient,
  role: TeamRole,
  input: CreateTeamActionInput,
): Promise<{ action: TeamAction | null; error: string | null }> {
  if (!isManagerRole(role)) {
    return { action: null, error: MANAGER_REQUIRED };
  }
  if (
    input.riskFlagKey !== undefined &&
    input.riskFlagKey !== null &&
    !isActionRiskFlagKey(input.riskFlagKey)
  ) {
    return { action: null, error: "Risk flag key is not allowlisted." };
  }

  let text: string;
  try {
    text = sanitizeActionText(input.text);
  } catch (error) {
    return {
      action: null,
      error: error instanceof Error ? error.message : "Action text is invalid.",
    };
  }

  const { data, error } = await supabase.rpc("create_team_action", {
    p_team_id: input.teamId,
    p_action_text: text,
    p_risk_flag_key: input.riskFlagKey ?? null,
  });

  if (error || !data) {
    return { action: null, error: error?.message ?? "Action was not created." };
  }
  return { action: mapActionRow(data as TeamActionRow), error: null };
}

export async function listTeamActions(
  supabase: SupabaseClient,
  role: TeamRole,
  teamId: string,
): Promise<{ actions: TeamAction[]; error: string | null }> {
  if (!isManagerRole(role)) {
    return { actions: [], error: MANAGER_REQUIRED };
  }
  const { data, error } = await supabase
    .from("team_actions")
    .select(ACTION_COLUMNS)
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });

  if (error) {
    return { actions: [], error: error.message };
  }
  return {
    actions: ((data ?? []) as unknown as TeamActionRow[]).map(mapActionRow),
    error: null,
  };
}

export async function updateTeamActionStatus(
  supabase: SupabaseClient,
  role: TeamRole,
  teamId: string,
  actionId: string,
  status: ResolvedActionStatus,
): Promise<{ action: TeamAction | null; error: string | null }> {
  if (!isManagerRole(role)) {
    return { action: null, error: MANAGER_REQUIRED };
  }
  if (status !== "done" && status !== "dropped") {
    return { action: null, error: "Action status must be done or dropped." };
  }
  const { data, error } = await supabase.rpc("resolve_team_action", {
    p_team_id: teamId,
    p_action_id: actionId,
    p_status: status,
  });

  if (error || !data) {
    return { action: null, error: error?.message ?? "Action was not updated." };
  }
  return { action: mapActionRow(data as TeamActionRow), error: null };
}

export async function deleteTeamAction(
  supabase: SupabaseClient,
  role: TeamRole,
  teamId: string,
  actionId: string,
): Promise<{ error: string | null }> {
  if (!isManagerRole(role)) {
    return { error: MANAGER_REQUIRED };
  }
  const { error } = await supabase.rpc("delete_team_action", {
    p_team_id: teamId,
    p_action_id: actionId,
  });
  return { error: error?.message ?? null };
}

/** UTC ISO week id; used only to separate action week from later weekly evidence. */
function isoWeekId(iso: string): string | null {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  const date = new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function finiteMetric(
  snapshot: LatestSnapshot,
  metric: ActionTrendMetric,
): number | null {
  const value = snapshot[metric];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Summarize only team-level shared change after an action. This deliberately
 * makes no causal claim and exposes no member values or attribution.
 */
export function buildActionFollowThrough(
  actions: TeamAction[],
  snapshots: LatestSnapshot[],
): ActionFollowThrough[] {
  const results: ActionFollowThrough[] = [];

  for (const action of actions) {
    if (action.status === "dropped") {
      continue;
    }
    const tracked = action.riskFlagKey
      ? TRACKABLE_ACTION_RISKS[action.riskFlagKey]
      : undefined;
    if (!tracked) {
      results.push({
        actionId: action.id,
        status: "not-trackable",
        subsequentWeekCount: 0,
        metric: null,
        metricLabel: null,
        firstWeekId: null,
        latestWeekId: null,
        firstTeamMedian: null,
        latestTeamMedian: null,
        changePoints: null,
        label:
          "What changed after this action is not available because it is not linked to a shared team trend metric.",
      });
      continue;
    }

    const actionWeekId = isoWeekId(action.createdAt);
    const relevant = snapshots.filter(
      (snapshot) =>
        snapshot.teamId === action.teamId &&
        actionWeekId !== null &&
        snapshot.weekId > actionWeekId,
    );

    // Keep only the newest snapshot for each member/week before aggregating.
    const deduped = new Map<string, LatestSnapshot>();
    for (const snapshot of relevant) {
      const key = `${snapshot.weekId}\u0000${snapshot.userId}`;
      const existing = deduped.get(key);
      if (
        !existing ||
        Date.parse(snapshot.observedAt) > Date.parse(existing.observedAt)
      ) {
        deduped.set(key, snapshot);
      }
    }

    const valuesByWeek = new Map<string, number[]>();
    for (const snapshot of deduped.values()) {
      const value = finiteMetric(snapshot, tracked.metric);
      if (value === null) {
        continue;
      }
      const values = valuesByWeek.get(snapshot.weekId) ?? [];
      values.push(value);
      valuesByWeek.set(snapshot.weekId, values);
    }
    const weekIds = [...valuesByWeek.keys()].sort();

    if (weekIds.length < 2) {
      results.push({
        actionId: action.id,
        status: "too-early",
        subsequentWeekCount: weekIds.length,
        metric: tracked.metric,
        metricLabel: tracked.metricLabel,
        firstWeekId: weekIds[0] ?? null,
        latestWeekId: null,
        firstTeamMedian: null,
        latestTeamMedian: null,
        changePoints: null,
        label: `Too early to tell: what changed after this action needs two distinct subsequent weeks of shared team ${tracked.metricLabel}.`,
      });
      continue;
    }

    const firstWeekId = weekIds[0] as string;
    const latestWeekId = weekIds[weekIds.length - 1] as string;
    const firstTeamMedian = median(valuesByWeek.get(firstWeekId) ?? []);
    const latestTeamMedian = median(valuesByWeek.get(latestWeekId) ?? []);
    // Each included week has at least one finite value, so medians are non-null.
    const changePoints =
      firstTeamMedian === null || latestTeamMedian === null
        ? null
        : latestTeamMedian - firstTeamMedian;
    const roundedMagnitude = Math.abs(Math.round(changePoints ?? 0));
    const direction = (changePoints ?? 0) === 0
      ? "unchanged"
      : (changePoints ?? 0) > 0
        ? `${roundedMagnitude} points higher`
        : `${roundedMagnitude} points lower`;

    results.push({
      actionId: action.id,
      status: "computed",
      subsequentWeekCount: weekIds.length,
      metric: tracked.metric,
      metricLabel: tracked.metricLabel,
      firstWeekId,
      latestWeekId,
      firstTeamMedian,
      latestTeamMedian,
      changePoints,
      label: `What changed after this action: team median shared ${tracked.metricLabel} was ${direction} across ${weekIds.length} subsequent weeks. This correlation does not show that the action caused the change.`,
    });
  }

  return results;
}
