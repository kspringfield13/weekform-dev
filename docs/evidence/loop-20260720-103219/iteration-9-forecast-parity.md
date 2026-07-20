# Iteration 9 — Forecast composition parity

Date: 2026-07-20  
Scope: authenticated Individual Web Forecast only. Backend, Supabase schema, review-safe replica shape, Desktop source, and Manager Access were unchanged.

## Outcome

The Web Forecast now uses the Desktop page sequence: Forecast header, Forecast Agent panel, scenario result, capacity trajectory, then forecast track record. The same existing review-safe presentation remains the data source.

- The header uses Desktop Forecast hierarchy and no longer carries a persistent Mac acquisition CTA.
- The Agent panel owns the Mac-only generation boundary in-place and says that no forecast action ran.
- The result uses the Desktop three-scenario cards, range, planning guidance, risk flags, and assumptions geometry. It does not fabricate Desktop's AI reliable estimate.
- Error, no-replica, one-week baseline, and multi-week history branches remain distinct and fail loudly.
- One week renders an explicit unavailable accuracy/track-record boundary. Two or more weeks retain the accessible, interactive observed-baseline trajectory and explicitly state that it is not predicted-versus-actual accuracy.
- Scenario-card padding and value scale were aligned to the Desktop source at 12 px and 28 px after independent review.

## TDD and gates

- RED: `node --import tsx --test apps/web/lib/individualForecastCompositionParity.test.ts` — 0/4 passed before implementation.
- Focused final: Forecast composition, interaction, presentation, and trajectory tests — 19/19 passed.
- `npm run test:web` — 455/455 passed.
- `npm --prefix apps/web run typecheck` — passed.
- `npm run verify:wave3` — passed: 173/173 Desktop-cloud tests, 455/455 Web tests, Next production build with 12/12 static pages.
- `npm run build` — passed after final CSS polish; pricing catalog valid and Vite built successfully.
- `git diff --check` — passed.

## Rendered-proof boundary

Rendered matched screenshots were attempted but are still environment-blocked. The managed sandbox denied the Next dev server bind (`listen EPERM` on `0.0.0.0:3141`) and agent-browser could not write its socket directory (`Operation not permitted`). No pixel-parity claim is made. Authenticated light/dark screenshots at 1440x900 and 1024x720 remain required.
