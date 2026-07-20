# Iteration 6 runtime and responsive audit

Date: 2026-07-20  
Scope: authenticated Individual Web workspace runtime/visual QA. Production code was not edited.

## Runtime result

An isolated Next development server was attempted on `127.0.0.1:3319`:

```text
npm --prefix apps/web run dev -- --hostname 127.0.0.1 --port 3319

Failed to start server
Error: listen EPERM: operation not permitted 127.0.0.1:3319
```

Follow-up probes confirmed that no reusable server was listening on `127.0.0.1:3000`, `:3319`, or `:5173`. `agent-browser doctor --offline --quick` passed all seven local browser checks, so the blocker is loopback-listener permission rather than missing Chrome or a broken browser installation.

Authenticated Desktop-size and narrow screenshots therefore could not be captured honestly in this sandbox. No screenshot artifact is claimed.

## Source-based responsive and accessibility review

The Individual route map still covers the full Desktop-aligned set: Today; Capacity, Forecast, Review, AI Usage, Summary; Ask, Accelerate, Skills; Activity, Audit, Flagged; and Settings. The inspected route surfaces have explicit narrow reflow rules:

- Capacity changes four metrics to two columns and then one, collapses the detail grid, and stacks its donut layout.
- Forecast stacks scenario/result grids and condenses its trajectory legend and track-record rows.
- Summary collapses the Analyst/Manager layout and full-widths its handoff action.
- Agent reduces message width, stacks starter/actions, and reflows its Mac-action boundary.
- History stacks audit receipts and the Flagged boundary; Settings rows and terminal handoffs collapse below their component breakpoints.
- The primary drawer has a labelled modal role, focus trap, Escape handling, background `inert`, focus restoration, and route-close behavior.

Focused contract result:

```text
node --import tsx --test \
  apps/web/lib/individualMobileNavigationAccessibility.test.ts \
  apps/web/lib/individualShellVisualParity.test.ts \
  apps/web/lib/individualCapacityBreakdownParity.test.ts \
  apps/web/lib/individualSettingsDensityParity.test.ts \
  apps/web/lib/individualHistoryVisualParity.test.ts

22 tests passed, 0 failed
```

## Highest-impact visual gap: narrow first-paint navigation flash

At `<=820px`, the CSS renders the sidebar as a fixed drawer and adds the full content scrim whenever `.sidebar-collapsed` is absent (`globals.css:5975-6053`). The React shell initializes `sidebarCollapsed` and `isNarrowViewport` to `false`, then detects the narrow viewport and collapses the drawer only in a post-render effect. On the server/first client paint, the DOM therefore represents an expanded sidebar while the narrow CSS already renders the drawer and scrim. The effect then removes it.

Consequences:

- Every cold narrow load can flash an open navigation drawer and dimmed workspace before settling closed.
- During that first visual state, `mobileNavigationOpen` is still false, so the visibly open drawer is not yet exposed as a modal and the background is not yet inert. Visual and accessibility state briefly disagree.
- Immediate screenshot automation can capture the wrong initial layout, making narrow parity evidence flaky.

The existing tests prove the settled overlay and focus lifecycle, but do not exercise the server-render/hydration first paint. A future production repair should make the initial responsive drawer state paint-stable without inventing a second breakpoint source of truth, then add a hydration-level contract or real-browser assertion.

## Secondary narrow interaction gap

The full-shell navigation opener remains `28px` square and vertically centered on the left edge (`globals.css:5089-5108`); the narrow drawer close button is `36px` square (`globals.css:6015-6032`). This is less touch-ready than the app's separately tested Compact surface (`40px` minimum actions) and leaves primary route access visually easy to miss on a phone. It should be evaluated in the first available rendered narrow pass after the first-paint issue is fixed.

## Proof boundary

This audit establishes source behavior and a reproducible sandbox blocker. It does not establish pixel parity, authenticated interaction success, light/dark rendering, overflow behavior in Chromium, or matched Desktop/Web screenshots. Those remain a separate human/browser acceptance surface.
