# Iteration 8 independent critic — privacy-safe Flagged route

Date: July 20, 2026  
Role: independent critic; no implementation source edited  
Verdict: **APPROVE**

## Scope reviewed

I inspected the bounded Individual Web `sensitive` / Flagged Captures slice against the Desktop route, composition, focus, and privacy contract. The review covered:

- canonical route resolution and reverse serialization;
- conditional History-tab behavior;
- direct-load and browser Back/Forward state and focus handling;
- authenticated dashboard composition and CSS visibility;
- Desktop-shaped header, score, introduction, empty-boundary layout, responsive treatment, and keyboard focus affordances;
- positive-allowlist, storage, network, mutation, and Manager Access boundaries;
- evidence wording for false zero, false availability, screenshot, or pixel-parity claims.

## Findings

### Route and navigation — PASS

`sensitive` is a valid Individual History subview and round-trips to the canonical `?screen=sensitive` value. Unknown routes still fail closed to Week Capacity, and invalid cross-section combinations still fall back within their requested section.

The Flagged context tab is appended only while the canonical sensitive route is active. This matches Desktop's conditional-tab behavior: Activity and Audit remain the normal History taxonomy, while a copied or restored Flagged deep link always has a selected tab instead of a blank or mismatched panel. Leaving Flagged removes the conditional tab; browser Back makes it reappear.

The existing canonical URL writer retains unrelated query parameters and writes one `pushState` entry. `popstate` resolves through the same allowlist. Focus restoration is restrained: when focus was in the context-navigation strip, Back/Forward moves it to the restored selected tab on the next animation frame; otherwise navigation does not steal focus. Direct initial load likewise does not force focus.

### Rendered composition and accessibility — PASS

The authenticated Individual dashboard mounts a distinct `data-web-subview="sensitive"`, and the global visibility selector exposes it only for the matching active subview. The panel is labelled by its `h1`; the tab uses the existing WAI-ARIA roving-tab pattern with `aria-selected`, `aria-controls`, and one `tabIndex=0` owner. A polite status boundary states that local captures remain on Mac and cannot be displayed or managed on Web.

The view carries the Desktop Flagged header and score silhouette, 60-character introduction measure, 13 px introduction copy, 148 px empty-state floor, 42 px icon footprint, surface/border tokens, responsive stacking, and the existing globally visible keyboard focus treatment for the acquisition link. Web correctly replaces the unknown local count with an em dash and an explicit unavailable label rather than presenting zero or claiming an empty local queue.

### Privacy, backend, and Manager separation — PASS

The new screen receives no props and contains no fetch, Supabase client, RPC, localStorage, sessionStorage, form control, destructive control, or persistence path. It does not import or render `VisualContextInsight`, app names, project hints, derived summaries, timestamps, screenshot-retention state, local audit events, or a capture count. The dashboard does not pass the already-loaded review-safe replica into the boundary.

No sensitive subview or boundary component was added to Manager Access or team pages. Existing backend wiring, review-command behavior, and Manager-specific surfaces remain unchanged.

### Evidence integrity — PASS with explicit limitation

The implementation makes no claim that authenticated matched screenshots or computed pixel measurements were captured. This review confirms source composition, tests, compiler/build output, and privacy behavior only. The route-parity audit remains conservatively stale until the lead records this iteration; it still describes the route as missing, so it does not create an unearned completion claim but should be updated with the new evidence before the operator summary.

## Commands and exact results

```text
node --import tsx --test apps/web/lib/individualWorkspaceRoute.test.ts apps/web/lib/individualSensitiveBoundaryParity.test.ts apps/web/lib/individualSensitiveHistoryBoundaryParity.test.ts apps/web/lib/webAppRouting.test.ts apps/web/lib/storageBoundary.test.ts
PASS — 20/20 tests

npm --prefix apps/web run typecheck
PASS — exit 0

npm run test:web
PASS — 451/451 tests

npm --prefix apps/web run build
PASS — Next.js production build compiled, TypeScript passed, and 12/12 static pages generated

git diff --check
PASS — exit 0
```

## Critic decision

No blocking issue was found in the bounded sensitive-route repair. The route fails loudly and truthfully at the Web privacy boundary, preserves Desktop navigation semantics and layout vocabulary, does not widen backend or Manager scope, and keeps local evidence local. **APPROVE** for this iteration.

Authenticated matched Desktop/Web screenshots and human operator approval remain separate overall-mission gates.
