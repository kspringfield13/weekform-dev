# Iteration 9 — Account & Sharing density parity

Scope: authenticated Individual Web Settings > Account & Sharing only. Existing Supabase reads, server actions, auth, persistence, Manager Access authorization, and Mac-owned sharing controls were not changed.

## Inspectable advance

- Replaced the embedded three-card marketing composition with a compact Desktop-style settings-row stack for team creation, invite acceptance, and the Mac source-of-truth handoff.
- Preserved the existing team list/error/empty branches and all existing actions.
- Kept Manager Access conditional on `managedTeams.length > 0`, but presented the entry as a compact settings row.
- Removed the public workspace section's 52px spacing and 25px title scale from Shared Workload inside Account & Sharing.
- Added responsive four-column, three-column, and two-column layouts with explicit status/control placement.
- Moved `teams-title` to the always-rendered heading so the section remains labelled during team-load errors.

## TDD evidence

1. New contract before production integration:
   `node --import tsx --test apps/web/lib/individualAccountSharingDensityParity.test.ts`
   — RED, 0/1 passed because the Account projection still used marketing cards.
2. The first independent critic rejected the integrated result for a possible status/control collision, retained Shared Workload marketing density, and a missing error-state label.
3. The contract was strengthened for those three defects and run again — RED, 0/1 passed.
4. After repair, the focused Account/Settings suite passed 10/10.

## Final gates

- `npm run test:web` — PASS, 534/534.
- `npm run web:build` — PASS, TypeScript complete and 12/12 static pages generated.
- `npm run build` — PASS, pricing catalog valid and Vite production bundle built.
- Scoped `git diff --check` — PASS.
- Independent critic re-review — APPROVE; no blocking layout, responsive, accessibility, backend, Manager, or privacy drift.
- `agent-browser doctor --offline --quick` — PASS, 7/7.

## Visual-proof boundary

The local Next app started successfully on `127.0.0.1:3000`, but `agent-browser` could not create its daemon socket under `/Users/rohnspringfield/.agent-browser` in this managed sandbox (`Operation not permitted`). Authenticated matched screenshots therefore remain environment-blocked and are not claimed as completed evidence.
