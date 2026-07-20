# Iteration 5 — Capacity breakdown parity

Date: 2026-07-20  
Scope: authenticated Individual Capacity page only. Manager Access, API wiring, persistence, and the review-safe replica schema were not changed.

## New inspectable outcome

The Web Capacity breakdown now follows the current Desktop composition instead of stopping at a reduced percentage-only summary:

- Categories aggregate the complete review-safe allocation, show the Desktop top five initially, and expose an accessible `View all` / `Show top 5` disclosure only when more categories exist.
- Category rows use the Desktop four-column silhouette: category and color cue, relative bar, modeled duration, and allocated share.
- The right panel is now `How tracked time is spent`. Its donut center and legend use the same deterministic `estimatedCapacityPct` allocation and 40-hour baseline as Desktop, avoiding divergent analytics for the same synced week.
- Category dots and bars keep stable category identity colors. Because the Web bundle has an intentionally self-contained Turbopack root, its local palette helper is executable-tested entry-for-entry against the canonical Desktop taxonomy rather than widening the runtime bundle boundary.
- Raw activity, titles, screenshots, notes, evidence, browser storage, and Manager data remain outside this surface.
- Narrow category geometry, toggle focus, and existing responsive panel collapse are preserved.

## TDD evidence

RED before production changes:

```text
node --import tsx --test apps/web/lib/individualCapacityBreakdownParity.test.ts
0 passed, 4 failed
```

The initial four failures covered the missing category disclosure and a proposed duration presentation. Independent criticism then found that timestamp-derived duration would diverge from Desktop's deterministic capacity model. The corrected RED contract passed two checks and failed three: stable taxonomy colors, Desktop `aggregateReplicaModes`, and 40-hour-baseline formatting. The rejected timestamp helper was removed rather than accepted behind green source-regex tests.

GREEN after implementation:

```text
node --import tsx --test \
  apps/web/lib/individualCapacityBreakdownParity.test.ts \
  apps/web/lib/personalWeekPresentation.test.ts \
  apps/web/lib/individualCapacityCompositionParity.test.ts \
  apps/web/lib/personalCapacityEmptyWeekParity.test.ts
20 passed, 0 failed
```

Standing gates:

```text
npm run test:web
524 passed, 0 failed

npm run web:build
PASS — TypeScript passed; 12/12 static pages generated

npm run build
FINAL RUN BLOCKED outside this slice — a concurrent Desktop change leaves
apps/desktop/src/services/cloudPolicy.ts missing the newly required sourceClock field.
The root build passed earlier in this iteration, before that concurrent tree change.

git diff --check -- <scoped Capacity files>
PASS
```

## Runtime proof boundary

An authenticated matched screenshot could not be captured in this sandbox. A direct loopback attempt failed before browser automation could connect:

```text
npm --prefix apps/web run dev -- --hostname 127.0.0.1 --port 3000
listen EPERM: operation not permitted 127.0.0.1:3000
```

This document therefore claims source, contract, type, and build proof only. It does not claim pixel parity, computed-style inspection, console inspection, or authenticated keyboard traversal.

## Independent review

The first critic pass rejected the timestamp-derived donut because Desktop groups `estimated_capacity_pct` and converts it against the 40-hour baseline. After the repair, the independent critic returned **APPROVE** and independently reproduced:

```text
Focused Capacity suite: 20 passed, 0 failed
npm run web:build: PASS, 12/12 pages
Scoped git diff --check: PASS
```

The critic found no blocking privacy, accessibility, responsive, semantic, or regression issue in this bounded slice. Human approval and authenticated matched screenshots remain outside this source-level verdict.
