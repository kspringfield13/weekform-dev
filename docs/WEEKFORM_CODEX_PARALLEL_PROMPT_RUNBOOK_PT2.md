# Weekform Team Clawfather — Codex Parallel Prompt Runbook, Part 2

**Purpose:** Copy/paste mission prompts that carry Weekform beyond the completed hackathon slice (Runbook Part 1, Prompts 0A–12) and the completed expansion roadmap Phase A, toward the blueprint's full Horizon 2/3 definition — and past it, to a best-in-class private-first workload-intelligence experience.
**Primary model:** GPT-5.6 in Codex, with the highest justified effort for architecture, privacy, RLS, and integration. Claude agent teams may execute the same prompts.
**Operating contract:** Read repository-root `AGENTS.md` before every task. Read `docs/EXPANSION_ROADMAP.md` §Ground rules before any Phase B/C work.
**Rule (unchanged from Part 1):** A prompt is not complete because an agent says it is complete; it is complete when its named artifacts and evidence exist.

**Standing gates (all exist today and must stay green after every prompt):**

```bash
npm run verify:wave3   # chains test:desktop-cloud + test:web + web:build
npm run build          # root desktop build
npm run audit:check    # must report 0 vulnerabilities in both workspaces
```

Baseline at Part 2 authoring (July 19, 2026): `verify:wave3` exit 0 — 97/97 desktop-cloud tests, 150/150 web tests, 12 routes / 11 static pages; root `build` exit 0; `audit:check` 0 vulnerabilities.

