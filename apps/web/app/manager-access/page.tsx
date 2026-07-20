import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { WorkspaceModeToggle } from "@/components/WorkspaceModeToggle";
import { getTeamWorkspacePath } from "@/lib/managerAccess";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole, listUserTeams } from "@/lib/teams";

export const metadata: Metadata = {
  title: "Team",
  description: "Open your connected Weekform team workspace.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ManagerAccessPage() {
  const supabase = await createClient();

  if (!supabase) {
    return (
      <>
        <SiteHeader />
        <main className="container">
          <div className="page-head">
            <span className="badge">Team</span>
            <h1>Team is not connected.</h1>
            <p>This deployment needs its public Supabase configuration before memberships can be verified.</p>
          </div>
          <WorkspaceModeToggle teamAvailable={false} teamHref="/manager-access" mode="individual" />
          <div className="panel" role="alert">
            <h2>Cloud access is unavailable</h2>
            <p>No team data was requested or displayed.</p>
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
    redirect("/login?next=/manager-access");
  }

  const { teams, error } = await listUserTeams(supabase, user.id);
  const directTeamPath = getTeamWorkspacePath(teams);

  if (!error && teams.length === 1 && directTeamPath) {
    redirect(directTeamPath);
  }

  return (
    <>
      <SiteHeader />
      <main className="container">
        <div className="page-head">
          <span className="badge">Team</span>
          <h1>Choose a team workspace.</h1>
          <p>Your experience follows your role. Managers coordinate from member-approved summaries; members see their own membership and sharing boundary.</p>
        </div>

        <WorkspaceModeToggle
          teamAvailable={teams.length > 0}
          teamHref="/manager-access"
          mode="team"
          teamLabel="Team"
        />

        {error ? (
          <div className="panel" role="alert">
            <h2>Your team memberships could not be verified</h2>
            <p>Reload the page to retry. No team workspace is shown when membership verification fails.</p>
          </div>
        ) : teams.length === 0 ? (
          <div className="panel">
            <h2>No team is connected</h2>
            <p>Create a team or accept an invite from your individual Settings page. Until then, Team stays out of your side panel.</p>
            <Link className="button button-secondary" href="/app">Return to your individual workspace</Link>
          </div>
        ) : (
          <div className="card-grid" aria-label="Connected teams">
            {teams.map((team) => (
              <article className="choice-card" key={team.teamId}>
                <span className="badge">{team.role}</span>
                <h2>{team.teamName}</h2>
                <p>
                  {isManagerRole(team.role)
                    ? "Review approved workload summaries, briefings, coordination actions, sharing policy, and member access."
                    : "Review your membership, sharing choice, and the snapshot this team may see from you."}
                </p>
                <Link className="button button-primary" href={`/teams/${team.teamId}`}>
                  {isManagerRole(team.role) ? "Open Manager mode" : "Open Team"}
                </Link>
              </article>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
