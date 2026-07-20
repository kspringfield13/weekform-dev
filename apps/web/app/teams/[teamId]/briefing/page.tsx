import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getOwnMembership, isManagerRole } from "@/lib/teams";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { BriefingPanel } from "./BriefingPanel";

export const metadata: Metadata = { title: "Team Briefing" };

interface BriefingPageProps {
  params: Promise<{ teamId: string }>;
}

/**
 * Manager-only entry point for the Team Briefing Agent (blueprint §9).
 * Authorization mirrors the team page exactly: an active session, then an
 * active owner/manager membership via getOwnMembership + isManagerRole. A
 * plain member or an outsider sees the same "unavailable" view either way —
 * this page never confirms whether a team exists to someone without access.
 */
export default async function BriefingPage({ params }: BriefingPageProps) {
  const { teamId } = await params;
  const supabase = await createClient();

  if (!supabase) {
    return (
      <>
        <SiteHeader />
        <main className="container">
          <div className="page-head">
            <h1>Team Briefing</h1>
          </div>
          <div className="error-panel" role="alert">
            <h2>Supabase is not configured</h2>
            <p>
              This deployment has no Supabase project configured, so team
              briefings are unavailable. See{" "}
              <span className="mono">apps/web/README.md</span>.
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
    redirect(`/login?next=${encodeURIComponent(`/teams/${teamId}/briefing`)}`);
  }

  const membership = await getOwnMembership(supabase, teamId, user.id);
  const manager = membership !== null && isManagerRole(membership.role);

  if (!manager) {
    return (
      <>
        <SiteHeader />
        <main className="container">
          <div className="page-head">
            <h1>Team Briefing unavailable</h1>
          </div>
          <div className="error-panel" role="alert">
            <h2>You don&apos;t have access to this page</h2>
            <p>
              Team Briefings are available to team owners and managers only.
              Either this team doesn&apos;t exist, you&apos;re not an active
              member, or you&apos;re a member rather than a manager.
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

  return (
    <>
      <SiteHeader />
      <main className="container">
        <div className="page-head">
          <h1>Team Briefing — {membership.teamName}</h1>
          <p>
            An evidence-grounded summary built only from metrics your team
            chose to share. It is a planning aid for a conversation, not a
            performance score.
          </p>
        </div>

        <section className="panel" aria-labelledby="briefing-panel-title">
          <h2 id="briefing-panel-title">Generate this week&apos;s briefing</h2>
          <p>
            Uses the same shared snapshots and deterministic risk flags shown
            on the team page — nothing raw (window titles, notes, evidence,
            screenshots, or unshared metrics) is ever included.
          </p>
          <BriefingPanel teamId={teamId} />
        </section>

        <p>
          <Link href={`/teams/${teamId}`} className="text-link">
            Back to team page
          </Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