**Accuracy review (July 19, 2026, independent pass):** every file, directory, symbol, and count this document cites was verified against the working tree — all 15 cited source paths exist; `scoreForecastAccuracy` is at `packages/inference/src/capacity.ts:255`; the "coming soon" connector stubs, `sessionStorage.ts` Keychain honesty contract, hashed invite tokens, signed-URL artifact route (`apps/web/app/download/artifact/route.ts`), proactive alerts module (`apps/desktop/src/lib/proactiveAlerts.ts`), 4 shared packages, 3 Supabase migrations, and 19 test files all check out. One correction applied: `listTeamSnapshotHistory` lives in `apps/web/lib/snapshots.ts` (Prompt 13's dependency line originally attributed it to `trends.ts`). All three standing gates were re-run as written during the review and match the baseline exactly.

**Final coherence verification (July 19, 2026, closing pass):** all three standing gates re-run once more exactly as written above — `verify:wave3` exit 0 (97/97 desktop-cloud, 150/150 web, 0 failures), root `build` exit 0, `audit:check` exit 0 with 0 vulnerabilities in both workspaces — and the cross-references in Part 1 §0, `docs/EXPANSION_ROADMAP.md` (status log), and blueprint §17 were confirmed to point at this document consistently. Part 2 execution begins from Prompt 13.

---

## 0. Prompt execution status

| Prompt | Title | Status | Evidence |
|---|---|---|---|
| 13 | Team forecasting calibrated against outcomes (A7) | DONE (2026-07-19) | `apps/web/lib/forecast.ts` + `forecast.test.ts` (12 tests, tests-first); scorer cross-check `packages/inference/src/capacity.forecastScorer.test.ts`; Forecast panel in `apps/web/app/teams/[teamId]/page.tsx` (coverage n/n, "insufficient shared data" below threshold, medians/ranges only). Gates: verify:wave3 exit 0 (97/97 + 161/161), build exit 0, audit:check 0 vulns. Roadmap A7 row updated. |
| 14 | Experience excellence pass — desktop + web coherence | DONE (2026-07-19; audit rerun env-blocked) | Audit-first artifact `docs/hackathon/TEAM_CLAWFATHER_UX_AUDIT.md`; all 20 FIX rows resolved across the desktop and web surfaces. Shared pending/confirmation controls, assertive errors, announced loading, destructive confirmations, canonical freshness and approved-snapshot provenance. Gate runner hardened from `tsx --test` to equivalent `node --import tsx --test` after IPC `EPERM`; final `verify:wave3` exit 0 (97/97 desktop-cloud, 162/162 web, 12 routes / 11 static pages) and root build exit 0. `audit:check` could not reach `registry.npmjs.org` (`ENOTFOUND`); no dependencies changed, and the last same-day audit evidence remains 0 vulnerabilities. |
| 15 | Weekly review ritual (B1) | DONE (2026-07-19; audit rerun env-blocked) | Pure local checklist `apps/desktop/src/services/weeklyReview.ts` + 6 tests; routed `WeeklyReviewScreen`; current-week forecast comparison; cloud-disabled omission and matching sync-audit/consent-receipt proof; one idempotent ids/counts-only `weekly_review` audit event. Gates: `verify:wave3` exit 0 (103/103 desktop-cloud, 162/162 web, 12 routes / 11 static pages), root build exit 0, diff check clean. `audit:check` ran but registry DNS returned `ENOTFOUND`; no dependencies changed. |
| 16 | Manager action follow-through — closed learning loop (B2) | REVIEW (2026-07-19; fresh audit and live migration proof env-blocked) | Loop `loop-20260719-135748-556358` removed every direct table mutation: create, resolve/drop, and delete are manager-authorized security-definer RPCs; the server derives `id`, `created_by`, `status`, `created_at`, and `resolved_at`. Direct INSERT/UPDATE/DELETE abuse is pinned by 7 migration-contract tests and a 76-assertion pgTAP contract, including direct member UPDATE/DELETE and outsider resolve/delete attempts. Lead and independent iteration-9 verification reproduced focused 17/17, verify:wave3 exit 0 (111/111 + 179/179, 12 routes / 11 static pages), build and diff check exit 0. Seventeen fresh `audit:check` attempts across the lead and independent reviewers exited 1 because registry DNS returned `ENOTFOUND`; the two iteration-9 attempts stopped at the root audit, so the web audit did not run. Do not mark DONE until the full command exits 0 on this tree. |
| 17 | Demand mapping and capacity reservations (B4) | BLOCKED (after 16 DONE) | Prompt 16 remains at its human/audit approval gate. |
| 18 | Connector contracts and role-based views (B3 + B5) | READY — live OAuth [env-blocked] | — |
| 19 | Privacy thresholds and self-benchmarking (C2 + C3) | READY (after 17) | — |
| 20 | Portfolio views and explainable planning APIs (C1 + C4) | BLOCKED on 19 | — |
| 21 | Part 2 adversarial critic and release gate | BLOCKED on 13–19 | — |

State markers as in Part 1: `READY, BLOCKED, ACTIVE, REVIEW, DONE, CUT`, with honesty tags (`DONE (fallback mode)`, `[env-blocked]`) mandatory whenever a live dependency is unavailable.

---

## 1. Full analysis — current state vs. blueprint definition and mission

*(Authored July 19, 2026 from a two-track survey: a docs/blueprint extraction pass and an independent code-only state survey. This section is the ground truth Part 2 builds on.)*

### 1.1 Mission definition (blueprint §1)

> "Weekform gives each teammate private workload intelligence on their Mac and lets them share only approved capacity signals with the people coordinating the work."

Non-negotiables: sharing defaults off; null is never zero; medians/ranges, never sums; no rankings, leaderboards, or productivity scores; AI explains deterministic metrics rather than inventing them; raw evidence never leaves the device.

### 1.2 What is implemented and gate-proven (verified against code, not docs)

**Desktop (`apps/desktop`):** weekly capacity snapshots (`packages/inference/src/capacity.ts`), personal forecasting with a forecast-accuracy track record (`components/capacity/ForecastScreen.tsx`, `scoreForecastAccuracy`), activity ledger + classification, daily review copilot, weekly narrative, acceleration/skills library, audit log + sensitive-data review, CSV-injection-guarded local export, consent receipts (`services/consentReceipt.ts`, byte-exact), cloud account/team share with consent∩policy clamping (`cloudPolicy.ts`), auto-sync scheduler with tested retry ladder (`cloudScheduler.ts`), AI usage/cost tracking, agent chat, proactive alerts, onboarding, tray/compact widget, Span Simulator admin.

**Web (`apps/web`):** Supabase SSR auth, teams/invites (hashed-token, copy-link), manager + member dashboards (medians/ranges, null-never-zero), weekly history + trends (A2), planning scenarios (A1), team forecasting calibrated against its own outcomes (A7), retention statement (A3), narrowing-only team share policy settings (A6, `lib/teamPolicy.ts`), manager-only AI team briefing with deterministic fallback, session-gated download with config-gated signed-URL artifact route.

**Infrastructure:** 4 shared packages (`domain`, `inference`, `integrations`, `simulator`); 4 Supabase migrations (simulator, team cloud v1 + RLS, team share policy, manager actions); 26 repository-owned test files concentrated on cloud/policy/privacy and deterministic planning logic. On the hardened Prompt 16 tree, `verify:wave3` and `build` are green; the fresh `audit:check` is registry-DNS-blocked. Live Supabase execution remains environment-blocked.

### 1.3 Honest deltas — where current state falls short of the definition

| # | Gap | Source | Class |
|---|---|---|---|
| G1 | Team-level forecasting calibrated against outcomes (A7) | Roadmap A7; blueprint §17 | **CLOSED by Prompt 13** — pure forecast + walk-forward calibration, no per-member prediction |
| G2 | Weekly review ritual (B1) — no guided weekly close-out that turns corrections into a habit loop | Blueprint §17 Phase B | **CLOSED by Prompt 15** — deterministic local checklist, routed ritual, approval/audit completion |
| G3 | Manager action follow-through (B2) — briefings surface risk, but no loop records what the manager did and whether it helped | Blueprint §17 Phase B | **IMPLEMENTED; REVIEW pending Prompt 16 audit gate** — manager-only action log + correlation-only team follow-through after two later weeks |
| G4 | Demand mapping & capacity reservations (B4) — capacity supply exists; demand side is absent | Blueprint §17 Phase B | Buildable now → **Prompt 17** |
| G5 | Live connectors (B3) — calendar/chat OAuth sources are "coming soon" disabled stubs (`calendarSource.ts`, `chatSource.ts`); only local file import works | Blueprint §17 Phase B | Contract-first now; live OAuth **[env-blocked]** → **Prompt 18** |
| G6 | Role-based client views (B5) | Blueprint §17 Phase B | Buildable now → **Prompt 18** |
| G7 | Privacy thresholds / aggregation minimums (C2) and self-benchmarking-only (C3) | Blueprint §17 Phase C | Buildable now → **Prompt 19** |
| G8 | Multi-team orgs/portfolios (C1), explainable planning APIs (C4) | Blueprint §17 Phase C | Contract-first → **Prompt 20** |
| G9 | Live four-actor RLS proof, golden path ×2, live model path, live signed-URL, Keychain proof, pairing implementation, notarized distribution, data residency (C5) | Part 1 §0; roadmap A4/A5/A6 | **[env-blocked]** — remain specified + test-scaffolded; never claimed live. Part 2 must not unblock these by pretending |
| G10 | UX coherence — empty/error/loading/destructive states, accessibility, freshness terminology, and approved-snapshot provenance | Prompt 14 audit + fix map | **CLOSED by Prompt 14** — 20/20 FIX rows resolved and independently reviewed |

**Permanently out of scope (blueprint §3.3 P2):** billing/seats, SSO/SCIM, real-time streaming, raw session/screenshot upload, manager-enforced sharing, rankings, mobile/Windows, closed-app daemon. No Part 2 prompt may reintroduce these.

### 1.4 Conclusion

The original hackathon definition of done is met and independently gate-proven. What separates the current product from the blueprint's *full* definition is Horizon 2/3: closing the learning loop (forecast→outcome, briefing→action→effect), adding the demand side of capacity, and hardening privacy math for scale — all while raising the experience from "waves of features" to one coherent product. Part 2's prompts are ordered to do exactly that.

---

## Wave 5 — Learning loop and experience excellence

## Prompt 13 — Team forecasting calibrated against outcomes (A7)

**Status:** DONE (2026-07-19).
**Owner:** Web + inference agent.
**Depends on:** A2 history substrate (`listTeamSnapshotHistory` in `apps/web/lib/snapshots.ts`, trend math in `apps/web/lib/trends.ts`); desktop forecast scoring (`packages/inference/src/capacity.ts`).
**Mode:** High effort; pure modules + `node:test` first, UI second (roadmap ground rule).

```text
Read AGENTS.md and docs/EXPANSION_ROADMAP.md §Ground rules. Implement roadmap item A7:
team-level forecasting calibrated against outcomes, on the web manager surface.

1. Add a pure module apps/web/lib/forecast.ts: given a team's snapshot history
   (existing listTeamSnapshotHistory shape), produce next-week team capacity forecasts
   as medians + ranges per shared metric, plus a calibration record comparing each past
   forecast to the actual that later arrived. Reuse the scoring semantics of
   scoreForecastAccuracy in packages/inference/src/capacity.ts rather than inventing new
   math; if the desktop scorer cannot be imported directly, mirror its rules and add a
   cross-check test pinning both to the same fixture outputs.
2. Nulls are never zero: members who did not share are excluded from the aggregate and
   the forecast must carry an explicit coverage field (n shared / n members). Below-
   coverage forecasts render as "insufficient shared data", never as a number.
3. No per-member forecasts, no rankings, no sums. Team medians and ranges only.
4. Manager team page: a Forecast panel showing next-week forecast, coverage, and the
   calibration track record (how often past forecasts landed inside their stated range),
   labeled as derived from consented shared snapshots only.
5. Tests first: apps/web/lib/forecast.test.ts covering empty history, single week,
   coverage below threshold, calibration hit/miss accounting, and a widening guard
   proving excluded members never leak into aggregates.
Gates: npm run verify:wave3, npm run build, npm run audit:check — all exit 0.
```

### Expected result
`apps/web/lib/forecast.ts` + `forecast.test.ts`; Forecast panel on the manager team page; roadmap A7 row updated with dated evidence.

### Reject the result if
Any per-member number appears in the forecast UI; missing data renders as zero; the calibration math is asserted but untested; or any standing gate is not re-run as written.

---

## Prompt 14 — Experience excellence pass: one coherent product

**Status:** DONE (2026-07-19).
**Owner:** Design-lead agent + one desktop and one web implementer (parallel, single reviewer).
**Depends on:** Nothing new; operates on the existing surface.
**Mode:** Max effort on design judgment; zero new capabilities — this prompt only raises quality.

```text
Read AGENTS.md. The product grew wave-by-wave; make it feel designed as one system.
Scope: apps/desktop/src (all screens) and apps/web/app (all routes). No new features.

1. Audit pass first (read-only): inventory every empty state, loading state, error
   state, and destructive-action confirmation across both apps. Produce
   docs/hackathon/TEAM_CLAWFATHER_UX_AUDIT.md with a table (screen, state, current
   behavior, verdict keep/fix) before editing anything.
2. Fix pass: every listed "fix" gets a consistent treatment — same vocabulary for the
   same concept on both apps (e.g. "shared"/"not shared"/"stale" must use identical
   terms desktop and web), every empty state says what the user can do next, every
   error state is role="alert", every async action has a visible in-flight state.
3. Accessibility: keyboard reachability and visible focus for every interactive
   element touched; labels for every input; no color-only meaning.
4. Privacy-forward microcopy: anywhere a number derives from consented shares, the
   provenance line ("from N teammates' approved snapshots") uses one shared phrasing.
5. No layout rewrites, no dependency additions, no color-system replacement.
Gates: npm run verify:wave3, npm run build, npm run audit:check — all exit 0. List
every file touched in the closeout, grouped by audit-table row.
```

### Expected result
`docs/hackathon/TEAM_CLAWFATHER_UX_AUDIT.md` (audit table, verdicts, and which rows were fixed) plus the fixes themselves; gates green.

### Reject the result if
The audit doc is written after the fixes as a justification; any fix adds a capability; terminology still differs between desktop and web for the same state; or gates were not re-run.

---

## Wave 6 — Phase B: the closed team loop

## Prompt 15 — Weekly review ritual (B1)

**Status:** DONE (July 19, 2026; audit rerun environment-blocked).
**Owner:** Desktop agent.
**Depends on:** Daily review copilot (`components/review/`), narrative (`components/narrative/`), consent receipts.
**Mode:** High effort; pure ritual-state module first.

```text
Read AGENTS.md and docs/EXPANSION_ROADMAP.md. Implement blueprint §17 Phase B item B1:
a guided weekly review ritual on desktop.

1. Pure module apps/desktop/src/services/weeklyReview.ts: derive a review checklist
   for the closing week from existing local data only — unclassified blocks count,
   pending sensitive-data reviews, forecast-vs-actual delta (reuse the existing
   personal track record), narrative draft available yes/no, and (only if cloud
   sharing is enabled) whether the week's snapshot was shared and a consent receipt
   exists. Output is a deterministic WeeklyReviewState with per-item done/pending.
2. UI: a WeeklyReviewScreen reachable from the existing router that walks those items
   in order, linking into the existing screens (ledger, sensitive review, narrative,
   share preview) rather than duplicating them. Completing the ritual writes one
   local audit event (ids/counts only, no content).
3. The ritual is optional and skippable forever — no streaks, no guilt mechanics, no
   nagging. One dismissible reminder surface at most, via the existing proactive
   alerts module.
4. Tests: weeklyReview.test.ts covering all-done, nothing-done, cloud-disabled (share
   item absent, not failed), and determinism (same inputs → same state).
Gates: npm run verify:wave3, npm run build, npm run audit:check — all exit 0.
```

### Expected result
`weeklyReview.ts` + tests, `WeeklyReviewScreen` wired into the router, one audit-event type, roadmap B1 row updated.

### Reject the result if
The ritual computes or uploads anything not already local; it introduces streaks/scores; the share item renders as failed when cloud is simply disabled; or the state module touches the network.

### Completion evidence — July 19, 2026

- `weeklyReview.ts` derives the ordered checklist only from caller-provided local
  evidence, scopes counts to the normalized closing week, and omits the share
  item when sharing is disabled. A share is complete only when a matching local
  sync-success audit and consent receipt prove the same snapshot.
- `WeeklyReviewScreen` is a Week subview. It links to the existing ledger,
  flagged-capture review, forecast, narrative, and Settings Account/share-preview
  surfaces. It adds no duplicate editor, streak, score, deadline, or reminder.
- Completing an all-ready ritual writes at most one persisted `weekly_review`
  event per normalized week. Its payload is limited to the week id, checklist
  ids, and aggregate done/pending counts.
- TDD evidence: the focused test first failed because the implementation module
  did not exist, then passed 6/6. Final gates: `npm run verify:wave3` exit 0
  (103/103 desktop-cloud, 162/162 web, 12 routes / 11 static pages), `npm run
  build` exit 0, and `git diff --check` exit 0. `npm run audit:check` executed but
  could not resolve `registry.npmjs.org` (`ENOTFOUND`); no dependency changed.
- Rendered browser QA was attempted through the repository browser workflow but
  could not start because the managed sandbox cannot write the agent-browser
  socket directory. This is not claimed as visual proof.

---

## Prompt 16 — Manager action follow-through: closed learning loop (B2)

**Status:** REVIEW (July 19, 2026; fresh audit and live migration proof environment-blocked).
**Owner:** Web agent.
**Depends on:** Briefing (`apps/web/lib/briefing.ts`), forecast (Prompt 13), team cloud schema.
**Mode:** High effort; migration is SQL-review-only until a live stack exists (Part 1 Prompt 2 precedent).

```text
Read AGENTS.md and docs/EXPANSION_ROADMAP.md. Implement blueprint §17 Phase B item B2:
record what a manager decided and close the loop on whether it helped.

1. Migration supabase/migrations/<timestamp>_team_actions.sql: table team_actions
   with manager-only SELECT through RLS and no direct INSERT/UPDATE/DELETE privilege.
   All writes use narrow SECURITY DEFINER RPCs that reauthorize the authenticated
   manager server-side. Creation accepts only team id, clamped action text ≤500
   characters, and an optional allowlisted briefing risk key; the server derives id,
   created_by, open status, created_at, and null resolved_at. Resolve/drop accepts
   only team id, action id, and the closed status, and derives resolved_at; delete
   accepts only team id and action id. SQL-review-only [env-blocked] like all prior
   migrations — never claim it ran live.
2. Pure module apps/web/lib/actions.ts: RPC-backed mutation and explicit-column read
   wrappers against a mocked client (house pattern from lib/teams.ts) + a
   follow-through view that joins an action's lifetime
   to the team trend for the metric its risk flag came from, labeled strictly as
   "what changed after" — correlation, never causation, and no per-member attribution.
3. UI: an Actions panel on the manager team page: log an action from a briefing risk
   flag, see open actions, resolve them, and see the after-trend once ≥2 subsequent
   weekly snapshots exist (else "too early to tell", never a fabricated readout).
4. Tests: actions.test.ts plus a migration-boundary contract — every read/mutation is
   team-scoped and role-gated; direct table writes are denied; member, outsider, and
   anonymous RPC abuse is exercised; too-early gating, dropped-action exclusion, and
   the ≤500-character clamp remain covered.
Gates: npm run verify:wave3, npm run build, npm run audit:check — all exit 0.
```

### Expected result
Migration (SQL-review-only, honestly tagged), `lib/actions.ts` + tests, Actions panel, roadmap B2 row updated.

### Reject the result if
Follow-through language implies causation or attributes change to individuals; the migration is claimed applied; actions accept free-form data beyond the clamped text + flag key; or coverage of the too-early gate is missing.

### Completion evidence (July 19, 2026)

- RED-first proof: the original focused command initially failed with the expected
  missing `./actions` module, then passed after implementation. The behavior tests
  cover manager denial before any client call, explicit team/action query
  scope, the 500-character clamp, the closed risk-key allowlist, two distinct
  later ISO weeks (not two member rows), dropped exclusion, and correlation-only
  team medians.
- `202607190003_team_actions.sql` is explicitly a SQL-review-only artifact. It
  forces RLS, revokes direct authenticated INSERT/UPDATE/DELETE, and exposes
  manager-authorized create, resolve/drop, and delete security-definer RPCs.
  Creation accepts only team, clamped text, and an allowlisted risk key; the
  server derives `id`, `created_by`, `status`, `created_at`, and `resolved_at`.
  Resolution also derives `resolved_at = now()` server-side. It was not applied
  to a live stack here.
- The manager-only Actions panel records text plus an optional allowlisted
  briefing flag, shows open actions, resolves/drops with fresh server-side role
  checks, reports safe visible failures instead of false success, and renders
  either “Too early to tell” or “What changed after” with no individual
  attribution or causal claim.
- Fresh lead and independent gates for loop `loop-20260719-135748-556358`:
  focused boundary tests 17/17; `npm run verify:wave3` exit 0 (111/111
  desktop-cloud, 179/179 web, 12 routes / 11 static pages); `npm run build` exit
  0; and `git diff --check` exit 0. Two additional iteration-9 `npm run
  audit:check` retries exited 1 because `registry.npmjs.org` DNS resolution was
  blocked (`ENOTFOUND`), bringing the documented fresh retry count to seventeen.
  Both stopped at the root audit before the `apps/web` audit could run, so this
  prompt remains REVIEW
  rather than DONE. Live pgTAP/RLS
  execution remains unclaimed because neither Supabase CLI nor `psql` is
  available on this machine. The defense-in-depth continuation expanded that
  unapplied contract from 72 to 76 assertions with direct member UPDATE/DELETE
  and outsider resolve/delete attempts; its static guard remains green.

---

## Prompt 17 — Demand mapping and capacity reservations (B4)

**Status:** BLOCKED (until Prompt 16 reaches DONE).
**Owner:** Web agent.
**Depends on:** Scenario planning (`apps/web/lib/scenario.ts`), forecast (Prompt 13).
**Mode:** High effort.

```text
Read AGENTS.md and docs/EXPANSION_ROADMAP.md. Implement blueprint §17 Phase B item B4:
put the demand side next to the capacity side.

1. Extend the scenario model (apps/web/lib/scenario.ts, additive only — existing
   exports unchanged): named demand items (label ≤200 chars, estimated hours range
   low–high, target week) and reservations (a slice of team reliable capacity held
   back, expressed as a percentage 0–50%).
2. Pure planning math: given the Prompt 13 team forecast and a demand list, compute
   a fit report per week — demand range vs forecast range minus reservations, with
   tri-state verdicts fits / tight / over and the coverage caveat carried through
   verbatim. Never a single false-precision number; always ranges.
3. UI: extend the existing manager planning panel — demand list editor, reservation
   slider, fit report. Demands are team-level planning fiction: they name work, never
   people. No assignment UI of any kind.
4. Tests: scenario fit math across fits/tight/over boundaries, reservation clamping,
   empty-demand and insufficient-coverage cases, and a guard that existing scenario
   exports' behavior is byte-identical on old fixtures.
Gates: npm run verify:wave3, npm run build, npm run audit:check — all exit 0.
```

### Expected result
Additive scenario-model extension + fit math + tests; planning panel extension; roadmap B4 row updated.

### Reject the result if
Demand items can reference or be assigned to members; fit verdicts collapse ranges into single numbers; existing scenario tests were modified to pass; or the coverage caveat is dropped anywhere downstream.

---

## Prompt 18 — Connector contracts and role-based views (B3 + B5)

**Status:** READY — live OAuth **[env-blocked]** (no provider app registrations on this machine; contract-first per roadmap ground rules).
**Owner:** Integrations agent (B3) + web agent (B5), parallel.
**Depends on:** `packages/integrations` source registry; team roles in `apps/web/lib/teams.ts`.
**Mode:** High effort; B3 ships contracts + fixture-driven tests only, never fake live calls.

```text
Read AGENTS.md and docs/EXPANSION_ROADMAP.md. Two parallel slices:

B3 (contract-first connectors): In packages/integrations, define the connector
contract the "coming soon" stubs in calendar/calendarSource.ts and chat/chatSource.ts
already gesture at: a ConnectorDescriptor (id, provider, scopes requested, data
retrieved, local-only normalization) + a normalize step producing the existing
rawEvents shapes from recorded fixture payloads (Google Calendar events.list,
Microsoft Graph calendarView + chats). Fixture-driven tests prove normalization,
timezone handling, and that no field outside the allowlisted shape survives
normalization. The OAuth handshake itself stays a capability-gated stub that throws
(sessionStorage.ts Keychain precedent) — never simulate a successful live handshake.
Document each connector's privacy posture in docs/PRIVACY.md (data stays local;
connectors feed the same local ledger as file import).

B5 (role-based views): The web team page currently branches on a single
isManagerRole(membership.role) boolean (apps/web/app/teams/[teamId]/page.tsx) with
per-feature conditionals scattered below it.
Introduce an explicit viewer-capability model in apps/web/lib/teamView.ts — a pure
function from membership role to a capability set (see-aggregates, manage-policy,
log-actions, generate-briefing, view-own-only) — and route every existing conditional
through it. Add a read-only "observer" capability set derivable from existing roles
(no schema change) for future client views; unused capabilities render nothing rather
than disabled teasers. Tests: every role→capability mapping, and a guard that member
role never gains see-aggregates.

Gates: npm run verify:wave3, npm run build, npm run audit:check — all exit 0.
```

### Expected result
Connector contract + fixtures + tests in `packages/integrations` (stubs still honestly throw); `apps/web/lib/teamView.ts` + tests with all role branches routed through it; PRIVACY.md updated; roadmap B3 [env-blocked]/B5 rows updated.

### Reject the result if
Any code path fakes a live OAuth success; fixtures contain real-looking personal data (synthetic only); a role conditional bypasses `teamView.ts`; or PRIVACY.md is not updated.

---

## Wave 7 — Phase C foundations and the Part 2 gate

## Prompt 19 — Privacy thresholds and self-benchmarking (C2 + C3)

**Status:** READY (after Prompt 17).
**Owner:** Web + inference agent.
**Depends on:** Aggregation sites from Prompts 13/16/17; trends (A2).
**Mode:** Max effort — this is privacy math; adversarial tests mandatory.

```text
Read AGENTS.md and docs/EXPANSION_ROADMAP.md. Implement blueprint §17 Phase C items
C2 (aggregation minimums) and C3 (self-benchmarking only).

1. C2: one shared constant module apps/web/lib/aggregation.ts exporting
   MIN_AGGREGATION_N (start at 3) and requireMinimumN() helpers. Every team-level
   aggregate in workload.ts, trends.ts, forecast.ts, scenario.ts, and briefing input
   building must flow through it: below N shared members, the aggregate renders as
   "not enough shared data (needs at least 3)" — never a number, never zero.
   Adversarial tests: verify a 2-member team leaks nothing derivable about either
   member from any surface (dashboard, trends, forecast, fit report, briefing input),
   including the subtraction attack (team-of-3 aggregate visible, one member leaves,
   team-of-2 must go dark rather than expose a diffable pair).
2. C3: benchmarking is strictly against your own history. Audit every comparative
   surface; anywhere a member could read "vs the team", replace with "vs your own
   baseline" (the A2 self-baseline pattern). Add a regression test asserting the
   member dashboard renders no team-derived comparison for the signed-in member.
Gates: npm run verify:wave3, npm run build, npm run audit:check — all exit 0.
```

### Expected result
`aggregation.ts` + threaded through all five aggregate sites with adversarial tests (including the subtraction attack); member-facing comparisons self-only; roadmap C2/C3 rows updated.

### Reject the result if
Any aggregate site bypasses the shared constant; the subtraction-attack test is absent or weakened; below-threshold states render as zero; or thresholds are configurable below 3.

---

## Prompt 20 — Portfolio views and explainable planning APIs (C1 + C4)

**Status:** BLOCKED on Prompt 19 (portfolio math must inherit aggregation minimums from day one).
**Owner:** Web agent.
**Depends on:** Prompt 19's `aggregation.ts`; existing multi-team membership support.
**Mode:** High effort; contract-first — C4 ships a typed contract + route handler with fixture tests, no external consumers promised.

```text
Read AGENTS.md and docs/EXPANSION_ROADMAP.md. Implement blueprint §17 Phase C items
C1 (multi-team portfolio) and C4 (explainable planning API), contract-first.

1. C1: a /portfolio route for users managing ≥2 teams: per-team cards (median
   headroom, coverage, freshness) built exclusively from data the manager can already
   see per-team — the portfolio view grants zero new visibility, and every card
   respects MIN_AGGREGATION_N. Cross-team totals are forbidden; cards are side by
   side, never summed. Users managing <2 teams never see the route in navigation
   (direct visits render an honest empty state).
2. C4: a typed read-only endpoint apps/web/app/api/planning/[teamId]/route.ts
   returning the same forecast + fit report the UI shows (same pure modules — no
   parallel math), each figure carrying an explanation object naming its inputs
   (weeks of history, coverage, reservation) so any consumer can show provenance.
   Auth: session + manager capability via teamView.ts; every response passes through
   the aggregation minimums. Contract documented in docs/hackathon/ as a versioned
   schema (v1, additive-only evolution rule).
3. Tests: portfolio visibility (a manager of teams A+B sees nothing about
   unmanaged team C), no-sums guard, API auth rejection paths (anon, member,
   outsider), explanation-object completeness on every numeric field.
Gates: npm run verify:wave3, npm run build, npm run audit:check — all exit 0.
```

### Expected result
`/portfolio` route + tests; planning API route + versioned contract doc + tests; roadmap C1/C4 rows updated. C5 (data residency) stays **[env-blocked]** and untouched; C6 (outcome learning) stays future.

### Reject the result if
The portfolio shows anything a per-team view would not; any cross-team sum exists; the API computes math not shared with the UI modules; or any numeric field ships without its explanation object.

---

## Prompt 21 — Part 2 adversarial critic and release gate

**Status:** BLOCKED until Prompts 13–19 are DONE (Prompt 20 may be in REVIEW).
**Owner:** Independent read-only critic team (three parallel reviewers, one integrator) — reviewers must be different agents/sessions from the implementers.
**Mode:** Max effort. Reviewers are instructed to distrust every status table, including this one.

```text
Read AGENTS.md. You are the Part 2 release critic. Do not edit product code.

1. Re-run every standing gate as written (npm run verify:wave3, npm run build,
   npm run audit:check) and record exact counts and exit codes.
2. For each Part 2 prompt marked DONE, verify its named artifacts exist and its
   Reject-if conditions do not hold, by reading the working tree — not the closeouts.
3. Privacy red-team: attempt the subtraction attack, per-member inference via the
   planning API, portfolio cross-team leakage, and connector-fixture PII review.
4. Honesty audit: list every [env-blocked] claim in Part 1 §0, EXPANSION_ROADMAP,
   and this document, and confirm none has silently upgraded itself to "live".
5. Produce docs/hackathon/TEAM_CLAWFATHER_PT2_RELEASE_REPORT.md: findings by
   severity (BLOCKER/HIGH/MEDIUM/LOW), remediation owners, and a go/no-go verdict.
   Any privacy finding at HIGH+ is an automatic no-go until remediated.
Update this document's §0 table and EXPANSION_ROADMAP status log with the outcome.
```

### Expected result
`TEAM_CLAWFATHER_PT2_RELEASE_REPORT.md` with reproduced gate evidence and a verdict; §0 table and roadmap updated.

### Reject the result if
Gates were quoted from prior logs instead of re-run; any reviewer also implemented a Part 2 prompt; or the honesty audit is missing.

---

## Recovery prompts

**R-F (gate broke):** `verify:wave3`, `build`, or `audit:check` is red. Stop all feature work; bisect to the breaking prompt's diff; fix forward only if the fix is ≤1 file, else revert that prompt's changes and mark its §0 row ACTIVE with the failure pasted verbatim.

**R-G (privacy regression):** any test guarding a non-negotiable (null-never-zero, no-sums, widening, aggregation minimum, key-leak) fails or was found weakened. Treat as BLOCKER: revert the offending change immediately — never "fix" the test — and record the incident in the Part 2 release report even if remediated same-day.

**R-H (env-blocked drift):** a claim marked [env-blocked] is discovered stated as live anywhere in docs. Correct every copy in the same pass (grep, don't sample) and note the drift in §0.

---

## Scoring (unchanged from Part 1)

Each prompt result is scored 0–2 on Scope, Evidence, Privacy, Integration, UX, Documentation. Below 10/12 does not merge; any Privacy 0 is an automatic reject.
