# Iteration 6 independent critic

Date: 2026-07-20  
Verdict: **APPROVE — bounded Today correction and Weekly Review checklist slice**

## Rejected defect and verified repair

The first critic pass rejected a runtime import of the canonical taxonomy from `PersonalTodayScreen.tsx`: Turbopack could not resolve that cross-app runtime module even though the new source-regex contracts all passed. This exposed an important test-integrity gap: source inspection alone did not compile or render the changed component.

Independent reproduction:

```text
npm run web:build
exit 1
Module not found: Can't resolve '../../../packages/domain/src/taxonomy'
./components/PersonalTodayScreen.tsx:16:1
```

The repair keeps the closed review-safe planned-status and work-mode values local beside the existing Web category allowlist, with values and order matching Desktop's current taxonomy. It introduces no new runtime package boundary. The focused tests, full Web suite, Web production build, and root build all passed after the repair.

## Final findings

- The Today form presents the Desktop correction order: Work category, Planned status, then Work mode.
- The server action maps `planned_status` to `plannedStatus` and forwards only category, planned status, and mode through the existing `reviewCommandInput` validator and `queue_review_command` RPC.
- No direct database write, optimistic local mutation, browser persistence, raw title, stakeholder, evidence, screenshot, credential, or local audit field was added.
- Existing pending, applied, rejected, and conflict states continue to communicate the Mac-approval boundary and lock requests consistently.
- The wide four-column correction form collapses to a single column at 760 px; the card itself becomes one column at 1040 px, avoiding the action collision present in the prior two-column card geometry.
- Weekly Review now preserves Desktop's four core checklist rows in order. Flagged Captures is an explicit Mac-only boundary, while the terminal action remains one truthful Mac acquisition handoff rather than a dead completion control.
- Manager Access routing and backend wiring are untouched by the scoped changes.

Non-blocking follow-up: the new source contract should eventually compare the Web-local option values with Desktop's taxonomy or move all three Web review allowlists behind an executable Web-safe shared seam. At present the values and order match exactly, but the regex test would not catch future option drift.

## Independent checks

```text
node --import tsx --test \
  apps/web/lib/individualTodayCorrectionParity.test.ts \
  apps/web/lib/individualWeeklyReviewChecklistParity.test.ts \
  apps/web/lib/individualTodayCompositionParity.test.ts \
  apps/web/lib/individualWeeklyReviewCompositionParity.test.ts \
  apps/web/lib/personalReplica.test.ts \
  apps/web/lib/reviewCommandDuplicateSafety.test.ts
PASS — 29/29

npm run test:web
PASS — 530/530

npm run web:build
PASS — TypeScript and Turbopack compiled; 12/12 static pages generated

npm run build
PASS — root TypeScript, pricing check, and Vite production build

git diff --check -- <iteration 6 scoped artifacts>
PASS
```

No authenticated matched screenshots or runtime keyboard traversal were available in this sandbox, so this review makes no pixel-level or rendered-runtime approval claim.
