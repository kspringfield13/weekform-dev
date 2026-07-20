# Iteration 8 Today taxonomy and mobile Settings parity

Date: 2026-07-20  
Scope: two narrow source-level Individual parity repairs discovered after the route-wide continuation audit. Backend wiring, Supabase, Manager Access, persistence, and privacy boundaries were not changed.

## User-visible outcome

- Today now renders Work category, Planned status, and Work mode from one Web review-taxonomy module also used by the review-safe replica validator. An executable contract compares every entry and order against Desktop's canonical domain taxonomy, preventing UI/parser/Desktop drift while preserving the intentionally self-contained Web build boundary.
- At the `<=820px` drawer breakpoint, the primary Settings destination now keeps a 44 px minimum target beside the 44 px opener/close controls and 48 px route rows. This closes the remaining undersized primary mobile navigation target.

## TDD evidence

The initial contracts failed before production edits:

```text
individualTodayCanonicalTaxonomyParity: 0/1 passed
individualMobileSettingsTouchParity: 0/1 passed
```

The first taxonomy implementation exposed a real integration defect rather than being accepted on source assertions alone: `npm run web:build` failed because the self-contained Turbopack root cannot bundle a runtime import from `packages/domain`. The repair therefore keeps a single Web-local taxonomy shared by presentation and validation, and proves it entry-for-entry against Desktop in the executable test.

Final checks:

```text
Focused Today/parser/touch suite: 20/20 passed
npm run test:web: 533/533 passed
npm run web:build: passed; 12/12 static pages generated
npm run build: passed
```

## Runtime and proof boundary

`agent-browser doctor --offline --quick` passed 7/7. Authenticated matched screenshots remain environment-blocked: the sandbox cannot reach the existing host listeners, and the browser daemon exits during startup even with its socket redirected to writable temporary storage. This note makes no rendered or pixel-parity claim.

The read-only route audit also identified Settings > Account & Sharing as the next highest-density composition gap: it retains a marketing-style three-column layout and dominant Manager Access hero inside the Desktop-shaped Settings panel. That larger re-composition is deliberately not mixed into this bounded repair.
