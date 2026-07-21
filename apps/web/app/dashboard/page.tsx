import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, LogOut, UserPlus, UsersRound } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
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
import { MacAppLink } from "@/components/MacAppLink";
import { RequestFreshnessRefresh } from "@/components/RequestFreshnessRefresh";
import { PersonalReplicaRealtime } from "@/components/PersonalReplicaRealtime";
import {
  listOwnPersonalReplicas,
  listOwnReviewCommands,
  type PersonalReplicaView,
  type ReviewCommandsClient,
} from "@/lib/personalReplica";
import {
  getTeamWorkspacePath,
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
import { PersonalWebDataControl } from "@/components/PersonalWebDataControl";
import {
  IndividualHistoryView,
  IndividualSensitiveBoundaryView,
  IndividualSettingsView,
} from "@/components/IndividualHistorySettings";
import { signOut } from "@/app/auth/actions";
import { resolveIndividualSettingsTab } from "@/lib/individualSettingsRoute";

export const metadata: Metadata = { title: "Weekform Web" };
export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams: Promise<{
    team_error?: string;
    notice?: string;
    screen?: string;
    settings_tab?: string | string[];
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
            teamAvailable={false}
            teamHref="/manager-access"
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
  const { teams, error: teamsError } = await listUserTeams(supabase, user.id);
  const { snapshots: ownSnapshots, error: snapshotsError } =
    await listOwnLatestSnapshots(supabase, user.id);
  const {
    replicas: personalReplicas,
    error: personalReplicaError,
    errorKind: personalReplicaErrorKind,
  } =
    await listOwnPersonalReplicas(supabase);
  const {
    commands: reviewCommands,
    error: reviewCommandsError,
  } = await listOwnReviewCommands(
    supabase as unknown as ReviewCommandsClient,
    personalReplicas[0]?.weekId ?? null,
  );
  const managedTeams = managerAccessMemberships(teams);
  const teamHref = getTeamWorkspacePath(teams) ?? "/manager-access";
  const currentReplica = personalReplicas[0] ?? null;
  return (
    <IndividualWorkspaceShell
      reliableCapacity={currentReplica?.payload.capacity.reliableNewWorkCapacityPct ?? null}
      reviewCount={currentReplica?.payload.blocks.filter((block) => !block.userVerified).length ?? 0}
      activeWeekLabel={currentReplica?.weekId ?? null}
      teamAvailable={teams.length > 0}
      teamHref={teamHref}
      teamRole={teams.length === 1 ? teams[0]?.role : undefined}
      accountActions={(
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
      )}
      initialScreen={params.screen}
    >
      <div className="container workspace-shell">
        {params.notice ? (
          <div className="form-notice" role="status">
            {params.notice}
          </div>
        ) : null}
        <div data-web-view="today">
          <PersonalTodayScreen
            replicas={personalReplicas}
            error={personalReplicaError}
            reviewCommands={reviewCommands}
            reviewCommandsError={reviewCommandsError}
          />
        </div>
        <div data-web-view="week">
        <div data-web-subview="capacity">
        <RequestFreshnessRefresh />
        <PersonalReplicaRealtime userId={user.id} />

        <PersonalCapacityScreen
          replicas={personalReplicas}
          error={personalReplicaError}
          errorKind={personalReplicaErrorKind}
        />
        </div>
        <div data-web-subview="forecast">
          <PersonalForecastScreen
            replicas={personalReplicas.map((replica) => replica.payload)}
            error={personalReplicaError}
          />
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
        <IndividualSettingsView
          key={resolveIndividualSettingsTab(params.settings_tab)}
          accountEmail={user.email ?? "your account"}
          initialTab={resolveIndividualSettingsTab(params.settings_tab)}
          dataControl={(
            <PersonalWebDataControl
              replicaCount={personalReplicas.length}
              pendingReviewCount={reviewCommandsError
                ? null
                : reviewCommands.filter((command) => command.status === "pending").length}
              latestWeekId={currentReplica?.weekId ?? null}
              latestSyncedAt={currentReplica?.syncedAt ?? null}
            />
          )}
          accountAndSharing={(
        <div className="individual-account-sharing">
        <section id="teams" className="account-sharing-section" aria-labelledby="teams-title">
          <div className="settings-row account-sharing-overview-row">
            <span>Optional coordination</span>
            <h2 id="teams-title">Teams</h2>
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
              <h2>Your teams</h2>
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
              <h2>You&apos;re not part of a team yet</h2>
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

          <div className="individual-account-sharing" aria-label="Account and team actions">
            <article className="settings-row account-sharing-operation-row">
              <div className="settings-row-icon" aria-hidden="true"><UsersRound size={18} /></div>
              <div className="settings-row-copy">
                <h3>Create a team</h3>
                <p>Coordinate through member-approved capacity signals. You become the team owner.</p>
              </div>
              <div className="settings-row-status"><strong>Optional</strong><span>Approval-safe sharing</span></div>
              <form action={createTeam} className="individual-team-form">
                <div className="field">
                  <label className="visually-hidden" htmlFor="team-name">Team name</label>
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
            <article className="settings-row account-sharing-operation-row">
              <div className="settings-row-icon" aria-hidden="true"><UserPlus size={18} /></div>
              <div className="settings-row-copy">
                <h3>Accept an invite</h3>
                <p>Join through a single-use invite tied to your signed-in address. Invites expire after seven days.</p>
              </div>
              <div className="settings-row-status"><strong>Invite required</strong><span>Identity checked</span></div>
              <Link href="/invite" className="button button-secondary">
                Enter an invite link
              </Link>
            </article>
            <article className="settings-row account-sharing-operation-row">
              <div className="settings-row-icon" aria-hidden="true"><Download size={18} /></div>
              <div className="settings-row-copy">
                <h3>Weekform for Mac</h3>
                <p>Review local evidence and approve what this Web workspace may display. Raw activity remains on your Mac.</p>
              </div>
              <div className="settings-row-status"><strong>Local source of truth</strong><span>Release status shown on download page</span></div>
              <MacAppLink className="button button-primary">
                View Mac download
              </MacAppLink>
            </article>
          </div>
        </section>

        {teams.length > 0 ? (
          <section id="manager-entry" className="settings-row account-manager-entry" aria-labelledby="manager-entry-title">
            <div>
              <span className="badge">Team</span>
              <h2 id="manager-entry-title">Your connected team workspace.</h2>
              <p>
                {managedTeams.length > 0
                  ? "Coordinate through member-approved summaries, briefings, scenarios, and approval-gated actions."
                  : "Review your membership, sharing boundary, and the snapshot you approved for your team."}
              </p>
            </div>
            <Link href={teamHref} className="button button-primary">
              Open Team <span aria-hidden="true">→</span>
            </Link>
          </section>
        ) : null}
        <SharedWorkloadSection
          teams={teams}
          snapshots={ownSnapshots}
          snapshotsError={snapshotsError}
        />
        </div>
        )} />
        </div>

        <div data-web-view="history">
          <div data-web-subview="activity">
            <IndividualHistoryView replicas={personalReplicas} error={personalReplicaError} initialTab="activity" showTabs={false} />
          </div>
          <div data-web-subview="audit">
            <IndividualHistoryView replicas={personalReplicas} error={personalReplicaError} initialTab="audit" showTabs={false} />
          </div>
          <div data-web-subview="sensitive">
            <IndividualSensitiveBoundaryView />
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
  errorKind,
}: {
  replicas: PersonalReplicaView[];
  error: string | null;
  errorKind: "integrity" | "load" | null;
}) {
  const current = replicas[0] ?? null;
  return (
    <section className="web-desktop-screen capacity-screen" aria-label="Weekly capacity">
      <div className="screen-header capacity-dashboard-header">
        <p className="eyebrow">Weekly capacity</p>
      </div>
      {error ? (
        <div className="form-alert web-screen-empty" role="alert">
          {errorKind === "integrity" ? (
            <>
              <strong>Your private Web data could not be validated.</strong>
              <p>No capacity estimate is being shown. Resync from Weekform for Mac, then reload this page.</p>
            </>
          ) : (
            <>
              <strong>Your private Web data could not be loaded.</strong>
              <p>No capacity estimate is being shown. Reload this page or check your connection.</p>
            </>
          )}
        </div>
      ) : !current ? (
        <div className="panel web-screen-empty"><h2>No review-safe week is connected</h2><p>Enable Private Web workspace in Weekform for Mac to publish the derived capacity fields this screen can display.</p><MacAppLink className="button button-primary">Get Weekform for Mac</MacAppLink></div>
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
              <MacAppLink className="text-link">
                Download or reinstall Weekform for Mac
              </MacAppLink>
              .
            </p>
          </>
        )}
      </div>
    </section>
  );
}
