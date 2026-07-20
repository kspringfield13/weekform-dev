import Link from "next/link";

import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { WeekformMark } from "@/components/WeekformMark";
import { productEntry, type ProductEntry } from "@/lib/productEntry";

const WEB_ENTRY = productEntry("web");
const MAC_ENTRY = productEntry("mac");

const WEEK_ROWS = [
  {
    day: "Mon",
    blocks: [
      { tone: "focus", left: 4, width: 31, label: "Forecast model" },
      { tone: "collab", left: 39, width: 16, label: "Review" },
      { tone: "reactive", left: 61, width: 19, label: "Requests" },
    ],
  },
  {
    day: "Tue",
    blocks: [
      { tone: "focus", left: 10, width: 23, label: "Analysis" },
      { tone: "fragmented", left: 37, width: 12, label: "Admin" },
      { tone: "collab", left: 54, width: 28, label: "Workshop" },
    ],
  },
  {
    day: "Wed",
    blocks: [
      { tone: "reactive", left: 3, width: 17, label: "Support" },
      { tone: "focus", left: 25, width: 36, label: "Capacity brief" },
      { tone: "fragmented", left: 66, width: 20, label: "Follow-up" },
    ],
  },
  {
    day: "Thu",
    blocks: [
      { tone: "collab", left: 8, width: 20, label: "Planning" },
      { tone: "focus", left: 34, width: 43, label: "Protected focus" },
    ],
  },
  {
    day: "Fri",
    blocks: [
      { tone: "fragmented", left: 7, width: 17, label: "Triage" },
      { tone: "reactive", left: 29, width: 25, label: "Requests" },
      { tone: "carryover", left: 60, width: 23, label: "Carryover" },
    ],
  },
];

const NEVER_SEEN = [
  "Raw window titles",
  "Activity samples",
  "Personal notes",
  "Visual Context captures",
  "Calendar event details",
  "Chat content",
];

function SignalWave({ className, id }: { className?: string; id: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 520 180"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={id} x1="0" x2="1">
          <stop offset="0" stopColor="var(--signal-blue)" />
          <stop offset="0.52" stopColor="var(--signal-green)" />
          <stop offset="1" stopColor="var(--signal-neutral)" />
        </linearGradient>
      </defs>
      <g className="signal-grid">
        <path d="M0 30H520M0 75H520M0 120H520M0 165H520" />
        <path d="M65 0V180M130 0V180M195 0V180M260 0V180M325 0V180M390 0V180M455 0V180" />
      </g>
      <path
        className="signal-halo"
        style={{ stroke: `url(#${id})` }}
        d="M0 106C33 106 37 68 70 68s36 73 69 73 42-99 76-99 39 92 75 92 38-55 69-55 34 43 65 43 39-77 70-77 30 58 46 58"
      />
      <path
        className="signal-line"
        style={{ stroke: `url(#${id})` }}
        d="M0 106C33 106 37 68 70 68s36 73 69 73 42-99 76-99 39 92 75 92 38-55 69-55 34 43 65 43 39-77 70-77 70 58 86 58"
      />
      <g className="signal-points">
        <circle cx="70" cy="68" r="3" />
        <circle cx="139" cy="141" r="3" />
        <circle cx="215" cy="42" r="3" />
        <circle cx="290" cy="134" r="3" />
        <circle cx="359" cy="79" r="3" />
        <circle cx="424" cy="122" r="3" />
      </g>
    </svg>
  );
}

