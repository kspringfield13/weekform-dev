import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { IndividualWorkspaceShell } from "@/components/IndividualWorkspaceShell";
import { IndividualHistoryView } from "@/components/IndividualHistorySettings";
import { PersonalSummaryScreen } from "@/components/PersonalSummaryScreen";
import { PersonalTodayScreen } from "@/components/PersonalTodayScreen";
import { PersonalWeekOverview } from "@/components/PersonalWeekOverview";
import { buildPersonalForecastPresentation } from "@/lib/personalForecastPresentation";
import type { LocalWebDemoData } from "@/lib/localWebDemo";

function formatSyncTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

function DemoSourceBand({ demo }: { demo: LocalWebDemoData }) {
  return (
    <section className="web-demo-source-band" aria-labelledby="web-demo-source-title">
      <div className="web-demo-source-intro">
        <span className="web-demo-live-pill"><i aria-hidden="true" /> Local synthetic demo</span>
        <div>
          <h1 id="web-demo-source-title">A connected workload story, without touching your data.</h1>
          <p>Explore 13 weeks of synthetic source history. No synthetic workload record is saved, approved, or shared.</p>
        </div>
      </div>
      <div className="web-demo-source-grid" aria-label="Synthetic connected sources">
        <article>
          <span className="web-demo-source-icon is-calendar"><CalendarDays aria-hidden="true" /></span>
          <div><strong>{demo.sources.calendar.name}</strong><small>{demo.sources.calendar.eventCount} synthetic events · {Math.round(demo.sources.calendar.minutes / 60)}h mapped</small></div>
          <span className="web-demo-source-state"><i aria-hidden="true" /> Ready</span>
        </article>
        <article>
          <span className="web-demo-source-icon is-chat"><MessageSquareText aria-hidden="true" /></span>
          <div><strong>{demo.sources.chat.name}</strong><small>{demo.sources.chat.episodeCount} response episodes · {demo.sources.chat.directedCount} directed</small></div>
          <span className="web-demo-source-state"><i aria-hidden="true" /> Ready</span>
        </article>
        <article className="is-boundary">
          <span className="web-demo-source-icon"><LockKeyhole aria-hidden="true" /></span>
          <div><strong>Read-only boundary</strong><small>Synthetic fixtures · no workload persistence or mutation requests</small></div>
          <span className="web-demo-source-state is-neutral">Preview</span>
        </article>
      </div>
    </section>
  );
}

function DemoWeeklyReview({ demo }: { demo: LocalWebDemoData }) {
  const current = demo.personalReplicas[0]!;
  const reviewed = current.payload.blocks.filter((block) => block.userVerified).length;
  const checks = [
    { label: "Review obvious work blocks", value: `${reviewed}/${current.payload.blocks.length}`, ready: reviewed > 0 },
    { label: "Inspect reactive load", value: `${Math.round(current.payload.capacity.reactivePct)}%`, ready: true },
    { label: "Protect reliable headroom", value: `${Math.round(current.payload.capacity.reliableNewWorkCapacityPct)}%`, ready: true },
    { label: "Record local close-out", value: "Mac only", ready: false },
  ];
  return (
    <section className="web-demo-screen" aria-labelledby="web-demo-review-title">
      <header className="web-demo-screen-header">
        <span>Weekly review · preview</span>
        <h1 id="web-demo-review-title">Close the week with evidence, not memory.</h1>
        <p>This checklist is computed from the synthetic review-safe replica. Completion controls stay disabled.</p>
      </header>
      <div className="web-demo-checklist">
        {checks.map((check, index) => (
          <article key={check.label}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            <span className={check.ready ? "is-ready" : ""}>{check.ready ? <CheckCircle2 aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}</span>
            <div><strong>{check.label}</strong><small>{check.ready ? "Derived check ready" : "Private completion stays local"}</small></div>
            <em>{check.value}</em>
          </article>
        ))}
      </div>
    </section>
  );
}

function DemoForecastView({ demo }: { demo: LocalWebDemoData }) {
  const forecast = buildPersonalForecastPresentation(demo.personalReplicas.map((replica) => replica.payload));
  const scenarios = forecast.scenarios!;
  return (
    <section className="web-demo-screen web-demo-forecast" aria-labelledby="web-demo-forecast-title">
      <header className="web-demo-screen-header">
        <span>Weekly forecast · deterministic preview</span>
        <h1 id="web-demo-forecast-title">Next week: {forecast.targetWeekId}.</h1>
        <p>{forecast.explanation}</p>
      </header>
      <div className="web-demo-forecast-scenarios" aria-label="Reliable capacity scenarios">
        <article><span>Conservative</span><strong>{Math.round(scenarios.conservative)}%</strong><small>Protect when current risks persist</small></article>
        <article className="is-likely"><span>Likely</span><strong>{Math.round(scenarios.likely)}%</strong><small>Median planning baseline</small></article>
        <article><span>Optimistic</span><strong>{Math.round(scenarios.optimistic)}%</strong><small>Only if current risks clear</small></article>
      </div>
      <div className="web-demo-forecast-history">
        <header><div><TrendingUp aria-hidden="true" /><span><strong>Reliable-capacity trajectory</strong><small>{forecast.historyWeekCount} synced synthetic weeks</small></span></div><em>{forecast.confidencePct}% summary confidence</em></header>
        <div className="web-demo-forecast-bars">
          {forecast.trajectory.map((point) => <article key={point.weekId}><span>{point.weekId.replace(/^\d{4}-/, "")}</span><div aria-label={`${point.weekId}: ${point.reliableCapacityPct}% reliable capacity`}><i style={{ height: `${point.reliableCapacityPct}%` }} /></div><strong>{point.reliableCapacityPct}%</strong></article>)}
        </div>
        <p>{forecast.recommendation}</p>
      </div>
    </section>
  );
}

