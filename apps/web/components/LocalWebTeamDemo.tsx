import {
  CalendarDays,
  CheckCircle2,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";

import { TeamGantt } from "@/app/teams/[teamId]/TeamGantt";
import { IndividualWorkspaceShell } from "@/components/IndividualWorkspaceShell";
import type { LocalWebDemoData } from "@/lib/localWebDemo";
import type { LatestSnapshot } from "@/lib/snapshots";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1]! + sorted[midpoint]!) / 2
    : sorted[midpoint]!;
}

function metricMedian(
  snapshots: LatestSnapshot[],
  key: "reliableCapacityPct" | "reactivePct" | "meetingPct" | "fragmentedPct",
): number | null {
  return median(snapshots.flatMap((snapshot) => snapshot[key] === null ? [] : [snapshot[key]]));
}

function metricLabel(value: number | null): string {
  return value === null ? "Unknown" : `${Math.round(value)}%`;
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("");
}

function TeamDemoMasthead({ demo }: { demo: LocalWebDemoData }) {
  const weekCount = new Set(demo.team.history.map((snapshot) => snapshot.weekId)).size;
  return (
    <section className="web-demo-team-masthead" aria-label="Local Team demo status">
      <div>
        <span className="web-demo-live-pill"><i aria-hidden="true" /> Local synthetic demo</span>
        <strong>{demo.team.teamName}</strong>
        <small>{weekCount}-week approved planning story · no ranking</small>
      </div>
      <div className="web-demo-team-source-pills" aria-label="Synthetic Team Calendar sources">
        <span><CalendarDays aria-hidden="true" /><b>Apple Calendar</b>Maya overlay</span>
        <span><MessageSquareText aria-hidden="true" /><b>Slack</b>Maya overlay</span>
        <span><LockKeyhole aria-hidden="true" /><b>Read-only</b>no workload mutations</span>
      </div>
    </section>
  );
}

function TeamToday({ demo }: { demo: LocalWebDemoData }) {
  const snapshots = demo.team.latest;
  const sharing = snapshots.filter((snapshot) => snapshot.reliableCapacityPct !== null);
  const unknownCount = demo.team.identities.length - sharing.length;
  const reliable = metricMedian(snapshots, "reliableCapacityPct");
  const reactive = metricMedian(snapshots, "reactivePct");
  const reviewed = snapshots.reduce((sum, snapshot) => sum + snapshot.reviewedBlocks, 0);
  const eligible = snapshots.reduce((sum, snapshot) => sum + snapshot.eligibleBlocks, 0);

  return (
    <section data-web-view="today" className="team-workspace-view web-demo-team-view" aria-labelledby="web-demo-team-today-title">
      <header className="team-workspace-view-header web-demo-team-hero">
        <span className="team-section-kicker">Today · approved team signals</span>
        <h1 id="web-demo-team-today-title">Know where the week bends before another commitment lands.</h1>
        <p>{sharing.length} of {demo.team.identities.length} teammates share current summaries. {unknownCount === 0 ? "No current capacity is unknown." : `${unknownCount} ${unknownCount === 1 ? "teammate remains" : "teammates remain"} explicitly unknown—never counted as zero capacity.`}</p>
      </header>

      <div className="web-demo-team-stat-rail" aria-label="Current Team evidence summary">
        <article><span>Active roster</span><strong>{demo.team.identities.length}</strong><small>Synthetic teammates</small></article>
        <article><span>Sharing now</span><strong>{sharing.length}/{demo.team.identities.length}</strong><small>Approved summaries</small></article>
        <article><span>Reliable capacity</span><strong>{metricLabel(reliable)}</strong><small>Median shared headroom</small></article>
        <article><span>Review coverage</span><strong>{eligible === 0 ? "—" : `${Math.round((reviewed / eligible) * 100)}%`}</strong><small>{reviewed}/{eligible} blocks</small></article>
      </div>

      <div className="web-demo-team-decision-layout">
        <article className="web-demo-team-decision">
          <span className="web-demo-decision-orbit" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <span className="team-section-kicker">Decision now</span>
            <h2>Keep the next commitment narrow and preserve a recovery lane.</h2>
            <p>Median reliable capacity is {metricLabel(reliable)} while reactive load is {metricLabel(reactive)}. The evidence supports one focused ask, not a broad team-wide expansion.</p>
          </div>
          <dl>
            <div><dt>Approved coverage</dt><dd>{sharing.length}/{demo.team.identities.length}</dd></div>
            <div><dt>Reliable median</dt><dd>{metricLabel(reliable)}</dd></div>
            <div><dt>Reactive median</dt><dd>{metricLabel(reactive)}</dd></div>
          </dl>
        </article>

        <aside className="web-demo-team-roster" aria-labelledby="web-demo-team-roster-title">
          <div><span className="team-section-kicker">Signal roster</span><h2 id="web-demo-team-roster-title">Current sharing</h2></div>
          <ul>
            {demo.team.identities.map((identity) => {
              const snapshot = snapshots.find((candidate) => candidate.userId === identity.userId);
              const known = snapshot?.reliableCapacityPct !== null && snapshot?.reliableCapacityPct !== undefined;
              return <li key={identity.userId}><span>{initials(identity.name)}</span><p><strong>{identity.name}</strong><small>{identity.userId === demo.team.viewerId ? "You · categories" : "Approved summary"}</small></p><em className={known ? "is-known" : ""}>{known ? `${Math.round(snapshot!.reliableCapacityPct!)}%` : "Unknown"}</em></li>;
            })}
          </ul>
        </aside>
      </div>
    </section>
  );
}

