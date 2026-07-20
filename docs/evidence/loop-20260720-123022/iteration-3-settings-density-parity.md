# Iteration 3 — Individual Settings density and action parity

Date: 2026-07-20  
Scope: authenticated Individual Web Settings presentation only. No API, Supabase, auth, storage, Manager Access, or sharing contract changed.

## User-visible advance

Settings now retains Desktop's stable `Privacy and data sources` page title across the first five tabs and changes to `Account & sharing` only for the Account tab. All local-boundary rows use the effective Desktop geometry: 80 px minimum height, 12 px/8 px inset, 34 px icon column, 13 px/18 px body copy, 11 px secondary status, and an inert 82 px/32 px control footprint.

Data Sources, Data Control, AI Assistance, AI Usage, and Notifications no longer repeat an acquisition button in every Mac-owned row. Each uses one restrained terminal handoff after its rows. Data Control's authenticated `Delete private Web history` form remains operational and structurally separate; Web Ask, Web AI Usage, account, and team actions retain their existing Web wiring. Six-tab deep links, browser Back/Forward, roving tab focus, and narrow stacking are unchanged.

## TDD and verification

The independent density contract began RED at 0/4, exposing the dynamic page title, repeated row CTAs, 78 px Data Sources drift, and incomplete narrow handoff. The action contract also forced local-only controls to remain inert. After implementation and critic repair, the combined focused Settings surface passed 34/34 tests, including explicit protection for the private-history deletion form and exact Desktop geometry/type tokens.

`npm run web:build` compiled, typechecked production source, and generated 12/12 static pages. The authoritative root `npm run build` passed. Scoped `git diff --check` passed.

The complete static Web suite ran 497 tests: 492 passed and five failed in concurrent distributed-request/Webex broker work outside this slice. The failures are a missing `distributedRequestControl` module and incomplete `webexTokenBroker` control exports/behavior. Standalone Web test typechecking reports the same concurrent test-source drift; production `next build` remains green.

## Rendered-proof boundary

No pixel-parity claim is made. `npm --prefix apps/web run dev` still cannot bind the sandbox listener (`listen EPERM` on `0.0.0.0:3000`), so agent-browser cannot reach the local authenticated workspace. Required operator proof remains matched Desktop/Web screenshots for all six tabs at 1440x900 and 1024x720 in light/dark, including tab focus, terminal handoffs, the operational Web deletion form, and narrow overflow behavior.
