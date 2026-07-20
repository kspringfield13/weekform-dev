# Iteration 2 — Individual History Activity/Audit density parity

Date: 2026-07-20  
Scope: authenticated Individual Web Activity and Audit presentation only. No replica, API, storage, auth, Manager Access, or local-data contract changed.

## User-visible advance

Activity now follows Desktop's compact Ledger composition: the 360 px search occupies the header action slot, the redundant Web-only block-count card is gone, reviewed rows have a visible verification cue, the list owns the remaining viewport, and cards use Desktop's dense 11 px/14 px treatment. Search clear restores input focus, and the narrow layout stacks controls and card values without horizontal clipping.

Audit now follows Desktop's toolbar and receipt-stream geometry: the two review-safe scopes form a named control group, filters retain 32 px targets, receipt rows use the 260 px/0.36fr leading column with 12 px/14 px padding, long values truncate, and the stream scrolls inside the workspace. A replica load failure displays an unavailable receipt count and matching accessible text rather than masquerading as a successful zero-receipt result.

The boundary remains truthful. Web reads only review-safe activity and derived sync receipts already supplied by the existing replica path. Local events, window titles, screenshots, notes, capture controls, AI credentials, and Manager data remain absent; the local-history and Flagged Captures handoffs stay explicit.

## TDD and validation evidence

The independent contract lane first ran:

```text
node --import tsx --test apps/web/lib/individualHistoryDensityParity.test.ts
3 passed, 4 failed
```

The failures covered viewport-owned density, semantic filter grouping, clear-search focus restoration, and an honest load-error receipt count. After repair:

```text
node --import tsx --test apps/web/lib/individualHistory*.test.ts apps/web/lib/individualSensitiveHistoryBoundaryParity.test.ts
23 passed, 0 failed
```

Web TypeScript checking passed. `npm run web:build` compiled, typechecked, and generated all 12 static pages. The authoritative root `npm run build` also passed in this iteration. Scoped `git diff --check` passed.

The complete static Web suite ran 483 tests: 481 passed and two failed in concurrent Supabase smoke-gate work outside this slice. Those failures expect the deleted `supabase/tests/personal_replica_production_smoke.sql` and an older `verify:wave4` command string; this History work did not modify those artifacts or weaken those tests.

## Rendered-proof boundary

No pixel-parity claim is made. `npm --prefix apps/web run dev` cannot bind the sandbox listener (`listen EPERM` on port 3000), and the authenticated workspace has no supported synthetic auth bypass. Required operator proof remains matched Desktop/Web Activity and Audit states at 1440x900 and 1024x720 in light/dark, including populated, empty, filtered, load-error, expanded-receipt, keyboard-focus, and narrow-overflow states.
