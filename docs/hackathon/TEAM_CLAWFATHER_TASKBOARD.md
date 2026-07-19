# Team Clawfather — Delivery Taskboard (Prompt 0B task ledger; upgrades Prompt 0A synthesis)

**Window:** Sunday, July 19 → Tuesday, July 21, 2026. The blueprint and execution board were framed for a Saturday, July 18 start; one calendar day is gone, so Phase 0 (contract freeze) and Phase 1 (foundations) are compressed into today, July 19. Scope, cut lists, and gates are unchanged.
**Fixed times (from `docs/WEEKFORM_HACKATHON_EXECUTION_BOARD.md`):** feature freeze Monday July 20, 9:00 PM EDT · internal submission Tuesday July 21, 3:00 PM EDT · hard deadline Tuesday July 21, 8:00 PM EDT (5:00 PM PDT) — the hard deadline is not the working target.
**Sources:** `docs/WEEKFORM_TEAM_CLAWFATHER_HACKATHON_BLUEPRINT.md` (sections 10–16), `docs/WEEKFORM_HACKATHON_EXECUTION_BOARD.md`, `docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK.md` (Prompt 0B, "How to run this pack"), `docs/hackathon/TEAM_CLAWFATHER_ARCHITECTURE.md`, `TEAM_CLAWFATHER_PRODUCT_CONTRACT.md`, `TEAM_CLAWFATHER_DECISIONS.md`, `TEAM_CLAWFATHER_BASELINE.md`.

## Success metric

The build is winning when this loop works twice from clean synthetic state (`docs/WEEKFORM_HACKATHON_EXECUTION_BOARD.md`): manager account → team → invite → member account → authenticated download → desktop login → exact privacy preview → manual sync → manager dashboard → grounded briefing/fallback → member removes data → manager view honors it.

## Ledger conventions (Prompt 0B)

Every task below carries eleven fields: **ID/title · Outcome (user-visible) · Owns (exact writable paths) · Read-only · Depends · Est (blueprint §12 focused hours, execution-board refinement where they differ) · Model (blueprint §13.3 Codex effort posture) · Gates (automated) · Evidence (manual) · Rollback/fallback · Status.**

- Status legend (execution board): `READY` · `BLOCKED` · `ACTIVE` · `REVIEW` · `DONE` (acceptance evidence attached) · `CUT`.
- **Path/script verification (done July 19, 2026 via `ls` and `cat package.json`):** all four high-conflict desktop files exist at the cited paths; `packages/domain/src/` contains only `models.ts` and `taxonomy.ts` (so `cloud.ts` is a **new file**); `packages/inference/src/sharedSnapshot.ts`, `apps/desktop/src/services/cloudClient.ts`, `apps/desktop/src/hooks/useCloudSync.ts`, `apps/desktop/src/components/settings/CloudAccountPanel.tsx`, `apps/web/**`, and any `supabase/migrations/*_team_cloud_v1.sql` are **new files** (no `apps/web` exists). Existing npm scripts: `build`, `dev`, `demo`, `preview`, `desktop:dev`, `desktop:build`, `test:simulator`, `pricing:check` (+ pricing refresh variants). **`web:build`, `web:dev`, and `test:cloud` did not exist at that check; they now exist (added July 19, 2026: `test:cloud` = `tsx --test packages/inference/src/*.test.ts`, `web:dev`, and `web:build` = `npm --prefix apps/web run build`)** — WEB-01 and CONTRACT-03 created them; before that the only real gates were `npm run build` (includes `tsc -b` typecheck), `npm run test:simulator`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `CARGO_BUILD_JOBS=2 npm run desktop:build`.
- Model shorthand (blueprint §13.3): **Sol high/max** = GPT-5.6 Sol high or max effort (architecture, privacy, RLS, desktop integration, final review) · **Sol med** = GPT-5.6 Sol medium (product UI/features) · **Terra** = GPT-5.6 Terra (narrow tests, docs, fixtures, mechanical follow-up) · **Luna** = GPT-5.6 Luna (fast low-risk checks). Verify availability in the installed Codex client before assigning.

---

## 1. Dependency-ordered task ledger (July 19 → July 21)

Task IDs match `docs/WEEKFORM_HACKATHON_EXECUTION_BOARD.md`. The blueprint §12 work breakdown uses an older planning ID scheme; this ledger is **authoritative** for IDs, estimates, and status wherever the two differ (estimate deltas are noted inline as "§12 X-NN says …"). Blueprint §12 → ledger ID mapping:

| Blueprint §12 | This ledger | Blueprint §12 | This ledger |
|---|---|---|---|
| P0-01 / P0-02 | DIR-01 / DIR-02 | M-01 | DESK-01 |
| P0-03 | ENV-01 (ENV-02 is ledger-only) | M-02 | DESK-02 + DESK-03 |
| C-01 | DB-01 + DB-02 | M-03 | DESK-04 |
| C-02 | DB-03 | M-04 | DESK-05 |
| C-03 | DB-04 | I-01 | INT-01 + INT-02 + INT-03 |
| D-01 / D-02 / D-03 | CONTRACT-01 / -02 / -03 | I-02 | PRIV-01 + PRIV-02 |
| W-01…W-05 | WEB-01…WEB-05 | P1-01 / P1-02 | SYNC-01/02/03 |
| W-06 | DASH-01 + DASH-02 | P1-03 / P1-04 | AI-01/02/03 |
| W-07 | DASH-03 | P1-05 | INV-EMAIL (P1, first overrun cut) |
| W-08 | WEB-06 | Q-01 / Q-02 / Q-03 | QA-01 / QA-02 / QA-03 |
| R-01 / R-02 | REL-01 / REL-02 | R-03 | DB-04 seed + reset polish |
| R-04 | SUB-01 + SUB-02 + SUB-03 + SUB-04 | | |

### Sunday, July 19 — contract freeze + foundations + vertical-slice start (compressed Phases 0–2)

| ID | Title | Owner/agent | Depends on | Est. | Status |
|---|---|---|---|---:|---|
| DIR-01 | Freeze P0/P1/P2 and demo story | Program Director | — | 1.0h | DONE |
| DIR-02 | Freeze cloud field names and share levels | Program Director | DIR-01 | 1.0h | DONE |
| ENV-01 | Supabase project + env inventory | Cloud Lead (human) | DIR-01 | 0.5h | READY |
| ENV-02 | Empty Vercel web shell | Web Lead (human) | DIR-01 | 0.5h | READY |
| CONTRACT-01 | Cloud domain types | Contract Agent | DIR-02 | 1.0h | DONE |
| CONTRACT-02 | Allowlist snapshot builder + preview + fingerprint | Contract Agent | CONTRACT-01 | 2.0h | DONE |
| CONTRACT-03 | Ten privacy/contract tests | Contract Agent | CONTRACT-02 | 1.5h | DONE |
| DB-01 | Team-cloud migration with RLS in the same migration | Cloud Agent | DIR-02, ENV-01 | 2.0h | REVIEW |
| DB-02 | RLS policies/helpers/indexes verified | Cloud Agent | DB-01 | 2.0h | REVIEW |
| DB-03 | `create_team_with_owner` + `accept_team_invite` RPCs | Cloud Agent | DB-02 | 1.5h | REVIEW |
| DB-04 | Synthetic team seed | Cloud Agent | DB-01 | 1.0h | REVIEW |
| WEB-01 | Scaffold Next.js + `@supabase/ssr` | Web Agent | ENV-01 | 1.5h | DONE |
| WEB-02 | Landing/account CTA/privacy story | Web Agent | WEB-01 | 2.5h | DONE |
| WEB-03 | Signup/login/logout/profile | Web Agent | WEB-01, DB-01 | 2.0h | REVIEW |
| WEB-04 | Role-aware onboarding / create team | Web Agent | WEB-03, DB-03 | 2.0h | REVIEW |
| WEB-05 | Invite link and accept route | Web Agent | WEB-04, DB-03 | 2.5h | REVIEW |
| DESK-00 | Desktop plan-only design | Desktop Agent | DIR-02 | 1.0h | READY |

**DIR-01 — Freeze P0/P1/P2 and demo story** — **DONE**
- Outcome: an approved product contract every agent can build against without re-litigating scope.
- Owns: `docs/hackathon/TEAM_CLAWFATHER_PRODUCT_CONTRACT.md` (exists).
- Read-only: `AGENTS.md`, blueprint §1–§3, §16; `docs/WEEKFORM_HACKATHON_EXECUTION_BOARD.md`.
- Depends: —. Est: 1.0h (§12 P0-01). Model: Sol high (architecture).
- Gates: none (docs-only; no npm script applies).
- Evidence: contract doc marked "Approved product contract" with P0/P1/P2, cut order, and the eight-step demo.
- Rollback: revert the doc; scope falls back to blueprint §3 verbatim.
- Status: **DONE** — evidence exists: `TEAM_CLAWFATHER_PRODUCT_CONTRACT.md` was produced by Prompt 0A, self-describes as "Approved product contract," and contains the full P0/P1/P2 scope (§2), demo story (§1.2), and cut order (§2.4). That is exactly the execution-board acceptance evidence ("Approved product contract"), so DONE is honest, not aspirational.

