# Iteration 3 Desktop/Web Individual route parity audit

Date: July 20, 2026  
Scope: read-only source audit of Individual routes; Manager Access and backend wiring are excluded.

## Route map

| Desktop screen | Web route | Current parity state | Remaining boundary or gap |
| --- | --- | --- | --- |
| Today (`daily`) | `?screen=daily` | Dedicated review queue, lifecycle states, and confirm-all request path | Rendered matched screenshot still pending |
| Capacity (`weekly`) | `?screen=weekly` | Dedicated review-safe capacity composition | Rendered matched screenshot still pending |
| Forecast (`forecast`) | `?screen=forecast` | Deterministic scenarios, risks, assumptions, trajectory, and baseline track record | Highest-impact interaction gap: the Web trajectory is static while Desktop makes each series keyboard/pointer-isolatable and exposes current value plus window delta |
| Weekly Review (`weekly-review`) | `?screen=weekly-review` | Dedicated close-out composition with honest Mac completion boundary | Rendered matched screenshot still pending |
| AI Usage (`usage`) | `?screen=usage` | Desktop-shaped local-data boundary | Provider tokens, prices, sessions, and model table are intentionally absent from the replica |
| Summary (`narrative`) | `?screen=narrative` | Deterministic review-safe summary composition | Generated narrative, private evidence, editing, and export remain local |
| Ask (`agent`) | `?screen=agent` | Operational temporary review-safe question loop; iteration 2 added Desktop interactions | Streaming, persisted history, local execution, and rendered proof remain local/pending |
| Accelerate (`accelerate`) | `?screen=accelerate` | Desktop-shaped boundary and derived connection state | Plays, recipes, evidence, savings, and generation stay local |
| Skills (`skills`) | `?screen=skills` | Desktop empty-library hierarchy and Accelerate cross-link | Saved recipe content and mutations stay local |
| Activity (`ledger`) | `?screen=ledger` | Dedicated review-safe block ledger | Raw evidence and local notes stay local |
| Audit (`audit`) | `?screen=audit` | Dedicated Web receipt filters, search, and expansion | Local audit events stay local |
| Settings (`setup`) | `?screen=setup&settings_tab=...` | Dedicated Desktop tab model; Back/Forward and focus repaired in iteration 1 | Native controls use explicit Mac handoffs; rendered proof pending |
| Flagged Captures (`sensitive`, conditional Desktop route) | no Web route | Correctly omitted from the review-safe route allowlist | Full-screen captures and visual summaries must not be added to the Web replica merely for parity |

The canonical mapping is implemented in `apps/web/lib/individualWorkspaceRoute.ts`; Web mounts Forecast from the existing replica read in `apps/web/app/dashboard/page.tsx` without a Forecast-specific API or mutation.

## Recommended next bounded slice: Forecast trajectory interaction parity

Forecast is the strongest next target because it is the product promise's forward-looking decision surface (what fits next), the positive-allowlist replica already provides every value needed for an honest deterministic presentation, and the repair can remain within the existing read-only Web boundary. Within Forecast, the trajectory is the clearest remaining Desktop interaction mismatch: five crossing series are difficult to read when they cannot be isolated, especially without Desktop's per-series current value and delta.

Desktop source contract:

- `apps/desktop/src/components/capacity/ForecastScreen.tsx:127-132` places the multiweek trajectory between the Forecast result and track record.
- `apps/desktop/src/components/capacity/CapacityTrendChart.tsx:74-132` derives the active series, current value, signed first-to-latest delta, direction, and good/bad/flat tone.
- `apps/desktop/src/components/capacity/CapacityTrendChart.tsx:147-223` makes every legend row keyboard-focusable and pointer-interactive, dims peer legend rows and SVG series to `0.3`, and keeps the accessible value table.
- Desktop-only inputs are saved AI forecasts, corrections, accuracy records, locally configured AI, and local action execution. They cannot be reconstructed on Web.

Current Web source contract:

- `apps/web/components/PersonalForecastScreen.tsx:134-207` correctly renders five chronological review-safe series, a screen-reader table, and an explicit `not forecast accuracy` boundary.
- `apps/web/components/PersonalForecastScreen.tsx:156-178` is the material interaction mismatch: the series and legend are passive, there is only one overall reliable-capacity delta, and keyboard/pointer users cannot isolate a line from the four crossing peers.
- `apps/web/app/globals.css:5487-5509` supplies correct series colors but no active/dimmed state or focus treatment.
- `apps/web/lib/personalForecastPresentation.ts` is already deterministic, bounded to six deduplicated review-safe replicas, and exposes `sourceWeekId`, confidence, scenarios, risks, assumptions, and trajectory. No backend change is needed.

Suggested implementation boundary:

1. Extract the trajectory into a small client component so its active-series state remains temporary React state; keep derivation and replica loading server-side.
2. Give each legend item `tabIndex={0}` plus focus/blur and mouse enter/leave handlers that isolate the matching legend row and SVG series by dimming peers to Desktop's `0.3` opacity.
3. Add Desktop-equivalent current value and signed first-to-latest window delta to each legend item, with accessible `points higher`, `points lower`, and `No change over the window` wording. Do not assign improvement/regression semantics unless the Desktop direction contract is ported exactly.
4. Preserve the existing chart descriptions, hidden table, observed-baseline wording, and explicit `not forecast accuracy` boundary. Corrections, predicted-versus-actual accuracy, saved forecasts, and AI generation remain local-only.
5. Match Desktop focus appearance, rapid opacity transition, narrow wrapping, and reduced-motion behavior using existing Geist/Web tokens; do not add a browser cache, API request, or write path.

## Acceptance evidence

1. Add a red-first focused interaction contract requiring client-local active-series state, keyboard and pointer handlers, peer opacity, per-series current/delta context, and the observed-baseline/no-accuracy boundary.
2. Keep `apps/web/lib/personalForecastPresentation.test.ts`, `personalForecastParity.test.ts`, and `personalForecastTrajectoryParity.test.ts` green for empty, one-week, duplicate-week, bounded-history, range-clamping, chronological trajectory, accessible table, and accuracy-boundary behavior.
3. Add a source/CSS assertion for a visible legend focus state, reduced-motion override, narrow wrapping, and no horizontal overflow.
4. Run the focused Forecast suites, Web typecheck, the standing Web/Wave gate, and `git diff --check`.
5. Capture authenticated matched Desktop/Web Forecast screenshots for default and one focused/isolated series at the normal desktop width, plus the Web narrow breakpoint. Also verify keyboard focus through all five series. This is the only evidence that can close the visual/interaction claim; source and build checks alone cannot.

## Proof boundary

This audit recommends a source-feasible repair; it does not claim pixel parity. Local server binding was denied in the previous iterations, so authenticated matched screenshots and human approval remain separate gates.
