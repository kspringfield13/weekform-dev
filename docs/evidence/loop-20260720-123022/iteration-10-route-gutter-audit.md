# Iteration 10 — route-wide Individual content-gutter audit

Date: 2026-07-20  
Scope: read-only source audit after Iteration 9. No production code, backend wiring, Manager Access, persistence, or privacy boundary changed. No rendered screenshot claim is made.

## Highest-impact remaining source gap

Every authenticated Individual route is still wrapped by two horizontal content frames:

1. `apps/web/app/dashboard/page.tsx` places all route views inside `container workspace-shell`.
2. `apps/web/app/globals.css` gives that wrapper `padding-inline: clamp(24px, 4vw, 64px)` (with additional responsive values), then gives every `.web-desktop-screen` the Desktop screen frame `width: min(100%, 1200px); margin: 0 auto; padding: 24px 32px 32px`.

Desktop has only the second frame: its final `.screen` rule is the same 1200 px centered width and `24px 32px 32px` padding. The outer Web gutter therefore narrows and shifts Today, all five Week pages, all three Agent pages, Activity, Audit, Flagged Captures, and all Settings tabs whenever the main panel is narrower than the outer gutter plus the 1200 px screen maximum.

This is especially material at the mission's required comparison sizes. With the 224 px expanded sidebar, a 1440 px viewport leaves a 1216 px main panel; Web first removes roughly 116 px through the `4vw` wrapper gutter and then applies the 32 px screen inset, while Desktop applies only the centered screen frame. At 1024 px, the same double-frame behavior remains before the 820 px drawer breakpoint. The Web context strip is separately inset by 16 px, making the route heading/card left edge visibly farther inward than both Desktop and its own tabs.

The existing shell contract confirms only `.web-desktop-screen`; it does not assert that the ancestor contributes no second content gutter. Consequently all route-specific density contracts can pass while the composed page remains horizontally unlike Desktop.

## Recommended bounded repair slice

Normalize the authenticated route-body wrapper, without changing any route component or data boundary:

- `apps/web/app/globals.css`
  - `.web-individual-app .workspace-shell`
  - its `@media (max-width: 820px)` and `@media (max-width: 520px)` overrides
  - preserve `.web-desktop-screen` as the sole Desktop content frame
  - give the optional top-level `.form-notice` its own centered screen-aligned frame if needed, rather than retaining a gutter around every route
- `apps/web/lib/individualShellVisualParity.test.ts`
  - add a failing composed-frame contract that the authenticated `.workspace-shell` has no horizontal padding/max-width constraint while `.web-desktop-screen` retains the Desktop 1200 px/32 px frame
  - pin the narrow rule so only `.web-desktop-screen` supplies its 12 px mobile inset

Do not edit page-specific components, Supabase/API calls, review-command behavior, Manager Access, or the positive-allowlist replica. This is one CSS/test slice whose effect is inspectable across every Individual route.

## Acceptance evidence

1. Focused shell test first fails against the current double gutter, then passes after normalization.
2. Existing Individual shell/mobile/route contracts remain green.
3. Web production build and root build pass.
4. When authenticated browser access is available, compare expanded-sidebar Desktop/Web at 1440x900 and 1024x720: context strip, eyebrow, heading, and first card should share the Desktop horizontal rhythm in light and dark. Also verify collapsed sidebar and <=820 px drawer layouts.
5. The optional dashboard notice remains readable, centered, and aligned without reintroducing a route-wide wrapper gutter.

## Audit decision

Recommend this route-wide gutter normalization as the next bounded iteration. It advances every Individual page with one presentation-only repair and is higher leverage than another isolated card polish. Authenticated matched screenshots and human approval still remain separate mission gates.