function DemoAgentView({ demo }: { demo: LocalWebDemoData }) {
  const capacity = demo.personalReplicas[0]!.payload.capacity;
  return (
    <section className="web-demo-agent" aria-labelledby="web-demo-agent-title">
      <header className="web-demo-screen-header">
        <span>Evidence-grounded Agent · preview</span>
        <h1 id="web-demo-agent-title">What should I protect before accepting more work?</h1>
        <p>The demo answer uses only the visible synthetic workload fields. It does not call an AI provider.</p>
      </header>
      <div className="web-demo-agent-layout">
        <article className="web-demo-agent-answer">
          <span className="web-demo-agent-mark"><Sparkles aria-hidden="true" /></span>
          <div>
            <small>Weekform readout</small>
            <h2>Protect one deep-work block and keep the delivery buffer intact.</h2>
            <p>Reliable new-work capacity is {Math.round(capacity.reliableNewWorkCapacityPct)}%, while reactive work is {Math.round(capacity.reactivePct)}%. A small focused commitment fits better than several interrupt-driven requests.</p>
          </div>
        </article>
        <aside className="web-demo-evidence-stack" aria-label="Evidence used">
          <span>Evidence used</span>
          <div><MessageSquareText aria-hidden="true" /><p><strong>Reactive load</strong><small>{Math.round(capacity.reactivePct)}% of modeled capacity</small></p></div>
          <div><TrendingUp aria-hidden="true" /><p><strong>Reliable headroom</strong><small>{Math.round(capacity.reliableNewWorkCapacityPct)}% for new planned work</small></p></div>
          <div><ShieldCheck aria-hidden="true" /><p><strong>Approval boundary</strong><small>No recommendation has been applied</small></p></div>
        </aside>
      </div>
    </section>
  );
}

function DemoAccelerationView() {
  return (
    <section className="web-demo-screen" aria-labelledby="web-demo-accelerate-title">
      <header className="web-demo-screen-header">
        <span>Acceleration play · preview</span>
        <h1 id="web-demo-accelerate-title">Turn interruption pressure into a protected response window.</h1>
        <p>A suggested planning move, shown with its evidence and consequence boundary.</p>
      </header>
      <div className="web-demo-play-card">
        <div className="web-demo-play-number">01</div>
        <div><span>Proposed move</span><h2>Batch directed Slack responses at 11:30 AM and 3:30 PM.</h2><p>Preserve the 9:00–11:00 focus block while keeping two predictable response windows for stakeholder requests.</p></div>
        <aside><strong>Estimated effect</strong><span>1 fewer fragmented focus window</span><small>Prototype estimate · not applied</small></aside>
      </div>
    </section>
  );
}

function DemoSkillsView() {
  const skills = [
    { icon: <TrendingUp aria-hidden="true" />, title: "Commitment check", detail: "Test a new ask against reliable capacity." },
    { icon: <MessageSquareText aria-hidden="true" />, title: "Reactive load review", detail: "Explain where response pressure entered the week." },
    { icon: <Clock3 aria-hidden="true" />, title: "Focus protection", detail: "Find a defensible window for uninterrupted work." },
  ];
  return (
    <section className="web-demo-screen" aria-labelledby="web-demo-skills-title">
      <header className="web-demo-screen-header">
        <span>Skills library · preview</span>
        <h1 id="web-demo-skills-title">Reusable decisions for a sustainable week.</h1>
        <p>These examples read the same synthetic evidence already visible in the workspace.</p>
      </header>
      <div className="web-demo-skill-grid">
        {skills.map((skill) => <article key={skill.title}><span>{skill.icon}</span><div><h2>{skill.title}</h2><p>{skill.detail}</p></div><small>Available</small></article>)}
      </div>
    </section>
  );
}

