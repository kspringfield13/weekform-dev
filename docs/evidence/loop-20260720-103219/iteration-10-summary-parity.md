# Iteration 10 — Individual Summary parity

Date: 2026-07-20  
Loop: `loop-20260720-103219-8d922a`  
Scope: bounded Desktop-to-Web Individual Summary composition repair. Backend/API/Supabase wiring, the positive-allowlist replica, and Manager Access were unchanged.

## Outcome

Web Summary now selects one truthful composition before rendering:

1. **Load error** — a Summary header and accessible alert only. Stale replica headlines, signals, and manager content are not rendered underneath the failure.
2. **Waiting for Mac** — Desktop's no-evidence header and empty-state silhouette with one explicit Mac acquisition handoff. Analyst and Manager result panels are absent.
3. **Connected deterministic readout** — Desktop's result order: hero headline; synced/derived/review-safe status chips; a Mac handoff rail; 0.92/1.08 Analyst and Manager panels; deterministic assessment; three review-safe driver rows; and a 190 px editor-shaped local-only manager boundary.

The component does not add a generated narrative, model or trigger metadata, narrative generation, an editable draft, copy/download behavior, browser workload storage, a Supabase client, or Manager Access data. `buildPersonalSummaryReadout` remains the sole presentation adapter and continues to read only the review-safe capacity allowlist.

## TDD and verification evidence

- RED: `node --import tsx --test apps/web/lib/individualSummaryWaitingStateParity.test.ts` — exit 1, 0/1. Failure: Web Summary did not branch on a missing readout before its result shell.
- Focused final: `node --import tsx --test apps/web/lib/*Summary*.test.ts apps/web/lib/personalSummaryPresentation.test.ts` — exit 0, 12/12.
- Web suite: `npm run test:web` — exit 0, 458/458.
- Web typecheck: `npm --prefix apps/web run typecheck` — exit 0.
- Standing gate: `npm run verify:wave3` — exit 0: 173/173 Desktop-cloud tests, 458/458 Web tests, and Next production build with 12/12 static pages.
- Desktop build gate: `npm run build` — exit 0; pricing catalog valid and Vite production bundle completed.
- `git diff --check` — exit 0.

## Rendered-proof boundary

The authenticated matched screenshot matrix is not claimed. A fresh attempt to start the Web server with `npm --prefix apps/web run dev -- --hostname 127.0.0.1 --port 3141` failed with `listen EPERM: operation not permitted 127.0.0.1:3141`. A direct browser-tool attempt with `agent-browser --session weekform-summary-parity open 'http://127.0.0.1:3141/app?screen=narrative'` also failed because its socket directory under `~/.agent-browser` is not writable in this sandbox. Therefore light/dark captures at 1440x900 and 1024x720 remain an operator/environment follow-up rather than inferred proof.

## Acceptance boundaries

- Error, waiting, and connected content are mutually exclusive.
- Unsupported Desktop narrative operations are not rendered as working Web actions.
- The single Web handoff describes acquisition/continuation on Mac; it does not claim the browser can launch the installed app.
- The manager boundary uses `role="note"`, not a live status region, and the load failure uses `role="alert"`.
- Responsive CSS preserves the Desktop two-panel geometry and collapses to one column at 760 px.
