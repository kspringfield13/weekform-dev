# Independent critic review — Summary parity slice

Date: 2026-07-20  
Mission: `loop-20260720-103219-8d922a`  
Verdict: **APPROVE (slice only)**

## Decision

No blocking defect was found in the new Individual Web Summary slice. The implementation is an honest, bounded improvement to Desktop-shaped Summary composition: it adds the narrative-result wrapper, hero status/footer, synchronized replica metadata, evidence list, and manager-panel toolbar while retaining the existing two-panel Analyst/Manager hierarchy and responsive collapse.

This approval does **not** declare the overall Desktop-to-Web parity mission complete. The route audit identifies additional P0/P1 gaps, and `rendered/qa-report.md` documents that authenticated rendered proof and matched screenshots remain environment-blocked. Human approval should therefore treat this as acceptance of the Summary source slice, not acceptance of pixel-level route parity or the full mission.

## Files inspected

- `apps/web/components/PersonalSummaryScreen.tsx`
- `apps/web/components/PersonalWeekIntelligence.module.css`
- `apps/web/lib/individualSummaryCompositionParity.test.ts`
- `apps/web/lib/personalSummaryPresentation.ts`
- `apps/web/lib/personalSummaryPresentation.test.ts`
- `apps/web/lib/personalReplica.ts`
- `apps/desktop/src/components/narrative/NarrativeScreen.tsx`
- `docs/evidence/loop-20260720-103219/route-parity-audit.md`
- `docs/evidence/loop-20260720-103219/rendered/qa-report.md`

## Findings

### Backend and privacy boundary — PASS

- Summary reads only the already-validated `PersonalReplicaView` and calls the deterministic `buildPersonalSummaryReadout`; it adds no fetch, Supabase client, browser persistence, or write path.
- The visible signals are derived exclusively from the positive-allowlist capacity fields. No raw titles, screenshots, notes, local audit history, AI credentials, prompts, or generated narratives are introduced.
- The manager panel explicitly says `Private on Mac`, `Not assembled in Web`, and refuses to invent a shareable draft or recommendation. Its only action is the truthful `Get Weekform for Mac` acquisition route.
- The sync timestamp is safe to format because `listOwnPersonalReplicas` returns no rows on load/integrity error and `parsePersonalReplicaRow` validates `synced_at` before producing `PersonalReplicaView`.

### Desktop style and composition — PASS at source level

- The new `result`, `heroCopy`, `heroFooter`, and `statusGroup` reproduce the Desktop narrative result's header/status layering instead of using a generic Web card header.
- The Analyst panel now has an evidence heading and numbered signal list; the Manager panel has a desktop-shaped toolbar and bounded local-only body.
- The 0.92/1.08 two-panel grid and 760px single-column collapse match the intended Desktop narrative balance and provide a coherent narrow layout.
- Status is announced, the sync timestamp uses semantic `<time>`, panels have distinct headings, and the signal list is a labeled ordered list.

### Tests — PASS, with proof limitation noted

The new composition test is intentionally source-contract based. It usefully pins the expected hierarchy, privacy wording, absence of browser/network seams, panel proportions, and responsive breakpoint, but it cannot prove computed CSS, browser layout, screenshots, or visual regressions. The deterministic presentation tests provide real behavior coverage for allowlisted fields and the no-replica fail-closed state.

## Commands and evidence

Focused Summary/parity tests:

```text
node --import tsx --test \
  apps/web/lib/individualSummaryCompositionParity.test.ts \
  apps/web/lib/individualUsageSummaryCompositionParity.test.ts \
  apps/web/lib/personalSummaryPresentation.test.ts

9 tests, 9 pass, 0 fail
```

Full Web regression suite:

```text
npm run test:web

413 tests, 413 pass, 0 fail
```

Production Web build:

```text
npm run web:build

exit 0; Next.js compiled and TypeScript completed; 12/12 static pages generated
```

Diff hygiene:

```text
git diff --check -- apps/web/components/PersonalSummaryScreen.tsx \
  apps/web/components/PersonalWeekIntelligence.module.css \
  apps/web/lib/individualSummaryCompositionParity.test.ts

exit 0
```

An initial ad hoc `node --test` invocation was not the repository test runner and failed to resolve the extensionless TypeScript import in `personalSummaryPresentation.test.ts`. Re-running with the repository's required `node --import tsx --test` invocation passed; this is a runner mismatch, not an application or test failure.

## Residual risk / operator gate

- No authenticated browser render or matched Desktop/Web screenshot exists for this slice. The independent rendered QA worker could not bind/reach localhost or launch a browser. This blocks any pixel-parity claim.
- The empty, valid-replica, and load/integrity-error layouts compile and are source-covered, but their real 1440x900, 1024x720, light, and dark rendering is still unverified.
- Overall route parity remains incomplete. In particular, Agent, Forecast, AI Usage, Accelerate, Skills, and the missing privacy-safe `sensitive` route still have documented gaps.

## Final verdict

**APPROVE the Summary slice.** It is privacy-correct, backend-neutral, build-clean, regression-green, and materially closer to the Desktop narrative result composition. **Do not mark the overall mission done** until authenticated rendered comparison is available, the remaining route gaps are addressed, and the human operator approves.
