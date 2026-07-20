import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { listUserTeams, type TeamMembershipSummary } from "@/lib/teams";
import { listOwnLatestSnapshots, type LatestSnapshot } from "@/lib/snapshots";
import {
  FreshnessBadge,
  SnapshotMetricList,
  formatDateTime,
  shareLevelLabel,
  snapshotFreshness,
} from "@/components/WorkloadSnapshot";
import { createTeam, deleteCloudHistory, leaveTeam } from "@/app/teams/actions";
import { describeCloudRetention } from "@/lib/retention";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { RequestFreshnessRefresh } from "@/components/RequestFreshnessRefresh";
import { PersonalReplicaRealtime } from "@/components/PersonalReplicaRealtime";
import { listOwnPersonalReplicas, type PersonalReplicaView } from "@/lib/personalReplica";
import { deletePersonalReplicaHistory } from "./personalActions";
import {
  getSingleManagerTeamPath,
  managerAccessMemberships,
} from "@/lib/managerAccess";
import { WorkspaceModeToggle } from "@/components/WorkspaceModeToggle";
import { PersonalWeekOverview } from "@/components/PersonalWeekOverview";
import { IndividualWorkspaceShell } from "@/components/IndividualWorkspaceShell";
import { PersonalForecastScreen } from "@/components/PersonalForecastScreen";
import { PersonalAgentWorkspace } from "@/components/PersonalAgentWorkspace";
import { PersonalTodayScreen } from "@/components/PersonalTodayScreen";
import { PersonalWeeklyReviewScreen } from "@/components/PersonalWeeklyReviewScreen";
import { PersonalAIUsageScreen } from "@/components/PersonalAIUsageScreen";
import { PersonalSummaryScreen } from "@/components/PersonalSummaryScreen";
import { PersonalAccelerationScreen } from "@/components/PersonalAccelerationScreen";
import { PersonalSkillsLibraryScreen } from "@/components/PersonalSkillsLibraryScreen";
import {
  IndividualHistoryView,
  IndividualSettingsView,
} from "@/components/IndividualHistorySettings";
import { signOut } from "@/app/auth/actions";

