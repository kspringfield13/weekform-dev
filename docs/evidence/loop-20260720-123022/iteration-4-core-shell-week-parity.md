# Iteration 4 — Individual shell and core Week parity

Date: July 20, 2026

## Inspectable outcome

- The Week context strip now shows the current review-safe replica week using the same `page-week-context` placement and accessible “Viewing week” label as Desktop. With no replica, no week label is fabricated.
- Primary Individual destinations expose and implement Desktop's `Meta+1`, `Meta+2`, `Meta+3`, `Meta+4`, and `Meta+9` shortcuts, with assistive metadata and visible hover hints.
- Capacity now restores Desktop's screen-header hierarchy and `h1` hero semantics, along with the 168/300/220 hero columns, 190px hero, 154px gauge, 132px metric cards, 40px icons, and 172px/24px donut geometry.
- Today, Capacity, and Weekly Review share the 1200px Desktop content rail. Narrow layouts retain a stable 44px toolbar row plus one content row at both 760px and 820px.
- Weekly Review reports readiness as unavailable on replica load failure and ends with one truthful “Get Weekform for Mac” acquisition handoff in Desktop's terminal action slot instead of a permanently disabled duplicate action.
- Replica errors are owned by each active route; the duplicate workspace-level error banner was removed. Existing API calls, review-command approval, positive-allowlist replica data, and Manager Access routing are unchanged.

## Verification

- `node --import tsx --test apps/web/lib/individualCoreRouteParityGaps.test.ts apps/web/lib/individualCoreWeekContextParity.test.ts apps/web/lib/individualShellVisualParity.test.ts apps/web/lib/individualTodayCompositionParity.test.ts apps/web/lib/individualCapacityCompositionParity.test.ts apps/web/lib/individualWeeklyReviewCompositionParity.test.ts` — PASS, 30/30.
- `npm run web:build` — PASS; optimized Next.js build compiled and generated 12/12 static pages.
- `npm run build` — PASS; TypeScript project build, pricing check, and Vite production build completed.
- Scoped `git diff --check` — PASS.
- `npm run test:web` — 515/517 PASS. The only failures are concurrent distributed-request-control route-ordering and SQL RPC-signature contracts outside this parity slice; all parity, workspace-error, and download-truth tests pass.
- `npm --prefix apps/web run typecheck` — BLOCKED outside this slice by five pre-existing `webexTokenBroker.test.ts` argument-type errors (`string` versus `"x-forwarded-for"`). The production Web build's TypeScript phase passed.

## Proof boundary

No authenticated matched screenshots or browser runtime proof were captured in this sandbox. This note records source contracts and production build evidence only; it does not claim pixel-level visual approval.

## Independent critic

Final verdict: **APPROVE** for this bounded shell, Today, Capacity, and Weekly Review slice. The critic independently verified 38/38 focused parity tests and scoped diff hygiene, and found no blocking privacy, backend-wiring, Manager Access, error-state, responsive, or acquisition-truth issue. Human operator approval and authenticated matched screenshots remain outstanding for the overall mission.