function DemoUsageView() {
  return (
    <section className="web-demo-screen" aria-labelledby="web-demo-usage-title">
      <header className="web-demo-screen-header">
        <span>AI usage · local demo</span>
        <h1 id="web-demo-usage-title">No provider call is needed for this walkthrough.</h1>
        <p>Capacity, history, forecasts, and calendar evidence are deterministic synthetic fixtures. Token and cost records remain at zero.</p>
      </header>
      <div className="web-demo-usage-grid">
        <article><span>Provider requests</span><strong>0</strong><small>No remote generation</small></article>
        <article><span>Estimated cost</span><strong>$0.00</strong><small>No credentials loaded</small></article>
        <article><span>Deterministic views</span><strong>5</strong><small>Today through Settings</small></article>
      </div>
    </section>
  );
}

function DemoSettings({ demo }: { demo: LocalWebDemoData }) {
  return (
    <section className="web-demo-settings" aria-labelledby="web-demo-settings-title">
      <header className="web-demo-screen-header">
        <span>Demo data sources</span>
        <h1 id="web-demo-settings-title">Connected enough to understand the product. Isolated enough to trust the demo.</h1>
        <p>Only synthetic fixtures power this route. The production Web workspace keeps the normal sign-in and consent boundaries.</p>
      </header>
      <div className="web-demo-settings-grid">
        <article><span className="web-demo-source-icon is-calendar"><CalendarDays aria-hidden="true" /></span><div><h2>Apple Calendar</h2><p>{demo.sources.calendar.eventCount} synthetic events become daily coordination pressure and meeting-time facts.</p></div><strong>Connected · synthetic</strong></article>
        <article><span className="web-demo-source-icon is-chat"><MessageSquareText aria-hidden="true" /></span><div><h2>Slack</h2><p>{demo.sources.chat.episodeCount} metadata-only response episodes show interruption load without message bodies.</p></div><strong>Connected · synthetic</strong></article>
        <article><span className="web-demo-source-icon"><DatabaseZap aria-hidden="true" /></span><div><h2>Local fixture</h2><p>{demo.personalReplicas.length} personal weeks and {new Set(demo.team.history.map((snapshot) => snapshot.weekId)).size} team weeks are regenerated in memory for this walkthrough.</p></div><strong>No workload persistence</strong></article>
        <article><span className="web-demo-source-icon"><LockKeyhole aria-hidden="true" /></span><div><h2>Mutation boundary</h2><p>Review, approval, sharing, invite, and tracking controls are intentionally unavailable.</p></div><strong>Read-only</strong></article>
      </div>
    </section>
  );
}

export function LocalWebIndividualDemo({
  demo,
  initialScreen,
}: {
  demo: LocalWebDemoData;
  initialScreen: string | undefined;
}) {
  const current = demo.personalReplicas[0]!;
  const reviewCount = current.payload.blocks.filter((block) => !block.userVerified).length;

  return (
    <IndividualWorkspaceShell
      reliableCapacity={current.payload.capacity.reliableNewWorkCapacityPct}
      reviewCount={reviewCount}
      activeWeekLabel={current.weekId}
      teamAvailable
      teamHref="/demo/team"
      teamRole="manager"
      workspaceMode="individual"
      individualHrefBase="/demo"
      demoReadOnly
      accountActions={<span className="web-demo-account"><span aria-hidden="true">MC</span><strong>Maya Chen</strong><small>Demo analyst</small></span>}
      initialScreen={initialScreen}
    >
      <div className="container workspace-shell web-demo-workspace">
        <DemoSourceBand demo={demo} />

        <div data-web-view="today">
          <PersonalTodayScreen replicas={demo.personalReplicas} error={null} reviewCommands={[]} reviewCommandsError={null} demoReadOnly />
        </div>

        <div data-web-view="week">
          <div data-web-subview="capacity"><PersonalWeekOverview replica={current.payload} /></div>
          <div data-web-subview="forecast"><DemoForecastView demo={demo} /></div>
          <div data-web-subview="review"><DemoWeeklyReview demo={demo} /></div>
          <div data-web-subview="usage"><DemoUsageView /></div>
          <div data-web-subview="summary"><PersonalSummaryScreen replicas={demo.personalReplicas} error={null} /></div>
        </div>

        <div data-web-view="agent">
          <div data-web-subview="agent"><DemoAgentView demo={demo} /></div>
          <div data-web-subview="accelerate"><DemoAccelerationView /></div>
          <div data-web-subview="skills"><DemoSkillsView /></div>
        </div>

        <div data-web-view="history">
          <div data-web-subview="activity"><IndividualHistoryView replicas={demo.personalReplicas} error={null} initialTab="activity" showTabs={false} /></div>
          <div data-web-subview="audit"><IndividualHistoryView replicas={demo.personalReplicas} error={null} initialTab="audit" showTabs={false} /></div>
        </div>

        <div data-web-view="settings"><DemoSettings demo={demo} /></div>

        <p className="web-demo-generated-at"><Clock3 aria-hidden="true" /> Fixture generated {formatSyncTime(demo.generatedAt)} · reload to reset the walkthrough</p>
      </div>
    </IndividualWorkspaceShell>
  );
}
