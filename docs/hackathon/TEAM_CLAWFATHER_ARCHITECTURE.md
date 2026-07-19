# Team Clawfather — Cloud & Security Architecture (Prompt 0A synthesis)

**Status:** Frozen for P0 implementation. Synthesized July 19, 2026 for OpenAI Build Week (deadline July 21, 2026, 5:00 PM PDT / 8:00 PM EDT).
**Sources of truth:** `AGENTS.md`, `docs/WEEKFORM_TEAM_CLAWFATHER_HACKATHON_BLUEPRINT.md` (sections 4–6, 14), `docs/WEEKFORM_HACKATHON_EXECUTION_BOARD.md`, `docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK.md` (Prompt 0A), `docs/WEEKFORM_SUPABASE_SCHEMA_DRAFT.sql`.
**Non-negotiables carried forward:** no raw-activity upload; RLS in the first migration; no billing/SSO/Realtime in P0; database cron is never a way to pull data from a closed Mac (blueprint 4.1 "Scheduled upload" row); team roles live in `team_memberships`, never in global roles or user-editable auth metadata (blueprint 6.1).

---

## 1. Minimum Supabase Auth/Postgres/RLS model

Grounded in blueprint section 6 (6.1 tables, 6.2 RLS rules, 6.3 views/functions) and already drafted as SQL in `docs/WEEKFORM_SUPABASE_SCHEMA_DRAFT.sql` (666 lines: five tables, security-definer helper functions in a locked `private` schema, ~17 policies, `security_invoker = true` latest-snapshot view). The Cloud Agent's first migration under `supabase/migrations/` should be a reviewed application of that draft — not a rewrite. The existing `supabase/migrations/202607180001_span_simulator.sql` and `supabase/tests/span_simulator_rls.sql` are unrelated Span Simulator artifacts; do not extend them, add a new migration.

### 1.1 Tables (blueprint 6.1; draft SQL lines 26–100)

| Table | Purpose | Key constraints |
|---|---|---|
| `profiles` | Display identity; `id` references `auth.users(id)` | User-controlled `display_name` only; no role column here |
| `teams` | Sharing boundary | `created_by` owner reference |
| `team_memberships` | **The only source of authorization** | Composite PK `(team_id, user_id)`; `role` ∈ `owner`/`manager`/`member`; `status` ∈ `active`/`removed` |
| `team_invites` | Custom tokenized invites | `token_hash` unique — plaintext token is never stored; `expires_at` (72h), one-time `accepted_at`/`accepted_by` |
| `workload_snapshots` | Derived snapshots only | `client_snapshot_id` unique (retry idempotency); `user_id` must equal `auth.uid()` on insert; `schema_version = 1`; typed metric columns + sanitized jsonb allocations |

Optional `cloud_events` only if the web product needs a minimal sync receipt; it never replicates the desktop audit trail (blueprint 6.1).

**Role placement rule (restated because it is a stop-the-line condition):** roles exist exclusively as rows in `team_memberships`. There is no global `role` on `profiles`, no `app_metadata`/`user_metadata` role, and no client-writable role field. `raw_user_meta_data` is user-editable via the auth API, so any policy reading it would be an escalation hole — see negative test T6 below.

### 1.2 RLS rules (blueprint 6.2, rules 1–13)

Every exposed table gets `enable row level security` in the same migration that creates it — RLS is never "later" (Prompt 0A rejection criterion, runbook line 156).

1. Own-profile read/update; teammate profiles readable only through shared active membership.
2. Teams readable only by active members; updatable by owner/manager; final-owner removal safeguarded.
3. Own membership readable; managers read active memberships of teams they manage.
4. Snapshots: insert/update/delete only where `user_id = auth.uid()` **and** the user has an active membership in `team_id`.
5. Snapshot reads: own rows, plus owner/manager reads for teams they manage. A regular member can never read a peer's snapshot.
6. Membership checks go through `security definer` helper functions in the `private` schema (draft SQL) to avoid recursive-policy pitfalls; `revoke all on schema private from public`.
7. Index every `user_id`, `team_id`, and membership lookup used by a policy (blueprint 6.2 rule 13).
8. Service/secret keys exist only in trusted server routes; the desktop app uses the publishable key plus the authenticated user session (blueprint 4.1). Secret key in client code is a stop-the-line condition (`docs/WEEKFORM_HACKATHON_EXECUTION_BOARD.md`).

