"use client";

import { WeekformMark } from "@/components/WeekformMark";
import { WebEditionLabel } from "@/components/WebEditionLabel";

export function WebCompactWindowHandoff({ onRestore }: { onRestore: () => void }) {
  return (
    <main className="web-compact-handoff">
      <section className="web-compact-handoff-card" aria-labelledby="compact-handoff-title">
        <div className="web-compact-handoff-brand" aria-label="Weekform Web">
          <WeekformMark className="web-compact-handoff-mark" />
          <strong>Weekform</strong>
          <WebEditionLabel />
        </div>
        <span className="mono">Compact window active</span>
        <h1 id="compact-handoff-title">Weekform is running beside your work.</h1>
        <p>This tab is resting while the compact window owns the Web workspace.</p>
        <button className="button button-primary" type="button" onClick={onRestore}>
          Restore full Web App
        </button>
      </section>
    </main>
  );
}