function WeekTimeline({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "week-timeline is-compact" : "week-timeline"} aria-hidden="true">
      <div className="timeline-scale mono">
        <span>8a</span>
        <span>10</span>
        <span>12</span>
        <span>2</span>
        <span>4</span>
        <span>6p</span>
      </div>
      {WEEK_ROWS.map((row) => (
        <div className="timeline-row" key={row.day}>
          <span className="timeline-day mono">{row.day}</span>
          <div className="timeline-track">
            {row.blocks.map((block) => (
              <span
                className={`timeline-block is-${block.tone}`}
                key={`${row.day}-${block.label}`}
                style={{ left: `${block.left}%`, width: `${block.width}%` }}
              >
                <span>{block.label}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProductStage() {
  return (
    <div className="product-stage-wrap">
      <div
        className="product-stage"
        role="img"
        aria-label="Illustrative Weekform app showing a reviewed synthetic week, 6.5 hours of reliable capacity, and an evidence-grounded planning recommendation"
      >
        <div className="stage-titlebar">
          <div className="window-controls" aria-hidden="true"><i /><i /><i /></div>
          <div className="stage-titlebar-brand">
            <WeekformMark />
            <span>Weekform</span>
          </div>
          <span className="local-status"><i /> Tracking locally</span>
        </div>

        <div className="stage-layout">
          <aside className="stage-sidebar">
            <div className="stage-sidebar-brand">
              <WeekformMark />
              <strong>Weekform</strong>
            </div>
            <nav aria-hidden="true">
              <span>Today</span>
              <span className="is-active">Week</span>
              <span>Agent</span>
              <span>History</span>
            </nav>
            <div className="sidebar-capacity">
              <small>Reliable capacity</small>
              <strong>6.5h</strong>
              <span><i /> This week</span>
            </div>
          </aside>

          <div className="stage-content">
            <div className="stage-context-row">
              <div className="stage-tabs"><b>Capacity</b><span>Forecast</span><span>Summary</span></div>
              <span className="stage-date mono">Jul 13 — Jul 17</span>
            </div>

            <section className="stage-capacity-hero">
              <div className="stage-gauge">
                <span><strong>6.5</strong>h</span>
                <small>reliable</small>
              </div>
              <div className="stage-capacity-copy">
                <small className="mono">Weekly capacity</small>
                <h2>One focused commitment still fits.</h2>
                <p>Your reviewed week leaves 6.5 reliable hours for new planned work.</p>
              </div>
              <SignalWave className="stage-signal" id="stage-signal-gradient" />
            </section>

            <div className="stage-metrics">
              <div data-tone="blue"><small>Planned load</small><strong>22h</strong><i style={{ width: "55%" }} /></div>
              <div data-tone="orange"><small>Reactive work</small><strong>7h</strong><i style={{ width: "36%" }} /></div>
              <div data-tone="neutral"><small>Carryover</small><strong>4.5h</strong><i style={{ width: "24%" }} /></div>
              <div data-tone="green"><small>New-work capacity</small><strong>6.5h</strong><i style={{ width: "41%" }} /></div>
            </div>

            <div className="stage-bottom-grid">
              <section className="stage-panel stage-week-panel">
                <header><div><strong>The week behind the number</strong><small>Reviewed work blocks</small></div><span className="reviewed-pill">Reviewed</span></header>
                <WeekTimeline compact />
              </section>
              <section className="stage-panel stage-agent-panel">
                <header><div><strong>Agent</strong><small>Grounded in this week</small></div><span className="agent-mark">∿</span></header>
                <p className="agent-question">Can I take on the 8h reporting request?</p>
                <div className="agent-answer">
                  <strong>Not at the current scope.</strong>
                  <span>It exceeds reliable capacity by 1.5h. Reduce scope or move the date.</span>
                </div>
                <div className="agent-evidence mono"><span>3 evidence refs</span><span>Assumptions visible</span></div>
              </section>
            </div>
          </div>
        </div>
      </div>

      <div className="floating-card floating-review" aria-hidden="true">
        <span className="floating-icon">✓</span>
        <div><small>Correction saved</small><strong>Budget analysis</strong><span>Relabeled as deep work · 1h 40m</span></div>
      </div>
      <div className="floating-card floating-fit" aria-hidden="true">
        <small>Commitment check</small>
        <div><strong>8h request</strong><span>1.5h over</span></div>
        <p>Move the date or reduce scope.</p>
      </div>
    </div>
  );
}

function EntryChoice({ entry }: { entry: ProductEntry }) {
  return (
    <article className={`entry-choice is-${entry.id}`}>
      <div className="entry-choice-heading">
        <span className="entry-choice-index mono">{entry.id === "web" ? "WEB" : "MAC"}</span>
        <span className="entry-choice-eyebrow">{entry.eyebrow}</span>
      </div>
      <h3>{entry.title}</h3>
      <p className="entry-choice-description">{entry.description}</p>
      <div className="entry-choice-scope">
        <strong>Available here</strong>
        <p>{entry.capabilities}</p>
      </div>
      <p className="entry-choice-limit">
        <span>Boundary</span>
        {entry.limitations}
      </p>
      <Link
        href={entry.href}
        className={entry.id === "web" ? "button button-primary" : "button button-secondary"}
      >
        {entry.action} <span aria-hidden="true">→</span>
      </Link>
    </article>
  );
}

export default function LandingPage() {
  return (
    <>
      <SiteHeader variant="immersive" />
      <main className="landing-main" id="main">
        <section className="landing-hero">
          <div className="hero-atmosphere" aria-hidden="true"><span /><span /><span /></div>
          <div className="hero-intro container">
            <p className="hero-kicker"><span aria-hidden="true" />Local workload intelligence for individual analysts</p>
            <h1>
              <span>See what shaped your week.</span>
              <span className="hero-motto-accent">Decide what fits next.</span>
            </h1>
            <p className="hero-sub">
              Weekform turns limited signals on your Mac into work blocks you
              can correct, then uses a deterministic model to show reliable
              capacity, delivery risk, and the tradeoffs behind your next commitment.
            </p>
            <div className="hero-actions">
              <Link href={WEB_ENTRY.href} className="button button-primary button-large">
                Open Web App
              </Link>
              <Link href={MAC_ENTRY.href} className="button button-secondary button-large">
                {MAC_ENTRY.action}
              </Link>
            </div>
            <div className="hero-assurances" aria-label="Weekform product principles">
              <span><i aria-hidden="true">✓</i> Raw activity stays local</span>
              <span><i aria-hidden="true">✓</i> Every inference is reviewable</span>
              <span><i aria-hidden="true">✓</i> Actions wait for approval</span>
            </div>
          </div>
          <div className="container hero-product-stage">
            <ProductStage />
          </div>
        </section>

        <section className="entry-section section container" aria-labelledby="entry-title">
          <div className="section-intro entry-section-intro">
            <p className="section-kicker mono">Two places · one privacy boundary</p>
            <h2 className="section-title" id="entry-title">Choose where you work.</h2>
            <p className="section-lede">
              Open the browser workspace for shared decisions, or use the Mac app
              for the complete local evidence loop. Your raw activity does not
              move between them.
            </p>
          </div>
          <div className="entry-choice-grid">
            <EntryChoice entry={WEB_ENTRY} />
            <div className="entry-boundary" aria-label="Only approved workload snapshots cross between the Mac app and web workspace">
              <span className="entry-boundary-line" aria-hidden="true" />
              <div>
                <span className="entry-boundary-mark" aria-hidden="true">✓</span>
                <strong>Approved summaries only</strong>
                <small>Raw activity stays local</small>
              </div>
              <span className="entry-boundary-line" aria-hidden="true" />
            </div>
            <EntryChoice entry={MAC_ENTRY} />
          </div>
        </section>

        <section className="product-story section container" id="product" aria-labelledby="product-title">
          <div className="section-intro">
            <p className="section-kicker mono">A system you can question</p>
            <h2 className="section-title" id="product-title">Not another dashboard. A decision trail.</h2>
            <p className="section-lede">
              Weekform keeps the full path from limited signals to a reviewed
              workload decision visible—and leaves you in control at every step.
            </p>
          </div>

          <div className="feature-grid">
            <article className="feature-card feature-review">
              <div className="feature-copy">
                <span className="feature-step mono">01 · Reviewed truth</span>
                <h3>Correct the record.</h3>
                <p>Confirm, relabel, annotate, or exclude any inferred block before it shapes your week.</p>
              </div>
              <div className="review-stack" aria-label="Illustrative work block review queue">
                <div className="review-row is-done">
                  <span className="review-state">✓</span><div><strong>Forecast model</strong><small>VS Code · 2h 25m</small></div><span className="mode-chip is-focus">Deep work</span>
                </div>
                <div className="review-row is-active">
                  <span className="review-state">?</span><div><strong>Budget analysis</strong><small>Numbers · 1h 40m</small></div><span className="mode-chip is-editing">Relabeling</span>
                </div>
                <div className="review-row">
                  <span className="review-state">○</span><div><strong>Unplanned support</strong><small>Browser · 55m</small></div><span className="mode-chip is-reactive">Reactive</span>
                </div>
                <div className="review-actions" aria-hidden="true"><span>Exclude</span><span>Relabel</span><b>Confirm block</b></div>
              </div>
            </article>

            <article className="feature-card feature-model">
              <div className="feature-copy">
                <span className="feature-step mono">02 · Deterministic model</span>
                <h3>The math stays in.</h3>
                <p>Capacity is a planning aid with inspectable inputs—not a score handed down by a black box.</p>
              </div>
              <div className="capacity-equation" aria-label="Illustrative capacity equation">
                <div><span>Standard week</span><strong>40h</strong></div>
                <i aria-hidden="true">−</i>
                <div><span>Planned + reactive + carryover</span><strong>33.5h</strong></div>
                <i aria-hidden="true">=</i>
                <div className="is-result"><span>Reliable capacity</span><strong>6.5h</strong></div>
              </div>
              <div className="equation-meter" aria-hidden="true"><span /><i /></div>
              <small className="model-note mono">Heuristic weights · assumptions visible · no universal score</small>
            </article>

            <article className="feature-card feature-agent">
              <div className="feature-copy">
                <span className="feature-step mono">03 · Evidence-grounded guidance</span>
                <h3>Ask the week, not a generic chatbot.</h3>
                <p>The Agent answers from reviewed workload context and shows the evidence behind the recommendation.</p>
              </div>
              <div className="agent-conversation" aria-label="Illustrative evidence-grounded Agent conversation">
                <div className="conversation-user">Why does Friday look risky?</div>
                <div className="conversation-agent">
                  <span className="agent-avatar">∿</span>
                  <div>
                    <p>Reactive work rose by 3h and two focus blocks were split across six app switches. Protect Thursday afternoon or move the reporting request.</p>
                    <div className="evidence-chips mono"><span>Reactive load · 7h</span><span>Fragmentation · elevated</span><span>3 reviewed blocks</span></div>
                  </div>
                </div>
              </div>
            </article>

            <article className="feature-card feature-approval">
              <div className="feature-copy">
                <span className="feature-step mono">04 · Approval before consequence</span>
                <h3>AI can propose. You decide.</h3>
                <p>Classification, forecasts, summaries, sharing, and resets stay visibly approval-gated.</p>
              </div>
              <div className="approval-sheet" aria-label="Illustrative approval request">
                <span className="approval-symbol">↗</span>
                <div><small>Proposed planning move</small><strong>Protect Thursday, 1:00–3:00 PM</strong><p>Uses your current reviewed forecast. Nothing changes until you approve.</p></div>
                <div className="approval-actions" aria-hidden="true"><span>Not now</span><b>Approve move</b></div>
              </div>
            </article>
          </div>
        </section>

        <section className="privacy-section" id="privacy" aria-labelledby="privacy-title">
          <div className="container privacy-section-inner">
            <div className="section-intro privacy-intro">
              <p className="section-kicker mono">A visible privacy boundary</p>
              <h2 className="section-title" id="privacy-title">Useful without being watched.</h2>
              <p className="section-lede">
                Raw evidence remains inside the desktop app. If you join a team,
                only the small capacity snapshot you preview and approve can cross the line.
              </p>
            </div>

            <div className="privacy-flow" role="img" aria-label="Raw work evidence stays on the member's Mac; only an allowlisted capacity snapshot can be approved for optional team sharing">
              <div className="privacy-device">
                <div className="device-title"><WeekformMark /><div><strong>This Mac</strong><small>Local workload model</small></div><span>Private</span></div>
                <div className="local-evidence-grid"><span>Window activity</span><span>Calendar details</span><span>Corrections</span><span>Personal notes</span></div>
                <div className="local-model"><SignalWave id="privacy-signal-gradient" /><span className="mono">Review → model → decision</span></div>
              </div>

              <div className="consent-gate">
                <span className="gate-line" />
                <div><span className="gate-lock">✓</span><strong>You approve</strong><small>Sharing is off by default</small></div>
                <span className="gate-line" />
              </div>

              <div className="shared-signal-card">
                <span className="shared-label mono">Allowlisted snapshot</span>
                <strong>6.5h</strong><small>reliable capacity</small>
                <div><span>Reactive load</span><b>7h</b></div>
                <div><span>Reviewed</span><b>Jul 17</b></div>
                <p>Optional team signal</p>
              </div>
            </div>

            <div className="privacy-never">
              <span className="mono">Never included in a team snapshot</span>
              <ul>{NEVER_SEEN.map((item) => <li key={item}><i aria-hidden="true">×</i>{item}</li>)}</ul>
            </div>
          </div>
        </section>

        <section className="closing-section container" aria-labelledby="closing-title">
          <div className="closing-card">
            <SignalWave className="closing-signal" id="closing-signal-gradient" />
            <div>
              <p className="section-kicker mono">Your next commitment starts here</p>
              <h2 id="closing-title">Give the next week an honest chance.</h2>
              <p>Review what happened. Know what fits before you commit. Make the call with evidence.</p>
            </div>
            <div className="closing-actions">
              <Link href={WEB_ENTRY.href} className="button button-primary button-large">{WEB_ENTRY.action} <span aria-hidden="true">→</span></Link>
              <Link href={MAC_ENTRY.href} className="button button-secondary button-large">{MAC_ENTRY.action}</Link>
            </div>
          </div>
        </section>

        <section className="disclosure-section container" aria-labelledby="disclosure-title">
          <div className="disclosure">
            <h2 id="disclosure-title">Honest prototype disclosure</h2>
            <ul>
              <li>Weekform is a working OpenAI Build Week 2026 prototype, not a finished commercial product.</li>
              <li>Capacity weights are heuristics. Raw native capture uses an encrypted journal, while other prototype desktop state remains unencrypted.</li>
              <li>Outlook import is manual; Visual Context can capture the full screen only when explicitly enabled.</li>
              <li>Public examples and the interface above use synthetic data.</li>
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