### 1.3 Views and functions (blueprint 6.3)

- `latest_team_snapshots` — one most-recent row per `(team_id, user_id)`, created `with (security_invoker = true)` so it cannot bypass underlying RLS (draft SQL line 616). If view behavior is at risk near the deadline, query the table directly instead.
- `accept_team_invite(raw_token text)` — security-definer RPC: hashes token, verifies expiration/email/auth, inserts membership, marks invite accepted atomically.
- `create_team_with_owner(name text)` — atomic team + owner membership.
- `delete_my_team_snapshots(team_id uuid)` — optional; plain RLS delete suffices.

---

## 2. Versioned allowlist payload

### 2.1 Contract (blueprint 5.3)

The cloud receives only `SharedWorkloadSnapshotV1`, produced by a pure allowlist builder (`packages/inference/src/sharedSnapshot.ts`, blueprint 5.4) governed by `CloudSharePolicyV1`:

- `CloudSharePolicyV1`: `version: 1`, `enabled` (default **off**), `teamId`, `shareLevel` (`summary` | `categories` | `projects`), per-metric boolean `CloudMetricPolicy`, `allowedProjectNames`, `autoSyncEnabled`, `intervalMinutes: 60`, `consentedAt`.
- `SharedWorkloadSnapshotV1`: `schemaVersion: 1`, `clientSnapshotId`, `teamId`, `weekId`, `observedAt`, `sourceUpdatedAt`, `shareLevel`, `metrics` (partial — disabled metrics are **omitted, never zeroed**), optional `categoryAllocation`/`workModeAllocation` (categories level and above), optional `projectAllocation` (projects level, allowlisted names from reviewed blocks only), `reviewCoverage`.
- `user_id` is assigned by the authenticated database write path, never trusted from payload input (blueprint 5.3, closing note).

### 2.2 Non-negotiable rule (blueprint 5.1)

**The cloud never receives the desktop state object or a filtered copy of it.** The payload is separately constructed by allowlist so that local model evolution cannot leak new fields. The builder must reject disabled/unconsented/teamless policies, clamp numerics, never serialize unknown fields, produce a stable `clientSnapshotId` for retry idempotency, and generate the consent preview from the same object that is uploaded (blueprint 5.4, requirements 1–10).

### 2.3 What the payload can NEVER carry (blueprint 5.2 "Always local")

- Raw window titles or foreground app names.
- Raw active-window samples, activity sessions, or source IDs.
- Work-block evidence arrays.
- Notes.
- Screenshots and Visual Context insights.
- Calendar titles, locations, organizer names, or attendee identities.
- Chat channels, message text, or raw chat events.
- AI provider keys, Supabase secret/service keys, or any credential.
- Full audit details; generated skill recipes unless separately exported by the user.

Contract tests (blueprint 14.1) must assert with sentinels that window-title, evidence, and note strings cannot appear in serialized output; any appearance is a stop-the-line condition per `docs/WEEKFORM_HACKATHON_EXECUTION_BOARD.md`.

---

## 3. Desktop auth decision

Blueprint 4.2–4.3 already decides this; recorded here, not reopened.

