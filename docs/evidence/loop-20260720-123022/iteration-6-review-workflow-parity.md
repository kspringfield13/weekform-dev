# Iteration 6 — Individual review workflow parity

Date: 2026-07-20  
Scope: authenticated Individual Today and Weekly Review only. Manager Access, replica shape, storage, Supabase schema, and RPC behavior are unchanged.

## Inspectable advancement

- Today now exposes Desktop's complete review-safe classification correction set: Work category, Planned status, and Work mode.
- One approval-gated relabel request carries all three submitted values through the existing `reviewCommandInput` positive allowlist and existing `queue_review_command` RPC. The browser still cannot directly change local truth.
- The wider four-control correction row collapses above constrained desktop widths and becomes a single column at 760 px, without horizontal clipping.
- Weekly Review restores Desktop's ordered `Review flagged captures` concern between work blocks and forecast accuracy. It remains a truthful Mac-only acquisition handoff: Web receives no screenshot, summary, count, or review outcome.
- The Web-only completion checklist row was removed. Completion remains represented once in the existing terminal footer because only the Mac can write the local completion audit event.

## TDD evidence

RED before production edits:

- `individualTodayCorrectionParity.test.ts`: 1 passed / 2 failed because Web omitted `planned_status` and `mode` fields and the server action built only `{ category }`.
- `individualWeeklyReviewChecklistParity.test.ts`: 1 passed / 2 failed because Web omitted `sensitive_captures` and substituted `completion` in the checklist.

GREEN after implementation:

- Focused review suite: 34/34 passed.
- New and updated parity/presentation contracts: 10/10 passed after the build repair.
- `npm run test:web`: 530/530 passed.
- `npm run web:build`: passed; TypeScript passed and 12/12 static pages generated.
- Scoped `git diff --check`: passed.

The first Web build correctly caught an invalid runtime import of shared taxonomy constants. The repair retained closed local option lists beside the existing local category allowlist; the server-side validator remains the authoritative allowlist and rejects drift or malformed values before RPC invocation.

## Runtime and broader gate boundaries

- Browser tooling itself passed `agent-browser doctor --offline --quick` (7/7).
- A local Next runtime could not bind `127.0.0.1:3319` (`listen EPERM`), and no reusable service was listening on 3000, 3319, or 5173. No authenticated screenshot or pixel-parity claim is made.
- `npm run build` remains blocked outside this slice by concurrent Desktop type errors: missing `quiesceForReset` in `usePersonalCloudSync.ts` and missing `sourceClock` in `cloudPolicy.ts`.
- Source QA separately identified a narrow first-paint drawer flash and undersized drawer controls. Those are recorded in the runtime audit and intentionally not mixed into this review-workflow slice.

## Privacy and behavior boundary

No raw activity, window title, project, stakeholder, evidence, screenshot, flagged-capture detail, AI credential, or local audit event was added to Web. No browser workload persistence was added. Manager Access is unchanged. Unsupported actions fail through the existing validator/RPC boundary or hand off explicitly to Mac acquisition.
