import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, Mail, ShieldCheck, UserRound, UsersRound, Waypoints } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import {
  getOwnMembership,
  getTeamSharePolicyValue,
  isManagerRole,
  listTeamInvites,
  listTeamRoster,
  type TeamRole,
} from "@/lib/teams";
import {
  TEAM_POLICY_NARROWING_NOTE,
  describeTeamSharePolicy,
  parseTeamSharePolicy,
} from "@/lib/teamPolicy";
import {
  listLatestTeamSnapshots,
  listTeamSnapshotHistory,
  type LatestSnapshot,
} from "@/lib/snapshots";
import {
  LOW_HEADROOM_THRESHOLD_PCT,
  approvedSnapshotProvenance,
  median,
  reviewCoveragePct,
  summarizeTeamWorkload,
  type MetricSummary,
} from "@/lib/workload";
import {
  MIN_SCENARIO_SHARED_COUNT,
  MIN_SCENARIO_SHARED_RATIO,
  absorptionVerdictLabel,
  assessAbsorption,
  type AbsorptionAssessment,
  type MemberAbsorptionStatus,
} from "@/lib/scenario";
import {
  TREND_METRIC_KEYS,
  TREND_METRIC_LABELS,
  driftWording,
  summarizeTeamTrend,
  type TeamTrend,
} from "@/lib/trends";
import {
  FORECAST_METRIC_KEYS,
  forecastTeamCapacity,
  type TeamCapacityForecast,
} from "@/lib/forecast";
import {
  ACTION_RISK_FLAG_KEYS,
  buildActionFollowThrough,
  listTeamActions,
  type ActionRiskFlagKey,
} from "@/lib/actions";
import {
  FreshnessBadge,
  SnapshotMetricList,
  SnapshotRiskFlags,
  formatDateTime,
  shareLevelLabel,
  snapshotFreshness,
} from "@/components/WorkloadSnapshot";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { RequestFreshnessRefresh } from "@/components/RequestFreshnessRefresh";
import { MacAppLink } from "@/components/MacAppLink";
import { IndividualWorkspaceShell } from "@/components/IndividualWorkspaceShell";
import { signOut } from "@/app/auth/actions";
import { leaveTeam, updateTeamSharePolicy } from "@/app/teams/actions";
import { InviteForm } from "./InviteForm";
import {
  ManagerActionsPanel,
  type ActionRiskOption,
} from "./ManagerActionsPanel";
import { TeamGantt } from "./TeamGantt";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

