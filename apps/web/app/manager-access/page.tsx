import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getSingleManagerTeamPath,
  managerAccessMemberships,
} from "@/lib/managerAccess";
import { createClient } from "@/lib/supabase/server";
import { listUserTeams } from "@/lib/teams";

export const metadata: Metadata = {
  title: "Manager Access",
  description: "Manage the workload signals your teams explicitly approved for coordination.",
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
            <span className="badge">Manager Access</span>
            <h1>Manager Access is not connected.</h1>
            <p>This deployment needs its public Supabase configuration before accounts and manager roles can be verified.</p>
          </div>
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
  const managedTeams = managerAccessMemberships(teams);
  const directTeamPath = getSingleManagerTeamPath(managedTeams);

  if (!error && directTeamPath) {
    redirect(directTeamPath);
  }

  return (
    <>
      <SiteHeader />
      <main className="container">
        <div className="page-head">
          <span className="badge">Manager Access</span>
          <h1>Choose a team workspace.</h1>
          <p>Manager Mode uses only member-approved summary signals. Raw activity, window titles, notes, and unshared fields remain unavailable.</p>
        </div>

        {error ? (
          <div className="panel" role="alert">
            <h2>Your manager roles could not be verified</h2>
            <p>Reload the page to retry. No team workspace is shown when role verification fails.</p>
          </div>
        ) : managedTeams.length === 0 ? (
          <div className="panel">
            <h2>Manager Access is not enabled for this account</h2>
            <p>You are signed in, but none of your active team memberships has an owner or manager role.</p>
            <Link className="button button-secondary" href="/dashboard">Return to your dashboard</Link>
          </div>
        ) : (
          <div className="card-grid" aria-label="Teams available in Manager Access">
            {managedTeams.map((team) => (
              <article className="choice-card" key={team.teamId}>
                <span className="badge">{team.role}</span>
                <h2>{team.teamName}</h2>
                <p>Review approved workload summaries, briefings, coordination actions, sharing policy, and member access.</p>
                <Link className="button button-primary" href={`/teams/${team.teamId}`}>
                  Open Manager Mode
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