| Option | Assessment |
|---|---|
| **Direct desktop Supabase auth (email/password) — P0 DECISION** | User creates the account on `weekform.com` first, then signs into the desktop app with the same email/password via `@supabase/supabase-js` and the publishable key; RLS authorizes direct inserts/reads. Smallest end-to-end path: no custom URI schemes, no browser-to-app callbacks, no pairing service (blueprint 4.2). Caveat that UI and `docs/PRIVACY.md` must state honestly: the saved cloud session lives in unencrypted prototype local storage; Keychain storage is a post-hackathon upgrade. |
| **Device pairing — EXPLICIT FALLBACK** | One-time short-lived code created by the signed-in web user, entered on the desktop, exchanged server-side for a revocable narrowly scoped device token (write own snapshots, read own memberships). More secure in scope but more custom code; adopt only if the standard Supabase desktop session cannot be made reliable quickly (blueprint 4.2 fallback; risk register 15 "Desktop auth session unreliable"). |
| **Deep-link auth — REJECTED FOR HACKATHON** | Tauri supports it, but macOS scheme registration must be declared in app config and tested in a bundled build. It is a product upgrade, not the fastest P0 dependency; the execution board hard-cut list also lists "Deep-link OAuth" (blueprint 4.3; `docs/WEEKFORM_HACKATHON_EXECUTION_BOARD.md`). |

Sync semantics follow from this: only the running desktop app possesses current approved data, so uploads are manual "Sync Now" (P0) plus an hourly interval and startup catch-up **while the app runs** (P1). Supabase Cron is appropriate later for rollups/retention/stale markers only — it can never pull from a sleeping or closed Mac (blueprint 4.1, 8.4–8.5).

---

## 4. Concrete negative RLS tests

Actors (blueprint 14.2; execution board QA-01): **Manager A** (owner/manager of Team T1), **Member B** (active member, T1), **Member C** (active member, T1, no manager role), **Outsider D** (authenticated, no T1 membership). Execute as an actual allow/deny log with per-actor JWTs (`request.jwt.claims` swapped per statement, in the style of `supabase/tests/span_simulator_rls.sql`); expected DENY means zero rows or an RLS error, never silent success.

| # | Test | Steps | Expected |
|---|---|---|---|
| T1 | Cross-team read | D selects from `teams`, `team_memberships`, `workload_snapshots`, and `latest_team_snapshots` for T1 | DENY / zero rows on all four |
| T2 | Forged `user_id` | B inserts a snapshot with `user_id = C's uuid` (and again with A's uuid); B updates an own row setting `user_id = C` | DENY — insert/update policies require `user_id = auth.uid()` |
| T3 | Member reads peer | C selects B's rows from `workload_snapshots` and via `latest_team_snapshots` | DENY / zero rows — manager reads only |
| T4 | Invite replay | Valid token accepted once by B, then: B replays it; D replays it; D presents an expired token; D presents a wrong-email token | First accept ALLOW; all replays/expired/wrong-email DENY (one-time `accepted_at`, `token_hash` match, expiry check in `accept_team_invite`) |
| T5 | Non-manager invite forgery | B and C insert into `team_invites` for T1; D inserts an invite naming T1 | DENY — `invites_insert_managers` policy restricts to owner/manager of that team |
| T6 | Metadata role escalation | C updates their own auth `user_metadata` to `{"role":"owner"}` via the auth API, then retries T3 and T5 | Still DENY — no policy reads auth metadata; authorization derives only from `team_memberships` rows, which C cannot self-promote (membership update policies exclude role self-elevation) |
| T7 | View bypass | C and D query `latest_team_snapshots` for T1 rows; verify the view is `security_invoker = true` (inspect `pg_views`/reloptions) | Zero rows; view definition confirms invoker security so it cannot launder manager-only reads |
| T8 | Forged team scope | B, an active member of T1 only, inserts a snapshot with a `team_id` of another team T2 | DENY — insert requires active membership in the target `team_id` |
| T9 | Manager write overreach | A updates or deletes B's snapshot rows | DENY by default — managers read, they do not edit member data (blueprint 14.2 "A deletes B history: Deny by default") |
| T10 | Anonymous access | Unauthenticated role selects from every exposed table and the view | DENY on all (Phase 1 exit gate, blueprint 11) |

Also test already-accepted, expired, wrong-email, and reused invites explicitly (blueprint 14.2 closing note). Any failure of T1–T3 or T6–T8 is a stop-the-line condition (`docs/WEEKFORM_HACKATHON_EXECUTION_BOARD.md`): halt integration until fixed, or fall back to demo-only server routes with strict server checks (blueprint 15, RLS risk row).