function TeamWeek({ demo }: { demo: LocalWebDemoData }) {
  return (
    <section data-web-view="week" className="team-workspace-view web-demo-team-view" aria-labelledby="web-demo-team-week-title">
      <header className="team-workspace-view-header">
        <span className="team-section-kicker">Calendar intelligence · {demo.team.anchorWeekId}</span>
        <h1 id="web-demo-team-week-title">The calendar is the analysis surface.</h1>
        <p>Open the workload calendar to inspect Maya&apos;s private synthetic Apple Calendar and Slack context alongside separate, member-approved weekly team capacity and coverage.</p>
      </header>
      <div className="web-demo-calendar-flight" aria-label="Private viewer context beside approved Team summaries">
        <div><CalendarDays aria-hidden="true" /><p><strong>{demo.sources.calendar.eventCount} calendar events</strong><small>Maya-only overlay · 13-week synthetic history</small></p></div>
        <span aria-hidden="true">+</span>
        <div><MessageSquareText aria-hidden="true" /><p><strong>{demo.sources.chat.episodeCount} chat episodes</strong><small>Maya-only metadata · {demo.sources.chat.directedCount} directed triggers</small></p></div>
        <span aria-hidden="true">→</span>
        <div><Sparkles aria-hidden="true" /><p><strong>{demo.team.evidence.length} viewer-context days</strong><small>Beside approved weekly team summaries</small></p></div>
      </div>
      <TeamGantt
        anchorWeekId={demo.team.anchorWeekId}
        forecast={demo.team.forecast}
        history={demo.team.history}
        identities={demo.team.identities}
        teamRole="manager"
        todayIso={demo.generatedAt}
        viewerId={demo.team.viewerId}
        evidence={demo.team.evidence}
        evidenceSources={{ calendar: demo.sources.calendar.name, chat: demo.sources.chat.name }}
      />
    </section>
  );
}

function TeamAgent({ demo }: { demo: LocalWebDemoData }) {
  const forecast = demo.team.forecast.metrics.reliableCapacityPct.forecast;
  return (
    <section data-web-view="agent" className="team-workspace-view web-demo-team-view" aria-labelledby="web-demo-team-agent-title">
      <header className="team-workspace-view-header">
        <span className="team-section-kicker">Team briefing · deterministic preview</span>
        <h1 id="web-demo-team-agent-title">A briefing that shows its work.</h1>
        <p>No AI provider runs in this demo. The briefing below is assembled from the visible synthetic facts and remains unapplied.</p>
      </header>
      <div className="web-demo-briefing-layout">
        <article className="web-demo-briefing">
          <header><span><Sparkles aria-hidden="true" /></span><div><small>Northstar planning brief</small><h2>Keep the next commitment scoped until approved summary coverage is complete.</h2></div><em>Preview only</em></header>
          <ol>
            <li><b>01</b><p><strong>Viewer context stays separate.</strong><span>Maya&apos;s private calendar and Slack overlay can explain her own coordination pressure; it is not treated as team activity.</span></p></li>
            <li><b>02</b><p><strong>Coverage remains explicit.</strong><span>{demo.team.latest.filter((snapshot) => snapshot.reliableCapacityPct !== null).length} of {demo.team.identities.length} current weekly summaries are shared; unknown values are excluded.</span></p></li>
            <li><b>03</b><p><strong>The forward range is bounded.</strong><span>{forecast ? `${Math.round(forecast.min)}–${Math.round(forecast.max)}% reliable capacity` : "Forecast withheld"} based on the available multiweek history.</span></p></li>
          </ol>
        </article>
        <aside className="web-demo-proposed-move">
          <ShieldCheck aria-hidden="true" />
          <span>Approval boundary</span>
          <h2>Test one bounded commitment against shared headroom and keep unknown capacity out of the estimate.</h2>
          <p>This proposal comes from approved weekly team summaries. The demo cannot assign work, notify anyone, or record an approval.</p>
          <div><CheckCircle2 aria-hidden="true" /><span><strong>Evidence attached</strong><small>No consequence executed</small></span></div>
        </aside>
      </div>
    </section>
  );
}