interface TeamPageProps {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{
    notice?: string;
    action_error?: string;
    screen?: string;
  }>;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function currentIsoWeekId(): string {
  const date = new Date();
  const cursor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = cursor.getUTCDay() || 7;
  cursor.setUTCDate(cursor.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(cursor.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((cursor.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${cursor.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function inviteStatus(invite: {
  acceptedAt: string | null;
  expiresAt: string;
}): "accepted" | "expired" | "pending" {
  if (invite.acceptedAt) {
    return "accepted";
  }
  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    return "expired";
  }
  return "pending";
}

function memberInitials(name: string, email: string | null): string {
  const source = name.startsWith("member-") ? (email ?? name) : name;
  const parts = source
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "WF"
  );
}

function metricStat(summary: MetricSummary | null, totalSharing: number) {
  if (!summary) {
    return { value: "Not shared", note: "No member shares this metric yet." };
  }
  const range =
    summary.min === summary.max
      ? `${Math.round(summary.min)}%`
      : `${Math.round(summary.min)}–${Math.round(summary.max)}%`;
  return {
    value: `${Math.round(summary.median)}%`,
    note: `Median ${approvedSnapshotProvenance(summary.sharedCount, totalSharing)} · range ${range}`,
  };
}

/** Preset planning asks, in % of a member-week (prototype presets). */
const SCENARIO_ASK_PRESETS_PCT = [10, 25] as const;

const ACTION_RISK_LABELS: Record<ActionRiskFlagKey, string> = {
  "low-headroom": "Low reliable capacity",
  "high-reactive": "High reactive load",
  "high-meetings": "High meeting load",
  "high-fragmentation": "High fragmentation",
  "low-review-coverage": "Low review coverage",
  "stale-data": "Stale shared data",
};

const ACTION_RISK_OPTIONS: ActionRiskOption[] = ACTION_RISK_FLAG_KEYS.map(
  (key) => ({ key, label: ACTION_RISK_LABELS[key] }),
);

const TEAM_SHARE_POLICY_OPTIONS = [
  {
    value: "none",
    eyebrow: "Member choice",
    title: "No team cap",
    description:
      "Keep every member’s own sharing choice unchanged. Weekform adds no team-wide cap.",
    scope: ["Personal policy"],
  },
  {
    value: "summary",
    eyebrow: "Smallest team view",
    title: "Summary only",
    description:
      "Capacity, allocation, and workload signals only. No categories or project names.",
    scope: ["Summary"],
  },
  {
    value: "categories",
    eyebrow: "Pattern context",
    title: "Summary + categories",
    description:
      "Adds category-level workload patterns, such as focus, meetings, and reactive work.",
    scope: ["Summary", "Categories"],
  },
  {
    value: "projects",
    eyebrow: "Most context",
    title: "Summary + projects",
    description:
      "Adds only projects each member explicitly allowlisted. Everything else stays private.",
    scope: ["Summary", "Categories", "Allowlisted projects"],
  },
] as const;

function countMemberStatus(
  assessment: AbsorptionAssessment,
  status: MemberAbsorptionStatus,
): number {
  return Object.values(assessment.memberStatus).filter(
    (value) => value === status,
  ).length;
}

function ScenarioStat({ assessment }: { assessment: AbsorptionAssessment }) {
  const insufficient = assessment.verdict === "insufficient-shared-data";
  return (
    <div className="stat">
      <span className="stat-label">
        +{assessment.askPct}% additional planned load
      </span>
      <span className="stat-value">
        {absorptionVerdictLabel(assessment.verdict)}
      </span>
      {insufficient ? (
        <span className="stat-note">
          Current capacity comes {approvedSnapshotProvenance(assessment.currentSharedCount, assessment.memberCount)} — below the prototype minimum (
          {MIN_SCENARIO_SHARED_COUNT} members and{" "}
          {Math.round(MIN_SCENARIO_SHARED_RATIO * 100)}% of the roster). No
          estimate is shown from partial data; unknown is not zero, and it is
          not headroom either.
        </span>
      ) : (
        <>
          <span className="stat-note">
            Median shared headroom{" "}
            {assessment.headroom ? Math.round(assessment.headroom.median) : "—"}
            % (range{" "}
            {assessment.headroom
              ? `${Math.round(assessment.headroom.min)}–${Math.round(assessment.headroom.max)}%`
              : "—"}
            ), {approvedSnapshotProvenance(assessment.currentSharedCount, assessment.memberCount)}.
          </span>
          <span className="stat-note">
            Against their own shared headroom:{" "}
            {countMemberStatus(assessment, "fits")} fit,{" "}
            {countMemberStatus(assessment, "tight")} tight,{" "}
            {countMemberStatus(assessment, "exceeds")} exceeded. Stale (
            {assessment.excludedStaleCount}) and unknown (
            {assessment.excludedUnknownCount}) members are excluded, never
            counted as zero.
          </span>
        </>
      )}
    </div>
  );
}

function TrendStat({
  trend,
  metricKey,
}: {
  trend: TeamTrend;
  metricKey: (typeof TREND_METRIC_KEYS)[number];
}) {
  const drift = trend.medianDrift[metricKey];
  const rounded = drift.value === null ? null : Math.round(drift.value);
  return (
    <div className="stat">
      <span className="stat-label">Median {TREND_METRIC_LABELS[metricKey]}</span>
      <span className="stat-value">
        {rounded === null
          ? "Not comparable"
          : rounded === 0
            ? "No change"
            : `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} pts`}
      </span>
      <span className="stat-note">
        {drift.value === null
          ? "No member shared this metric across both weeks without a share-level change — no drift is invented."
          : `${driftWording(metricKey, drift.value)}, ${approvedSnapshotProvenance(drift.comparedCount)} across week ${trend.currentWeekId} vs ${trend.priorWeekId}.`}
      </span>
    </div>
  );
}

function ForecastStat({
  forecast,
  metricKey,
}: {
  forecast: TeamCapacityForecast;
  metricKey: (typeof FORECAST_METRIC_KEYS)[number];
}) {
  const metric = forecast.metrics[metricKey];
  const range = metric.forecast;
  return (
    <div className="stat">
      <span className="stat-label">
        Median {TREND_METRIC_LABELS[metricKey]} (next week)
      </span>
      <span className="stat-value">
        {range === null ? "Not shared" : `${Math.round(range.median)}%`}
      </span>
      <span className="stat-note">
        {range === null
          ? "No member shares this metric currently — no forecast is invented, and missing data is never shown as zero."
          : `Median of ${metric.weekCount} recent weekly team median${metric.weekCount === 1 ? "" : "s"}, ${approvedSnapshotProvenance(forecast.sharedCount, forecast.memberCount)} · stated range ${Math.round(range.min)}–${Math.round(range.max)}%.`}
      </span>
      <span className="stat-note">
        {metric.scoredCount === 0
          ? "No past forecast for this metric has an outcome to score yet."
          : `Track record: ${metric.hitCount} of ${metric.scoredCount} past forecast${metric.scoredCount === 1 ? "" : "s"} landed inside the stated range.`}
      </span>
    </div>
  );
}

function TeamWorkspaceHeader({
  headingId,
  manager,
  role,
  teamName,
}: {
  headingId?: string;
  manager: boolean;
  role: TeamRole;
  teamName: string;
}) {
  return (
    <header className="team-screen-header">
      <div>
        <span className="team-screen-eyebrow">
          {manager ? "Team workload intelligence" : "Your team connection"}
        </span>
        <h1 id={headingId}>{manager ? `${teamName} workload` : `Your place in ${teamName}`}</h1>
        <p>
          {manager
            ? "Coordinate commitments from member-approved summaries without ranking people."
            : "Understand what you contribute, what stays private, and whether your team signal is current."}
        </p>
      </div>
      <div className="team-screen-actions">
        <div className="team-role-indicator">
          {manager ? <Waypoints aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
          <span>{manager ? "Manager · approved summaries" : `${role} · your data only`}</span>
        </div>
        <div className="team-view-toggle" aria-label="Weekform workspace mode">
          <Link href="/app">
            <UserRound aria-hidden="true" /> Individual
          </Link>
          <span className="is-active" aria-current="page">
            <Waypoints aria-hidden="true" /> {manager ? "Manager" : "Team"}
          </span>
        </div>
      </div>
    </header>
  );
}

export default async function TeamPage({ params, searchParams }: TeamPageProps) {
  const [{ teamId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const { notice, action_error: actionError } = query;
  const supabase = await createClient();

  if (!supabase) {
    return (
      <>
        <SiteHeader />
        <main className="container">
          <div className="page-head">
            <h1>Team</h1>
          </div>
          <div className="error-panel" role="alert">
            <h2>Supabase is not configured</h2>
            <p>
              This deployment has no Supabase project configured, so teams are
              unavailable. See <span className="mono">apps/web/README.md</span>.
            </p>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    redirect(`/login?next=${encodeURIComponent(`/teams/${teamId}`)}`);
  }

  const membership = await getOwnMembership(supabase, teamId, user.id);

  if (!membership) {
    // Same view for "team does not exist" and "not a member": RLS returns
    // zero rows either way, and this page must not help anyone probe.
    return (
      <>
        <SiteHeader />
        <main className="container">
          <div className="page-head">
            <h1>Team unavailable</h1>
          </div>
          <div className="error-panel" role="alert">
            <h2>You don&apos;t have access to this team</h2>
            <p>
              Either this team doesn&apos;t exist or you&apos;re not an active
              member of it. If someone invited you, open their invite link to
              join first.
            </p>
            <p>
              <Link href="/app" className="button button-secondary">
                Back to your individual workspace
              </Link>
            </p>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const manager = isManagerRole(membership.role);
  const toolbarAccountActions = (
    <>
      <span className="web-toolbar-identity">
        <span className="web-toolbar-account-avatar" aria-hidden="true">
          {user.email?.slice(0, 1).toUpperCase() ?? "W"}
        </span>
        <span className="web-toolbar-account" title={user.email ?? undefined}>{user.email}</span>
      </span>
      <form action={signOut}>
        <button className="web-toolbar-button web-sign-out-button" type="submit">
          <LogOut aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </form>
    </>
  );

  return manager ? (
    <IndividualWorkspaceShell
      reliableCapacity={null}
      reviewCount={0}
      activeWeekLabel={null}
      teamAvailable
      teamHref={`/teams/${teamId}`}
      teamRole={membership.role}
      workspaceMode="manager"
      accountActions={toolbarAccountActions}
      initialScreen={query.screen}
    >
      <div className="container workspace-shell team-workspace-shell">
        <div className="team-freshness-strip">
          <RequestFreshnessRefresh />
        </div>
        {notice ? (
          <div className="form-notice" role="status">{notice}</div>
        ) : null}
        <ManagerView
          teamId={teamId}
          teamName={membership.teamName}
          viewerId={user.id}
          role={membership.role}
          actionError={actionError ?? null}
        />
      </div>
    </IndividualWorkspaceShell>
  ) : (
    <IndividualWorkspaceShell
      reliableCapacity={null}
      reviewCount={0}
      activeWeekLabel={null}
      teamAvailable
      teamHref={`/teams/${teamId}`}
      teamRole={membership.role}
      workspaceMode="team"
      accountActions={toolbarAccountActions}
      initialScreen={undefined}
    >
      <main className="container workspace-shell team-page-container team-screen">
        <TeamWorkspaceHeader
          manager={false}
          role={membership.role}
          teamName={membership.teamName}
        />

        <div className="team-freshness-strip">
          <RequestFreshnessRefresh />
        </div>

        {notice ? (
          <div className="form-notice" role="status">
            {notice}
          </div>
        ) : null}

        <MemberView
          teamId={teamId}
          teamName={membership.teamName}
          role={membership.role}
          viewerId={user.id}
        />
      </main>
    </IndividualWorkspaceShell>
  );
}

/**
 * Member view of a team page: only their own shared snapshot (RLS returns
 * nobody else's), plus the leave-team path. Sharing itself is controlled in
 * the Mac app, never here.
 */
async function MemberView({
  teamId,
  teamName,
  role,
  viewerId,
}: {
  teamId: string;
  teamName: string;
  role: TeamRole;
  viewerId: string;
}) {
  const supabase = await createClient();
  if (!supabase) {
    return null; // parent already handled the unconfigured state
  }

  const nowIso = new Date().toISOString();
  const [
    { snapshots, error },
    { snapshots: history, error: historyError },
    { value: policyValue, error: policyError },
  ] =
    await Promise.all([
      listLatestTeamSnapshots(supabase, teamId),
      listTeamSnapshotHistory(supabase, teamId),
      getTeamSharePolicyValue(supabase, teamId),
    ]);
  const teamPolicy = policyError ? null : parseTeamSharePolicy(policyValue);
  const own = snapshots.find((snapshot) => snapshot.userId === viewerId) ?? null;
  const freshness = own ? snapshotFreshness(own, nowIso) : null;

  return (
    <>
      <div className="team-status-rail team-evidence-rail" aria-label="Your team sharing status">
        <div>
          <span>Membership</span>
          <strong>Active</strong>
          <small>{role}</small>
        </div>
        <div>
          <span>Coordination signal</span>
          <strong>{own ? "Shared" : "Private"}</strong>
          <small>{own ? shareLevelLabel(own.shareLevel) : "Nothing automatic"}</small>
        </div>
        <div>
          <span>Freshness</span>
          <strong>{freshness === "fresh" ? "Current" : freshness === "aging" ? "Aging" : freshness === "stale" ? "Stale" : "Not synced"}</strong>
          <small>{own ? formatDateTime(own.observedAt) : "No snapshot"}</small>
        </div>
        <div>
          <span>Team boundary</span>
          <strong>{teamPolicy ? shareLevelLabel(teamPolicy.maxShareLevel) : "Member choice"}</strong>
          <small>Can only narrow sharing</small>
        </div>
      </div>

      <div className="team-decision-grid team-member-decision-grid team-decision-layout">
      <section className="panel team-member-signal team-decision-card team-decision-card--primary" aria-labelledby="member-share-title">
        <span className="team-section-kicker">Your coordination signal</span>
        <h2 id="member-share-title">What {teamName} sees from you</h2>
        {error ? (
          <div className="form-alert" role="alert">
            Your shared snapshot could not be loaded right now. Reload the page
            to try again.
          </div>
        ) : own ? (
          <>
            <div className="member-card-badges">
              <span className="badge">{shareLevelLabel(own.shareLevel)}</span>
              <FreshnessBadge freshness={snapshotFreshness(own, nowIso)} />
            </div>
            <p style={{ marginTop: 10 }}>
              Week <span className="mono">{own.weekId}</span> · last synced{" "}
              {formatDateTime(own.observedAt)}. Metrics marked &quot;Not
              shared&quot; are omitted from the cloud entirely — never sent as
              zero.
            </p>
            <SnapshotMetricList snapshot={own} />
          </>
        ) : (
          <p>
            You haven&apos;t shared a workload snapshot with this team yet.
            Nothing is shared automatically.
          </p>
        )}
        {!policyError && teamPolicy ? (
          <p style={{ marginTop: 12 }}>
            {describeTeamSharePolicy(teamPolicy)} {TEAM_POLICY_NARROWING_NOTE}
          </p>
        ) : null}
        <p style={{ marginTop: 12 }}>
          To change what you share — or stop sharing — open{" "}
          <strong>Account &amp; Sharing in Weekform for Mac</strong>. This
          website can delete your shared history but cannot change your sharing
          policy.
        </p>
        <p>
          <Link href="/app" className="text-link">
            Manage sharing and cloud history in your individual workspace
          </Link>
        </p>
      </section>

      <aside className="panel team-member-boundary team-decision-card" aria-labelledby="member-boundary-title">
        <span className="team-section-kicker">What this helps decide</span>
        <h2 id="member-boundary-title">Coordinate without exposing your workday</h2>
        <p>
          Your approved capacity and load signal can help the team discuss commitments.
          It cannot reveal your apps, raw activity, notes, window titles, or how you compare with another person.
        </p>
        <ul className="team-member-boundary-list">
          <li><ShieldCheck aria-hidden="true" /> You choose every shared metric.</li>
          <li><ShieldCheck aria-hidden="true" /> Missing values remain unknown, never zero.</li>
          <li><ShieldCheck aria-hidden="true" /> Managers receive summaries, never raw evidence.</li>
        </ul>
      </aside>
      </div>

      {historyError ? (
        <div className="form-alert" role="alert">Your workload horizon could not be loaded. No placeholder timeline is shown.</div>
      ) : (
        <TeamGantt
          anchorWeekId={history.reduce((latest, point) => point.weekId > latest ? point.weekId : latest, own?.weekId ?? currentIsoWeekId())}
          history={history}
          identities={[{ userId: viewerId, name: "You" }]}
          teamRole="member"
          todayIso={nowIso}
          viewerId={viewerId}
        />
      )}

      <section className="panel team-leave-panel" aria-labelledby="member-leave-title">
        <div>
          <span className="team-section-kicker">Membership control</span>
          <h2 id="member-leave-title">Leave this team</h2>
        <p>
          Leaving stops managers of this team from seeing any future snapshots.
          Snapshots you already shared remain until you delete your cloud
          history from your dashboard.
        </p>
        </div>
        <form action={leaveTeam}>
          <input type="hidden" name="team_id" value={teamId} />
          <FormSubmitButton
            className="button button-secondary"
            pendingLabel="Leaving team…"
            confirmMessage="Leave this team? Future snapshots will stop, but existing cloud history remains until you delete it."
          >
            Leave team
          </FormSubmitButton>
        </form>
      </section>
    </>
  );
}

async function ManagerView({
  teamId,
  teamName,
  viewerId,
  role,
  actionError,
}: {
  teamId: string;
  teamName: string;
  viewerId: string;
  role: TeamRole;
  actionError: string | null;
}) {
  const supabase = await createClient();
  if (!supabase) {
    return null; // parent already handled the unconfigured state
  }

  const nowIso = new Date().toISOString();
  const [
    { roster, error: rosterError },
    { invites, error: invitesError },
    { snapshots, error: snapshotsError },
    { snapshots: history, error: historyError },
    { value: policyValue, error: policyError },
    { actions, error: actionsError },
  ] = await Promise.all([
    listTeamRoster(supabase, teamId, viewerId),
    listTeamInvites(supabase, teamId),
    listLatestTeamSnapshots(supabase, teamId),
    listTeamSnapshotHistory(supabase, teamId),
    getTeamSharePolicyValue(supabase, teamId),
    listTeamActions(supabase, role, teamId),
  ]);
  const teamPolicy = policyError ? null : parseTeamSharePolicy(policyValue);

  const summary = summarizeTeamWorkload(roster.length, snapshots, nowIso);
  const trend = summarizeTeamTrend(history, nowIso);
  const forecast = forecastTeamCapacity(roster.length, history, nowIso);
  const actionFollowThrough = buildActionFollowThrough(actions, history);
  const snapshotByUser = new Map<string, LatestSnapshot>(
    snapshots.map((snapshot) => [snapshot.userId, snapshot]),
  );
  const capacity = metricStat(summary.reliableCapacity, summary.sharingCount);
  const reactive = metricStat(summary.reactive, summary.sharingCount);
  const meetings = metricStat(summary.meetings, summary.sharingCount);
  const fragmentation = metricStat(summary.fragmentation, summary.sharingCount);
  const timelineIdentities = roster.map((entry) => ({
    userId: entry.userId,
    name: entry.displayName ?? entry.email ?? `member-${entry.userId.slice(0, 8)}`,
  }));
  const timelineAnchorWeek = history.reduce(
    (latest, point) => point.weekId > latest ? point.weekId : latest,
    currentIsoWeekId(),
  );
  const medianReviewCoverage = median(
    snapshots.flatMap((snapshot) => {
      const coverage = reviewCoveragePct(
        snapshot.reviewedBlocks,
        snapshot.eligibleBlocks,
      );
      return coverage === null ? [] : [coverage];
    }),
  );
  const ownSnapshot = snapshotByUser.get(viewerId) ?? null;
  const ownSnapshotFreshness = ownSnapshot
    ? snapshotFreshness(ownSnapshot, nowIso)
    : null;
  const openActionsCount = actions.filter((action) => action.status === "open").length;

  return (
    <div className="team-manager-workspace team-screen">
      <section data-web-view="today" className="team-workspace-view" aria-labelledby="team-today-title">
        <TeamWorkspaceHeader headingId="team-today-title" manager role={role} teamName={teamName} />

      <div className="team-status-rail team-desktop-evidence-rail team-evidence-rail" aria-label="Team evidence coverage">
        <div>
          <span>Active roster</span>
          <strong>{rosterError ? "—" : roster.length}</strong>
          <small>RLS-scoped members</small>
        </div>
        <div>
          <span>Sharing now</span>
          <strong>{snapshotsError ? "—" : summary.sharingCount}</strong>
          <small>approved snapshots</small>
        </div>
        <div>
          <span>Coverage</span>
          <strong>
            {rosterError || snapshotsError || roster.length === 0
              ? "—"
              : `${Math.round((summary.sharingCount / roster.length) * 100)}%`}
          </strong>
          <small>unknown stays unknown</small>
        </div>
        <div>
          <span>Freshness</span>
          <strong>{formatDateTime(summary.lastUpdatedAt)}</strong>
          <small>latest team sync</small>
        </div>
      </div>

      <div className="team-decision-grid team-desktop-decision-grid team-decision-layout">
        <section className="panel team-member-signal team-decision-card team-decision-card--primary" aria-labelledby="team-decision-now-title">
          <span className="team-section-kicker">Decision now</span>
          <h2 id="team-decision-now-title">
            {snapshotsError || rosterError
              ? "Team evidence could not be loaded"
              : summary.lowHeadroom.count > 0
                ? "Review pressure before accepting more work"
                : "No fresh signal currently needs escalation"}
          </h2>
          <p>
            {snapshotsError || rosterError
              ? "Current team evidence could not be loaded, so Weekform is not presenting a reassuring fallback."
              : summary.lowHeadroom.count > 0
                ? `${summary.lowHeadroom.count} fresh approved ${summary.lowHeadroom.count === 1 ? "signal crosses" : "signals cross"} the low-headroom coordination threshold. ${summary.lowHeadroom.excludedStaleCount} stale ${summary.lowHeadroom.excludedStaleCount === 1 ? "snapshot is" : "snapshots are"} excluded.`
                : `${summary.sharingCount} of ${roster.length} members have an approved summary available. Missing and stale evidence is never treated as capacity.`}
          </p>
          <div className="team-desktop-decision-metrics">
            <div>
              <span>Median reliable capacity</span>
              <strong>{capacity.value}</strong>
            </div>
            <div>
              <span>Median review coverage</span>
              <strong>{medianReviewCoverage === null ? "Not shared" : `${Math.round(medianReviewCoverage)}%`}</strong>
            </div>
            <div>
              <span>Open coordination actions</span>
              <strong>{actionsError ? "—" : openActionsCount}</strong>
            </div>
          </div>
          <div className="team-card-actions">
            <Link href={`/teams/${teamId}/briefing`} className="button button-primary">
              Open team briefing
            </Link>
            <Link href={`/teams/${teamId}?screen=week`} className="button button-secondary">
              Test what fits
            </Link>
          </div>
        </section>

        <aside className="panel team-member-boundary team-decision-card" aria-labelledby="team-self-boundary-title">
          <span className="team-section-kicker">Trust boundary</span>
          <h2 id="team-self-boundary-title">You are included in the team data</h2>
          <p>
            Your manager account is part of the active roster just like every other member.
            {ownSnapshot
              ? ownSnapshotFreshness === "fresh" || ownSnapshotFreshness === "aging"
                ? ` Your approved week ${ownSnapshot.weekId} snapshot is included in the current team evidence.`
                : ` Your approved week ${ownSnapshot.weekId} snapshot is visible but excluded from current aggregates because it is stale.`
              : " You have not approved a snapshot for this team yet, so your workload stays unknown rather than becoming zero."}
          </p>
          <ul className="team-member-boundary-list">
            <li><ShieldCheck aria-hidden="true" /> Member-controlled sharing.</li>
            <li><ShieldCheck aria-hidden="true" /> Medians and ranges, never rankings.</li>
            <li><ShieldCheck aria-hidden="true" /> Raw activity, notes, screenshots, and window titles stay unavailable.</li>
          </ul>
          {!ownSnapshot ? (
            <MacAppLink className="button button-secondary team-open-desktop-action">
              Get Weekform for Mac to review sharing
            </MacAppLink>
          ) : null}
        </aside>
      </div>

      <section
        className="panel team-overview-panel team-detail-panel"
        id="overview"
        aria-labelledby="workload-title"
      >
        <div className="team-section-heading">
          <div>
            <span className="team-section-kicker">Current team pulse</span>
            <h2 id="workload-title">Workload overview</h2>
            <p>
              Team medians from the latest member-approved snapshots. Missing
              signals stay unknown and never become zero.
            </p>
          </div>
        </div>

        {snapshotsError ? (
          <div className="form-alert" role="alert">
            Shared snapshots could not be loaded right now. Reload the page to
            try again.
          </div>
        ) : rosterError ? (
          <div className="form-alert" role="alert">
            The member list could not be loaded, so team aggregates can&apos;t
            be computed right now. Reload the page to try again.
          </div>
        ) : summary.sharingCount === 0 ? (
          <div className="empty-state" style={{ marginTop: 12 }}>
            No member has shared a workload snapshot yet. Members opt in from
            Account &amp; Sharing in Weekform for Mac — nothing is collected
            automatically, and this page only ever shows what each member
            explicitly approved.
          </div>
        ) : (
          <>
            <div className="status-line" style={{ marginTop: 0 }}>
              <span>
                Aggregates {approvedSnapshotProvenance(summary.sharingCount, summary.memberCount)}
              </span>
              <span>Last update: {formatDateTime(summary.lastUpdatedAt)}</span>
            </div>
            <div className="stat-grid">
              <div className="stat">
                <span className="stat-label">Median reliable capacity</span>
                <span className="stat-value">{capacity.value}</span>
                <span className="stat-note">{capacity.note}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Median reactive load</span>
                <span className="stat-value">{reactive.value}</span>
                <span className="stat-note">{reactive.note}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Median meetings</span>
                <span className="stat-value">{meetings.value}</span>
                <span className="stat-note">{meetings.note}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Median fragmented work</span>
                <span className="stat-value">{fragmentation.value}</span>
                <span className="stat-note">{fragmentation.note}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Low headroom</span>
                <span className="stat-value">
                  {summary.lowHeadroom.count}
                  <span className="stat-note">
                    {" "}
                    of {summary.lowHeadroom.consideredCount} considered
                  </span>
                </span>
                <span className="stat-note">
                  Prototype threshold: shared reliable capacity below{" "}
                  {LOW_HEADROOM_THRESHOLD_PCT}%. Stale (
                  {summary.lowHeadroom.excludedStaleCount}) and not-shared (
                  {summary.lowHeadroom.excludedNotSharedCount}) members are
                  excluded, never counted as zero.
                </span>
              </div>
            </div>
            <p style={{ marginTop: 16 }}>
              Aggregates are medians and ranges {approvedSnapshotProvenance(summary.sharingCount, summary.memberCount)}
              {" "}— never sums, ranks, or scores. Each approved snapshot is
              member-reviewed in Weekform for Mac; thresholds are
              prototype heuristics, not benchmarks.
            </p>
          </>
        )}
      </section>

      {historyError ? (
        <div className="form-alert" role="alert">The team workload horizon could not be loaded. No placeholder timeline is shown.</div>
      ) : (
        <TeamGantt
          anchorWeekId={timelineAnchorWeek}
          forecast={forecast}
          history={history}
          identities={timelineIdentities}
          teamRole="manager"
          todayIso={nowIso}
          viewerId={viewerId}
        />
      )}

      <section
        className="panel team-roster-section"
        id="people"
        aria-labelledby="members-title"
      >
        <div className="team-section-heading">
          <div>
            <span className="team-section-kicker">People and consent</span>
            <h2 id="members-title">Team roster</h2>
            <p>
              Account identity and each member&apos;s latest sharing state. Workload
              details appear only when that member has approved a snapshot.
            </p>
          </div>
          <span className="team-section-count">
            <UsersRound aria-hidden="true" />
            {roster.length} {roster.length === 1 ? "member" : "members"}
          </span>
        </div>
        {rosterError ? (
          <div className="form-alert" role="alert">
            The member list could not be loaded right now. Reload the page to
            try again.
          </div>
        ) : roster.length === 0 ? (
          <div className="empty-state">No active members yet.</div>
        ) : (
          <ul className="member-grid team-member-grid">
            {roster.map((entry) => {
              const snapshot = snapshotByUser.get(entry.userId) ?? null;
              const name =
                entry.displayName ?? `member-${entry.userId.slice(0, 8)}`;
              return (
                <li
                  className={`member-card team-member-card${snapshot ? " is-sharing" : " is-private"}`}
                  key={entry.userId}
                >
                  <div className="team-member-identity">
                    <span className="team-member-avatar" aria-hidden="true">
                      {memberInitials(name, entry.email)}
                    </span>
                    <div>
                      <h3>
                        {name}
                        {entry.isSelf ? <span className="badge">You</span> : null}
                      </h3>
                      {entry.email ? (
                        <a
                          className="member-card-email mono"
                          href={`mailto:${entry.email}`}
                        >
                          <Mail aria-hidden="true" />
                          {entry.email}
                        </a>
                      ) : (
                        <span className="member-card-email is-unavailable">
                          Account email unavailable
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="member-card-badges">
                    <span className="badge">{entry.role}</span>
                    {snapshot ? (
                      <>
                        <span className="badge badge-ok">
                          {shareLevelLabel(snapshot.shareLevel)}
                        </span>
                        <FreshnessBadge
                          freshness={snapshotFreshness(snapshot, nowIso)}
                        />
                      </>
                    ) : (
                      <span className="badge">Not sharing</span>
                    )}
                  </div>

                  <div className="team-member-consent-line">
                    <span aria-hidden="true" />
                    {snapshot
                      ? "Member-approved snapshot"
                      : "No workload data shared"}
                  </div>

                  {snapshot ? (
                    <>
                      <p className="team-member-snapshot-meta">
                        Week <span className="mono">{snapshot.weekId}</span> ·
                        synced {formatDateTime(snapshot.observedAt)}
                      </p>
                      <SnapshotMetricList snapshot={snapshot} />
                      <SnapshotRiskFlags snapshot={snapshot} nowIso={nowIso} />
                    </>
                  ) : (
                    <p className="team-member-private-note">
                      Joined {formatDate(entry.joinedAt)}. Sharing is opt-in from
                      Weekform for Mac; absence of data says nothing about this
                      member&apos;s workload.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      </section>

      <section data-web-view="week" className="team-workspace-view" aria-labelledby="team-week-title">
      <header className="team-workspace-view-header">
        <span className="team-section-kicker">Capacity and forecast</span>
        <h1 id="team-week-title">Team capacity</h1>
        <p>Test what fits against shared headroom, with unknown and stale signals kept explicit.</p>
      </header>
      <div className="team-decision-grid">
      <section className="panel team-planning-panel" aria-labelledby="scenario-title">
        <h2 id="scenario-title">Planning scenario</h2>
        <p>
          &quot;What can the team absorb?&quot; — each preset asks whether that
          much additional planned load fits within the headroom members chose
          to share. Verdicts compare the ask to the median of shared current
          headroom (never a sum, rank, or score) and refuse to answer when too
          few members share fresh data.
        </p>
        {snapshotsError || rosterError ? (
          <div className="form-alert" role="alert">
            Planning scenarios need both the member list and shared snapshots.
            Reload the page to try again.
          </div>
        ) : (
          <>
            <div className="stat-grid">
              {SCENARIO_ASK_PRESETS_PCT.map((askPct) => (
                <ScenarioStat
                  key={askPct}
                  assessment={assessAbsorption(
                    roster.length,
                    snapshots,
                    { additionalLoadPct: askPct },
                    nowIso,
                  )}
                />
              ))}
            </div>
            <p style={{ marginTop: 16 }}>
              All thresholds here are labeled prototype heuristics, not
              benchmarks. Members who are stale or not sharing are excluded
              from every number — their capacity is unknown, not zero, and the
              verdict only ever speaks for the members counted in its
              denominator.
            </p>
          </>
        )}
      </section>

      </div>
      </section>

      <section data-web-view="history" className="team-workspace-view" aria-labelledby="team-history-title">
      <header className="team-workspace-view-header">
        <span className="team-section-kicker">Observed change</span>
        <h1 id="team-history-title">Team history</h1>
        <p>Compare shared weekly medians and keep changes in consent or coverage visible.</p>
      </header>
      <section className="panel team-trend-panel" aria-labelledby="trend-title">
        <h2 id="trend-title">Weekly trend</h2>
        <p>
          How the team&apos;s shared metrics moved between its two most recent
          weeks of data. {trend.baselineLabel} Drift is a median of per-member
          week-over-week changes — never a sum, rank, or score.
        </p>
        {historyError ? (
          <div className="form-alert" role="alert">
            Snapshot history could not be loaded right now. Reload the page to
            try again.
          </div>
        ) : trend.verdict === "no-history" ? (
          <div className="empty-state" style={{ marginTop: 12 }}>
            No week-over-week history yet
            {trend.currentWeekId ? (
              <>
                {" "}
                — only week <span className="mono">{trend.currentWeekId}</span>{" "}
                has shared data so far
              </>
            ) : null}
            . Trends appear once two distinct weeks have fresh shared data; no
            drift is invented from a single week
            {trend.excludedStaleCount > 0
              ? `, and ${trend.excludedStaleCount} stale snapshot${trend.excludedStaleCount === 1 ? " was" : "s were"} excluded rather than treated as current`
              : ""}
            .
          </div>
        ) : (
          <>
            <div className="status-line" style={{ marginTop: 0 }}>
              <span>
                Week <span className="mono">{trend.currentWeekId}</span> vs{" "}
                <span className="mono">{trend.priorWeekId}</span>
              </span>
              <span>
                Excluded from medians: {trend.excludedStaleCount} stale ·{" "}
                {trend.noHistoryCount} without prior-week data ·{" "}
                {trend.shareLevelChangedCount} share-level changed
              </span>
            </div>
            <div className="stat-grid">
              {TREND_METRIC_KEYS.map((metricKey) => (
                <TrendStat key={metricKey} trend={trend} metricKey={metricKey} />
              ))}
            </div>
            <p style={{ marginTop: 16 }}>
              Members without a prior week show as &quot;no history&quot;, never
              a zero delta; metrics unshared in either week stay out of the
              medians; a member whose share level changed between the weeks is
              excluded from every median because the pair is not comparable.
            </p>
          </>
        )}
      </section>

      </section>

      <section data-web-view="week" className="team-workspace-view team-workspace-view-continuation">
      <section className="panel team-forecast-panel" aria-labelledby="forecast-title">
        <h2 id="forecast-title">Next-week forecast</h2>
        <p>
          What the team&apos;s own shared history suggests next week looks
          like: for each shared metric, the median of up to{" "}
          {forecast.windowWeeks} recent weekly team medians, with the range
          those weeks spanned — never a sum, rank, or score, and never a
          per-member prediction. {forecast.basisLabel}
        </p>
        {historyError || rosterError ? (
          <div className="form-alert" role="alert">
            Forecasts need both the member list and snapshot history. Reload
            the page to try again.
          </div>
        ) : forecast.verdict === "no-history" ? (
          <div className="empty-state" style={{ marginTop: 12 }}>
            No member has shared a workload snapshot yet, so there is nothing
            to forecast. Members opt in from Account &amp; Sharing in Weekform
            for Mac — nothing is collected automatically, and forecasts start
            from the first week with an approved snapshot.
          </div>
        ) : forecast.verdict === "insufficient-shared-data" ? (
          <div className="empty-state" style={{ marginTop: 12 }}>
            Insufficient shared data: only {forecast.sharedCount} of{" "}
            {forecast.memberCount} members have current shared snapshots —
            below the prototype minimum ({forecast.minSharedCount} members and{" "}
            {Math.round(forecast.minSharedRatio * 100)}% of the roster)
            {forecast.excludedStaleCount > 0
              ? `, and ${forecast.excludedStaleCount} stale snapshot${forecast.excludedStaleCount === 1 ? " was" : "s were"} excluded rather than treated as current`
              : ""}
            . No forecast number is shown from partial data; unknown is not
            zero. Forecasts appear once enough members share from Account
            &amp; Sharing in Weekform for Mac.
          </div>
        ) : (
          <>
            <div className="status-line" style={{ marginTop: 0 }}>
              <span>
                Forecast for the week after{" "}
                <span className="mono">{forecast.latestWeekId}</span>
              </span>
              <span>
                Coverage {approvedSnapshotProvenance(forecast.sharedCount, forecast.memberCount)}
                {forecast.excludedStaleCount > 0
                  ? ` · ${forecast.excludedStaleCount} stale excluded`
                  : ""}
              </span>
            </div>
            <div className="stat-grid">
              {FORECAST_METRIC_KEYS.map((metricKey) => (
                <ForecastStat
                  key={metricKey}
                  forecast={forecast}
                  metricKey={metricKey}
                />
              ))}
            </div>
            <p style={{ marginTop: 16 }}>
              {forecast.calibrationSummary.scoredCount === 0
                ? "Calibration starts with the second shared week: each past forecast is replayed against the actual that later arrived, so the track record is measured, never asserted."
                : `Calibration across all metrics: ${forecast.calibrationSummary.hitCount} of ${forecast.calibrationSummary.scoredCount} past forecasts landed inside their stated range (${forecast.calibrationSummary.hitRatePct}%), with a mean error of ${forecast.calibrationSummary.meanAbsErrorPts} pts against each week's actual team median.`}{" "}
              Forecasts are prototype heuristics {approvedSnapshotProvenance(forecast.sharedCount, forecast.memberCount)},
              {" "}not benchmarks or commitments; members who are
              stale or not sharing are excluded from every number — their
              capacity is unknown, not zero.
            </p>
          </>
        )}
      </section>

      </section>

      <section data-web-view="agent" className="team-workspace-view" aria-labelledby="team-agent-title">
      <header className="team-workspace-view-header team-workspace-agent-header">
        <div>
          <span className="team-section-kicker">Evidence-grounded coordination</span>
          <h1 id="team-agent-title">Team briefing</h1>
          <p>Turn the current approved signals into a concise briefing, then propose actions that remain approval-gated.</p>
        </div>
        <Link href={`/teams/${teamId}/briefing`} className="button button-primary">
          Open team briefing
        </Link>
      </header>
      <div id="decisions" className="team-actions-section">
      <ManagerActionsPanel
        teamId={teamId}
        actions={actions}
        followThrough={actionFollowThrough}
        riskOptions={ACTION_RISK_OPTIONS}
        loadError={actionsError}
        actionError={actionError}
      />
      </div>

      </section>

      <section data-web-view="settings" className="team-workspace-view" aria-labelledby="team-settings-title">
      <header className="team-workspace-view-header">
        <span className="team-section-kicker">Membership and consent</span>
        <h1 id="team-settings-title">Team controls</h1>
        <p>Set the maximum sharing level, invite members, and inspect invite status.</p>
      </header>
      <div className="team-controls-grid" id="controls">
      <section className="panel team-policy-panel" aria-labelledby="share-policy-title">
        <h2 id="share-policy-title">Team share policy</h2>
        <p>
          Cap how much structure this team receives from members&apos; future
          syncs. {TEAM_POLICY_NARROWING_NOTE} Members who chose a narrower
          level than the cap keep their own choice; metrics a member never
          consented to are never sent, cap or no cap.
        </p>
        {policyError ? (
          <div className="form-alert" role="alert">
            The team share policy could not be loaded right now. Reload the
            page to try again.
          </div>
        ) : (
          <>
            <p>
              <strong>Current policy:</strong>{" "}
              {describeTeamSharePolicy(teamPolicy)}
            </p>
            <form className="team-policy-form" action={updateTeamSharePolicy}>
              <input type="hidden" name="team_id" value={teamId} />
              <fieldset className="team-share-choice-fieldset">
                <legend>Choose the team maximum</legend>
                <span className="team-share-choice-helper">
                  Select the most detail this team may receive. A member&apos;s
                  own consent can always be narrower.
                </span>
                <div className="team-share-choice-grid">
                  {TEAM_SHARE_POLICY_OPTIONS.map((option) => {
                    const selected =
                      option.value === (teamPolicy?.maxShareLevel ?? "none");
                    return (
                      <label className="team-share-choice-card" key={option.value}>
                        <input
                          type="radio"
                          name="share_policy_level"
                          value={option.value}
                          defaultChecked={selected}
                        />
                        <span className="team-share-choice-indicator" aria-hidden="true" />
                        <span className="team-share-choice-copy">
                          <span className="team-share-choice-eyebrow">
                            {option.eyebrow}
                          </span>
                          <strong>{option.title}</strong>
                          <small>{option.description}</small>
                          <span className="team-share-choice-scope" aria-hidden="true">
                            {option.scope.map((item) => (
                              <span key={item}>{item}</span>
                            ))}
                          </span>
                        </span>
                        {selected ? (
                          <span className="team-share-choice-current">Current</span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <FormSubmitButton
                className="button button-secondary"
                pendingLabel="Saving policy…"
              >
                Save share policy
              </FormSubmitButton>
            </form>
            <p className="team-policy-footnote">
              The cap is enforced on each member&apos;s device before anything
              is uploaded, and their consent preview shows exactly what the
              capped payload contains. Snapshots already shared are unaffected;
              members can delete them from their dashboard at any time.
            </p>
          </>
        )}
      </section>

      <section className="panel team-invite-panel" aria-labelledby="invite-title">
        <h2 id="invite-title">Invite a teammate</h2>
        <p>
          Invites are member-role, single-use links tied to one email address.
          Only the link&apos;s hash is stored server-side.
        </p>
        <InviteForm teamId={teamId} />
      </section>

      <section className="panel team-invites-panel" aria-labelledby="invites-title">
        <h2 id="invites-title">Sent invites</h2>
        {invitesError ? (
          <div className="form-alert" role="alert">
            Sent invites could not be loaded right now. Reload the page to try
            again.
          </div>
        ) : invites.length === 0 ? (
          <p>No invites sent yet.</p>
        ) : (
          <div className="team-table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">
              Invites sent for this team
            </caption>
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Status</th>
                <th scope="col">Expires</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => {
                const status = inviteStatus(invite);
                return (
                  <tr key={invite.id}>
                    <td className="mono">{invite.email}</td>
                    <td>{invite.role}</td>
                    <td>
                      {status === "accepted"
                        ? `Accepted ${formatDate(invite.acceptedAt as string)}`
                        : status === "expired"
                          ? "Expired"
                          : "Pending"}
                    </td>
                    <td>{formatDate(invite.expiresAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
        <p style={{ marginTop: 12 }}>
          Invite links are shown once, at creation. If a link is lost or
          expired, create a new invite for the same email.
        </p>
      </section>
      </div>
      </section>
    </div>
  );
}
