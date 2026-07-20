# Independent critic review — Forecast trajectory parity slice

Date: 2026-07-20  
Mission: `loop-20260720-103219-8d922a`  
Final verdict: **APPROVE (focus repair independently verified; initial rejection retained below)**

## Findings

| Before | After | Why |
| --- | --- | --- |
| `apps/web/app/globals.css:5509` uses `var(--focus)` for the focus-visible border and outline, but Web defines `--focus-ring` and never defines `--focus`; the global Individual focus rule covers buttons, links, inputs, and selects, not the new focusable legend `span` elements. | Use an existing theme token such as `var(--decision)` / `var(--focus-ring)` for both declarations and pin the token with a focused CSS/source contract. | The legend rows are deliberately keyboard-focusable and focus drives series isolation. Both declarations containing the missing custom property are invalid at computed-value time, so keyboard users have no reliable visible focus indicator. This blocks the advertised keyboard parity and WCAG focus-visible acceptance across light and dark themes. |

## Review result

### Blocking accessibility

`PersonalForecastTrajectory.tsx:85-95` correctly adds five tab stops and connects focus/blur to the same series-isolation state as pointer entry/exit. However, the only selector intended to expose that focus is invalid because `--focus` does not exist. The repository's actual focus tokens are `--focus-ring` (`globals.css:35,74`) and the Individual control rule's `--decision` (`globals.css:5598-5603`). This is a real source-level defect even though a browser could not be launched in the managed environment.

The focused source test asserts `tabIndex`, focus handlers, and opacity changes, but it does not inspect the focus selector or theme-token existence, so all tests pass while the keyboard focus indication is broken.

### React and SVG behavior

- The client extraction is coherent: the parent renders the component only for two or more normalized trajectory points, so its non-null `first` and `latest` access is safe.
- Pointer and keyboard entry isolate the same series, and blur/leave restore all series. The SVG keeps its hidden tabular equivalent and labels each point with a `<title>`.
- A single shared hover/focus state mirrors Desktop behavior, but mixed simultaneous mouse and keyboard input can let a mouse-leave clear an active keyboard selection. This is an inherited Desktop interaction shape and is not treated as a separate blocker for this bounded parity slice.
- The 120ms opacity transition is GPU/compositor-friendly and the global `prefers-reduced-motion` rule reduces all transition durations to `0.01ms`. No layout property is animated. The built-in `ease` is less crisp than the motion standard's preferred custom curve, but is not the acceptance blocker here.

### Privacy and backend boundary

PASS. The extracted client component receives only already-derived, review-safe trajectory points. It adds no fetch, Supabase client, browser storage, write path, raw titles, screenshots, notes, evidence, credentials, or generated prediction data. The visible copy remains explicit that these are observed baselines and cannot be presented as predicted-versus-actual accuracy.

### Theme, responsive, and regression assessment

- Color, surface, status, typography, and chart series use existing design tokens; the sole invalid token is the blocking focus selector above.
- The legend changes from five columns to two below 760px, while the existing track-record rows collapse. Source and TypeScript checks find no structural responsive regression.
- No authenticated rendered proof was available, so this review does not claim pixel parity, computed layout correctness, touch behavior, or clean browser console output.

## Verification evidence

Focused Forecast suite:

```text
node --import tsx --test \
  apps/web/lib/personalForecastPresentation.test.ts \
  apps/web/lib/personalForecastParity.test.ts \
  apps/web/lib/personalForecastTrajectoryParity.test.ts \
  apps/web/lib/individualForecastInteractionParity.test.ts

14 tests, 14 pass, 0 fail
```

Additional checks:

```text
npm --prefix apps/web run typecheck
PASS

git diff --check -- apps/web/app/globals.css \
  apps/web/components/PersonalForecastScreen.tsx \
  apps/web/components/PersonalForecastTrajectory.tsx \
  apps/web/lib/personalForecastTrajectoryParity.test.ts \
  apps/web/lib/individualForecastInteractionParity.test.ts
PASS
```

## Decision

**REJECT this slice until the undefined focus token is replaced with a defined theme token and a regression test proves that the focusable legend owns a valid visible-focus contract.** After that narrow repair, rerun the 14 focused tests, Web typecheck, scoped diff check, and the standing Web/build gates. Overall mission approval still separately requires authenticated matched screenshots and human approval.

## Final repair addendum — APPROVE

The blocking focus defect was repaired and independently re-reviewed. `apps/web/app/globals.css:5509` now uses the defined `--focus-ring` token for both the border and two-pixel outline. That token has explicit light and dark values at `globals.css:35,74`, so the focusable legend rows retain a visible, theme-aware keyboard focus indicator.

The new regression test in `apps/web/lib/individualForecastInteractionParity.test.ts` pins all three parts of the repair: a `--focus-ring` definition exists, the trajectory legend's `:focus-visible` rule consumes it, and the obsolete `var(--focus)` reference is absent. The reported RED-before-GREEN sequence is consistent with the inspected diff; this re-review independently confirmed the final GREEN state.

Re-review commands:

```text
node --import tsx --test apps/web/lib/individualForecastInteractionParity.test.ts
4 tests, 4 pass, 0 fail

npm --prefix apps/web run typecheck
PASS

git diff --check -- apps/web/app/globals.css \
  apps/web/components/PersonalForecastScreen.tsx \
  apps/web/components/PersonalForecastTrajectory.tsx \
  apps/web/lib/personalForecastTrajectoryParity.test.ts \
  apps/web/lib/individualForecastInteractionParity.test.ts \
  docs/evidence/loop-20260720-103219/iteration-3-forecast-critic.md
PASS
```

Standing gates reported by the Builder were also green: `npm run verify:wave3` passed with 173 Desktop-cloud tests, 423 Web tests, and a successful Web build; root `npm run build` passed. This critic did not rerun those already-completed full gates during the narrow repair review.

**Final scoped decision: APPROVE. No blocking issue remains in the Forecast trajectory parity slice.** This approval remains source/test scoped and does not convert the environment-blocked authenticated screenshot comparison into pixel-parity proof or approve the overall multi-route mission.