function TeamHistory({ demo }: { demo: LocalWebDemoData }) {
  const weekIds = [...new Set(demo.team.history.map((snapshot) => snapshot.weekId))].sort().reverse();
  const rows = weekIds.map((weekId) => {
    const snapshots = demo.team.history.filter((snapshot) => snapshot.weekId === weekId);
    return {
      weekId,
      shared: snapshots.filter((snapshot) => snapshot.reliableCapacityPct !== null).length,
      reliable: metricMedian(snapshots, "reliableCapacityPct"),
      reactive: metricMedian(snapshots, "reactivePct"),
      meeting: metricMedian(snapshots, "meetingPct"),
      fragmented: metricMedian(snapshots, "fragmentedPct"),
    };
  });
  return (
    <section data-web-view="history" className="team-workspace-view web-demo-team-view" aria-labelledby="web-demo-team-history-title">
      <header className="team-workspace-view-header">
        <span className="team-section-kicker">Observed change · {weekIds.length} weeks</span>
        <h1 id="web-demo-team-history-title">See the pattern, and the evidence coverage behind it.</h1>
        <p>Each row is a team median from approved summaries. Missing values remain visibly excluded.</p>
      </header>
      <div className="web-demo-history-table" role="table" aria-label={`${weekIds.length}-week Team workload history`}>
        <div className="web-demo-history-head" role="row"><span role="columnheader">Week</span><span role="columnheader">Sharing</span><span role="columnheader">Reliable</span><span role="columnheader">Reactive</span><span role="columnheader">Meetings</span><span role="columnheader">Fragmented</span></div>
        {rows.map((row, index) => <div className="web-demo-history-row" role="row" key={row.weekId}><span role="cell"><strong>{row.weekId}</strong><small>{index === 0 ? "Current" : "Observed"}</small></span><span role="cell">{row.shared}/{demo.team.identities.length}</span><span role="cell"><i style={{ width: `${row.reliable ?? 0}%` }} />{metricLabel(row.reliable)}</span><span role="cell"><i style={{ width: `${row.reactive ?? 0}%` }} />{metricLabel(row.reactive)}</span><span role="cell"><i style={{ width: `${row.meeting ?? 0}%` }} />{metricLabel(row.meeting)}</span><span role="cell"><i style={{ width: `${row.fragmented ?? 0}%` }} />{metricLabel(row.fragmented)}</span></div>)}
      </div>
    </section>
  );
}

function TeamSettings({ demo }: { demo: LocalWebDemoData }) {
  return (
    <section data-web-view="settings" className="team-workspace-view web-demo-team-view" aria-labelledby="web-demo-team-settings-title">
      <header className="team-workspace-view-header">
        <span className="team-section-kicker">Sources and consent · demo boundary</span>
        <h1 id="web-demo-team-settings-title">Integrated facts without hidden surveillance.</h1>
        <p>The demo shows how source-attributed evidence supports coordination while preserving user review, unknown states, and explicit approval.</p>
      </header>
      <div className="web-demo-settings-grid web-demo-team-settings-grid">
        <article><span className="web-demo-source-icon is-calendar"><CalendarDays aria-hidden="true" /></span><div><h2>Apple Calendar</h2><p>Maya&apos;s private overlay uses timing and duration as daily viewer context. Titles and attendees are not part of this fixture.</p></div><strong>{demo.sources.calendar.eventCount} synthetic events</strong></article>
        <article><span className="web-demo-source-icon is-chat"><MessageSquareText aria-hidden="true" /></span><div><h2>Slack</h2><p>Maya&apos;s metadata-only response episodes explain her own reactive context without exposing message bodies or team activity.</p></div><strong>{demo.sources.chat.episodeCount} synthetic episodes</strong></article>
        <article><span className="web-demo-source-icon"><UsersRound aria-hidden="true" /></span><div><h2>Team summaries</h2><p>Only member-approved weekly metrics appear. Unknown and omitted fields never become zero.</p></div><strong>{demo.team.identities.length} synthetic members</strong></article>
        <article><span className="web-demo-source-icon"><LockKeyhole aria-hidden="true" /></span><div><h2>Read-only walkthrough</h2><p>Invites, policy edits, approvals, tracking commands, and calendar changes are unavailable here.</p></div><strong>No team-data persistence</strong></article>
      </div>
    </section>
  );
}

export function LocalWebTeamDemo({
  demo,
  initialScreen,
}: {
  demo: LocalWebDemoData;
  initialScreen: string | undefined;
}) {
  return (
    <IndividualWorkspaceShell
      reliableCapacity={metricMedian(demo.team.latest, "reliableCapacityPct")}
      reviewCount={0}
      activeWeekLabel={demo.team.anchorWeekId}
      teamAvailable
      teamHref="/demo/team"
      teamRole="manager"
      workspaceMode="manager"
      individualHrefBase="/demo"
      demoReadOnly
      accountActions={<span className="web-demo-account"><span aria-hidden="true">MC</span><strong>Maya Chen</strong><small>Demo manager</small></span>}
      initialScreen={initialScreen}
    >
      <div className="container workspace-shell team-workspace-shell web-demo-workspace web-demo-team-workspace">
        <TeamDemoMasthead demo={demo} />
        <TeamToday demo={demo} />
        <TeamWeek demo={demo} />
        <TeamAgent demo={demo} />
        <TeamHistory demo={demo} />
        <TeamSettings demo={demo} />
      </div>
    </IndividualWorkspaceShell>
  );
}
