# Team Clawfather — Repository Baseline (Prompt 0A, Investigation 1)

Read-only baseline of `weekform-dev` as of **July 19, 2026**. Source of truth for what exists before any Team Clawfather cloud work. Companion documents: [TEAM_CLAWFATHER_PRODUCT_CONTRACT.md](TEAM_CLAWFATHER_PRODUCT_CONTRACT.md), [TEAM_CLAWFATHER_ARCHITECTURE.md](TEAM_CLAWFATHER_ARCHITECTURE.md), [TEAM_CLAWFATHER_TASKBOARD.md](TEAM_CLAWFATHER_TASKBOARD.md), [TEAM_CLAWFATHER_DECISIONS.md](TEAM_CLAWFATHER_DECISIONS.md).

## 1. Baseline commit

- Branch: `absolooply-incredible`
- HEAD: `fa4557966f4ac5dd7226f3613ee27036a93a8a6b` (`fa45579 Update ZComb task throughput metric`)
- Public `main` baseline cited by the blueprint: `ae25396` ("Refresh README…"), two commits behind current HEAD.
- History is short (6 commits); inherited capabilities below all predate the Team Clawfather cloud work.

## 2. Current architecture

**Stack:** Tauri 2 (Rust menu-bar shell) + React 18 + TypeScript + Vite 8, single root npm workspace (`package.json` name `weekform`; `apps/desktop` has no own package.json). Shared TS packages compile via root `tsconfig.json` include globs.

**Apps:** only `apps/desktop`. **There is no `apps/web`.**

**Packages:**
- `packages/domain/src/models.ts` (527 lines) — all data models and taxonomy.
- `packages/inference/src/` — deterministic capacity, forecasts, accelerate, realized savings.
- `packages/integrations/src/` — Outlook `.ics`, chat metadata, git-log, usage CSV/pricing.
- `packages/simulator/src/` — synthetic span-simulator lab (has the only test target, `simulator.test.ts`). Not a product surface.

**State ownership:** `apps/desktop/src/App.tsx` (1972 lines) is the single frontend source of truth; state flows through hooks into `<ScreenRouter>` (`App.tsx:1858`). No parallel store.

**Persistence:** `apps/desktop/src/services/localStore.ts` (1002 lines). Tauri Store file `clear-capacity.store`, key `appState`; browser `localStorage` fallback `clear-capacity:v1` for web/demo. Central shape `PersistedAppState` (`localStore.ts:126`). Legacy `clear-capacity.*` keys are compatibility-protected per `AGENTS.md` — rename only with migration + rollback.

**Key models (`packages/domain/src/models.ts`):**
- `WorkBlock` (line 109) — category, mode, planned status, project, stakeholder, confidence, `evidence[]`, `derived_from[]`, `user_verified`, `blocker_flag`, `notes`.
- `WeeklyCapacitySnapshot` (line 303) — allocation, deep/fragmented/meeting/reactive/planned/blocked/recurring pct, `reliable_new_work_capacity_pct`, `committed_utilization_pct`, carryover risk, WIP load, context-switch score, penalties, `summary_confidence`, category/work-mode allocations.
- No team, account, cloud, or sharing-policy model exists.

**Screens** (`apps/desktop/src/components/`, routed by `shell/ScreenRouter.tsx`, 496 lines): setup, ledger, daily review, weekly capacity, forecast, narrative, usage, audit, sensitive review, agent, accelerate, skills, compact widget. `Screen` union at `apps/desktop/src/lib/types.ts:1`; `SettingsTab` union at `types.ts:2` (`data-sources | data-control | ai-assistance | ai-usage | notifications`).

**Demo mode:** `?demo=1` (`App.tsx:108`), seeded by `createDemoState()` from `services/demoData.ts`; persistence writes are gated off in demo. Honors `?screen=` and `?mode=compact`.

**AI paths:** provider presets in `services/aiProviders.ts` (openai/grok/deepseek/custom); prompt+schema services for classifier, review copilot, forecast, narrative, acceleration, visual context; native AI commands in `apps/desktop/src-tauri/src/lib.rs`; Vercel AI SDK (`ai@6.0.230`, `@ai-sdk/openai@3.0.86`) for the conversational Agent.

**Privacy boundary today:** local-first; raw activity and imports stay on the Mac; local storage is unencrypted (honest-prototype disclosure required); `AuditEvent` emitted for consequential actions; no telemetry or cloud sync of workload data exists.

## 3. Build, dev, and test commands (root `package.json`, verified present)

| Script | Command |
|---|---|
| `dev` | `vite --host 127.0.0.1` |
| `demo` | `vite --host 127.0.0.1 --open '/?demo=1&screen=weekly'` |
| `desktop:dev` / `desktop:build` | `tauri dev` / `tauri build` (with `DEVELOPER_DIR` default) |
| `build` | `tsc -b && npm run pricing:check && vite build` |
| `test:simulator` | `tsx --test packages/simulator/src/*.test.ts` |
| `preview` | `vite preview --host 127.0.0.1` |
| `pricing:check` / `pricing:refresh` / `pricing:refresh:apply` | `node scripts/refresh-model-prices.mjs …` |

No `test`, `lint`, or `typecheck` script exists; type-checking rides in `build` via `tsc -b`. The only automated test target is `test:simulator`. Dev port 5173.

## 4. Supabase / auth / team / cloud — proven state

