# Weekform Team Clawfather — Codex Parallel Prompt Runbook

**Purpose:** Copy/paste mission prompts for rapidly implementing the Weekform Team Clawfather vertical slice in `weekform-dev`.  
**Primary model:** GPT-5.6 in Codex, with the highest justified effort for architecture, privacy, RLS, and integration.  
**Operating contract:** Read repository-root `AGENTS.md` before every task.  
**Rule:** A prompt is not complete because an agent says it is complete; it is complete when its named artifacts and evidence exist.

---

## 0. Prompt execution status

| Prompt | Title | Status | Evidence |
|---|---|---|---|
| 0A | Planning Director with parallel research agents | **DONE** — July 19, 2026 | Five planning files exist in `docs/hackathon/` (`TEAM_CLAWFATHER_BASELINE.md`, `_PRODUCT_CONTRACT.md`, `_ARCHITECTURE.md`, `_TASKBOARD.md`, `_DECISIONS.md`) |
| 0B | Program Integrator task ledger | **DONE** — July 19, 2026 | `docs/hackathon/TEAM_CLAWFATHER_TASKBOARD.md` upgraded to the full eleven-field ledger with the five Program Integrator outputs (critical path, parallel wave, highest-risk assumption, next commands, hard P0 cut list) |
| 1 | Shared cloud contract and privacy tests | **DONE** — July 19, 2026 | `packages/domain/src/cloud.ts` + `packages/inference/src/sharedSnapshot.ts` exist; `npm run test:cloud` (new root script) passes 10/10 focused privacy tests; root `npm run build` exit 0 |
| 2 | Supabase schema, RLS, and synthetic seed | **DONE (SQL-review only)** — July 19, 2026 | `supabase/migrations/202607190001_team_cloud_v1.sql` (RLS in the same migration), `supabase/seed.sql` (synthetic identities only), `supabase/tests/team_cloud_rls.sql`, and `docs/hackathon/TEAM_CLAWFATHER_RLS_MATRIX.md` exist; no service keys/project URLs committed (grep-verified). **Limitation:** Supabase CLI and psql are not installed on this machine, so the SQL has been reviewed but not executed — RLS behavior is unproven until `supabase/tests/team_cloud_rls.sql` runs against a local stack |
| 3 | Next.js/Supabase web foundation and landing | **DONE (foundation)** — July 19, 2026 | `apps/web/` (Next.js App Router, TypeScript strict, `@supabase/ssr`, pinned deps) with routes `/`, `/login`, `/signup`, `/auth/callback`, `/auth/error`, `/dashboard`, `/download`; `npm run web:build` (new root script) and `apps/web` `npm run typecheck` both exit 0. **Limitation:** auth flows are implemented but not yet exercised against a live Supabase project (no env configured) |
| 4 | Team creation, membership, and invitation flow | **DONE (copy-link; live-stack pending)** — July 19, 2026 | `apps/web/app/teams/` (server actions calling `create_team_with_owner`, hashed-token invite insert, `accept_team_invite`), `apps/web/app/teams/[teamId]/` (team view + InviteForm), `apps/web/app/invite/` (accept page with wrong-email/expired/reused/already-member/missing-token messages), `apps/web/lib/invites.ts` + `teams.ts`; `npm run test:web` (new root script) passes 13/13 pure invite-helper tests; `npm run web:build` exit 0 (10 routes incl. `/invite`, `/teams/[teamId]`); `apps/web` typecheck exit 0. **Limitations:** copy-link invites only (no email provider configured — the prompt's approved fallback); RLS/RPC behavior not exercised against a live Supabase stack (same environment limitation as Prompt 2), so the two-account demo sequence is written but unproven |
| 5 | Desktop Account & Sharing and Manual Sync | **DONE (manual sync; live-stack pending)** — July 19, 2026 | New files `apps/desktop/src/services/cloudClient.ts`, `cloudPolicy.ts`, `cloudStore.ts`, `cloudPolicy.test.ts`, hooks `useCloudAccount.ts`/`useCloudSync.ts`, and `CloudAccountPanel.tsx`/`SharePreview.tsx`; App.tsx/SetupScreen/ScreenRouter/audit/dataExport/localStore/types wired in; `docs/PRIVACY.md` updated. `npm run test:desktop-cloud` (new root script) passes 37/37 (12 cloudPolicy tests plus, from the July 19 Wave 2 hardening pass, 17 `cloudClient.test.ts` tests — token-response parsing, error-message extraction that never echoes tokens, network-failure mapping, membership-row allowlisting, upsert/delete request shapes — and 8 `cloudStore.test.ts` tests covering the localStorage persistence round-trip and corrupt-envelope degradation); root `npm run build` exit 0. **Limitations:** sync not exercised against a live Supabase project (no env/CLI on this machine); auto-sync is stored-but-off pending Prompt 7 |
| 6 | Manager and member dashboards | **DONE (live 4-account verification pending)** — July 19, 2026 | `apps/web/lib/workload.ts` + `workload.test.ts`, `apps/web/lib/snapshots.ts`; manager team dashboard in `apps/web/app/teams/[teamId]/page.tsx` (medians + ranges — not sums, labeled prototype low-headroom threshold, stale/not-shared never treated as zero, no ranks/leaderboards); member dashboard in `apps/web/app/dashboard/page.tsx`. `npm run test:web` passes 55/55 (13 invite + 11 workload + 15 snapshot + 16 team tests; the snapshot and team tests were added in the July 19 Wave 2 hardening passes — `apps/web/lib/snapshots.test.ts` covers `asMetric`/`mapRow` defensive parsing, unshared metrics staying null rather than zero, and the `listLatestTeamSnapshots`/`listOwnLatestSnapshots` wrappers against a mocked Supabase client; `apps/web/lib/teams.test.ts` covers the role helpers plus `listUserTeams`/`getOwnMembership`/`listTeamRoster`/`listTeamInvites` the same way); `npm run web:build` exit 0 (10 routes). **Limitations:** Manager A / Member B / Member C / Outsider D live-RLS verification and screenshots require a live Supabase stack (same environment limitation as Prompt 2) |
| 7 | Hourly sync, catch-up, retry, and freshness | **DONE (live-app soak pending)** — July 19, 2026 | New pure scheduler `apps/desktop/src/services/cloudScheduler.ts` (+ `cloudScheduler.test.ts`, 23 cases after the July 19 pass-3 timer-arming tests): eligibility gating, unchanged-fingerprint no-op, startup/resume catch-up (requires last success ≥1 interval old AND fingerprint changed AND a prior manual sync), capped 1/5/15-minute retry ladder with `clientSnapshotId` reuse, 401/403 classified as auth (hard-stops retries until reconnect), every stop condition (sign-out, membership loss, policy disable, disconnect, demo mode) collapsed into one `planNextAutoSyncAttempt` decision — no timers in the pure module. `useCloudSync.ts` arms a single `window.setTimeout` and audits `trigger:"auto"` attempts (ids/counts only, never metric values); `CloudAccountPanel.tsx` shows next-scheduled-attempt status; `cloudClient.ts` failure results carry an optional HTTP status so auth-vs-transient isn't message parsing. `npm run test:desktop-cloud` 60/60 (37 + 18 scheduler + 5 timer-arming), root `npm run build` exit 0. The July 19 hardening pass 3 extracted the plan→timer translation into the pure injectable `armAutoSyncTimer` (`TimerHost`) so the arm/fire/disarm contract is test-proven, including against real platform timers — the hook's effect is now a one-line delegation. **Limitations:** live Supabase path unexercised (no live stack), and the React effect's re-render/dependency wiring is still build-verified only; a failure outliving all three retries pauses auto-sync until re-arm/reconnect/team change/manual Sync Now |
| 8 | Team Briefing Agent | **DONE (fallback mode on this machine)** — July 19, 2026 | `apps/web/lib/briefing.ts` (allowlist input builder, deterministic fallback from `workload.ts` risk flags, prompt builder, schema validator that strips model-invented evidence refs, server-only Responses-API orchestrator with `store:false`, model ID only from `OPENAI_TEAM_BRIEFING_MODEL` — no guessed default) + 24-case `briefing.test.ts` (fixture `fetchImpl` only, zero live calls; proves not-configured mode never touches the network; a second July 19 hardening pass added the previously untested orchestrator branches — real-timer timeout/abort reporting `fallbackReason:"timeout"` with the `AbortSignal` proven wired to the timer, fetch network-rejection → `model_error`, Responses-API `output[]`-array extraction without `output_text`, and a guard that the API key never appears in any returned response, including hostile error messages); manager-only route `apps/web/app/teams/[teamId]/briefing/` (page + server action with defense-in-depth membership/role re-check + `BriefingPanel.tsx` with the "AI-generated from shared workload signals" disclosure and no-data/model-failure/schema-failure fallback states); one link added to the manager team page; `.env.example` documents `OPENAI_API_KEY`/`OPENAI_TEAM_BRIEFING_MODEL` as optional server-only. `npm run test:web` 85/85, typecheck exit 0. **Limitations:** live model path unexercised (no API key on this machine — deterministic fallback is the demonstrated path); hand-rolled `fetch` instead of the `openai` SDK. The `docs/PRIVACY.md` follow-up was closed July 19, 2026: a "Team Briefing (weekform.com, server-side AI)" section now documents the env-gated model path, deterministic no-network fallback, allowlisted input, `store:false`, schema validation with evidence-ref stripping, and the AI disclosure |
| 9 | Authenticated download and official distribution gate | **DONE (fallback path; signed-URL branch config-gated)** — July 19, 2026 | `/download` stays session-gated (middleware redirect to `/login?next=/download` and back); page rewritten with version, generated date, macOS requirements, source-build/notarization limitation, privacy permissions, install steps, explicit "collects no workload data", and the documented honest fallback (public source archive — never claims the public repo is gated). New trusted route `apps/web/app/download/artifact/route.ts`: server-side session re-check (401), then — only when `WEEKFORM_ARTIFACT_BUCKET`/`PATH` + service-role env are configured — short-lived signed URL (TTL clamped 30–3600s) via a server-only service client; unconfigured returns clear 503 JSON. Pure helpers in `apps/web/lib/download.ts` + 17-case `download.test.ts`. A July 19, 2026 hardening pass extracted the route's full decision sequence into a pure dependency-injected planner (`planArtifactResponse` in `lib/download.ts`; the route is now a thin adapter) and added 6 branch tests: Supabase-unconfigured 503 without touching session or storage, unauthenticated 401 with the service-key step never invoked, signed-in-but-no-bucket honest 503, signing-failure 303 back to `/download?error=artifact`, success 307 with the exact parsed config passed and signing invoked exactly once, and a regression guard that a signed URL never appears in a failure body. `.env.example` and `apps/web/README.md` document artifact upload/env steps. **Limitations:** the branch ordering and responses are now test-proven, but the live Supabase Storage signing call itself remains unexercised (no live bucket on this machine) |
| 10 | Privacy and security critic | **DONE (findings remediated)** — July 19, 2026 | `docs/hackathon/TEAM_CLAWFATHER_PRIVACY_CRITIC_REPORT.md`: all six categories reviewed by three parallel read-only reviewers; no BLOCKER/HIGH. Two MEDIUM findings (3.1 `safeNextPath` backslash open-redirect, 5.1 prototype-key evidence-ref bypass in `briefing.ts`) plus LOW notes — both MEDIUMs remediated the same day by the completeness pass below; LOW items noted-only (two environment-blocked). Live four-actor RLS proof remains environment-blocked (no Supabase CLI/psql) |
| 11 | Integration Director and release gate | **DONE (runnable gates green; live gates operator-pending)** — July 19, 2026 | `docs/hackathon/TEAM_CLAWFATHER_RELEASE_REPORT.md`: single-tree integration verified in contract-first order; gates re-run as written on the final tree — `npm run test:cloud` 10/10, `npm run verify:wave3` exit 0 (60/60 desktop-cloud, 102/102 web, 12 routes / 11 static pages), root `npm run build` exit 0, secret scan clean, `cargo check` not required (zero native files changed vs `main`); eight-dimension drift audit run by a dedicated read-only teammate (results in report §3.1); taskboard INT/REL/SYNC/AI rows updated. **Update July 19, 2026:** `npm audit` gate now CLOSED — `npm run audit:check` exit 0, 0 vulnerabilities at root and in `apps/web` after a `postcss >=8.5.10` override (GHSA-qx2v-qp2m-jg93; regression gates re-run green). **Still not claimed:** live Supabase RLS verification and the ×2 synthetic golden path (credential/environment-blocked; documented, not asserted as passed) |
| 12 | Demo, README, and Devpost submission package | **DONE (repo artifacts; recording + submit are human actions)** — July 19, 2026 | `docs/hackathon/TEAM_CLAWFATHER_DEMO_SCRIPT.md`: 3:50 Time/Screen/Action/Narration script, S1–S11 shot list, 13-step synthetic-state reset checklist. `docs/hackathon/TEAM_CLAWFATHER_DEVPOST.md`: 93-char tagline, full Devpost sections, track justification, submission checklist. `README.md` restructured to lead with the team-cloud product story (problem, consent architecture, manager/member workflow, web/desktop setup, migration, limitations, collaboration provenance); final provenance entry in `docs/BUILD_WEEK_2026.md` §"Team Clawfather release wave (Wave 4)". All copy scoped to synthetic data and never claims signed/notarized distribution, 24/7 closed-app sync, encrypted local storage, or undemonstrated features. **Not claimed:** the video recording itself, live URLs, and the Devpost submit action (SUB-02 recording / SUB-04 submit are human-owned; deploy is operator-reserved) |
| — | Post-0B consistency review | **DONE** — July 19, 2026 | Cross-doc pass: taskboard weekday names corrected to the real 2026 calendar (July 19 is a Sunday; Phase 2 gate and freeze are Monday July 20), blueprint §12 marked superseded-for-execution with a §12→ledger ID mapping table added to taskboard §1, missing P0 accessibility task added as QA-03 (blueprint Q-03), and blueprint §13.4 annotated that `web:build`/`test:cloud` gates are future scripts (only `npm run build` exists today; the scripts were added later the same day — see the Wave 1 close-out row below) |
| — | Wave 1 close-out verification | **DONE** — July 19, 2026 | All §7.1-promised root scripts now exist and run green: `npm run validate:cloud` (added this pass; runs `test:cloud` then `web:build`) exits 0 with 10/10 privacy tests passing and 9 web routes built; root `npm run build` exit 0. Blueprint §13.4 note updated to reflect the completed script set |
| — | Wave 3 close-out verification | **DONE** — July 19, 2026 | Single Wave 3 gate added: `npm run verify:wave3` (chains `test:desktop-cloud`, `test:web`, `web:build`) exits 0 with 55/55 desktop-cloud tests, 85/85 web tests, and 12 web routes built / 11 static pages generated (adds `/teams/[teamId]/briefing` and `/download/artifact`); `apps/web` typecheck exit 0; root `npm run build` exit 0. Independently re-run July 19, 2026 by a second verification pass: all four gates (verify:wave3, verify:wave2, apps/web typecheck, root build) exit 0 with identical counts. Note: `verify:wave2` and `verify:wave3` are intentionally the same command chain — Wave 3's coverage lives in the grown suites (55 desktop-cloud / 85 web tests) and the two new routes, not in a different script. Live-stack (Supabase CLI/psql), live-model (OpenAI key), and live-app-soak verification remain environment-blocked, as documented in the Prompt 2/4/5/6/7/8/9 rows |
| — | Wave 2 close-out verification | **DONE** — July 19, 2026 | Single Wave 2 gate added: `npm run verify:wave2` (chains `test:desktop-cloud`, `test:web`, `web:build`) exits 0 with 37/37 desktop-cloud tests, 55/55 web tests, and 10 web routes built. Every root command documented in this runbook and the blueprint (`build`, `test:cloud`, `test:web`, `test:desktop-cloud`, `web:build`, `validate:cloud`, `verify:wave2`, plus `apps/web` `typecheck`) was re-run as written in this pass and exits 0. The sweep caught one drift: the mocked-wrapper test pass had introduced 24 strict-indexed-access (TS2532) errors in `apps/web/lib/{snapshots,teams,workload}.test.ts`, breaking the documented standalone `typecheck` claim (Next's build-time check excludes test files, so `web:build` stayed green); fixed by adding presence assertions (`assert.ok`) before indexed access in the test files only — no source modules, tsconfig, or existing assertions touched. Live-stack (Supabase CLI/psql) verification remains environment-blocked, as documented in the Prompt 2/4/5/6 rows |
| — | Wave 1–3 validation & ops/UI polish pass | **DONE** — July 19, 2026 | Independent two-track review (docs-vs-code audit + UI/ops code review) over the full Wave 1–3 surface. Docs audit: every artifact, script, route, RPC, and env var claimed DONE for Prompts 1–9 exists as documented; both `.env.example` files match actual code reads in both directions. Two doc gaps fixed: `docs/BUILD_WEEK_2026.md` was missing the Wave 3 provenance entry and carried Wave-2-era gate counts (now a Waves 1–3 section with historical counts labeled and a Wave 3 entry added), and `README.md` §Validation falsely said "there is not yet an automated test suite" (now lists the real `test:cloud`/`test:desktop-cloud`/`test:web`/`test:simulator` suites and `verify:wave2`/`verify:wave3` gates). UI review found no correctness bugs; two polish fixes applied: `/download/artifact` signed-URL failure now 303-redirects back to `/download?error=artifact` with a styled `role="alert"` notice instead of returning raw JSON to a navigational GET (`/download` is now a dynamic route as a result; still 12 routes / 11 static pages), and the `useCloudAccount`/`useCloudSync` controller objects are now `useMemo`-stable so App's `cloud` memo and the auto-sync timer effect no longer churn every render. Deferred as noted-only: blueprint §7.1 "recommended structure" diverges from the executed layout (explicitly superseded). The project-name allowlist's on-blur-only save gap was closed in the July 19 follow-up pass: `CloudAccountPanel.tsx` now shows a `role="status"` "Unsaved edits" hint with an explicit Apply-now action (committed on mousedown so the textarea's own blur commit cannot unmount the button before the click lands) whenever the textarea has uncommitted edits. Re-verified after edits: `verify:wave3` (55/55 desktop-cloud, 85/85 web, 12 routes / 11 static pages), root `npm run build`, `apps/web` tsc, `test:cloud` 10/10, `test:simulator` 12/12 — all exit 0 |
| — | Wave 3 execution hardening pass | **DONE** — July 19, 2026 | Second Wave 3 execution pass targeting the weakest remaining claim (Prompt 9's inspection-only signed-URL branch): `apps/web/app/download/artifact/route.ts` decision logic extracted to the pure `planArtifactResponse` planner in `apps/web/lib/download.ts` and covered by 6 new branch tests (see the Prompt 9 row). Gates after the change: `npm run verify:wave3` exit 0 with 55/55 desktop-cloud tests, **91/91** web tests (85 prior + 6 new), 12 routes / 11 static pages; `apps/web` typecheck exit 0. Remaining Wave 3 environment blocks unchanged: live Supabase stack, live OpenAI model, live-app soak, live artifact bucket |
| — | Wave 3 execution hardening pass 2 (briefing orchestrator) | **DONE** — July 19, 2026 | Third Wave 3 execution pass targeting the next-weakest claim (Prompt 8's `generateTeamBriefing` orchestrator: the timeout, network-rejection, and `output[]`-extraction branches were code-only). 4 new branch tests in `apps/web/lib/briefing.test.ts`: (1) real-timer timeout — a fetch fixture that resolves only when the injected `AbortSignal` fires proves the 20s timer actually aborts the request and the result is `fallbackReason:"timeout"` with the deterministic fallback body; (2) fetch rejecting with a network `TypeError` → `model_error` fallback; (3) a Responses-API payload with no `output_text` but a valid `output[]` message array still reaches `mode:"model"`; (4) regression guard that `OPENAI_API_KEY` never appears in any serialized response — including when a hostile error message echoes the key. Gates after the change: `npm run verify:wave3` exit 0 with 55/55 desktop-cloud tests, **95/95** web tests (91 prior + 4 new), 12 routes / 11 static pages; `apps/web` `tsc --noEmit` exit 0. Remaining Wave 3 environment blocks unchanged: live Supabase stack, live OpenAI model, live-app soak, live artifact bucket |
| — | Wave 3 execution hardening pass 3 (auto-sync timer arming) | **DONE** — July 19, 2026 | Fourth Wave 3 execution pass targeting the next-weakest claim (Prompt 7's real-timer wiring in `useCloudSync` — previously build-verified only). The plan→timer translation was extracted into the pure dependency-injected `armAutoSyncTimer(plan, runAttempt, timers)` helper (with a `TimerHost` interface) in `apps/desktop/src/services/cloudScheduler.ts`, and the hook's scheduling effect reduced to a one-line delegation passing `window.setTimeout`/`window.clearTimeout` — so the controller-owns-one-timer contract lives in tested code, not effect prose. 5 new tests in `cloudScheduler.test.ts`: (1) a real interval plan arms exactly one timer with the plan's exact delay and firing it runs the attempt; (2) `NOT_SCHEDULED` arms nothing and its disarm is a safe no-op (effect cleanup always runs); (3) disarm-before-fire clears the timer, so a re-plan never leaves a stale timer; (4) successive re-plans across the transient-failure ladder arm the 1/5/15-minute delays in order; (5) an end-to-end real-platform-timer test proving a catch-up plan actually fires through `setTimeout`. Gates after the change: `npm run test:desktop-cloud` **60/60** (55 prior + 5 new), `npm run verify:wave3` exit 0 (60/60 desktop-cloud, 102/102 web, 12 routes / 11 static pages), root `npx tsc -b` exit 0. Remaining Wave 3 environment blocks unchanged: live Supabase stack, live OpenAI model, live-app soak, live artifact bucket |
| — | Wave 3 gate-integrity & independent audit pass | **DONE** — July 19, 2026 | Two-track pass over the Wave 3 gate itself. (a) Flake root cause closed: the previously recorded one-off `download.test.ts` failure ("signing runs exactly once" counted 0 while the URL assertion passed) was reproduced under a 12× stress harness (`.absoloop/stress-test-web.ts`; logs `.absoloop/stress-fail-run-*.log`) and traced to **concurrent writers editing the tree mid-run** — the failing tests were newly added red tests from a parallel hardening pass that went green as its source fixes landed (runs 1–6: fail 2, 7–11: fail 1, 12: fail 0; identical suite is 102/102 on a quiet tree). Not a test-logic bug; recorded procedure: don't run `test:web` while another agent is editing `apps/web`. As defense-in-depth, `trackedDeps` in `download.test.ts` now centralizes step-counting in wrappers (overrides are wrapped too), removing the mutate-after-construction seam where a missed manual increment could ever make "URL matched but count 0" observable; assertions unchanged. (b) Independent Wave 3 requirements audit (read-only agent, instructed to distrust this table): every non-environment-blocked required-behavior bullet in Prompts 7–9 has inspectable implementation + covering test (fingerprint no-op / retry-ID reuse / disable cancellation / startup catch-up / 401-403-as-auth / demo-mode block; all five briefing failure modes incl. real-timer timeout; no model-ID guessing; no ranking language, key-leak and signed-URL-leak regression guards; download order Supabase→session→config→sign) — verdict: "no uncovered non-environment-blocked requirements found". Also verified the parallel pass's additions: `apps/web/lib/safeNextPath.ts` open-redirect guard (6 tests incl. `/\` and `\\` bypasses) wired into `app/auth/actions.ts`, and prototype-key evidence-ref stripping in `validateBriefingResult`. Gates on the merged tree: `npm run verify:wave3` exit 0 — 55/55 desktop-cloud, **102/102** web tests (95 + 6 safeNextPath + 1 briefing prototype-key), 12 routes / 11 static pages; `apps/web` `tsc --noEmit` exit 0; root `npm run build` exit 0. Environment blocks unchanged |
| — | Prompt 10 remediation & report close-out | **DONE** — July 19, 2026 | Completed the critic pass end-to-end. (a) Finding 3.1 fully closed: the hardened `safeNextPath` guard (rejects both `//` and `/\` second characters) is now the single validator at **all four** `next`-consuming sites — the earlier pass wired `app/auth/actions.ts`; this pass converged the three remaining hand-rolled `//`-only checks in `app/login/page.tsx`, `app/signup/page.tsx`, and `app/auth/callback/route.ts` (the live redirect) onto the shared helper, so the backslash bypass has no remaining copy anywhere (`grep 'startsWith("//")' apps/web` → 0 source hits). (b) `docs/hackathon/TEAM_CLAWFATHER_PRIVACY_CRITIC_REPORT.md` repaired from its budget-truncated state: the findings-summary table is complete (3.1/5.1 MEDIUM-remediated + three LOW-noted rows), a "Remediation status" section documents both fixes with their regression tests, and the stale "categories to be appended" footer now records the six-category completion. (c) Prompt 7's real-timer wiring limitation narrowed: `armAutoSyncTimer` extracted to `cloudScheduler.ts` behind a `TimerHost` seam with 5 new tests (single-timer guarantee, NOT_SCHEDULED no-op disarm, stale-timer clearing, 1/5/15 ladder order, one real-`setTimeout` end-to-end fire), raising desktop-cloud to **60/60**. Gates on the final tree: `npm run verify:wave3` exit 0 — 60/60 desktop-cloud, 102/102 web, 12 routes / 11 static pages; `apps/web` `tsc --noEmit` exit 0 |
| — | Post-hackathon expansion, Phase A (blueprint §17) | **COMPLETE** (A1–A7 shipped; A4 live Keychain proof and A5 implementation remain honestly environment-blocked) — July 19, 2026 | The detailed evidence remains in `docs/EXPANSION_ROADMAP.md`. PT2 Prompt 13 closed A7 with deterministic team forecasting and walk-forward calibration against the team's own outcomes; its tests and manager panel preserve approved-snapshot coverage, null-never-zero, and no per-member prediction. |
| — | Part 2 execution | **PROMPTS 13–16 DONE; PROMPT 17 READY** — July 19, 2026 | Prompt 16 is RPC-only for create/resolve/delete with server-derived lifecycle fields and no direct table mutations. The unapplied pgTAP contract contains 76 matched assertions covering direct member UPDATE/DELETE and outsider resolve/delete abuse. Final integration verification passed: focused 17/17, `npm run verify:wave3` exit 0 (128/128 desktop-cloud, 188/188 web, 12 routes), root build exit 0, `npm run audit:check` exit 0 with zero vulnerabilities in both workspaces, and diff check exit 0. Live migration/RLS execution remains environment-blocked and is not claimed. |
| — | Desktop/web alignment and storage-boundary QA | **REPOSITORY GATES DONE; LIVE RLS/API PROOF [env-blocked]** — July 19, 2026 | Parallel desktop/web/security QA added pre-upload membership/policy revalidation, remote-delete reconciliation with a guard that survives failed explicit retries, exhausted-retry recovery, UUID/native-storage hardening with a credential-free revocation tombstone, additive server-owned snapshot receipt ordering, force-dynamic 15-second request refresh, and source guards proving no application-managed persistent browser workload store/client or client-side server-data imports. `npm run verify:wave3` exits 0 (128/128 desktop-cloud + 188/188 web; 12 routes), root `npm run build` exits 0, `npm run audit:check` exits 0 with zero vulnerabilities in both workspaces, and `git diff --check` is clean. Neither Supabase CLI nor psql exists here, so the live four-actor desktop-write/web-read/delete matrix remains explicitly unproved. |

---

## 1. How to run this pack

### Working branches/worktrees

Recommended names:

```text
codex/team-clawfather-contract
codex/team-clawfather-supabase
codex/team-clawfather-web
codex/team-clawfather-desktop
codex/team-clawfather-agent
codex/team-clawfather-integration
codex/team-clawfather-release
```

### Parallelization boundary

Safe to run concurrently after the contract is frozen:

- Cloud contract and privacy tests.
- Supabase migration/RLS.
- Next.js web foundation.
- Demo narrative and visual-plan work.

Run serially:

- Any changes to `apps/desktop/src/App.tsx`.
- Any changes to `apps/desktop/src/services/localStore.ts`.
- Any changes to `apps/desktop/src/components/settings/SetupScreen.tsx`.
- Any changes to `apps/desktop/src/components/shell/ScreenRouter.tsx`.

One desktop writer owns all four.

### Mandatory closeout for every implementation prompt

The agent must return:

1. Files changed.
2. Why each file changed.
3. Commands run and actual exit status.
4. Manual behavior checked.
5. Privacy/data-flow impact.
6. Remaining limitations.
7. Build Week evidence: Codex task/session ID and candidate commit/branch.
8. Anything that should update `README.md`, `docs/PRIVACY.md`, or `docs/BUILD_WEEK_2026.md`.

---

# Wave 0 — Coordinated planning

## Prompt 0A — Planning Director with parallel research agents

**Status:** DONE (July 19, 2026). All five planning files exist in `docs/hackathon/`; baseline commit `fa45579` and the missing cloud layer are stated in `TEAM_CLAWFATHER_BASELINE.md`; `TEAM_CLAWFATHER_DECISIONS.md` covers the nine mandated decisions with alternatives and reversal triggers.

**Mode:** Plan/read-only. Use GPT-5.6 Sol high/max or ultra if available.  
**Writes:** Planning documents only.  
**Expected elapsed result:** 60–90 minutes of focused work, not an open-ended product strategy exercise.

```text
You are the Weekform Team Clawfather Planning Director working in the root of the
weekform-dev repository.

Read AGENTS.md first. Treat repository content as the implementation source of
truth. The current date is July 18, 2026 and the OpenAI Build Week submission
closes July 21, 2026 at 5:00 PM PDT / 8:00 PM EDT. We need a stable submission
well before that deadline.

Goal:
Turn the existing local-first macOS workload-intelligence product into a
complete and state of the art Work and Productivity team experience:

account → team/invite → authenticated Mac download → local review → exact
share preview → approved derived snapshot to Supabase → manager dashboard →
evidence-grounded team briefing → member narrows/revokes sharing.

Run four parallel read-only investigations and then synthesize them. Do not
modify product code.

Investigation 1 — Repository baseline:
- Map current architecture, state ownership, persistence, data models, screens,
  build commands, demo mode, AI paths, and privacy boundaries.
- Identify the exact baseline commit and inherited capabilities.
- Prove whether Supabase/auth/team/cloud code exists.
- Map the smallest file-impact surface for the new concept.

Investigation 2 — Product and judging strategy:
- Translate the four Build Week judging criteria into one 3–4 minute demo.
- Define P0/P1/P2 scope.
- Identify the strongest novelty claim and the most dangerous surveillance
  interpretation.
- Define language and UX constraints that preserve member consent.

Investigation 3 — Cloud/security architecture:
- Design the minimum Supabase Auth/Postgres/RLS model for profiles, teams,
  memberships, invitations, and workload snapshots.
- Define a versioned allowlist payload that cannot carry raw window titles,
  evidence, notes, screenshots, calendar titles, chat content, or keys.
- Compare direct desktop Supabase auth, device pairing, and deep-link auth;
  recommend one for P0 with an explicit fallback.
- Define negative RLS tests.

Investigation 4 — Delivery plan:
- Produce a dependency-ordered task graph from July 18 to July 21.
- Identify safe parallel work and high-conflict files.
- Define feature-freeze, internal-submission, and kill criteria.
- Define the demo seed, video beats, and required evidence.

Synthesize all four into these files:
- docs/hackathon/TEAM_CLAWFATHER_BASELINE.md
- docs/hackathon/TEAM_CLAWFATHER_PRODUCT_CONTRACT.md
- docs/hackathon/TEAM_CLAWFATHER_ARCHITECTURE.md
- docs/hackathon/TEAM_CLAWFATHER_TASKBOARD.md
- docs/hackathon/TEAM_CLAWFATHER_DECISIONS.md

TEAM_CLAWFATHER_DECISIONS.md must contain explicit decisions, alternatives rejected,
and reversal triggers. At minimum decide:
- web stack;
- desktop auth path;
- invitation path;
- official download gate;
- shared payload levels;
- manager metrics;
- AI boundary;
- scheduled-sync semantics;
- P0/P1/P2.

Do not propose a complete workforce SaaS. Do not permit raw local evidence in
Supabase. Do not create employee rankings or a productivity score. Do not
rewrite existing architecture without a critical-path reason.

Finish with a one-page executive summary and the first eight implementation
missions in dependency order. Cite repository file paths and exact commands.
```

### Expected result

- Five planning files exist.
- Baseline commit and missing cloud layer are explicit.
- Shared data contract is understandable without reading code.
- P0 demo can be described in eight steps or fewer.
- Desktop high-conflict files have one assigned writer.
- The first implementation wave can start without another architecture meeting.

### Reject the result if

- It proposes raw activity upload.
- It uses global user roles instead of team memberships.
- It leaves RLS to “later.”
- It treats database cron as a way to pull from a closed Mac.
- It proposes billing, SSO, Realtime, or multiple integrations on P0.
- It does not state what gets cut when a task overruns.

---

## Prompt 0B — Program Integrator task ledger

**Status:** DONE (July 19, 2026). `docs/hackathon/TEAM_CLAWFATHER_TASKBOARD.md` now carries the eleven-field per-task ledger (owned files, read-only files, dependencies, hour estimates, model/effort, automated gates, manual evidence, rollback, status) plus the five Program Integrator outputs in its final section.

**Mode:** Plan.  
**Run after:** Prompt 0A.

```text
Read AGENTS.md and docs/hackathon/TEAM_CLAWFATHER_*.md.

Act as the Weekform Build Week Program Integrator. Convert the approved product
contract into a task ledger that can be executed by separate Codex worktrees
without ambiguous ownership.

For every task include:
- ID and concise title;
- user-visible outcome;
- exact files/directories owned;
- files that are read-only for that task;
- dependencies;
- estimate in focused engineering hours;
- model/effort recommendation;
- required automated gates;
- required manual evidence;
- rollback or fallback;
- status: READY, BLOCKED, ACTIVE, REVIEW, DONE, CUT.

Create or update docs/hackathon/TEAM_CLAWFATHER_TASKBOARD.md.

Then output:
1. The critical path.
2. The safe parallel wave.
3. The single highest-risk assumption.
4. The exact next command/prompt for each ready workstream.
5. A hard P0 cut list.

Do not write product code. Do not assign two writers to App.tsx, localStore.ts,
SetupScreen.tsx, or ScreenRouter.tsx.
```

### Expected result

A task board that can be used as the daily source of truth and that makes ownership conflicts impossible to miss.

---

# Wave 1 — Contracts, backend, and web foundation in parallel

## Prompt 1 — Shared cloud contract and privacy tests

**Owner:** Contract Agent.  
**Writes:** `packages/domain/src/cloud.ts`, `packages/inference/src/sharedSnapshot.ts`, focused tests, minimal package scripts.  
**Do not write:** Desktop components, web routes, Supabase migration.

```text
Read AGENTS.md and all docs/hackathon/TEAM_CLAWFATHER_*.md.

Implement the version-1 Weekform cloud-sharing contract as a pure, explicit
allowlist boundary.

Objective:
Create a SharedWorkloadSnapshotV1 from the existing WeeklyCapacitySnapshot,
reviewed WorkBlock records, and CloudSharePolicyV1. The output must be safe to
send to Supabase and must be the exact object used by the desktop preview and
sync path.

Required files:
- packages/domain/src/cloud.ts
- packages/inference/src/sharedSnapshot.ts
- packages/inference/src/sharedSnapshot.test.ts or the smallest reliable test
  location supported by the repository

Required types:
- CloudShareLevel: summary | categories | projects
- CloudMetricPolicy
- CloudSharePolicyV1
- SharedWorkloadSnapshotV1
- CloudSyncState
- CloudAccountSummary, if needed without auth tokens

Builder requirements:
- Reject disabled/unconsented/teamless policy.
- Include only enabled metrics.
- Omit categories/work modes below categories level.
- Omit projects below projects level.
- Build project allocation only from user-verified work blocks and an explicit
  allowedProjectNames list.
- Do not include app names, window titles, evidence, derived_from IDs, notes,
  stakeholder names, calendar titles, chat data, screenshots, Visual Context,
  API keys, or arbitrary unknown fields.
- Validate finite numbers and clamp percentage fields to safe display bounds.
- Generate or accept a stable clientSnapshotId suitable for retry idempotency.
- Return a preview generated from the same payload, not a second calculation.
- Expose a deterministic content fingerprint excluding transient timestamps.

Focused tests must prove:
1. Summary output contains only enabled summary fields.
2. Categories output adds only category/work-mode allocation.
3. Projects output includes only allowed names from verified blocks.
4. Sentinel window title never appears in serialized output.
5. Sentinel evidence text never appears.
6. Sentinel note never appears.
7. Disabled fields are absent, not zero.
8. Non-finite values do not reach output.
9. Same approved content produces the same fingerprint.
10. Policy changes change the fingerprint.

Do not refactor the capacity model. Do not add Supabase code. Do not add a
catch-all object spread from local models. Do not weaken TypeScript strictness.

Add the smallest reliable test command. If adding a test runner is necessary,
explain and pin it; otherwise use an existing tool. Run npm run build and the
focused test command.

Update docs/hackathon/TEAM_CLAWFATHER_PRODUCT_CONTRACT.md if implementation details
require clarification, but do not silently change the approved privacy model.
```

### Expected result

- A reusable shared contract with no client/backend dependency.
- At least ten passing focused tests.
- Desktop and web agents can build against the same types.
- `npm run build` remains green.

### Evidence to request

- Serialized safe sample.
- List of omitted sensitive fields.
- Test output.
- Type/build output.

---

## Prompt 2 — Supabase schema, RLS, and synthetic seed

**Owner:** Cloud Agent.  
**Mode:** Implement; high/max effort.  
**Writes:** `supabase/**`, cloud architecture docs.  
**Do not write:** Web/desktop application code.

```text
Read AGENTS.md, docs/hackathon/TEAM_CLAWFATHER_ARCHITECTURE.md, and the cloud contract.

Implement a reviewable Supabase migration for Weekform Team Clawfather.

Create:
- supabase/migrations/<timestamp>_team_cloud_v1.sql
- supabase/seed.sql or a safe seed helper
- docs/hackathon/TEAM_CLAWFATHER_RLS_MATRIX.md
- optional scripts that run local policy checks if Supabase CLI is available

Tables:
- profiles
- teams
- team_memberships
- team_invites
- workload_snapshots

Rules:
- Team roles are owner, manager, member and live in team_memberships.
- All public tables have RLS enabled.
- Authorization must not depend on user-editable raw_user_meta_data.
- A user can write only their own snapshot for a team where they have active
  membership.
- A user can read/delete their own snapshots.
- Owners/managers can read snapshots for active members of teams they manage.
- Regular members cannot read other members' snapshots.
- Outsiders cannot enumerate teams, members, invitations, or snapshots.
- Owners/managers can create invitations.
- Store only token hashes, never invite plaintext.
- Invite acceptance must be one-time, expiration-aware, email-aware, and atomic.
- A manager must not be able to delete a member's workload history by default.
- Every RLS join column is indexed.
- workload_snapshots has a unique client_snapshot_id and schema_version.
- Prefer explicit metric columns plus sanitized JSON breakdowns.
- Reject unknown share levels and invalid roles with CHECK constraints.
- Use security-invoker views or direct queries; do not accidentally bypass RLS.
- Set safe search_path on security-definer functions.

Provide functions/RPCs when useful:
- handle_new_user/profile bootstrap
- create_team_with_owner
- accept_team_invite

Create TEAM_CLAWFATHER_RLS_MATRIX.md with actors:
Manager A, Member B, Member C, Outsider D. Cover positive and negative SELECT,
INSERT, UPDATE, DELETE, invite, and acceptance cases.

Seed only synthetic identities/team/snapshots. Do not commit passwords, service
keys, project URLs, or real email addresses. If auth-user seeding cannot be
portable, document exact local steps and seed only public rows through a script.

Validate migration syntax with Supabase CLI if installed. If unavailable, do a
careful SQL review and state that limitation. Do not claim RLS was executed
without evidence.
```

### Expected result

- One migration that can be inspected and applied.
- RLS is part of the first migration, not a follow-up.
- Invite acceptance is deterministic.
- The negative-access matrix is explicit.
- No service key appears in committed files.

### Mandatory reviewer questions

- Can a member change `user_id` during insert?
- Can a manager join an unrelated team through an RLS helper?
- Can an accepted invite be reused?
- Can a view bypass RLS?
- Can an outsider infer team existence?
- Can user metadata grant a role?

---

## Prompt 3 — Next.js/Supabase web foundation and landing

**Owner:** Web Agent.  
**Writes:** `apps/web/**`, root workspace/scripts only as needed.  
**Run in parallel with:** Prompts 1 and 2, but use temporary type stubs only if necessary and remove them before merge.

```text
Read AGENTS.md and docs/hackathon/TEAM_CLAWFATHER_PRODUCT_CONTRACT.md.

Create apps/web as a production-quality but tightly scoped weekform.com web app.
Use the latest stable Next.js App Router version compatible with Vercel and the
current official Supabase SSR guidance. Pin dependencies in the lockfile.

Foundation requirements:
- TypeScript strict mode.
- @supabase/ssr browser and server clients.
- Cookie-based session refresh according to current official docs.
- Geist typography and visual continuity with the desktop app.
- Accessible light/dark behavior using existing Weekform design intent.
- Responsive layout.
- Environment example with only publishable client values exposed.
- Protected /dashboard and /download routes.
- Sign up, sign in, sign out, callback/error behavior.
- Profile bootstrap/read.
- No secret/service key in client bundles.

Landing requirements:
- Headline: team capacity without surveillance.
- Explain local observation, personal review, approved sharing, and team view.
- Show exactly what managers do not see.
- Primary CTA creates an account.
- Secondary CTA explains privacy.
- Account-required download is visible in the journey.
- Honest prototype disclosure.
- No fake customer logos or metrics.

Authenticated shell:
- Dashboard loading/empty/error states.
- If no team membership: offer Create a team, Accept an invite, or Personal use.
- A personal-use path still leads to the Mac download.

Do not implement the manager dashboard data cards yet unless the schema is
merged. Do not invent API response shapes. Do not use deprecated Supabase auth
helpers. Do not use the service key in browser code.

Add root commands:
- web:dev
- web:build

Run the web production build. Capture screenshots at desktop and narrow width if
a browser-verification tool is available. Record remaining environment/setup
steps in apps/web/README.md.
```

### Expected result

- Deployed-capable web shell.
- Signup/login/logout and protected routing work locally.
- Landing explains the product in under one screen plus supporting sections.
- Web production build passes.
- No manager/team data assumptions are duplicated outside query helpers.

---

# Wave 2 — Team product and manual sync

## Prompt 4 — Team creation, membership, and invitation flow

**Status:** DONE (July 19, 2026), copy-link path. Team create/list, hashed-token invite generation with copyable URL, and invite acceptance (wrong-email, expired, reused, already-member, and missing-token messages via `mapAcceptInviteError`) are implemented in `apps/web`; `npm run test:web` 13/13, `npm run web:build` exit 0. Email delivery is intentionally not implemented (no server-side provider configured; copy-link is the documented reliable fallback). Live-stack integration cases and the RLS-matrix actual-outcome update remain blocked on the Prompt 2 environment limitation (no Supabase CLI/psql).

**Owner:** Web Agent.  
**Depends on:** Supabase migration and web foundation.

```text
Read AGENTS.md, the applied migration, and TEAM_CLAWFATHER_RLS_MATRIX.md.

Implement the P0 team lifecycle in apps/web:
- Create a team and atomically give the creator owner membership.
- List the signed-in user's teams and role in each.
- Generate a team invite for an email and role=member.
- Store only the token hash.
- Show a copyable invite URL immediately.
- Optionally send email only when a configured server-side provider exists;
  copy-link behavior must remain the reliable fallback.
- Accept invite after sign-in/sign-up.
- Handle wrong email, expired token, reused token, already-a-member, and missing
  token with clear messages.
- Show the new member in the manager team view.

Use server actions/route handlers/RPCs deliberately. The signed-in user's cookie
session should authorize normal actions. A secret/service key may be used only
in a trusted server path when unavoidable and never to skip a user authorization
check. Prefer RLS and reviewed RPCs.

Do not call Supabase Auth Admin inviteUserByEmail as the team-membership model;
that path fails for existing confirmed users and conflates account creation with
team invitation.

Add focused tests for pure token/input helpers and, where the local Supabase
stack is available, execute positive/negative integration cases. Update the RLS
matrix with actual outcomes.

Run web:build and return a demo sequence with two synthetic accounts.
```

### Expected result

A manager can create a team, copy an invite link, and a second account can accept it. Existing accounts and new accounts use the same product invitation.

---

## Prompt 5 — Desktop Account & Sharing and Manual Sync

**Status:** DONE (July 19, 2026), manual sync path. Cloud account/auth, Account & Sharing settings tab, `CloudSharePolicyV1` editor with consent timestamp, exact `SharedWorkloadSnapshotV1` preview, manual Sync Now with `clientSnapshotId` reuse, audit events, delete-my-snapshots, disconnect, reset integration, and token-free backup metadata are implemented across `cloudClient.ts`/`cloudPolicy.ts`/`cloudStore.ts`, `useCloudAccount`/`useCloudSync`, and `CloudAccountPanel.tsx`/`SharePreview.tsx`; `npm run test:desktop-cloud` 37/37 (12 cloudPolicy + 17 cloudClient + 8 cloudStore; the client/store tests were added in the July 19 Wave 2 hardening pass and cover token parsing, error messages that never echo tokens, allowlist-only membership mapping, upsert/delete request shapes, and localStorage envelope round-trips with corrupt-input degradation), root `npm run build` exit 0, `docs/PRIVACY.md` updated. Not exercised against a live Supabase project (no env/CLI on this machine); the app runs unchanged with Supabase env absent; the Tauri `Store` persistence branch is unit-untestable (plugin IPC) — only the localStorage fallback is covered. Auto-sync remains off pending Prompt 7.

**Owner:** Sole Desktop Agent.  
**Depends on:** Shared cloud contract, Supabase tables/RLS, working web account.  
**Mode:** High/max effort because this crosses persistence, privacy, and app state.

```text
Read AGENTS.md and all TEAM_CLAWFATHER planning/contract documents. Inspect the
current App.tsx, localStore.ts, SetupScreen.tsx, ScreenRouter.tsx, audit helpers,
data export, reset behavior, and demo path before editing.

You are the sole writer for the desktop integration files.

Objective:
Add Account & Sharing to Weekform for Mac and make one manually approved,
privacy-safe Supabase sync work end to end without regressing the local-only app.

Implement:
1. Cloud account/auth service using the Supabase publishable key and signed-in
   user's session. Never embed a secret/service key.
2. Account & Sharing settings tab/component.
3. Email/password sign-in with the same web account.
4. Team membership selection.
5. Sharing off by default.
6. CloudSharePolicyV1 editor:
   - summary/categories/projects level;
   - individual metric toggles;
   - explicit project-name allowlist;
   - auto-sync stored but can remain off until the hourly prompt;
   - consent timestamp.
7. Exact preview rendered from SharedWorkloadSnapshotV1.
8. Initial confirmation before first sync.
9. Manual Sync Now through RLS.
10. Last attempt, last success, error, and row/client snapshot ID state.
11. Local audit events for connect, policy change, success, failure, delete,
    pause, and disconnect.
12. Delete my snapshots for selected team.
13. Disconnect/sign out and stop future sync.
14. Reset Local Data clears cloud session/policy/sync state.
15. Full backup includes policy/sync metadata but excludes auth tokens.

Persistence:
- Add defensive parsers and safe defaults.
- Preserve existing users and version-1 state.
- Do not trust persisted arrays/objects without validating every field consumed.
- Do not put auth tokens inside a JSON export.

UX:
- State that account creation begins on weekform.com.
- State that session storage is local prototype storage.
- Show the recipient team and exact selected fields.
- Never say “all data synced.”
- Show that the app must be running for scheduled sync.
- Existing desktop behavior must work when Supabase env is absent.

Data:
- Use the shared payload builder; never construct a second payload in the hook.
- Never send raw samples, sessions, evidence, notes, titles, screenshots,
  calendar details, chat content, audit details, or AI keys.
- user_id comes from authenticated database context.
- Stable clientSnapshotId is reused across retries.

Files should be decomposed into cloudClient.ts, useCloudAccount/useCloudSync,
CloudAccountPanel.tsx, and SharePreview.tsx rather than adding all logic to
App.tsx or SetupScreen.tsx.

Validation:
- focused cloud tests;
- npm run build;
- cargo check only if native files change;
- manual signed-out, sign-in, preview, successful sync, failed sync, policy
  change, delete, sign-out, reset, and no-env behavior.

Update PRIVACY.md and relevant settings copy in the same change. Update Build
Week provenance with the task/session ID and outcome, not raw prompts.
```

### Expected result

- One synthetic teammate signs into desktop and syncs one approved row.
- Preview JSON exactly equals the inserted semantic payload.
- Existing local demo starts with cloud disabled.
- Reset and disconnect leave no active upload path.
- Desktop build remains green.

### Stop condition

If desktop Supabase session persistence consumes more than twice the estimate, implement the approved fallback (short-lived pairing/device token) without changing the payload contract.

---

## Prompt 6 — Manager and member dashboards

**Status:** DONE (July 19, 2026), live 4-account verification pending. Manager team dashboard (`apps/web/app/teams/[teamId]/page.tsx`) shows member count, sharing coverage, invite action, latest snapshot per member, median-and-range aggregates (never sums of percentages), a labeled prototype low-headroom threshold with stale/not-shared exclusions counted explicitly, and "Not shared" for omitted metrics — no ranks or leaderboards. Member dashboard (`apps/web/app/dashboard/page.tsx`) shows the latest shared snapshot, teams/roles, last sync, share level, and download action. Aggregation logic lives in `apps/web/lib/workload.ts` (tested) and explicit-column queries in `apps/web/lib/snapshots.ts` (row mapping now tested directly: `snapshots.test.ts` covers numeric-string coercion, null/undefined and non-finite values staying null — never zero — and full snake_case→camelCase mapping; `teams.test.ts` covers `isManagerRole` over the whole role union). A second July 19 hardening pass added mocked-Supabase-client tests for the query wrappers themselves: `teams.test.ts` now also covers `listUserTeams` (embed as object/array, invisible-team rows skipped, unknown roles coerced to `member`, error path), `getOwnMembership` (null on error/no-row/missing embed), `listTeamRoster` (memberships+profiles composition, name trimming, blank names → null, `isSelf`, empty roster skips the profiles query), and `listTeamInvites`; `snapshots.test.ts` now also covers `listLatestTeamSnapshots`/`listOwnLatestSnapshots` (correct table/filter usage, `data: null` → empty list, error paths). `npm run test:web` 55/55, `npm run web:build` exit 0 (10 routes). Untestable without a live stack (honest gap): actual RLS enforcement and the `latest_team_snapshots` view semantics — the mock tests prove the client-side query shapes and mapping, not what Postgres returns. Manager A / Member B / Member C / Outsider D RLS outcomes and screenshots require a live Supabase stack (same environment limitation as Prompt 2).

**Owner:** Web Agent.  
**Depends on:** Team membership, workload snapshot row, RLS.

```text
Read AGENTS.md, cloud.ts, the migration/RLS matrix, and the successful desktop
snapshot fixture.

Implement role-aware Weekform dashboards.

Manager team dashboard:
- Team name, member count, sharing coverage, last update, invite action.
- Latest snapshot per member.
- Median reliable capacity and range, not a sum of percentages.
- Median/range for reactive, meetings, fragmentation where shared.
- Count of low-headroom members using an explicitly labeled prototype threshold.
- Member cards with freshness, share level, review coverage/confidence, and
  “Not shared” for omitted metrics.
- Stale and missing data are clearly labeled and never treated as zero.
- No ranks, leaderboard, productivity score, or surveillance language.
- Deterministic risk flags with explanations.

Member dashboard:
- Their latest shared snapshot.
- Teams and roles.
- Last sync and share level.
- Download/reinstall action.
- “Change sharing in Weekform for Mac.”
- Delete cloud history and leave-team paths where authorized.

Data access:
- Use authenticated user queries and RLS.
- Select explicit columns; do not SELECT * for restricted data.
- Filter by team/user even when RLS also filters.
- Server-render primary data where practical.
- Do not introduce Realtime on P0.

Design:
- Use Weekform's Geist vocabulary and restrained data visualization.
- Include loading, empty, partial, stale, and error states.
- Responsive and keyboard accessible.

Run web:build and verify with Manager A, Member B, Member C, Outsider D.
Return screenshots and the actual RLS outcomes.
```

### Expected result

Manager A sees approved member snapshots; members and outsiders cannot see another person’s snapshots. Partial sharing is understandable and visually intentional.

---

# Wave 3 — Completeness and intelligence

## Prompt 7 — Hourly sync, catch-up, retry, and freshness

**Owner:** Desktop Agent.  
**Depends on:** Manual sync proven.

```text
Read AGENTS.md and the existing manual cloud sync implementation.

Add bounded automatic synchronization without changing the privacy contract.

Required behavior:
- Disabled by default until the user enables auto-sync.
- Interval defaults to 60 minutes.
- Runs only while Weekform is running.
- On startup/resume, attempts a catch-up when last success is older than one
  interval and approved payload content changed.
- Does not write redundant rows for an unchanged content fingerprint unless a
  documented freshness heartbeat is explicitly required.
- Retries transient failures after approximately 1, 5, and 15 minutes, capped.
- Reuses clientSnapshotId across retries.
- Stops immediately after sign-out, membership loss, policy disable, or account
  disconnect.
- Treats 401/403 as auth/authorization problems, not transient network errors.
- Preserves all local state after failure.
- Shows next scheduled attempt, last success, and clear failure text.
- Audits attempts/results without including payload content.
- Does not run in normal demo mode.
- Does not rely on Supabase Cron to pull from the Mac.

Use a testable clock/scheduler abstraction if practical. Add focused tests for
fingerprint no-op, retry ID reuse, disable cancellation, and startup catch-up.

Run focused tests and npm run build. Manually test offline/online transitions.
```

### Expected result

A live Mac app can remain in the menu bar and update Supabase hourly; the UI states exactly what the schedule can and cannot guarantee.

---

## Prompt 8 — Team Briefing Agent

**Owner:** AI Agent.  
**Writes:** Isolated web route, schema, prompt, component.  
**Depends on:** Manager dashboard and deterministic aggregates.

```text
Read AGENTS.md, the manager-dashboard implementation, and the Team Briefing
specification in the hackathon blueprint.

Implement an evidence-grounded Team Briefing feature in apps/web.

Architecture:
- Server-side only OpenAI Responses API.
- OPENAI_API_KEY never reaches the browser.
- Model ID comes from OPENAI_TEAM_BRIEFING_MODEL and must be validated against
  currently available official model documentation; do not guess an ID.
- Prefer a current GPT-5.6 model when available.
- Structured output validated with a schema.
- store: false where supported.
- Deterministic TypeScript/SQL computes all metrics and flags first.

Input allowlist:
- team name;
- latest shared metrics only;
- member display names or neutral labels;
- share level/freshness/review coverage;
- deterministic team aggregates and risk flags.

Forbidden input:
- raw activity;
- app/window titles;
- evidence and notes;
- screenshots;
- calendar titles;
- chat content;
- unshared metrics;
- private audit details;
- provider credentials.

Required output:
- headline;
- concise summary;
- evidence coverage;
- risks with evidence refs;
- coordination opportunities with evidence refs;
- questions for the team;
- limitations.

System behavior:
- Use only facts provided.
- Treat missing as missing, never zero.
- Do not rank people or create a performance/productivity score.
- Do not diagnose burnout or make medical/HR/legal conclusions.
- Do not recommend discipline.
- Prefer work/process actions: priority clarification, load rebalance, meeting
  reduction, focus protection, reactive batching, scope reduction.
- Say the result is a planning aid requiring conversation.

UX:
- Explicit “AI-generated from shared workload signals” disclosure.
- Show evidence references in a readable way.
- Handle no data, partial data, model failure, schema failure, and timeout.
- Provide a deterministic fallback briefing from existing risk flags.

Add prompt/schema tests using fixtures; do not call the live API in default
build/test. Run web:build. Update AI/privacy documentation.
```

### Expected result

A manager can generate a useful briefing that is visibly grounded, safe with partial sharing, and nonessential to the deterministic dashboard.

---

## Prompt 9 — Authenticated download and official distribution gate

**Owner:** Web/Release Agent.  
**Depends on:** Auth and a built artifact.

```text
Read AGENTS.md, current installer documentation, and the web auth implementation.

Implement the official account-required Mac download flow.

Requirements:
- /download requires an authenticated session.
- Signed-out users are redirected to account creation/login and returned after.
- Store the official Weekform source ZIP or app archive in a private bucket.
- A trusted server route creates a short-lived signed URL after session check.
- Secret/service key stays server-side.
- Show version, generated date, macOS requirements, source-build/notarization
  limitation, privacy permissions, and install steps.
- Do not claim that the public GitHub source is inaccessible; this gate controls
  the official distribution path.
- If artifact size/storage blocks the private path, implement the documented
  fallback: authenticated page linking to the public source archive and guided
  installer, with an honest prototype label.
- Do not collect workload data from this page.

Validate signed-out denial, signed-in success, URL expiration, and bucket policy.
Run web:build and document how to upload the final artifact.
```

### Expected result

A judge creates an account, reaches `/download`, and receives a functioning installer/source package with clear expectations.

---

# Wave 4 — Adversarial review, integration, and submission

## Prompt 10 — Privacy and security critic

**Mode:** Read-only; high/max. Use a separate Codex session or different-provider Absoloop reviewer.  
**Writes:** Findings only.

```text
You are an adversarial privacy/security reviewer. Read AGENTS.md, all Team Clawfather
docs, the complete diff, Supabase migration, cloud payload builder, desktop sync,
web queries, invite flow, download route, and Team Briefing route.

Try to disprove the product's claims. Do not fix code.

Review categories:
1. Payload leakage:
   - raw titles, app names, evidence, notes, IDs, screenshots, calendar/chat data,
     API keys, arbitrary object spreads.
2. RLS/authorization:
   - cross-team reads;
   - forged user_id/team_id;
   - member reading peers;
   - manager overreach;
   - invite token replay/wrong email;
   - user metadata role escalation;
   - security-definer search_path;
   - view bypass;
   - service key exposure.
3. Auth/session:
   - tokens in exports/logs/audit/UI;
   - reset/sign-out not stopping sync;
   - stale sessions;
   - client-side trust.
4. Sync integrity:
   - duplicate retries;
   - changed policy but stale payload;
   - disabled fields represented as zero;
   - offline loops;
   - membership removal.
5. AI:
   - unshared fields reaching model;
   - hallucinated claims;
   - ranking/HR/medical language;
   - secret key or model output retention.
6. Product honesty:
   - “local-first” claims after cloud addition;
   - app-closed hourly behavior;
   - account-gated download vs public source;
   - prototype credential storage.

Execute negative tests where possible. Cite file:line and exact reproduction.
Classify each finding:
- BLOCKER — data exposure, unauthorized access, false core claim, broken golden path.
- HIGH — likely trust/security failure.
- MEDIUM — meaningful defect with workaround.
- LOW — polish/documentation.

For each finding include expected behavior, actual behavior, evidence, smallest
safe remediation, and regression test. If no blocking issue remains, answer
NO_BLOCKING_FINDINGS only after summarizing the tests executed.
```

### Expected result

Concrete, reproducible findings—not generalized security advice. No implementation begins until each BLOCKER has an owner.

---

## Prompt 11 — Integration Director and release gate

**Owner:** Integrator.  
**Mode:** High/max; consider GPT-5.6 ultra for final cross-surface review.  
**Writes:** Integration branch only.

```text
Read AGENTS.md, the Team Clawfather blueprint/taskboard, all candidate diffs, and the
privacy critic report.

Integrate the stable P0 Team Clawfather vertical slice. Do not merge by file count or
agent confidence; inspect every diff and preserve the repository's local-first
golden path.

Integration order:
1. Shared cloud contract/tests.
2. Supabase migration/docs.
3. Web foundation/auth.
4. Team/invite flow.
5. Desktop account/manual sync.
6. Manager/member dashboards.
7. Revoke/delete.
8. P1 features only if all P0 gates are green.
9. Documentation/provenance.

Resolve drift:
- table/column/type names;
- share-level semantics;
- environment variable names;
- metric null/omission behavior;
- client snapshot ID/idempotency;
- invite token behavior;
- role names;
- last-sync/freshness meaning.

Required gates:
- focused cloud tests;
- npm run build;
- npm run web:build;
- cargo check if native files changed;
- npm audit --audit-level=moderate;
- Supabase migration/RLS verification if local project is available;
- secret scan;
- clean synthetic golden path twice.

Manual golden path:
manager creates team → invitation → member joins → authenticated download →
desktop sign-in → preview → manual sync → manager dashboard → briefing/fallback
→ metric removal → resync → delete/revoke.

P1 may merge only after P0 passes twice. Do not weaken tests, RLS, privacy copy,
or build gates to finish. Cut unfinished features cleanly; do not leave dead UI.

Update:
- README.md
- docs/PRIVACY.md
- docs/BUILD_WEEK_2026.md
- CONTRIBUTING.md only if setup changed
- apps/web/README.md
- .env.example files

Return a release report with exact commits, commands/exit codes, demo accounts
setup, known limitations, and the public-safe Codex evidence trail.
```

### Expected result

One coherent branch with a reproducible build and no hidden dependency on an agent worktree or developer-local state.

---

## Prompt 12 — Demo, README, and Devpost submission package

**Owner:** Demo/Submission Agent.  
**Depends on:** Frozen integration branch.

```text
Read AGENTS.md, the final implementation, Build Week rules, and the existing
provenance document.

Prepare the submission package for Weekform Team Clawfather without overstating what
was built during the Submission Period.

Deliver:
1. A 3.5–4 minute demo script with screen/action/narration columns.
2. A shot list and synthetic-state reset checklist.
3. README changes that lead with the team-cloud product story and show:
   - problem;
   - local-first consent architecture;
   - manager/member workflow;
   - screenshots;
   - web setup;
   - desktop setup;
   - Supabase migration;
   - demo accounts/seed instructions;
   - limitations;
   - Codex/GPT-5.6 collaboration.
4. Devpost copy:
   - 100-character tagline;
   - concise problem/solution;
   - what it does;
   - how it was built;
   - challenges;
   - accomplishments;
   - what was learned;
   - what's next;
   - track justification.
5. Final Build Week provenance entry with dated commit/session evidence.
6. Submission checklist including repository, live URL, video URL, primary
   /feedback Codex Session ID, screenshots, and setup verification.

Demo sequence:
- Manager signs in and creates/views team.
- Member joins and reaches authenticated Mac download.
- Local Weekform review/capacity appears.
- Account & Sharing preview proves raw titles/evidence are absent.
- Sync Now.
- Manager dashboard updates.
- Team Briefing uses shared metrics.
- Member removes a field or deletes history; manager view honors it.
- Close on impact and Codex development evidence.

Use only synthetic data. Keep inherited desktop capabilities distinct from new
Team Clawfather work. Do not claim signed/notarized distribution, 24/7 sync while the
app is closed, encrypted local storage, enterprise security, validated worker
performance science, or completed features that are not demonstrated.
```

### Expected result

A submission package that a new judge can understand, run, and trust without private context.

---

# Recovery prompts

## Recovery A — RLS is not green by Sunday afternoon (July 19 under the compressed schedule)

```text
Stop feature work. Act as a Supabase RLS incident commander.

Reduce the data path to one table: workload_snapshots. Keep profiles, teams,
and memberships only as required for authorization. Remove optional views and
email. Reproduce the four-actor matrix with direct queries. Fix own-write,
manager-team-read, member-own-read, and outsider-deny first. Do not proceed to
manager UI until all four are proven. Return exact SQL, tests, and results.
```

## Recovery B — Desktop auth is blocking the vertical slice

```text
The standard Supabase desktop session is not reliable within the remaining
hackathon window. Preserve SharedWorkloadSnapshotV1 and RLS semantics.

Design and implement the smallest device-pairing fallback:
- signed-in web user creates a short-lived one-time code;
- desktop exchanges it through a trusted server/Edge Function;
- returned device credential is revocable and scoped only to the user's team
  memberships and snapshot writes;
- server stores only credential hash;
- code expires and cannot be reused;
- disconnect revokes credential.

Do not fall back to a service key or unauthenticated insert endpoint. Document
prototype storage and implement the original auth path post-hackathon.
```

## Recovery C — Team Briefing is unstable

```text
Remove the live model dependency from the critical demo. Build a deterministic
Team Briefing from the existing team aggregate and risk helpers using fixed,
honest templates with evidence references. Keep the OpenAI route behind a
feature flag and demonstrate it only if its structured output passes. The
manager dashboard must remain complete without AI.
```

## Recovery D — Authenticated private download is blocked

```text
Keep account-required navigation and the authenticated /download page. Replace
the private artifact with the public source ZIP and guided install.command link.
State clearly that the official product journey requires an account but the
open repository remains publicly viewable. Do not pretend the source is gated.
```

## Recovery E — Deadline triage

```text
It is inside the final 24 hours. Read the P0 definition and current taskboard.
Mark every task DONE, BLOCKED, or CUT based on evidence. Remove or hide every
incomplete UI path. Preserve only:
- auth;
- team/invite;
- account/download page;
- desktop preview/manual sync;
- RLS manager dashboard;
- revoke/delete;
- synthetic demo;
- build/provenance/submission.

Do not add features. Fix only blockers, broken core UX, privacy/security issues,
and submission documentation. Produce the exact final critical path and owner
for every remaining hour.
```

---

# Prompt result scorecard

Score every agent result from 0–2 in each dimension:

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| Scope | Missed/expanded | Mostly aligned | Exact objective and exclusions honored |
| Evidence | Claims only | Partial commands/screens | Reproducible gates and manual proof |
| Privacy | Unclear/leaky | Main boundary honored | Boundary proven by tests and review |
| Integration | Isolated artifact | Requires manual assumptions | Uses frozen contracts and clean interfaces |
| UX | Prototype-only | Functional | Coherent loading/error/empty/consent states |
| Documentation | Missing | Basic | Setup, data flow, limitations, provenance current |

A result scoring below 10/12 does not merge without an explicit integrator decision. Any privacy score of 0 is an automatic rejection.