export const metadata: Metadata = { title: "Weekform Web" };
export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams: Promise<{ team_error?: string; notice?: string; screen?: string }>;
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

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const supabase = await createClient();

  if (!supabase) {
    // Unconfigured deployment: middleware could not protect this route,
    // so render an honest setup state rather than pretending to be signed in.
    return (
      <>
        <SiteHeader />
        <main className="container">
          <div className="page-head">
            <h1>Weekform Web</h1>
          </div>
          <WorkspaceModeToggle
            managerAvailable={false}
            managerHref="/manager-access"
            mode="individual"
          />
          <div className="error-panel" role="alert">
            <h2>Supabase is not configured</h2>
            <p>
              This deployment has no{" "}
              <span className="mono">NEXT_PUBLIC_SUPABASE_URL</span> /{" "}
              <span className="mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span>, so
              accounts and dashboards are unavailable. See{" "}
              <span className="mono">apps/web/README.md</span> for setup.
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
    redirect("/login?next=/app");
  }

  const params = await searchParams;
  const profile = await getOrCreateProfile(supabase, user);
  const greetingName = profile?.display_name?.trim() || user.email || "there";
  const { teams, error: teamsError } = await listUserTeams(supabase, user.id);
  const { snapshots: ownSnapshots, error: snapshotsError } =
    await listOwnLatestSnapshots(supabase, user.id);
  const {
    replicas: personalReplicas,
    error: personalReplicaError,
    errorKind: personalReplicaErrorKind,
  } =
    await listOwnPersonalReplicas(supabase);
  const managedTeams = managerAccessMemberships(teams);
  const managerHref = getSingleManagerTeamPath(managedTeams) ?? "/manager-access";
  const currentReplica = personalReplicas[0] ?? null;

  return (
    <IndividualWorkspaceShell
      greetingName={greetingName}
      reliableCapacity={currentReplica?.payload.capacity.reliableNewWorkCapacityPct ?? null}
      reviewCount={currentReplica?.payload.blocks.filter((block) => !block.userVerified).length ?? 0}
      managerAccessAvailable={managedTeams.length > 0}
      managerHref={managerHref}
      accountActions={(
        <>
          <span className="web-toolbar-account" title={user.email ?? undefined}>{user.email}</span>
          <form action={signOut}>
            <button className="web-toolbar-button" type="submit">Sign out</button>
          </form>
        </>
      )}
      initialScreen={params.screen}
    >
      <div className="container workspace-shell">
        {personalReplicaError ? (
          <div className="form-alert web-replica-alert" role="alert">
            {personalReplicaErrorKind === "integrity" ? (
              <>
                <strong>Your private Web data could not be validated.</strong>
                <p>No workload replica is being shown. Resync from Weekform for Mac, then reload this page.</p>
              </>
            ) : personalReplicaErrorKind === "load" ? (
              <>
                <strong>Your private Web data could not be loaded.</strong>
                <p>No workload replica is being shown. Reload this page or check your connection.</p>
              </>
            ) : null}
          </div>
        ) : null}
        {params.notice ? (
          <div className="form-notice" role="status">
            {params.notice}
          </div>
        ) : null}
        <div data-web-view="today">
          <PersonalTodayScreen replicas={personalReplicas} error={personalReplicaError} />
        </div>
        <div data-web-view="week">
        <div data-web-subview="capacity">
        <RequestFreshnessRefresh />
        <PersonalReplicaRealtime userId={user.id} />

        <PersonalCapacityScreen replicas={personalReplicas} error={personalReplicaError} />
        </div>
        <div data-web-subview="forecast">
          <PersonalForecastScreen replicas={personalReplicas.map((replica) => replica.payload)} />
        </div>
        <div data-web-subview="review">
          <PersonalWeeklyReviewScreen replicas={personalReplicas} error={personalReplicaError} />
        </div>
        <div data-web-subview="usage">
          <PersonalAIUsageScreen />
        </div>
        <div data-web-subview="summary">
          <PersonalSummaryScreen replicas={personalReplicas} error={personalReplicaError} />
        </div>
        </div>

        <div data-web-view="settings">
        <IndividualSettingsView accountEmail={user.email ?? "your account"} accountAndSharing={(
        <>
        <section id="teams" className="workspace-section" aria-labelledby="teams-title">
          <div className="workspace-section-heading">
            <span>Optional coordination</span>
            <h2>Teams</h2>
            <p>Create or join a team only when shared planning improves the decision.</p>
          </div>
          {teamsError ? (
            <div className="error-panel" role="alert">
              <h2>Your teams could not be loaded</h2>
              <p>
                This is usually temporary — reload the page. Team creation and
                invites below still work.
              </p>
            </div>
          ) : teams.length > 0 ? (
            <div className="panel">
              <h2 id="teams-title">Your teams</h2>
              <table className="data-table">
                <caption className="visually-hidden">
                  Teams you belong to, with your role in each
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Team</th>
                    <th scope="col">Your role</th>
                    <th scope="col">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.teamId}>
                      <td>
                        <Link
                          href={`/teams/${team.teamId}`}
                          className="text-link"
                        >
                          {team.teamName}
                        </Link>
                      </td>
                      <td>{team.role}</td>
                      <td>{formatDate(team.joinedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel">
              <h2 id="teams-title">You&apos;re not part of a team yet</h2>
              <p>
                Weekform works fully on your own — teams are optional. If you
                coordinate work for others, or someone invited you, start here.
              </p>
            </div>
          )}

          {params.team_error ? (
            <div className="form-alert" role="alert" style={{ marginTop: 16 }}>
              {params.team_error}
            </div>
          ) : null}

          <div className="card-grid">
            <article className="choice-card">
              <span className="badge">Teams</span>
              <h2>Create a team</h2>
              <p>
                Set up a team, invite teammates with a link, and see the
                capacity signals they choose to share. You become the
                team&apos;s owner.
              </p>
              <form action={createTeam}>
                <div className="field">
                  <label htmlFor="team-name">Team name</label>
                  <input
                    id="team-name"
                    name="team_name"
                    type="text"
                    autoComplete="off"
                    maxLength={120}
                    placeholder="e.g. Analytics Guild"
                    required
                  />
                </div>
                <FormSubmitButton
                  className="button button-primary"
                  pendingLabel="Creating team…"
                >
                  Create team
                </FormSubmitButton>
              </form>
            </article>
            <article className="choice-card">
              <span className="badge">Teams</span>
              <h2>Accept an invite</h2>
              <p>
                Got an invite link from a manager? Open it directly, or paste
                it on the invite page. Invites are single-use, tied to your
                email, and expire after 7 days.
              </p>
              <Link href="/invite" className="button button-secondary">
                Enter an invite link
              </Link>
            </article>
            <article className="choice-card">
              <span className="badge">Available now</span>
              <h2>Use Weekform personally</h2>
              <p>
                Download the Mac app and get private workload intelligence for
                your own week. Nothing is shared with anyone unless you later
                join a team and approve it.
              </p>
              <Link href="/download" className="button button-primary">
                Get the Mac app
              </Link>
            </article>
          </div>
        </section>

        {managedTeams.length > 0 ? (
          <section id="manager-entry" className="manager-entry" aria-labelledby="manager-entry-title">
            <div>
              <span className="badge">Manager Access</span>
              <h2 id="manager-entry-title">Coordinate from approved signals—not raw activity.</h2>
              <p>
                Open the manager workspace for member-approved summaries, briefings,
                scenarios, and approval-gated coordination actions.
              </p>
            </div>
            <Link href="/manager-access" className="button button-primary">
              Open Manager Access <span aria-hidden="true">→</span>
            </Link>
          </section>
        ) : null}
        <SharedWorkloadSection
          teams={teams}
          snapshots={ownSnapshots}
          snapshotsError={snapshotsError}
        />
        <details className="disclosure web-private-history-control">
          <summary>Delete private Web history</summary>
          <p>Turn Private Web workspace off on your Mac first, or a later desktop sync can publish the current week again. This removes your replicas and pending review requests; local Mac data stays untouched.</p>
          <form action={deletePersonalReplicaHistory}>
            <FormSubmitButton
              className="button button-danger"
              pendingLabel="Deleting Web history…"
              confirmMessage="Permanently delete your private Web replicas and pending review requests? Your local Mac data will stay untouched."
            >
              Delete replicas and pending requests
            </FormSubmitButton>
          </form>
        </details>
        </>
        )} />
        </div>

        <div data-web-view="history">
          <div data-web-subview="activity">
            <IndividualHistoryView replicas={personalReplicas} error={personalReplicaError} initialTab="activity" showTabs={false} />
          </div>
          <div data-web-subview="audit">
            <IndividualHistoryView replicas={personalReplicas} error={personalReplicaError} initialTab="audit" showTabs={false} />
          </div>
        </div>

        <div data-web-view="agent">
          <div data-web-subview="agent">
            <PersonalAgentWorkspace replica={currentReplica?.payload ?? null} />
          </div>
          <div data-web-subview="accelerate">
            <PersonalAccelerationScreen
              replica={currentReplica?.payload ?? null}
              error={personalReplicaError}
            />
          </div>
          <div data-web-subview="skills">
            <PersonalSkillsLibraryScreen />
          </div>
        </div>
      </div>
    </IndividualWorkspaceShell>
  );
}

function PersonalCapacityScreen({
  replicas,
  error,
}: {
  replicas: PersonalReplicaView[];
  error: string | null;
}) {
  const current = replicas[0] ?? null;
  return (
    <section className="web-desktop-screen capacity-screen" aria-label="Weekly capacity">
      {error ? (
        <div className="form-alert web-screen-empty" role="alert">Your private Web workspace could not be loaded. Reload the page to try again.</div>
      ) : !current ? (
        <div className="panel web-screen-empty"><h2>No review-safe week is connected</h2><p>Enable Private Web workspace in Weekform for Mac to publish the derived capacity fields this screen can display.</p><Link href="/download" className="button button-primary">Open Weekform for Mac</Link></div>
      ) : (
        <div className="web-capacity-panel">
          <PersonalWeekOverview replica={current.payload} />
          <div className="status-line" aria-label="Private Web replica status"><span>{current.weekId} · Received {formatDateTime(current.syncedAt)} · {current.payload.blocks.length} review-safe block{current.payload.blocks.length === 1 ? "" : "s"}</span><span>Ephemeral browser view · no workload cache</span></div>
        </div>
      )}
    </section>
  );
}

/**
 * The member's own cloud footprint: what each team currently sees from them,
 * plus the two controls this website is authorized to offer — deleting their
 * own shared history (RLS-scoped delete) and leaving a team (leave_team RPC).
 * Changing WHAT is shared happens only in Weekform for Mac.
 */
function SharedWorkloadSection({
  teams,
  snapshots,
  snapshotsError,
}: {
  teams: TeamMembershipSummary[];
  snapshots: LatestSnapshot[];
  snapshotsError: string | null;
}) {
  const nowIso = new Date().toISOString();
  const snapshotByTeam = new Map<string, LatestSnapshot>(
    snapshots.map((snapshot) => [snapshot.teamId, snapshot]),
  );
  const teamNames = new Map(teams.map((team) => [team.teamId, team.teamName]));
  // Snapshots can outlive a membership (e.g. after leaving a team); keep them
  // visible so the delete control still reaches them.
  const orphanSnapshots = snapshots.filter(
    (snapshot) => !teamNames.has(snapshot.teamId),
  );

  return (
    <section id="sharing" className="workspace-section" aria-labelledby="sharing-title">
      <div className="workspace-section-heading">
        <span>Consent boundary</span>
        <h2 id="sharing-title">Shared workload</h2>
        <p>One inspectable view of exactly what each team can see from you.</p>
      </div>
      <div className="panel">
        <h3>Your shared workload</h3>
        {snapshotsError ? (
          <div className="form-alert" role="alert">
            Your shared snapshots could not be loaded right now. Reload the
            page to try again.
          </div>
        ) : teams.length === 0 && snapshots.length === 0 ? (
          <p>
            You&apos;re not sharing anything with anyone. If you join a team,
            sharing stays off until you explicitly turn it on in{" "}
            <strong>Account &amp; Sharing in Weekform for Mac</strong>.
          </p>
        ) : (
          <>
            <p>
              This is exactly what each team can currently see from you.
              Metrics marked &quot;Not shared&quot; are omitted from the cloud
              entirely — never sent as zero. To change or stop sharing, open{" "}
              <strong>Account &amp; Sharing in Weekform for Mac</strong>; this
              website can only delete what was already shared.
            </p>
            <ul className="member-grid" style={{ listStyle: "none", padding: 0 }}>
              {teams.map((team) => {
                const snapshot = snapshotByTeam.get(team.teamId) ?? null;
                return (
                  <li className="member-card" key={team.teamId}>
                    <h3>
                      <Link
                        href={`/teams/${team.teamId}`}
                        className="text-link"
                      >
                        {team.teamName}
                      </Link>
                    </h3>
                    <div className="member-card-badges">
                      <span className="badge">Your role: {team.role}</span>
                      {snapshot ? (
                        <>
                          <span className="badge">
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
                    {snapshot ? (
                      <>
                        <p style={{ margin: 0, fontSize: 13 }}>
                          Week <span className="mono">{snapshot.weekId}</span>{" "}
                          · last synced {formatDateTime(snapshot.observedAt)}
                        </p>
                        <SnapshotMetricList snapshot={snapshot} />
                      </>
                    ) : (
                      <p style={{ margin: 0, fontSize: 13 }}>
                        You haven&apos;t shared a snapshot with this team.
                        Nothing is shared automatically.
                      </p>
                    )}
                    <div className="panel-actions">
                      {snapshot ? (
                        <form action={deleteCloudHistory}>
                          <input
                            type="hidden"
                            name="team_id"
                            value={team.teamId}
                          />
                          <FormSubmitButton
                            className="button button-secondary"
                            pendingLabel="Deleting history…"
                            confirmMessage={`Permanently delete the cloud history you shared with ${team.teamName}? Data on your Mac will stay untouched.`}
                          >
                            Delete my cloud history
                          </FormSubmitButton>
                        </form>
                      ) : null}
                      {team.role !== "owner" ? (
                        <form action={leaveTeam}>
                          <input
                            type="hidden"
                            name="team_id"
                            value={team.teamId}
                          />
                          <FormSubmitButton
                            className="button button-ghost"
                            pendingLabel="Leaving team…"
                            confirmMessage={`Leave ${team.teamName}? Future snapshots will stop, but existing cloud history remains until you delete it.`}
                          >
                            Leave team
                          </FormSubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
              {orphanSnapshots.map((snapshot) => (
                <li className="member-card" key={`orphan-${snapshot.teamId}`}>
                  <h3>A team you left</h3>
                  <div className="member-card-badges">
                    <span className="badge">
                      {shareLevelLabel(snapshot.shareLevel)}
                    </span>
                    <FreshnessBadge
                      freshness={snapshotFreshness(snapshot, nowIso)}
                    />
                  </div>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    Week <span className="mono">{snapshot.weekId}</span> · last
                    synced {formatDateTime(snapshot.observedAt)}. You&apos;re
                    no longer a member, but this history still exists until you
                    delete it.
                  </p>
                  <div className="panel-actions">
                    <form action={deleteCloudHistory}>
                      <input
                        type="hidden"
                        name="team_id"
                        value={snapshot.teamId}
                      />
                      <FormSubmitButton
                        className="button button-secondary"
                        pendingLabel="Deleting history…"
                        confirmMessage="Permanently delete the cloud history you shared with this former team? Data on your Mac will stay untouched."
                      >
                        Delete my cloud history
                      </FormSubmitButton>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
            {/* Retention statement derives from the single config constant in
                lib/retention.ts — never hand-written prose that could drift. */}
            <p style={{ marginTop: 16 }}>{describeCloudRetention()}</p>
            <p>
              Deleting cloud history removes only what you shared to the cloud
              — the data on your Mac is untouched. Need the app again?{" "}
              <Link href="/download" className="text-link">
                Download or reinstall Weekform for Mac
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </section>
  );
}
