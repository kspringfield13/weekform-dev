# Iteration 2 History independent critic

Date: 2026-07-20  
Verdict: **APPROVE — bounded History Activity/Audit density and interaction slice only**

The initial implementation was not approved. Independent review found that both clear-search controls lost keyboard focus when they unmounted, the Audit load-error state rendered a misleading zero receipt count, its inaccessible title/label continued to claim successful syncs, and the Activity search width drifted from Desktop's canonical 360 px geometry. The implementation and contract teammates repaired all four findings before this verdict.

## Final findings

- Activity now uses the Desktop compact-header composition: the 360 px search occupies the header action slot and the Web-only Activity count card is gone. Audit alone retains the score footprint.
- The screen and both streams use Desktop-shaped viewport ownership and density: column flex layout, shrinkable independently scrolling lists, 8 px row rhythm, 11 x 14 px Activity card padding, reviewed-card left cue, and the two-column 260 px Audit receipt row.
- Activity and Audit search support Escape, visible focus, and clear controls that explicitly restore focus to their respective inputs. Audit filters are exposed as a named control group with pressed state. At 720 px the header, toolbar, cards, receipt rows, and Flagged boundary collapse without requiring horizontal overflow.
- Audit load failure remains loud through `role="alert"`; its score renders an em dash and both title and screen-reader text say that the Web receipt count is unavailable. Failure therefore cannot masquerade as a successful zero-result response.
- The backend and privacy boundary did not widen. Activity is derived only from the already-validated positive-allowlist replica blocks; Audit is derived only from completed replica metadata. The component adds no fetch, Supabase client, browser storage, raw activity, local audit-event, screenshot, sensitive-summary, AI-credential, or Manager Access path. Local history and Flagged captures retain explicit Mac-only handoffs.

## Independent verification

```text
node --import tsx --test \
  apps/web/lib/individualHistoryDensityParity.test.ts \
  apps/web/lib/individualHistoryVisualParity.test.ts \
  apps/web/lib/individualHistoryPresentation.test.ts \
  apps/web/lib/individualHistoryCompositionParity.test.ts \
  apps/web/lib/individualSensitiveHistoryBoundaryParity.test.ts

20 passed, 0 failed
```

```text
npm --prefix apps/web run typecheck
exit 0

git diff --check -- apps/web/components/IndividualHistorySettings.tsx \
  apps/web/components/PersonalHistoryScreen.module.css \
  apps/web/lib/individualHistoryDensityParity.test.ts \
  apps/web/lib/individualHistoryVisualParity.test.ts
exit 0
```

## Approval boundary

This verdict approves the new source-level History slice, not route-wide pixel parity or the overall mission. Authenticated matched Desktop/Web screenshots, runtime console proof, light/dark review at 1440 x 900 and 1024 x 720, remaining current-block/empty-state density comparison, and human operator approval are still outstanding. No rendered or pixel-perfect claim is made here.
