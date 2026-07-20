# Iteration 7 — Individual mobile first-paint parity

Date: 2026-07-20  
Scope: authenticated Individual Web shell only. No backend, replica, Manager Access, persistence, or privacy-boundary changes.

## Route audit outcome

A source-level sweep confirmed that all 13 Desktop large-window destinations remain present and distinctly composed in Web. The highest-impact bounded defect was shared by every route at the `820px` responsive boundary: server-rendered state described the wide sidebar while CSS positioned it as a mobile drawer. Before the post-paint media-query effect collapsed it, the drawer, scrim, and opener could disagree with dialog, inert, focus, label, and expansion semantics.

## Implemented contract

- `mobileNavigationOpen` now emits the only class that can reveal the narrow drawer and scrim.
- The narrow first paint keeps the drawer hidden, transparent, off-canvas, and non-interactive; the scrim is likewise absent and non-interactive.
- The shell exposes `viewport-resolved` only after `matchMedia` resolves. The narrow opener stays absent until its label, glyph, and expansion state are truthful.
- `aria-expanded` is omitted while viewport mode is unresolved. Once resolved, it follows modal-open state on narrow viewports and sidebar-collapse state on wide viewports.
- Returning to the wide layout restores the expanded Desktop sidebar. Narrow opener and close targets are `44px` square.
- Existing dialog labeling, background inertness, focus entry/trap/return, Escape handling, route-close behavior, and the single `820px` breakpoint remain unchanged.

## TDD evidence

The independent contract owner added `apps/web/lib/individualMobileNavigationFirstPaintParity.test.ts` before production edits.

- RED: `0/1` passed. The shell did not expose an explicit mobile-open owner.
- First GREEN: focused shell/navigation suite `15/15` passed.
- Critic rejection: the initial contract did not prove visual hiding, and the readiness-unaware opener could still flash the wide label/glyph.
- Strengthened GREEN: the contract now pins hidden and open drawer geometry, hidden and open scrim behavior, viewport readiness, unresolved `aria-expanded`, and `44px` touch targets. Expanded focused route/shell suite passed `25/25`.

## Standing gates

- `npm run test:web` — PASS, `531/531`.
- `npm run web:build` — PASS; TypeScript passed and `12/12` static pages generated.
- `npm run build` — PASS; TypeScript project build, pricing catalog check (`18` models / `4` official sources), and Vite production bundle completed.
- Scoped `git diff --check` — PASS.
- `agent-browser doctor --offline --quick` — PASS, `7/7`.

## Rendered-proof boundary

No screenshot claim is made. The sandbox could not reach the host listener, and agent-browser daemon startup remained blocked even with its socket redirected to writable temporary storage. Matched authenticated screenshots at `1440×900` and `1024×720` remain a separate human/runtime proof surface.

## Independent critic

Final verdict: **APPROVE** for this bounded repair. The critic independently reproduced a `23/23` focused shell/mobile/route pass, a successful Web production build with `12/12` static pages, and a clean scoped diff check. The critic found no remaining blocking first-paint, wide-sidebar, modal/inert, CSS-order, hydration, or touch-target issue. Approval is explicitly source/build bounded and does not claim authenticated pixel proof.

## Product and privacy result

Every Individual route now has a stable narrow first paint: no open/dim flash, no misplaced or misdescribed opener, and no interval where visible navigation disagrees with modal accessibility state. The change is presentation-only and does not widen Web data, API calls, local storage, Supabase use, Manager Access, or Mac-authoritative approval behavior.
