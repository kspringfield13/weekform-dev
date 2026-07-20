# Iteration 10 — Today fail-closed action parity

Scope: authenticated Individual Web Today failure states only. No API, server action, Supabase, persistence, auth, Manager Access, replica, or Mac approval behavior changed.

## Defect and bounded repair

Today derived its header approval chip and batch-confirm form from the last review-safe replica before rendering route-local load errors. A replica load failure could therefore leave a stale batch form actionable above the error alert. A review-command lifecycle failure hid the form but left the approval region visible even though action status could not be validated.

The header action guard now requires both replica loading and review-command loading to be healthy. The existing mutually exclusive error branches remain loud: replica failure states that no request was sent, and command-status failure states that actions are unavailable. Healthy eligible-count, 50-item batching, pending/applied/rejected/conflict behavior, server validation, transactional RPC, and Mac approval remain unchanged.

## TDD and verification evidence

- RED: `node --import tsx --test apps/web/lib/individualTodayFailureStateParity.test.ts` — 0/1 passed before the guard.
- Focused GREEN: Today failure/composition/correction/taxonomy suite — 9/9 passed.
- `npm run test:web` — 535/535 passed.
- `npm run web:build` — passed; Next compiled and generated 12/12 static pages.
- `npm run build` — passed; TypeScript, pricing catalog, and Vite build completed. The standing bundle-size warning remains non-blocking and unchanged by this repair.
- `agent-browser doctor --offline --quick` — 7/7 passed.
- `npm --prefix apps/web run dev -- --hostname 127.0.0.1 --port 3000` — environment-blocked with `listen EPERM`; no runtime, computed-style, console, or screenshot claim is made.

Required rendered proof remains the Today replica-error and command-status-error states beside Desktop at 1440x900 and 1024x720 in light and dark. Neither Web failure state may contain an approval chip, batch form, or review action.

## Privacy and ownership

The repair narrows presentation during unvalidated state. It does not add data, network access, storage, browser persistence, direct execution, or Manager Access behavior. Review actions remain approval-gated and Mac-authoritative.