**DIR-02 — Freeze cloud field names and share levels** — **DONE**
- Outcome: implementers can name every field, table, and share level without guessing.
- Owns: `docs/hackathon/TEAM_CLAWFATHER_ARCHITECTURE.md` (exists).
- Read-only: blueprint §5.3–§5.4, §6.1; `docs/WEEKFORM_SUPABASE_SCHEMA_DRAFT.sql` (exists, 666-line draft).
- Depends: DIR-01. Est: 1.0h (execution board; blueprint §12 P0-02 says 1.5h). Model: Sol high (privacy contract).
- Gates: none (docs-only).
- Evidence: `CloudSharePolicyV1` and `SharedWorkloadSnapshotV1` field lists and share levels recorded and marked frozen.
- Rollback: revert to blueprint §5.3 as the literal contract.
- Status: **DONE** — evidence exists: `TEAM_CLAWFATHER_ARCHITECTURE.md` is headed "Status: Frozen for P0 implementation" and §2.1 records both type shapes, the three share levels, the omit-never-zero rule, and the five-table names — the execution board's required evidence for DIR-02. Any later change to these names is a §15 kill-criterion event, not an edit.

**ENV-01 — Create Supabase project and env inventory** — **READY**
- Outcome: a real project the Cloud and Web agents can point at; publishable vs. secret keys separated.
- Owns: `.env.example` (exists — add cloud variable names, never values); project ref and secrets stored outside the repo.
- Read-only: blueprint §4.1; `docs/hackathon/TEAM_CLAWFATHER_ARCHITECTURE.md`.
- Depends: DIR-01. Est: 0.5h (§12 P0-03). Model: human task (Cloud Lead); Luna at most for checklist generation.
- Gates: none; secret scan of any committed file (no keys in repo).
- Evidence: project ref recorded outside repo; `.env.example` lists desktop publishable vars separately from web/server secret vars.
- Rollback: delete/recreate the Supabase project; nothing in-repo depends on a specific ref.
- Status: READY (human-executable now).

**ENV-02 — Deploy empty Vercel web shell** — **READY**
- Outcome: a reachable preview URL exists on day one, removing deploy risk from the deadline (§15 "Deployment/domain delay").
- Owns: Vercel project settings (outside repo); no repo files beyond what WEB-01 creates.
- Read-only: `docs/hackathon/TEAM_CLAWFATHER_DECISIONS.md` D1.
- Depends: DIR-01 (can slip to just after WEB-01 without harm). Est: 0.5h. Model: human task (Web Lead); Luna.
- Gates: none yet (`npm run web:build` now exists — added July 19, 2026 — and is the gate once the shell is connected).
- Evidence: reachable preview URL.
- Rollback: none needed; fallback is submitting the preview URL instead of weekform.com (§15).
- Status: READY.

**CONTRACT-01 — Add cloud domain types** — **DONE**
- Outcome: `CloudSharePolicyV1`, `CloudMetricPolicy`, `SharedWorkloadSnapshotV1`, sync/audit types exist and typecheck; every other workstream imports one vocabulary.
- Owns: `packages/domain/src/cloud.ts` (**new file**; verified `packages/domain/src/` currently holds only `models.ts`, `taxonomy.ts`).
- Read-only: `packages/domain/src/models.ts` (exists — do not edit; §10 prefers `cloud.ts`), `docs/hackathon/TEAM_CLAWFATHER_ARCHITECTURE.md` §2.
- Depends: DIR-02 (DONE). Est: 1.0h (§12 D-01). Model: Sol high (privacy contract surface).
- Gates: `npm run build` (verified script; `tsc -b` is the typecheck — no standalone `typecheck` script exists).
- Evidence: type file matches ARCHITECTURE §2.1 field-for-field; note any deliberate deviation for Program Director sign-off.
- Rollback: delete `cloud.ts`; nothing else references it yet.
- Status: **DONE** — Verified July 19, 2026 (team lead): `packages/domain/src/cloud.ts` exists; `npm run build` exit 0.

**CONTRACT-02 — Allowlist snapshot builder + preview + fingerprint** — **DONE**
- Outcome: a pure function that is the only way data reaches the cloud; preview generated from the same object that uploads.
- Owns: `packages/inference/src/sharedSnapshot.ts` (**new file**).
- Read-only: `packages/domain/src/cloud.ts`, `packages/domain/src/models.ts`, `packages/inference/src/capacity.ts` (exists).
- Depends: CONTRACT-01. Est: 2.0h (§12 D-02). Model: Sol high (privacy-critical logic).
- Gates: `npm run build`.
- Evidence: a serialized fixture at each share level showing only allowlisted keys; builder rejects disabled/unconsented/teamless policies (blueprint §5.4 req 1–10).
- Rollback: delete the file; desktop sync (DESK-03/05) falls back to BLOCKED, not to a lesser builder — a blocklist filter is never an acceptable fallback (D5).
- Status: **DONE** — Verified July 19, 2026 (team lead): `packages/inference/src/sharedSnapshot.ts` exists; `npm run build` exit 0; behavior covered by the CONTRACT-03 tests (10/10 pass).

**CONTRACT-03 — Ten privacy/contract tests** — **DONE**
- Outcome: proof that titles/evidence/notes sentinels can never serialize and disabled metrics are omitted, not zeroed.
- Owns: `packages/inference/src/sharedSnapshot.test.ts` (**new file**); `package.json` script line only — add `test:cloud` (e.g. `tsx --test packages/inference/src/*.test.ts`, mirroring the verified `test:simulator` pattern). **`test:cloud` did not exist when this ledger was drafted; it now exists (added July 19, 2026) and runs the sharedSnapshot tests.**
- Read-only: `packages/inference/src/sharedSnapshot.ts`, blueprint §14.1 (the ten required cases).
- Depends: CONTRACT-02. Est: 1.5h (§12 D-03). Model: Terra (narrow tests).
- Gates: new `npm run test:cloud` passing; `npm run build` still green.
- Evidence: test output listing all ten §14.1 cases by name with actual exit status 0.
- Rollback: tests are additive; remove the script line and file. A red sentinel test is a stop-the-line condition, never a deletion candidate.
- Status: **DONE** — Verified July 19, 2026 (team lead): `packages/inference/src/sharedSnapshot.test.ts` exists; 10/10 tests pass via `npx tsx --test packages/inference/src/sharedSnapshot.test.ts` (now wired as `npm run test:cloud`); `npm run build` exit 0.