**Exists (artifacts only, not wired into any client):**
- `supabase/migrations/202607180001_span_simulator.sql` — simulator-admin schema + RLS; header states repository presence ≠ applied. Unrelated to team/workload cloud.
- `supabase/tests/span_simulator_rls.sql` — RLS test for the above.
- `docs/WEEKFORM_SUPABASE_SCHEMA_DRAFT.sql` — Team Cloud v1 **draft**: `profiles`, `teams`, `team_memberships`, hashed `team_invites`, `workload_snapshots`, full RLS. Not executed.
- `docs/WEEKFORM_TEAM_CLAWFATHER_HACKATHON_BLUEPRINT.md` — the full product/architecture plan.

**Missing (confirmed by grep across `apps/`, `packages/`, `scripts/`, `package-lock.json`):**
- No Supabase dependency, no `createClient`, no auth/session/sign-in code, no team/membership/cloud-sync code, no `apps/web`, no network sync of `WorkBlock`/`WeeklyCapacitySnapshot`.

**Verdict:** the Team Clawfather cloud layer is greenfield against a documented design. This is genuine submission-period work, and the largest risk: adding a cloud boundary without destabilizing the desktop core (blueprint §2.2).

## 5. Smallest file-impact surface

**A. Cloud contract types** — add `packages/domain/src/cloud.ts` as a sibling of `models.ts` (imported everywhere via deep relative paths; a new file is lowest-risk). Root tsconfig `include: ["packages"]` picks it up automatically. The share payload derives from the existing `WeeklyCapacitySnapshot` fields.

**B. Desktop Account & Sharing** — model as a new `SettingsTab`, not a new `Screen`, avoiding `ScreenRouter.tsx` entirely:
- `apps/desktop/src/lib/types.ts:2` — extend `SettingsTab` union.
- `apps/desktop/src/components/settings/SetupScreen.tsx` (1039 lines) — add section; the existing manager-summary sharing toggle (`Share2` icon, `include_in_manager_summary` ~line 562) is the natural anchor.
- `apps/desktop/src/App.tsx:177` — `activeSettingsTab` state, passed to router at `App.tsx:1898-1899`.
- `apps/desktop/src/services/localStore.ts` — extend `PersistedAppState` (`:126`) with defensive parsing + migration.
- Possibly `apps/desktop/src-tauri/src/lib.rs` + `capabilities/default.json` if a native network command is needed.

**C. Web app** — greenfield `apps/web/`; requires only root `package.json` script additions (`web:dev`, `web:build`), no edits to desktop files. Imports shared types from `packages/domain`.

**High-conflict single-writer files (paths confirmed):** `apps/desktop/src/App.tsx`, `apps/desktop/src/services/localStore.ts`, `apps/desktop/src/components/settings/SetupScreen.tsx`, `apps/desktop/src/components/shell/ScreenRouter.tsx`.

---

## 6. Executive summary

Weekform is a substantial, working local-first macOS workload-intelligence app (Tauri 2 + React 18 + deterministic inference) with reviewable `WorkBlock` evidence and a deterministic `WeeklyCapacitySnapshot` — and **zero** cloud/auth/team/web code. The winning Build Week move (blueprint §1) is one privacy-governed team loop: account → team/invite → authenticated Mac download → local review → exact share preview → approved derived `SharedWorkloadSnapshotV1` to Supabase under RLS → manager dashboard → evidence-grounded team briefing → member narrows/revokes. Raw evidence never leaves the Mac; the cloud carries only an allowlisted, versioned derived payload. The desktop edit surface is deliberately tiny (a new SettingsTab + `localStore` migration, one writer), the web app is greenfield, and the Supabase schema already exists as a reviewable draft. The demo is eight steps and requires no developer narration.

### First eight implementation missions (dependency order)

1. **M1 — Freeze the cloud contract** (`packages/domain/src/cloud.ts`, `packages/inference/src/sharedSnapshot.ts` + focused tests) — runbook Prompt 1. Unblocks everything.
2. **M2 — Supabase migration + RLS + seed** (`supabase/migrations/*_team_cloud_v1.sql`, RLS matrix doc) — runbook Prompt 2; promote `docs/WEEKFORM_SUPABASE_SCHEMA_DRAFT.sql` into a reviewed migration. Parallel with M3 after M1.
3. **M3 — Next.js web foundation** (`apps/web`, auth, landing, protected `/dashboard` + `/download`, root `web:dev`/`web:build`) — runbook Prompt 3. Parallel with M2.
4. **M4 — Team lifecycle** (create team, hashed invite, accept, membership list) — runbook Prompt 4. Depends on M2 + M3.
5. **M5 — Desktop Account & Sharing + manual sync** (sole desktop writer; SettingsTab, `CloudSharePolicyV1` editor, exact preview, Sync Now, audit, delete/disconnect/reset) — runbook Prompt 5. Depends on M1, M2, M4.
6. **M6 — Manager and member dashboards** (RLS-scoped queries, median/range aggregates, "Not shared" semantics) — runbook Prompt 6. Depends on M4 + one real synced row from M5.
7. **M7 — Hourly sync with catch-up/retry** — runbook Prompt 7. Depends on M5 proven.
8. **M8 — Team Briefing Agent** (server-side OpenAI Responses API, allowlisted input, deterministic fallback) — runbook Prompt 8. Depends on M6.

Adversarial privacy review (Prompt 10), integration gate (Prompt 11), and submission package (Prompt 12) follow per the taskboard. Kill criteria and cut lists live in [TEAM_CLAWFATHER_TASKBOARD.md](TEAM_CLAWFATHER_TASKBOARD.md).
