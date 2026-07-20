import Link from "next/link";

import type { PersonalWorkloadReplicaV1 } from "../../../packages/domain/src/personalCloud";

function pct(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(Math.max(0, Math.min(100, value)))}%`;
}

export function PersonalAgentWorkspace({ replica }: { replica: PersonalWorkloadReplicaV1 | null }) {
  const capacity = replica?.capacity;
  return (
    <section className="web-desktop-screen personal-agent-workspace" aria-labelledby="personal-agent-title">
      <div className="personal-agent-layout">
        <section className="personal-agent-conversation" aria-labelledby="personal-agent-title">
          <header>
            <div><span className="personal-week-eyebrow">Grounded in this week</span><h1 id="personal-agent-title">Agent</h1></div>
            <span className="badge">Private local capability</span>
          </header>
          <div className="personal-agent-boundary" role="status">
            <span className="agent-mark" aria-hidden="true">∿</span>
            <h2>Agent stays with your private evidence on Mac.</h2>
            <p>
              Weekform Web receives a review-safe workload summary. It does not receive raw activity,
              prompts, notes, or AI credentials, so Ask, Accelerate, and Skills cannot run honestly here.
            </p>
            <div className="personal-agent-actions">
              <Link className="button button-primary" href="/download">Open Weekform for Mac</Link>
              <button className="button button-secondary" type="button" aria-disabled="true" disabled title="Ask is available in Weekform for Mac">Ask about this week</button>
            </div>
          </div>
          <div className="personal-agent-composer" aria-disabled="true">
            <span>Ask about your capacity, focus, or what to do next…</span>
            <button type="button" aria-label="Send question" aria-disabled="true" disabled>↑</button>
          </div>
        </section>

        <aside className="personal-agent-briefing" aria-label="Current review-safe week context">
          <header><strong>Week briefing</strong><span>{replica?.weekId ?? "Waiting for signal"}</span></header>
          <dl>
            <div><dt>Reliable capacity</dt><dd>{pct(capacity?.reliableNewWorkCapacityPct)}</dd></div>
            <div><dt>Planned</dt><dd>{pct(capacity?.plannedPct)}</dd></div>
            <div><dt>Reactive</dt><dd>{pct(capacity?.reactivePct)}</dd></div>
            <div><dt>Carryover risk</dt><dd>{pct(capacity?.carryoverRiskPct)}</dd></div>
          </dl>
          <p>Values are derived on Mac and synced through the positive allowlist. Private supporting evidence stays local.</p>
        </aside>
      </div>
    </section>
  );
}