**DB-01 — Migration: profiles/teams/memberships/invites/snapshots, RLS in the same migration** — **REVIEW**
- Outcome: the five-table team-cloud schema exists with RLS enabled at creation — never "later."
- Owns: `supabase/migrations/<timestamp>_team_cloud_v1.sql` (**new file**).
- Read-only: `docs/WEEKFORM_SUPABASE_SCHEMA_DRAFT.sql` (exists — apply/review, don't rewrite; ARCHITECTURE §1), `supabase/migrations/202607180001_span_simulator.sql` (exists — unrelated Span Simulator artifact, do not touch or extend), `supabase/tests/span_simulator_rls.sql` (exists — style reference only).
- Depends: DIR-02 (DONE), ENV-01. Est: 2.0h (execution board; §12 C-01 gives 3.0h for migration+RLS combined across DB-01/DB-02). Model: Sol high (RLS).
- Gates: migration applies cleanly to the ENV-01 project (`supabase db push` or SQL editor apply, exit 0); no npm gate exists for SQL — record the apply command and status.
- Evidence: reviewed SQL diff against the draft; `select relrowsecurity` confirms RLS on all five tables; anonymous select denied everywhere (ARCHITECTURE T10).
- Rollback: `drop schema`-level down-migration or project reset; greenfield, so destructive rollback is safe pre-seed.
- Status: **REVIEW** — Verified July 19, 2026 (team lead): `supabase/migrations/202607190001_team_cloud_v1.sql` exists (723 lines, all five tables with RLS in the same migration). SQL-review only — Supabase CLI and psql are not installed, so the migration has not been applied; the apply gate is still pending ENV-01.

**DB-02 — RLS policies, helper functions, indexes verified** — **REVIEW**
- Outcome: the four-actor authorization model actually holds in Postgres.
- Owns: same migration file as DB-01 (or a follow-up migration in `supabase/migrations/`); `supabase/tests/team_cloud_rls.sql` (**new file**, styled after `supabase/tests/span_simulator_rls.sql`).
- Read-only: ARCHITECTURE §1.2, §4 (T1–T10); blueprint §6.2.
- Depends: DB-01. Est: 2.0h. Model: Sol high (RLS).
- Gates: RLS test SQL executes with expected allow/deny per statement (exit 0); record actual output.
- Evidence: four-actor matrix scaffold log (Manager A / Member B / Member C / Outsider D) with per-statement results.
- Rollback: policies are in-migration; fix-forward in a new migration. If unfixable near deadline: demo-only server routes with strict server checks — never unprotected tables (§15).
- Status: **REVIEW** — Verified July 19, 2026 (team lead): `supabase/tests/team_cloud_rls.sql` and `docs/hackathon/TEAM_CLAWFATHER_RLS_MATRIX.md` exist. SQL-review only — no Supabase CLI/psql installed, so the RLS test script has not been executed; the four-actor allow/deny log is still pending.

**DB-03 — `create_team_with_owner` and `accept_team_invite` RPCs** — **REVIEW**
- Outcome: atomic team creation and one-time, hashed, expiring invite acceptance.
- Owns: migration follow-up in `supabase/migrations/` (same Cloud Agent worktree).
- Read-only: ARCHITECTURE §1.3; DECISIONS D3 (token_hash, 72h expiry, one-time use).
- Depends: DB-02. Est: 1.5h (§12 C-02). Model: Sol high.
- Gates: SQL apply exit 0; invite T4 replay/expiry/wrong-email cases deny.
- Evidence: positive accept + negative replay/expired/wrong-email results captured.
- Rollback: drop the functions; fallback is seed-created memberships for the demo (D3 reversal trigger) — never hand-edited production tables mid-demo.
- Status: **REVIEW** — Verified July 19, 2026 (team lead): both RPCs plus `private.handle_new_user()` exist in `supabase/migrations/202607190001_team_cloud_v1.sql` (definitions at lines 338/377/409, with `revoke … from public` and `grant execute … to authenticated`). SQL-review only — no Supabase CLI/psql installed, so apply/replay/expiry cases have not been executed.

**DB-04 — Synthetic team seed** — **REVIEW**
- Outcome: Northstar Analytics with Maya Chen (manager), Jordan Lee, Sam Rivera exists and can be reset so the golden path runs twice.
- Owns: `supabase/seed/` or `scripts/` seed+reset script (**new file(s)**); demo credentials in a local **git-ignored** file only.
- Read-only: blueprint §6.4; product contract (synthetic data only).
- Depends: DB-01 (DB-03 for invite fixtures). Est: 1.0h (§12 C-03; R-03 reset polish adds 1.5h later). Model: Terra (fixtures).
- Gates: seed then reset then seed again succeeds (record commands + exit 0).
- Evidence: three identities visible; zero real names/credentials/calendar text anywhere.
- Rollback: drop seed rows; reset script is itself the rollback.
- Status: **REVIEW** — Verified July 19, 2026 (team lead): `supabase/seed.sql` exists; grep confirmed no secrets/service keys/project URLs in committed files. SQL-review only — the seed has not been executed against a live project (no Supabase CLI/psql), so the seed→reset→seed gate is still pending.

**WEB-01 — Scaffold Next.js + `@supabase/ssr`** — **DONE**
- Outcome: `apps/web` exists, builds, deploys to the ENV-02 shell.
- Owns: `apps/web/**` (**new directory** — verified `apps/` contains only `desktop`); root `package.json` **script lines only**: add `web:dev` and `web:build` (verified absent at the original check; both now exist — added July 19, 2026, `web:build` = `npm --prefix apps/web run build`; DECISIONS D1 — the existing root `build` desktop gate is unchanged).
- Read-only: all of `apps/desktop/**`, `packages/**`; existing `package.json` scripts.
- Depends: ENV-01 for real env values (scaffold can start now with placeholder env; that is why the execution board lists it READY). Est: 1.5h (§12 W-01). Model: Sol med (product scaffold).
- Gates: new `npm run web:build` exit 0 **and** existing `npm run build` still exit 0 (proves the desktop gate untouched).
- Evidence: deployed preview URL renders.
- Rollback: delete `apps/web` and the two script lines; desktop untouched by construction.
- Status: **DONE** — Verified July 19, 2026 (team lead): `apps/web/` exists (Next.js 16 App Router, TypeScript strict, `@supabase/ssr`); `npm run typecheck` and `npm run build` inside `apps/web` both exit 0; root `npm run build` exit 0.

**WEB-02 — Landing/account CTA/privacy story** — **DONE**
- Outcome: a landing page that says what managers see and what teammates control, with the honest prototype disclosure (product contract §3.2 item 10).
- Owns: `apps/web/app/(marketing)/**` or equivalent landing routes (**new files** inside WEB-01's scaffold).
- Read-only: product contract §3 (binding copy constraints), desktop design tokens for the Geist language (D1).
- Depends: WEB-01. Est: 2.5h (§12 W-02). Model: Sol med (UI).
- Gates: `npm run web:build`.
- Evidence: responsive screenshots at 1280px and mobile (blueprint §14.4).
- Rollback: reduce to a minimal hero + auth links; landing depth is never on the critical path.
- Status: **DONE** — Verified July 19, 2026 (team lead): landing route `/` exists in `apps/web` and `npm run build` inside `apps/web` exit 0.

**WEB-03 — Signup/login/logout/profile** — **REVIEW**
- Outcome: a user can create the account that both web and desktop will use.
- Owns: `apps/web/app/(auth)/**`, auth callback route, profile page (**new files**).
- Read-only: `packages/domain/src/cloud.ts`; ARCHITECTURE §1.1 (`profiles` has no role column).
- Depends: WEB-01, DB-01. Est: 2.0h (execution board; §12 W-03 says 2.5h). Model: Sol med.
- Gates: `npm run web:build`; unauthenticated protected-route redirect check (blueprint §14.4).
- Evidence: auth smoke — signup, login, logout, session refresh captured.
- Rollback: Supabase-hosted auth UI as a stopgap is not planned; fix-forward — auth is on the critical path.
- Status: **REVIEW** — Verified July 19, 2026 (team lead): `/login`, `/signup`, `/auth/callback`, `/auth/error`, and `/dashboard` routes exist and `apps/web` builds exit 0. Auth flows are implemented but have not been exercised against a live Supabase project (no env configured), so the auth smoke evidence is still pending.

**WEB-04 — Role-aware onboarding / create team** — **REVIEW**
- Outcome: a manager creates "Northstar Analytics" and holds an owner membership (team memberships, never global roles).
- Owns: `apps/web/app/(app)/onboarding/**`, team-creation route calling `create_team_with_owner` (**new files**).
- Read-only: ARCHITECTURE §1 (role placement rule — stop-the-line if violated).
- Depends: WEB-03, DB-03. Est: 2.0h (§12 W-04). Model: Sol med.
- Gates: `npm run web:build`.
- Evidence: owner membership row exists after the flow; member sees member onboarding.
- Rollback: seed-created team for the demo (D3 fallback).
- Status: **REVIEW** — Implemented July 19, 2026 (runbook Prompt 4). Actual paths differ from the planned `(app)/onboarding/**`: team creation lives in `apps/web/app/teams/actions.ts` (`createTeam` server action calling `create_team_with_owner`) surfaced from `/dashboard`, which also lists the user's teams and role per team. Gates green: `npm run web:build` exit 0, `apps/web` typecheck exit 0. Owner-membership evidence awaits a live Supabase stack (same limitation as DB-01…DB-03).

**WEB-05 — Invite link and accept route** — **REVIEW**
- Outcome: manager copies an invite URL; a second account accepts and gains an active membership.
- Owns: `apps/web/app/(app)/invite/**` + server route generating token/storing `token_hash` (**new files**).
- Read-only: DECISIONS D3; ARCHITECTURE T4/T5.
- Depends: WEB-04, DB-03. Est: 2.5h (§12 W-05). Model: Sol med.
- Gates: `npm run web:build`; T4 replay/expired/wrong-email deny.
- Evidence: second synthetic account joins via the link.
- Rollback: copy-link only (email is P1 INV-EMAIL); at worst, seeded memberships (D3).
- Status: **REVIEW** — Implemented July 19, 2026 (runbook Prompt 4). Actual paths: `apps/web/app/teams/[teamId]/` (InviteForm posting to the `createInvite` server action, which generates a base64url token, stores only its SHA-256 in `team_invites`, and returns a copyable URL — the raw token is never persisted) and `apps/web/app/invite/` (accept page; wrong-email/expired/reused/already-member/missing-token copy via `mapAcceptInviteError`). Copy-link only, per rollback plan. Pure helpers proven: `npm run test:web` (new root script) 13/13, incl. token shape/hash vector/error-mapping cases; `npm run web:build` exit 0. T4 replay/expired/wrong-email deny cases exist in `supabase/tests/team_cloud_rls.sql` but are unexecuted (no local stack).

**DESK-00 — Desktop plan-only: hook/service/persistence design** — **READY**
- Outcome: the sole Desktop Agent has a written design before touching any high-conflict file, so the later write window is short.
- Owns: a planning note under `docs/hackathon/` (**new file**, docs only). **Writes no product code and none of the four high-conflict files.**
- Read-only: `apps/desktop/src/App.tsx`, `apps/desktop/src/services/localStore.ts`, `apps/desktop/src/components/settings/SetupScreen.tsx`, `apps/desktop/src/components/shell/ScreenRouter.tsx`, `apps/desktop/src/lib/types.ts`, `apps/desktop/src/hooks/usePersistence.ts` (all verified to exist); BASELINE §5.B.
- Depends: DIR-02 (DONE). Est: 1.0h. Model: Sol high (desktop integration planning).
- Gates: none (plan-only).
- Evidence: written design naming the new `SettingsTab`, `PersistedAppState` extension, and prop threading — reviewed by Integrator.
- Rollback: discard the note.
- Status: **READY** (unblocked by DIR-02 DONE; runs in Codex Plan mode).

**End-of-day gate (July 19):** contract merged; web signup/login works; RLS denies anonymous access; builder tests prove sensitive keys cannot enter the payload; no implementation team is waiting on an unnamed field/table/role.

### Monday, July 20 (daytime) — desktop slice + dashboards + privacy proof

| ID | Title | Owner/agent | Depends on | Est. | Status |
|---|---|---|---|---:|---|
| WEB-06 | Authenticated download route/page | Web Agent | WEB-03 | 1.5h | REVIEW |
| DESK-01 | Desktop cloud account service/auth | Desktop Agent | WEB-03, CONTRACT-01, DESK-00 | 2.5h | REVIEW |
| DESK-02 | Account & Sharing tab and policy editor | Desktop Agent | DESK-01 | 3.0h | REVIEW |
| DESK-03 | Exact preview and consent | Desktop Agent | DESK-02, CONTRACT-02 | 1.5h | REVIEW |
| DESK-04 | Persist/parse/reset/export cloud state | Desktop Agent | DESK-01 | 3.0h | DONE |
| DESK-05 | Manual RLS snapshot sync + local audit | Desktop Agent | DESK-03, DESK-04, DB-02 | 3.0h | REVIEW |
| DASH-01 | Manager latest-snapshot query + aggregates | Web Agent | WEB-04, DESK-05 | 2.0h | REVIEW |
| DASH-02 | Manager dashboard, member cards, states | Web Agent | DASH-01 | 2.5h | REVIEW |
| DASH-03 | Member personal dashboard | Web Agent | WEB-03, DESK-05 | 1.5h | REVIEW |
| PRIV-01 | Disable metric, resync, show omission | Integrator | DESK-05, DASH-02 | 1.0h | BLOCKED |
| PRIV-02 | Delete cloud history / disconnect | Desktop + Web | DESK-05, DASH-02 | 1.5h | BLOCKED |
| QA-01 | Four-actor negative RLS matrix | Privacy Critic | DB-02, DASH-01 | 2.0h | REVIEW (static half done; live proof env-blocked) |
| QA-02 | Audit serialized payload for forbidden data | Privacy Critic | CONTRACT-03, DESK-05 | 1.0h | DONE (code-level) — July 19, 2026 |

**WEB-06 — Authenticated download route/page** — **REVIEW**
- Outcome: signed-in members reach the official Mac artifact via a short-lived signed URL; signed-out users are denied.
- Owns: `apps/web/app/(app)/download/**` + signed-URL server route (**new files**); private Supabase Storage bucket config.
- Read-only: DECISIONS D4; `scripts/install.command` (exists — the guided source installer that may be the artifact).
- Depends: WEB-03. Est: 1.5h (§12 W-08). Model: Sol med.
- Gates: `npm run web:build`; signed URL expiry check (blueprint §14.4).
- Evidence: signed-in download succeeds; signed-out request denied; URL dies after expiry.
- Rollback: authenticated page linking the public source ZIP with the limitation stated honestly — never fake enforcement (D4).
- Status: **REVIEW** — Verified July 19, 2026 (team lead): `/download` route exists in `apps/web` and the app builds exit 0. Signed-in/signed-out/expiry behavior has not been exercised against a live Supabase project (no env configured), so the gate evidence is still pending.

**DESK-01 — Desktop cloud account service/auth** — **REVIEW**
- Outcome: the same email/password account signs in on the Mac; session persists across restart (unencrypted prototype storage, disclosed).
- Owns: `apps/desktop/src/services/cloudClient.ts` (**new file**), `apps/desktop/src/hooks/useCloudSync.ts` (**new file**, skeleton), plus the Desktop Agent's first touches of `apps/desktop/src/App.tsx` (state composition). **Single-writer rule in force from here through DESK-05/PRIV-02/SYNC-xx: this one Desktop Agent is the only writer of `App.tsx`, `localStore.ts`, `SetupScreen.tsx`, `ScreenRouter.tsx`.**
- Read-only: `packages/domain/src/cloud.ts`, `apps/desktop/src/services/aiProviders.ts` (service-pattern reference), `apps/desktop/src-tauri/src/lib.rs` (avoid for P0 — §10).
- Depends: WEB-03 (an account must exist), CONTRACT-01, DESK-00. Est: 2.5h (§12 M-01). Model: Sol high (desktop integration).
- Gates: `npm run build`; `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` only if any native file changes.
- Evidence: same synthetic account signed in on desktop; app still starts signed-out and sharing-off; existing demo (`npm run demo`) still works with no Supabase env.
- Rollback: feature-flag the cloud UI off; the local-only app must keep working (D-register cross-cutting constraint). Auth fallback: one-time device-pairing code (D2).
- Status: **REVIEW** — Implemented July 19, 2026 (runbook Prompt 5, sole Desktop Agent). `apps/desktop/src/services/cloudClient.ts` and `apps/desktop/src/hooks/useCloudAccount.ts` exist (plus `services/cloudPolicy.ts`/`cloudStore.ts` and `hooks/useCloudSync.ts`, manual-only); `App.tsx` composes the cloud state. Gates green: `npm run test:desktop-cloud` 12/12 (incl. defensive parsers), root `npm run build` exit 0; the app still starts signed-out and sharing-off. Live sign-in of the synthetic account has not been exercised (no Supabase CLI/psql or live stack on this machine), so the desktop-auth evidence is still pending.

**DESK-02 — Account & Sharing tab and policy editor** — **REVIEW**
- Outcome: a new settings tab where sharing is off by default and every metric has its own toggle.
- Owns: `apps/desktop/src/components/settings/CloudAccountPanel.tsx` (**new file**), `apps/desktop/src/lib/types.ts` (extend `SettingsTab` union at line 2 — low conflict), `apps/desktop/src/components/settings/SetupScreen.tsx` (mount panel — high conflict, same sole writer), `apps/desktop/src/App.tsx` / `apps/desktop/src/components/shell/ScreenRouter.tsx` only as needed to thread props (same sole writer).
- Read-only: product contract §3.2 (binding copy rules), BASELINE §5.B (model as a SettingsTab, not a new Screen).
- Depends: DESK-01. Est: 3.0h (execution board; §12 M-02 says 4.0h). Model: Sol high (high-conflict files) with Sol med acceptable for the isolated panel component.
- Gates: `npm run build`.
- Evidence: fresh profile screenshot showing sharing off by default; all §5.2 metric toggles present; project allowlist empty by default.
- Rollback: remove the tab entry; panel file is additive.
- Status: **REVIEW** — Implemented July 19, 2026 (runbook Prompt 5). `apps/desktop/src/components/settings/CloudAccountPanel.tsx` exists and is mounted from `SetupScreen.tsx`; `lib/types.ts` `SettingsTab` extended; props threaded via `App.tsx`/`ScreenRouter.tsx` (sole-writer rule held). Sharing is off by default with per-metric toggles in `services/cloudPolicy.ts` (12/12 `npm run test:desktop-cloud`; root `npm run build` exit 0). The fresh-profile screenshot evidence is not yet captured, so this stays in REVIEW.

**DESK-03 — Exact preview and consent** — **REVIEW**
- Outcome: the member sees the exact payload object before first sync and must check "I reviewed what will be shared with this team."
- Owns: preview/consent UI inside `CloudAccountPanel.tsx` (same writer).
- Read-only: `packages/inference/src/sharedSnapshot.ts` (the preview must be generated from the same object that uploads — §5.4 req 10).
- Depends: DESK-02, CONTRACT-02. Est: 1.5h. Model: Sol high (consent is the product thesis).
- Evidence: side-by-side proof preview JSON === uploaded object (hash match); consent timestamp recorded in policy.
- Gates: `npm run build`.
- Rollback: none acceptable — exact preview is on the never-cut list (product contract §2.4).
- Status: **REVIEW** — Implemented July 19, 2026 (runbook Prompt 5). Preview/consent UI lives in `apps/desktop/src/components/settings/SharePreview.tsx` + `CloudAccountPanel.tsx`, rendered from the same allowlist snapshot object the sync path uploads (allowlist-only row mapping proven in `npm run test:desktop-cloud`, 12/12; root `npm run build` exit 0). The side-by-side preview-hash-vs-uploaded-row proof requires a live sync against a real Supabase project (not available on this machine), so that evidence item is still pending.

**DESK-04 — Persist/parse/reset/export cloud state** — **DONE**
- Outcome: cloud policy/sync state survives restart; old local state hydrates unchanged; reset clears cloud session; export excludes tokens.
- Owns: `apps/desktop/src/services/localStore.ts` (extend `PersistedAppState` at line 126 with defensive parsing + migration — high conflict, same sole writer), `apps/desktop/src/lib/dataExport.ts` (exists — exclude tokens).
- Read-only: `AGENTS.md` compatibility rules for legacy `clear-capacity.*` keys (rename only with migration + rollback).
- Depends: DESK-01. Est: 3.0h (§12 M-03). Model: Sol high (persistence/migration).
- Gates: `npm run build`.
- Evidence: pre-cloud persisted state loads cleanly; reset clears session+policy; export file contains no token.
- Rollback: migration is additive with defensive defaults; reverting the fields restores prior shape.
- Status: **DONE** — Verified July 19, 2026 (runbook Prompt 5). `apps/desktop/src/services/localStore.ts` extends `PersistedAppState` with defensive parsing (pre-cloud state hydrates unchanged), `services/cloudStore.ts` holds cloud session/policy persistence with reset, and `lib/dataExport.ts` excludes tokens from export/backup. Gates green: `npm run test:desktop-cloud` 12/12 — including the defensive-parser and backup-excludes-tokens cases — and root `npm run build` exit 0. This task's evidence is fully local; no live-stack dependency.

**DESK-05 — Manual RLS snapshot sync + local audit** — **REVIEW**
- Outcome: Sync Now pushes one authenticated, RLS-authorized snapshot row and writes a local audit event (payload hash, never the payload).
- Owns: sync path in `apps/desktop/src/services/cloudClient.ts` + `hooks/useCloudSync.ts`; `apps/desktop/src/lib/audit.ts` (exists — cloud audit helpers, §8.7 copy); final `App.tsx` wiring (same sole writer).
- Read-only: blueprint §8.4 (the full verification chain), ARCHITECTURE §2.
- Depends: DESK-03, DESK-04, DB-02. Est: 3.0h (execution board; §12 M-04 says 3.5h). Model: Sol high.
- Gates: `npm run build`; `npm run test:cloud`.
- Evidence: one row inserted through RLS as the synthetic member (row ID captured); receipt toast; audit event uses §8.7 language ("Shared N approved metrics…"), never "all data synced."
- Rollback: manual sync is never-cut; on failure, fix-forward or fall back to the pairing-code auth path (D2) — the sync chain itself has no lesser substitute.
- Status: **REVIEW** — Implemented July 19, 2026 (runbook Prompt 5). Manual Sync Now path in `apps/desktop/src/services/cloudClient.ts` + `hooks/useCloudSync.ts` (manual-only — no hourly scheduler; SYNC-01/02/03 remain BLOCKED), cloud audit helpers in `lib/audit.ts`, final `App.tsx` wiring landed under the sole writer. Gates green: `npm run test:desktop-cloud` 12/12 (allowlist-only row mapping, `clientSnapshotId` reuse on retry); root `npm run build` exit 0. Not yet done: the actual RLS-authorized row insert as the synthetic member (no Supabase CLI/psql or live stack on this machine), so the row-ID/receipt evidence — the Monday-evening (July 20) P0 keystone gate — is still pending. **This is the P0 keystone: Monday-evening (July 20) exit gate.**

**DASH-01 — Manager latest-snapshot query and team aggregates** — **REVIEW**
- Outcome: manager sees the latest snapshot per active member, via RLS-scoped reads only.
- Owns: `apps/web/lib/` query layer + deterministic aggregate helpers (**new files**; medians/ranges/counts — never summed "team capacity," D6).
- Read-only: `latest_team_snapshots` view definition (security_invoker — ARCHITECTURE §1.3).
- Depends: WEB-04, DESK-05. Est: 2.0h (§12 W-06 covers DASH-01+02 at 4.0h). Model: Sol med with Sol high review of the query scoping.
- Gates: `npm run web:build`.
- Evidence: manager account sees the member row; member C and outsider D queries return zero rows (spot-check ahead of QA-01).
- Rollback: query the table directly if the view misbehaves (ARCHITECTURE §1.3 fallback).
- Status: **REVIEW** — Implemented July 19, 2026 (runbook Prompt 6). Query layer in `apps/web/lib/snapshots.ts`; deterministic aggregate helpers in `apps/web/lib/workload.ts` (medians + ranges, never a summed "team capacity" — D6 honored). Gates green: `npm run test:web` 24/24 (11 workload tests + the 13 Prompt 4 invite-helper tests); `npm run web:build` exit 0 (10 routes). The manager-sees/member-C-and-outsider-D-see-nothing spot-check requires a live Supabase stack (none on this machine), so that evidence is still pending ahead of QA-01.

**DASH-02 — Manager dashboard, member cards, partial/stale/not-shared states** — **REVIEW**
- Outcome: honest team view — freshness, share level, explicit "Not shared"; missing is never rendered as zero or as poor performance.
- Owns: `apps/web/app/(app)/team/**` dashboard UI (**new files**).
- Read-only: product contract §3.2 constraints 1–10 (binding); D6.
- Depends: DASH-01. Est: 2.5h. Model: Sol med (UI) with product-contract copy review.
- Gates: `npm run web:build`.
- Evidence: screenshots of populated, stale, partial-share, not-shared, and empty states.
- Rollback: if the view reads as surveillant in rehearsal, drop member cards to team-level aggregates only (§15 / D6 reversal trigger).
- Status: **REVIEW** — Implemented July 19, 2026 (runbook Prompt 6). Actual path differs from the planned `(app)/team/**`: the manager dashboard lives in `apps/web/app/teams/[teamId]/page.tsx` — member cards with freshness, share level, explicit "Not shared"; stale/not-shared is never rendered as zero or as poor performance; the low-headroom prototype threshold is labeled as such; no leaderboards or rankings. Gates green: `npm run test:web` 24/24; `npm run web:build` exit 0 (10 routes). The populated/stale/partial/not-shared/empty state screenshots require a live stack with seeded data and are not yet captured.

**DASH-03 — Member personal dashboard** — **REVIEW**
- Outcome: a member sees exactly (and only) their own latest shared snapshot — what the team can see about them.
- Owns: `apps/web/app/(app)/me/**` (**new files**).
- Read-only: RLS own-rows policy semantics.
- Depends: WEB-03, DESK-05. Est: 1.5h (execution board; §12 W-07 says 2.0h). Model: Sol med.
- Gates: `npm run web:build`.
- Evidence: member account shows own snapshot; no other member visible.
- Rollback: cut to a simple "what you last shared" JSON rendering; own-data transparency stays.
- Status: **REVIEW** — Implemented July 19, 2026 (runbook Prompt 6). Actual path differs from the planned `(app)/me/**`: the member view lives in `apps/web/app/dashboard/page.tsx`, showing the member's own latest shared snapshot only (RLS own-rows reads via `apps/web/lib/snapshots.ts`). Gates green: `npm run test:web` 24/24; `npm run web:build` exit 0. The live proof that a member account sees only its own snapshot (four-account matrix) has not been run — no live Supabase stack on this machine.

**PRIV-01 — Disable metric, resync, show omission** — **BLOCKED** (DESK-05, DASH-02)
- Outcome: the demo's revocation beat — manager sees "Not shared" after the member narrows scope.
- Owns: nothing new — an integration verification task; fixes route to the owning task's files (desktop fixes via the sole Desktop Agent only).
- Read-only: everything.
- Depends: DESK-05, DASH-02. Est: 1.0h. Model: Sol high (Integrator).
- Gates: `npm run build`, `npm run web:build`, `npm run test:cloud` all green after any fix.
- Evidence: before/after screenshots — metric present, then "Not shared" after resync.
- Rollback: none acceptable — revocation is never-cut (product contract §2.4).
- Status: BLOCKED.

**PRIV-02 — Delete cloud history / disconnect** — **BLOCKED** (DESK-05, DASH-02)
- Outcome: member deletes cloud snapshots / disconnects; rows are gone, scheduler stopped, manager view shows no current snapshot.
- Owns: delete/disconnect UI in `CloudAccountPanel.tsx` + `cloudClient.ts` (Desktop Agent — sole writer) and the corresponding empty-state on the web dashboard (Web Agent, `apps/web/**` only). Two owners, zero shared files.
- Read-only: RLS own-delete policy (blueprint §14.2 row "B deletes B history: Allow").
- Depends: DESK-05, DASH-02. Est: 1.5h (§12 I-02 says 2.0h). Model: Sol high.
- Gates: `npm run build`, `npm run web:build`.
- Evidence: rows verifiably gone (query as manager); sign-out/disable leaves no scheduled uploads (stop-the-line condition otherwise); audit copy "Disconnected Weekform account and stopped future uploads" (§8.7).
- Rollback: none acceptable — deletion honesty is the product thesis.
- Status: BLOCKED.

**QA-01 — Four-actor negative RLS matrix** — **REVIEW** (static half done July 19, 2026; live four-actor proof env-blocked)
- Outcome: adversarial proof the authorization model holds (T1–T10, ARCHITECTURE §4).
- Owns: findings/log only (read-only critic — separate Codex task or different-provider reviewer, §13.1); test SQL additions land via the Cloud Agent.
- Read-only: entire repo + database.
- Depends: DB-02, DASH-01. Est: 2.0h (§12 Q-01). Model: Sol high/max (adversarial review; ideally a different provider per §13.4).
- Gates: executed allow/deny log with per-statement results — an expected DENY is zero rows or an RLS error, never silent success.
- Evidence: the T1–T10 log itself; T1–T3/T6–T8 failures are stop-the-line.
- Rollback: n/a (findings task); failures block INT-01.
- Status: **REVIEW** — The static-analysis half was completed July 19, 2026 by the runbook Prompt 10 critic pass (`docs/hackathon/TEAM_CLAWFATHER_PRIVACY_CRITIC_REPORT.md`): RLS policies, security-definer RPCs, invite acceptance, and view surfaces adversarially reviewed read-only with no BLOCKER/HIGH findings. The executed T1–T10 allow/deny log still requires a live Supabase stack (no CLI/psql on this machine), so the live proof remains environment-blocked.

**QA-02 — Audit serialized payload for forbidden data** — **DONE (code-level)** — July 19, 2026
- Outcome: independent confirmation that no title/evidence/note/credential sentinel appears in any real uploaded payload.
- Owns: findings only.
- Read-only: entire repo; captured sync payloads from DESK-05.
- Depends: CONTRACT-03, DESK-05. Est: 1.0h (§12 Q-02 says 1.5h). Model: Sol high (privacy) — different provider preferred.
- Gates: sentinel grep over captured payloads + `npm run test:cloud` re-run, exit statuses recorded.
- Evidence: "no sensitive sentinel found" with the exact commands used.
- Rollback: n/a; any hit is stop-the-line.
- Status: **DONE (code-level)** — Completed July 19, 2026 as the runbook Prompt 10 critic pass, Category 1 (`docs/hackathon/TEAM_CLAWFATHER_PRIVACY_CRITIC_REPORT.md`): every serialization path (`cloud.ts` closed allowlist, `sharedSnapshot.ts` field-by-field builder, `cloudPolicy.ts` row mapper, `cloudClient.ts` request shapes, audit events, exports) spread/field-audited with NO_BLOCKING_FINDINGS, plus a secret scan over the repo. Sentinel grep over *live captured* payloads still requires a live stack; the code-level boundary is proven by review + the 10/10 `test:cloud` privacy suite.

**Monday evening gate, July 20 (blueprint Phase 2 exit):** one desktop-authenticated synthetic account uploads one derived snapshot through RLS; the manager reads it only via team role; member/outsider denial proven; payload contains no forbidden field. The vertical slice exists without AI or hourly sync.

### Monday evening, July 20 — completeness, P1 only after two P0 passes, freeze at 9:00 PM EDT

| ID | Title | Owner/agent | Depends on | Est. | Status |
|---|---|---|---|---:|---|
| INT-01 | Merge P0 in contract-first order | Integrator | All P0 implementations | 2.5h | DONE — July 19, 2026 (single-tree integration; drift audit + all runnable gates green — see `docs/hackathon/TEAM_CLAWFATHER_RELEASE_REPORT.md`) |
| INT-02 | Golden path run 1 | Integrator | INT-01 | 1.0h | BLOCKED (env) — requires live Supabase stack; sequence scripted, not executed |
| INT-03 | Golden path run 2 from reset | Integrator | INT-02 fixes | 1.0h | BLOCKED (env) — same live-stack dependency as INT-02 |
| QA-03 | Web/native accessibility smoke | UX Critic | INT-02 | 1.5h | BLOCKED (env) — depends on INT-02 live run |
| SYNC-01/02/03 (P1) | Hourly sync + catch-up + retry | Desktop Agent | DESK-05, two P0 passes | 4.0h | DONE (code-level) — July 19, 2026 via runbook Prompt 7 (`cloudScheduler.ts`, 60/60 desktop-cloud tests); live soak env-blocked |
| AI-01/02/03 (P1) | Deterministic risks → briefing route → briefing UI | Web/AI Agent | DASH-01, two P0 passes | 4.5h | DONE (fallback mode) — July 19, 2026 via runbook Prompt 8 (`briefing.ts` + route + panel); live model env-blocked |
| REL-01 | Web production build/deploy | Release Lead | INT-01 | 1.0h | REVIEW — `npm run web:build` exit 0 (12 routes / 11 static pages); deploy is an external action reserved for the operator |
| REL-02 | Desktop build/source artifact | Release Lead | INT-01 | 2.0h | REVIEW — root `npm run build` exit 0; signed/notarized desktop artifact not produced (source-build path documented on `/download`) |

**INT-01 — Merge P0 in contract-first order** — **BLOCKED** (all P0 implementations)
- Outcome: one clean integration branch where every surface uses the same frozen contract.
- Owns: integration branch (`codex/team-clawfather-integration`); conflict resolution across all files — the only context in which a second pair of hands may touch desktop files, and then serially, never concurrently with the Desktop Agent (§15 App.tsx fallback).
- Read-only: all workstream branches.
- Depends: CONTRACT-03, DB-03, DB-04, WEB-02..06, DESK-05, DASH-02, DASH-03, PRIV-01, PRIV-02, QA-01, QA-02. Est: 2.5h (§12 I-01 2.0h + slack). Model: Sol high/max (final integration; ultra/multi-agent if available — §13.3).
- Gates: `npm run build` = 0, `npm run web:build` = 0, `npm run test:cloud` = 0, `npm run test:simulator` = 0, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` = 0 if native touched. Merge order: contract → db → web → desktop → dashboards.
- Evidence: branch point + all gate exit statuses in the evidence ledger.
- Rollback: revert merge commits individually; workstream branches remain intact.
- Status: BLOCKED.

**INT-02 — Golden path run 1 (14 steps, blueprint §14.5)** — **BLOCKED** (INT-01)
- Outcome: the full loop demonstrably works once, end to end, on the integration branch.
- Owns: checklist + recording artifacts (docs/evidence only); fixes route to owning agents.
- Read-only: everything. Depends: INT-01. Est: 1.0h. Model: Sol high (Integrator).
- Gates: all INT-01 gates still green after any fix.
- Evidence: screen recording + 14-step checklist with database row IDs.
- Rollback: n/a; failures spawn fix tasks under the owning agent.
- Status: BLOCKED.

**INT-03 — Golden path run 2 from reset** — **BLOCKED** (INT-02 fixes)
- Outcome: proof of repeatability from clean synthetic state — no hand-edited database (Phase 3 exit gate).
- Owns: evidence artifacts; reset uses DB-04's script.
- Read-only: everything. Depends: INT-02 fixes. Est: 1.0h. Model: Sol high.
- Gates: reset script exit 0; all gates green.
- Evidence: independent second pass recording + checklist.
- Rollback: n/a.
- Status: BLOCKED.

**QA-03 — Web/native accessibility smoke** — **BLOCKED** (INT-02)
- Outcome: independent UX-critique proof that the golden path is operable without a mouse and readable on both surfaces before the freeze (blueprint §12 Q-03, P0).
- Owns: findings/accessibility checklist only (docs/evidence artifacts; no product files — read-only critic, §13.1); fixes route to owning agents.
- Read-only: entire repo + the INT-02 integration build (web deploy/preview and desktop dev build).
- Depends: INT-02 (blueprint Q-03 depends on I-01 = end-to-end run; must finish with fixes landed before the Monday July 20, 9:00 PM EDT feature freeze). Est: 1.5h (§12 Q-03). Model: Terra (UX critique smoke, not security-adversarial — Sol high not required; §13.3).
- Gates: none automated beyond existing ones (docs-only findings task; no npm script applies — INT-01's gates remain the build proof).
- Evidence: completed checklist covering keyboard-only navigation of the 14-step golden path on web with visible focus states, form labels, and contrast on the manager/member dashboards (blueprint §14.4), plus a desktop (Tauri native webview) smoke of Account & Sharing, preview, and Sync Now; each item pass/fail with notes.
- Rollback: n/a (findings task); blocking findings become pre-freeze fix tasks under the owning agents, and unfixed blockers are declared honestly in SUB-01.
- Status: BLOCKED.

**SYNC-01/02/03 (P1) — Hourly interval · startup catch-up/content no-op · 1/5/15 retry and cancellation** — **BLOCKED** (DESK-05 + two P0 golden-path passes)
- Outcome: honest automatic sync "while Weekform is running"; unchanged data skips (fingerprint); retries stop on sign-out/disable.
- Owns: `apps/desktop/src/hooks/useCloudSync.ts` + `services/cloudClient.ts` (same sole Desktop Agent; may touch `App.tsx` wiring).
- Read-only: blueprint §8.5–§8.6; D8.
- Depends: DESK-05, INT-03 (two P0 passes) — per exec board "P1 only after two P0 passes". Est: 1.5h + 1.0h + 1.5h (exec board; §12 P1-01/P1-02 total 4.0h). Model: Sol high (scheduler edge cases), Terra for clock-fixture tests.
- Gates: `npm run build`; timed/clock-fixture test output.
- Evidence: timed run log; unchanged-data no-op; disable cancels retry mid-backoff; same `clientSnapshotId` reused on retry.
- Rollback: **first item on the cut list** — ship manual Sync Now only with the honest label (D8 reversal trigger).
- Status: BLOCKED (P1 gate).

**AI-01/02/03 (P1) — Deterministic team risks → structured Team Briefing route → briefing UI with deterministic fallback** — **BLOCKED** (DASH-01 + two P0 passes)
- Outcome: evidence-grounded briefing citing shared metrics with coordination questions — never rankings; AI failure still yields a useful deterministic briefing.
- Owns: `apps/web/lib/teamRisks.ts` (or equivalent aggregate helpers), `apps/web/app/api/team-briefing/route.ts`, briefing UI components (**all new files**, isolated web AI surface — §13.1 AI Agent).
- Read-only: DECISIONS D7 (binding: server-side only, `OPENAI_TEAM_BRIEFING_MODEL` from env verified against current docs, structured output, absent ≠ zero, no employee comparisons); shared snapshot types.
- Depends: DASH-01, INT-03. Est: 1.5h + 2.0h + 1.0h (exec board; §12 P1-03/P1-04 total 5.0h). Model: Sol high for prompt/schema (AI-02), Sol med for UI (AI-03), Terra for fixtures (AI-01).
- Gates: `npm run web:build`; schema/prompt tests; fixture output for the deterministic path.
- Evidence: a briefing rendered from synthetic data with metric citations; forced-failure run showing the deterministic fallback; zero ranking/evaluation language (stop-the-line otherwise).
- Rollback: ship deterministic briefing only (D7 reversal trigger) — second item on the cut list.
- Status: BLOCKED (P1 gate).

**REL-01 — Web production build/deploy** — **BLOCKED** (INT-01)
- Outcome: live URL judges can open.
- Owns: Vercel production config; no product code.
- Read-only: `apps/web/**`. Depends: INT-01. Est: 1.0h (§12 R-01 1.5h). Model: Luna/Terra (mechanical).
- Gates: `npm run web:build` exit 0 in CI/deploy; deploy log.
- Evidence: live URL + build output.
- Rollback: submit the Vercel preview URL (§15 / D1).
- Status: BLOCKED.

**REL-02 — Desktop build/source artifact** — **BLOCKED** (INT-01)
- Outcome: installable ZIP or documented guided source installer for the download gate.
- Owns: build artifacts; `scripts/install.command` (exists) packaging notes; private Storage upload.
- Read-only: desktop source. Depends: INT-01. Est: 2.0h (§12 R-02). Model: Terra (mechanical) with Sol high on any signing decision.
- Gates: `CARGO_BUILD_JOBS=2 npm run desktop:build` exit 0 (verified script `desktop:build` exists; the env prefix is the blueprint's memory-bounding convention).
- Evidence: artifact hash + install-from-artifact smoke on a clean profile.
- Rollback: authenticated source ZIP with honest limitation note (D4/§15 — macOS signing blocks).
- Status: BLOCKED.

### Tuesday, July 21 — submission hardening

| ID | Title | Owner/agent | Depends on | Est. | Status |
|---|---|---|---|---:|---|
| SUB-01 | README / PRIVACY / BUILD_WEEK final | Submission Lead | INT-03 | 2.0h | DONE (docs final; secret scan clean) |
| SUB-02 | Demo video and captions | Submission Lead | INT-03, REL-01, REL-02 | 2.5h | REVIEW (script/shot list/reset checklist in repo; recording is a human action) |
| SUB-03 | Devpost fields + `/feedback` verification | Submission Lead | SUB-01, SUB-02 | 1.0h | REVIEW (Devpost copy in repo; live URLs/session ID/preview are operator actions) |
| SUB-04 | Submit by 3:00 PM EDT | Human owner | SUB-03 | 0.5h | PENDING (human-only submit action) |

**SUB-01 — README / `docs/PRIVACY.md` / `docs/BUILD_WEEK_2026.md` final** — **DONE** (July 19, 2026 — runbook Prompt 12)
- Outcome: public claims exactly match implemented behavior, including the unencrypted-session disclosure and "while Weekform is running" sync honesty.
- Owns: `README.md`, `docs/PRIVACY.md`, `docs/BUILD_WEEK_2026.md` (all exist).
- Read-only: everything else. Depends: INT-03. Est: 2.0h (part of §12 R-04 5.0h). Model: Terra (docs) with Sol high honesty review.
- Gates: secret scan clean over the diff; `npm run build` untouched.
- Evidence: doc diff reviewed against actual golden-path behavior; no claim without an artifact.
- Rollback: revert doc edits.
- Status: **DONE** — July 19, 2026 (runbook Prompt 12). `README.md` restructured around the team-cloud product story with honest limitations; `docs/BUILD_WEEK_2026.md` carries the final Wave 4 provenance entry; `docs/PRIVACY.md` retains the unencrypted-session and while-running-sync disclosures. Secret scan clean over the diff; no claim without a repo artifact.

**SUB-02 — Demo video and captions (3.5–4 min, beats in §4 below)** — **REVIEW** (script done; recording human-owned)
- Outcome: the judge-facing artifact; every shown step works live (no fake success states).
- Owns: video assets (outside repo) + caption/script files under `docs/` if committed.
- Read-only: everything. Depends: INT-03, REL-01, REL-02. Est: 2.5h (part of R-04). Model: human recording; Terra for script polish.
- Gates: none automated; runtime 3:30–4:00 verified.
- Evidence: the video file/URL; beats checklist from §4.
- Rollback: re-record; if a beat breaks, cut the beat, never narrate it as working (product contract §1.2).
- Status: **REVIEW** — July 19, 2026 (runbook Prompt 12). `docs/hackathon/TEAM_CLAWFATHER_DEMO_SCRIPT.md` delivers the 3:50 Time/Screen/Action/Narration script, S1–S11 shot list, and 13-step synthetic-state reset checklist. The recording itself is a human action against a live seeded stack and has not been performed.

**SUB-03 — Devpost fields and `/feedback` session verification** — **REVIEW** (copy done; submit-side verification operator-owned)
- Outcome: complete submission preview with Codex provenance (primary `/feedback` session ID + supplemental task IDs).
- Owns: Devpost entry (outside repo); provenance list in `docs/BUILD_WEEK_2026.md`.
- Read-only: everything. Depends: SUB-01, SUB-02. Est: 1.0h. Model: Luna/human.
- Gates: none automated; checklist — repo access, video URL, description, track, setup instructions, final commit.
- Evidence: submission preview screenshot.
- Rollback: edit before final submit.
- Status: **REVIEW** — July 19, 2026 (runbook Prompt 12). `docs/hackathon/TEAM_CLAWFATHER_DEVPOST.md` carries the 93-character tagline, all Devpost sections, track justification, and the submission checklist. Live URL, video URL, primary `/feedback` session ID, and the submission preview are operator actions still pending.

**SUB-04 — Submit by 3:00 PM EDT internal deadline** — **PENDING** (human-only)
- Outcome: Devpost confirmation in hand five hours before the hard deadline.
- Owns: the submit action (human owner only).
- Read-only: everything. Depends: SUB-03. Est: 0.5h. Model: human.
- Gates: none. Evidence: Devpost confirmation.
- Rollback: the 8:00 PM EDT window is contingency margin, not plan.
- Status: **PENDING** — human-only action; everything the repo can prepare for it (SUB-01 docs, SUB-02 script, SUB-03 copy/checklist) is in place as of July 19, 2026.

---

## 2. Safe parallel work vs. high-conflict files

### Part 2 bounded expansion status (July 19, 2026)

| PT2 prompt | Outcome | Status | Evidence |
|---|---|---|---|
| 15 / B1 | Optional local weekly-review ritual | DONE | 6/6 focused tests; `verify:wave3` 103/103 desktop-cloud + 162/162 web at closeout |
| 16 / B2 | Manager action follow-through and measured team outcome | REVIEW (fresh audit and live migration proof env-blocked) | RPC-only create/resolve/delete; 17/17 focused boundary tests; 76-assertion pgTAP contract with direct member UPDATE/DELETE and outsider resolve/delete abuse; `verify:wave3` 111/111 desktop-cloud + 179/179 web; root build PASS; seventeen fresh audit attempts DNS-blocked, with the two iteration-9 attempts stopping before the web audit |
| 17 / B4 | Demand mapping and capacity reservations | BLOCKED | Depends on Prompt 16 reaching DONE; no implementation claim yet |

Prompt 16 accepts only clamped action text plus an optional closed risk key.
The web wrappers deny non-managers before a client call; the RPCs independently
reauthorize every caller server-side. Every read and mutation is team-scoped and
waits for two distinct later weeks before showing correlation-only team medians.
The committed migration has not been applied to a live Supabase project here,
so live RLS/RPC execution is not claimed. The repository contracts and all
runnable code/build gates are green. The fresh audit gate is DNS-blocked, so
Prompt 16 remains REVIEW; prior same-day audit evidence is not claimed for this
hardened tree.

Per the parallelization boundary in `docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK.md` ("How to run this pack") and blueprint sections 10/13.2.

**Safe to run concurrently now that DIR-01/DIR-02 are DONE:**

- Cloud contract and privacy tests — `packages/domain/src/cloud.ts`, `packages/inference/src/sharedSnapshot.ts` + tests (low conflict).
- Supabase migration/RLS — `supabase/**` (low conflict; keep clear of the existing `supabase/migrations/202607180001_span_simulator.sql`).
- Next.js web foundation — `apps/web/**` (low conflict relative to desktop; only shared touch point is two new lines in root `package.json`).
- Demo narrative and visual-plan work — read-only planning, docs.
- DESK-00 plan-only design (reads, never writes, the high-conflict files).

**Single-writer serial (one Desktop Agent owns all four; verified to exist at these paths):**

- `apps/desktop/src/App.tsx` — very high conflict; top-level state composition (`AGENTS.md`: frontend source of truth).
- `apps/desktop/src/services/localStore.ts` — high; persistence/migration.
- `apps/desktop/src/components/settings/SetupScreen.tsx` — high; mounts the new Account & Sharing panel.
- `apps/desktop/src/components/shell/ScreenRouter.tsx` — high; threads cloud props.

No task in this ledger assigns a second writer to any of the four: DESK-01…DESK-05, PRIV-02 (desktop half), and SYNC-01/02/03 all belong to the same sole Desktop Agent; PRIV-01/PRIV-02 web halves touch `apps/web/**` only; INT-01 conflict resolution is serial-only by definition. Do not start the desktop writer until cloud types and table names are stable (blueprint 13.2) — they now are (DIR-02 DONE), but DESK-01 still waits on WEB-03 for a real account. Never run two desktop writers; if conflicts appear anyway, the Integrator applies changes serially (blueprint 15). Avoid `apps/desktop/src-tauri/src/lib.rs` for P0 unless secure storage/native network is required (blueprint 10).

---

## 3. Feature-freeze, internal-submission, and kill criteria

**Feature freeze — Monday, July 20, 9:00 PM EDT.** Incomplete UI is removed or flagged off. After freeze: regression, privacy review, builds, and demo assets only.

**Internal submission — Tuesday, July 21, 3:00 PM EDT.** Verify repository access, video URL, description, track, `/feedback` value, setup instructions, and final commit. The 8:00 PM EDT official deadline is contingency margin, not the plan.

**Kill criteria (blueprint 15) — stop or defer a feature when it:**

- has consumed twice its estimate without a P0 demo artifact;
- requires changing the privacy contract after Phase 1;
- introduces a second writer into the desktop integration files above;
- cannot be tested with synthetic data;
- weakens an RLS or validation gate;
- does not improve the judge-facing golden path.

**Overrun cuts, in order:** cut all P1 (hourly sync, Team Briefing AI, invite email, history trends) and ship manual Sync Now + deterministic aggregates; then apply the execution-board hard cut list (Realtime, billing, SSO/SCIM, integrations OAuth, global admin, manager-enforced sharing, raw work-block cloud storage, deep-link OAuth, signed updater, mobile/Windows, rankings, auto-allocation, background sync after quit). **Stop-the-line conditions** in `docs/WEEKFORM_HACKATHON_EXECUTION_BOARD.md` (outsider/peer reads, raw titles in payload, secret key in client, live scheduler after reset, missing-treated-as-zero, employee-ranking AI output, broken local demo, skipped-but-reported gate) halt integration immediately regardless of schedule.

---

## 4. Demo seed, video beats, and required evidence

**Demo seed (blueprint 6.4; task DB-04):** synthetic team "Northstar Analytics" with Manager **Maya Chen**, Member **Jordan Lee** (low headroom, high reactive load), Member **Sam Rivera** (moderate headroom, meeting-heavy). Never seed real names, credentials, calendar text, or customer data; demo credentials live in a local ignored file. A reset script must restore clean state so the golden path can run twice without manual database edits (blueprint Phase 3 exit gate).

**Video beats (~4:00, blueprint 16.1):**

1. 0:00–0:30 — Problem: task tools miss reactive load, meetings, fragmentation, carryover.
2. 0:30–1:00 — Local intelligence: Weekform for Mac reviewed work blocks and explainable capacity.
3. 1:00–1:40 — Consent: Account & Sharing off by default → Summary + Categories → exact payload preview (no titles/evidence/screenshots) → sync.
4. 1:40–2:30 — Team view: manager dashboard on weekform.com with freshness, capacity, reactive load, partial-sharing states.
5. 2:30–3:10 — Team Briefing Agent: metric references and coordination questions, never rankings (or deterministic fallback).
6. 3:10–3:40 — User control: disable a metric or delete history on the Mac; manager view shows "Not shared"/empty.
7. 3:40–4:00 — Codex/GPT-5.6 build story and impact.

**Required evidence (blueprint 16.3, 14.5; execution-board ledger):** public repository and final commit; Build Week baseline/new-work explanation; primary Codex `/feedback` session ID and supplemental task IDs; demo video; live web URL; synthetic account/demo instructions; Mac installer or source-ZIP instructions; privacy data-flow diagram; screenshots of local review, share preview, manager dashboard, and revocation; validation commands with actual exit statuses (`npm run build`, `web:build`, cargo check if native touched, RLS matrix allow/deny log, contract-test output); database row IDs from the golden path. One evidence-ledger row per task; never include secrets, raw prompts, local paths, real data, or private cost records.

---

## 5. Program Integrator outputs (Prompt 0B)

### 5.1 Critical path (ordered task IDs)

DIR-01 ✓ → DIR-02 ✓ → ENV-01 → DB-01 → DB-02 → DB-03 → (WEB-01 → WEB-03 →) WEB-04 → DESK-01 → DESK-02 → DESK-03 → DESK-04 (parallel with DESK-02/03 under the same writer, serially scheduled) → DESK-05 → DASH-01 → DASH-02 → PRIV-01 / PRIV-02 → QA-01 / QA-02 → INT-01 → INT-02 → INT-03 / QA-03 → REL-01 / REL-02 → SUB-01 → SUB-02 → SUB-03 → SUB-04.

The serial desktop chain DESK-01→05 (~13h of the sole writer's time, execution-board estimates) is the longest inflexible segment; everything feeding it (CONTRACT-01/02, DB-01/02, WEB-03) must be finished today, Sunday July 19, or the Monday-evening (July 20) Phase 2 gate slips.

### 5.2 Safe parallel wave (READY tasks that can start concurrently now)

Five workstreams, zero shared writable files (only WEB-01 touches root `package.json`, script lines only):

1. **CONTRACT-01** — Contract Agent on `codex/team-clawfather-contract` (`packages/domain/src/cloud.ts`), continuing straight into CONTRACT-02/03.
2. **ENV-01** — Cloud Lead (human): Supabase project + `.env.example` inventory; unblocks DB-01 the moment it lands.
3. **WEB-01** (then WEB-02) — Web Agent on `codex/team-clawfather-web` (`apps/web/**` + `web:dev`/`web:build` scripts).
4. **ENV-02** — Web Lead (human): Vercel shell for the WEB-01 output.
5. **DESK-00** — Desktop Agent on `codex/team-clawfather-desktop`, **Plan mode only**; no code, no high-conflict file writes.

The Cloud Agent (`codex/team-clawfather-supabase`, DB-01) joins the wave as soon as ENV-01 reports a project ref — likely within the hour; nothing else it needs is pending.

### 5.3 Single highest-risk assumption

**That a Supabase email/password session created on weekform.com will work reliably from inside the Tauri desktop webview on the first integration attempt.** The repository contains zero Supabase/auth/network-sync code today (BASELINE §4 — greenfield), yet the entire serial keystone chain (DESK-01→DESK-05→DASH-01→the whole demo) sits behind this one untested behavior, and it cannot even be attempted until WEB-03 exists — i.e., the riskiest unknown is scheduled latest. Mitigation: DESK-00 today includes a throwaway spike plan for auth-in-webview; the named fallback (one-time device-pairing code, DECISIONS D2) must be treated as a real design, not a footnote. Trigger the fallback the moment desktop auth misses its 2× estimate (blueprint §15 kill criterion).

### 5.4 Exact next command/prompt per ready workstream

Branch names and prompt numbers from `docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK.md` §1 "How to run this pack"; every implementation prompt must return the runbook's 8-point mandatory closeout.

| Workstream | Worktree/branch | Next action |
|---|---|---|
| Contract Agent (CONTRACT-01→03) | `codex/team-clawfather-contract` | Run runbook **Prompt 1 — Shared cloud contract and privacy tests** (Sol high). |
| Cloud Lead → Cloud Agent (ENV-01 → DB-01→04) | `codex/team-clawfather-supabase` | Human: create the Supabase project, record the ref outside the repo, fill `.env.example` names. Then run runbook **Prompt 2 — Supabase schema, RLS, and synthetic seed** (Sol high). |
| Web Agent (WEB-01→02, ENV-02) | `codex/team-clawfather-web` | Run runbook **Prompt 3 — Next.js/Supabase web foundation and landing** (Sol med); Web Lead connects the Vercel shell to the branch. |
| Desktop Agent (DESK-00 only) | `codex/team-clawfather-desktop` | Run runbook **Prompt 5 — Desktop Account & Sharing and Manual Sync** in **Plan mode only** (Sol high): produce the DESK-00 design + auth spike plan; write no code until WEB-03 and CONTRACT-01 land. |
| Integrator (standing by) | `codex/team-clawfather-integration` | No prompt yet; owns this ledger, watches gate evidence, and will run runbook **Prompt 11** at INT-01. Prompts 4 and 6 (team lifecycle, dashboards) queue on the web worktree after DB-03/DESK-05; Prompt 10 (privacy critic) queues on QA-01/02. |

### 5.5 Hard P0 cut list

Mark `CUT` unless every P0 item is `DONE` (execution board), in cut order:

1. **All P1 first:** SYNC-01/02/03 (hourly/catch-up/retry — manual Sync Now stays), AI-01/02/03 (Team Briefing AI — deterministic aggregates/risk flags render without AI), INV-EMAIL (copy-link stays), HISTORY-01 (latest snapshot only).
2. **P0 degradations (not removals):** signed-artifact download → authenticated page linking the guided source ZIP with the limitation stated honestly (D4); desktop email/password auth → one-time device-pairing code (D2); member cards → team-level aggregates only if the dashboard reads as surveillant (D6/§15); `latest_team_snapshots` view → direct table query (ARCHITECTURE §1.3).
3. **Permanent hard cuts (never in this submission):** Realtime subscriptions · billing/subscriptions · SSO/SCIM · Slack/Jira/Linear OAuth · global role/admin console · manager-enforced sharing · raw work-block cloud storage · deep-link OAuth · signed/notarized updater · mobile/Windows · performance rankings/benchmarks · automatic work allocation · background sync after app quit.
4. **Never cut, no matter what:** manual Sync Now, RLS, the exact-preview consent flow, and revocation (product contract §2.4) — without them there is no product thesis.
