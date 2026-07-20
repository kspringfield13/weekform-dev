# Iteration 6 Desktop-to-Web Individual route gap audit

Date: 2026-07-20  
Scope: source-level inspection of every authenticated Individual route and its core waiting, error, empty, populated, responsive, and interaction seams. Manager Access and local-only Desktop capabilities remain deliberate exceptions. This note makes no screenshot claim.

## What is already present in the dirty tree

The current tree retains all 13 Desktop large-window routes in the Web allowlist. Capacity, Forecast, AI Usage, Summary, Ask, Accelerate, Skills, Activity, Audit, Flagged Captures, and Settings now have dedicated Desktop-shaped Web compositions or truthful local-only boundaries. The shared dashboard loading/error shell, active-week context, primary keyboard metadata, mobile navigation overlay, and light/dark theme controls have also landed. Weekly Review closely reuses Desktop's ordered checklist geometry and replaces the local completion mutation with one explicit Mac handoff.

Authenticated matched screenshots remain a route-wide proof gap, not evidence of a particular source defect. They should still be captured when the environment allows a signed-in runtime.

## Highest-impact bounded gap: Today correction-field parity

Today is the strongest remaining source-level parity gap because Web exposes only one of the three review-safe correction fields already available end to end.

- Desktop renders `Work category`, `Planned status`, and `Work mode` in every review card (`apps/desktop/src/components/ledger/BlockCard.tsx`).
- Web receives and displays all three values, but its relabel form renders only `Work category` (`apps/web/components/PersonalTodayScreen.tsx`).
- The shared `ReviewCommandPatchV1` already permits `category`, `mode`, and `plannedStatus` (`packages/domain/src/personalCloud.ts`).
- Web validation already allowlists and validates all three fields (`apps/web/lib/personalReplica.ts`).
- The database RPC already accepts those same fields. No migration, new API, expanded replica payload, local cache, or direct local mutation is required.
- The narrowing happens only in the server action, which currently constructs `{ category }` (`apps/web/app/dashboard/personalActions.ts`).

This is user-visible functional parity, not cosmetic imitation: an Individual can correct category in Web today but must switch to the Mac to correct mode or planned status, even though the existing approval-gated command path was designed to carry those corrections safely.

## Exact implementation surface

- `apps/web/components/PersonalTodayScreen.tsx`
  - Add canonical `Planned status` and `Work mode` selects beside `Work category`.
  - Submit names `planned_status` and `mode`; initialize from `block.plannedStatus` and `block.mode`.
  - Reuse the canonical domain taxonomy rather than creating divergent option strings.
  - Keep a single explicit `Request relabel` submit because Web corrections remain approval-gated.
- `apps/web/app/dashboard/personalActions.ts`
  - Construct the existing camel-case patch `{ category, plannedStatus, mode }` from the three form fields.
  - Continue routing through `reviewCommandInput` and `queue_review_command`; do not add a query, direct write, optimistic local mutation, or new persistence.
- `apps/web/app/globals.css`
  - Restore Desktop's three-field emphasis (`category` wider, `planned status` and `mode` narrower) while preserving space for the request action.
  - Collapse predictably at the existing narrow breakpoint with no horizontal overflow or clipped labels.
- Focused parity/contract tests, preferably a new `apps/web/lib/individualTodayCorrectionParity.test.ts` or a coherent extension of `individualTodayCompositionParity.test.ts`.

## Inspectable acceptance criteria

1. A populated Web Today card exposes exactly three labeled correction selects in Desktop order: Work category, Planned status, Work mode.
2. The submitted relabel request contains only existing allowlisted keys and maps `planned_status` to `plannedStatus`; category, mode, and planned status all pass through `reviewCommandInput` before the existing RPC.
3. No raw project title, stakeholder, evidence, window title, local note, screenshot, AI credential, or local audit event enters the Web form or patch.
4. Pending, applied, rejected, and conflict states continue to lock or reopen the whole correction request coherently; the UI never suggests a correction applied before Mac approval.
5. At wide width the fields preserve the Desktop density and order; at 1024x720 and the <=760 px breakpoint they wrap/stack without horizontal clipping, action overlap, or inaccessible labels.
6. Keyboard order is category -> planned status -> mode -> Request relabel -> Request confirmation -> Request exclusion, with visible focus and no focus loss during pending/error rendering.
7. Existing focused Today, review-command parser/lifecycle, Web, and build gates remain green. Add RED/GREEN coverage that fails if either field or either patch mapping is removed.

## Route sweep conclusion

After accounting for the already-landed diffs and intentional Manager/local-only boundaries, no other Individual route has a comparably clear combination of user impact, existing backend support, bounded implementation, and testability. The remaining work elsewhere is primarily authenticated screenshot proof and route-density polish. Today correction-field parity is therefore the next bounded implementation slice; matched screenshots should verify it together with the existing Today states once runtime access is available.
