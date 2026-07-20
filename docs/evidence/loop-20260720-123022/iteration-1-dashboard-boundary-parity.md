# Iteration 1 — Individual dashboard loading/error shell parity

Date: 2026-07-20  
Scope: authenticated Individual Web route boundaries only. No backend, replica, storage, auth, or Manager Access contract changed.

## User-visible advance

The Next.js dashboard loading and fatal-error states previously replaced the authenticated Weekform workspace with a generic marketing-width container and three cards. That caused the toolbar, sidebar, Week context strip, and content frame to disappear while a route resolved or failed.

Both states now compose `IndividualDashboardBoundaryShell`. The shared boundary preserves the Desktop-shaped app silhouette, all five Individual destination labels, the Week tab footprint, the 1200 px content frame, a four-metric/two-panel loading skeleton, and a retryable error panel. At narrow widths the decorative sidebar collapses instead of opening an unusable overlay. Loading animation is removed when reduced motion is requested.

The shell is intentionally data-free. It does not import Supabase, infer authentication details, render Manager Access, guess team membership, fabricate workload values, or mark a destination/context tab active before the deep-linked route is known. Fatal errors remain loud through one `role="alert"`; loading retains `aria-busy="true"`; the Next retry callback remains operational.

## TDD evidence

RED:

```text
node --import tsx --test apps/web/lib/individualDashboardBoundaryShellParity.test.ts
0 passed, 2 failed
```

GREEN:

```text
node --import tsx --test apps/web/lib/individualDashboardBoundaryShellParity.test.ts
2 passed, 0 failed
```

The independent critic then caught a misleading hardcoded Week/Capacity active state. A second RED contract failed 1/2 until both decorative navigation groups became neutral; the repaired focused contract returned to 2/2.

Focused Individual parity regression:

```text
node --import tsx --test apps/web/lib/individual*.test.ts
118 passed, 0 failed
```

`git diff --check` passed for the five scoped implementation/test artifacts. Web typecheck passed, the complete Web suite passed 472/472, and the Next production build compiled, typechecked, and generated all 12 static pages successfully.

## Standing-gate and rendered-proof boundary

The first standing-gate attempt overlapped concurrent Web edits and briefly failed four unrelated tests. After those files settled, Web typecheck passed, the complete Web suite passed 472/472, and `npm run web:build` exited 0. Root `npm run build` still stops in concurrent Desktop persistence work because `AggregateError` is unavailable to its configured TypeScript library; this slice does not modify that service or TypeScript target.

Authenticated screenshots were attempted but remain environment-blocked. Next cannot bind a new sandbox listener (`listen EPERM`), sandbox requests cannot reach the host listeners, and `agent-browser` cannot start its daemon even with a writable `/private/tmp` socket directory. No screenshot, runtime-console, computed-layout, or pixel-parity claim is made. Required human/operator proof remains loading and fatal error at 1440x900 and 1024x720 in light/dark, plus matched Desktop reference review.
