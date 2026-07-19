# Team Clawfather — Team Cloud v1 RLS Matrix

**Migration:** `supabase/migrations/202607190001_team_cloud_v1.sql`
**Executable contract:** `supabase/tests/team_cloud_rls.sql` (pgTAP, 39 assertions)
**Status of every cell below: EXPECTED, not VERIFIED.** No Supabase CLI or local
Postgres stack was available in this environment, so no RLS policy was executed.
All three SQL files were validated with `libpg_query` (the actual PostgreSQL
parser, via pglast 8.2), including plpgsql function bodies and the inner SQL of
every pgTAP block — that proves syntax, not policy behavior. Run
`supabase test db` against a local stack to flip cells to VERIFIED.

## Actors

| Actor | Identity |
|---|---|
| **Manager A** | Owner of Team T1 (and of a second team T2 used for forged-scope tests) |
| **Member B** | Active `member` of T1 |
| **Member C** | Active `member` of T1; `raw_user_meta_data` deliberately claims `{"role":"owner"}` — must grant nothing |
| **Outsider D** | Authenticated user with no membership anywhere |
| *(Invitee E)* | Auxiliary actor holding the email a valid invite is addressed to |
| *(anon)* | Unauthenticated role; all table privileges revoked |

Legend: **ALLOW** = rows returned / write succeeds. **DENY** = zero rows for
SELECT-shaped access or an RLS/permission error (42501) for writes — never a
silent success. "0 rows" for a manager DELETE means the statement runs but
matches nothing, which is the intended deny for history deletion.

## profiles

| Op | Manager A | Member B | Member C | Outsider D |
|---|---|---|---|---|
| SELECT own | ALLOW | ALLOW | ALLOW | ALLOW (own only) |
| SELECT teammate/peer | ALLOW for active members of managed teams | DENY (members see no peer profiles) | DENY | DENY (0 rows) |
| INSERT (own id) | ALLOW (normally trigger-bootstrapped) | ALLOW | ALLOW | ALLOW |
| INSERT (other id) | DENY | DENY | DENY | DENY |
| UPDATE own | ALLOW | ALLOW | ALLOW | ALLOW |
| UPDATE other | DENY | DENY | DENY | DENY |
| DELETE | DENY (no delete policy; rows cascade from auth.users) | DENY | DENY | DENY |

## teams

| Op | Manager A | Member B | Member C | Outsider D |
|---|---|---|---|---|
| SELECT T1 | ALLOW | ALLOW | ALLOW | DENY (0 rows — cannot infer existence) |
| INSERT direct | DENY (no insert policy/privilege; RPC only) | DENY | DENY | DENY |
| Create via `create_team_with_owner` | ALLOW (becomes owner atomically) | ALLOW (new team) | ALLOW (new team) | ALLOW (new team; grants nothing on T1) |
| UPDATE T1 | ALLOW (owner/manager) | DENY | DENY (metadata role ignored) | DENY |
| DELETE T1 | ALLOW (owner only) | DENY | DENY | DENY |

## team_memberships

| Op | Manager A | Member B | Member C | Outsider D |
|---|---|---|---|---|
| SELECT own row | ALLOW | ALLOW | ALLOW | DENY (no row exists; 0 rows) |
| SELECT T1 roster | ALLOW (manager) | DENY (own row only) | DENY | DENY (0 rows) |
| INSERT | DENY — no insert policy exists for anyone; RPC only | DENY | DENY | DENY |
| UPDATE (incl. role self-promotion) | DENY — no update policy exists for anyone | DENY | DENY | DENY |
| DELETE own non-owner row | n/a (A is owner → DENY) | ALLOW | ALLOW | n/a (no row) |
| DELETE another member's row | DENY | DENY | DENY | DENY |

## team_invites

| Op | Manager A | Member B | Member C | Outsider D |
|---|---|---|---|---|
| SELECT T1 invites | ALLOW (manager) | DENY (0 rows) | DENY | DENY (0 rows) |
| INSERT member-role invite for T1 | ALLOW | DENY (42501) | DENY (42501, despite forged metadata) | DENY (42501) |
| INSERT manager-role invite for T1 | ALLOW (owner only; a plain manager DENY) | DENY | DENY | DENY |
| UPDATE | DENY (no update policy; acceptance happens only inside the RPC) | DENY | DENY | DENY |
| DELETE (revoke invite) | ALLOW (manager) | DENY | DENY | DENY |

### Invite lifecycle (`accept_team_invite`, SECURITY DEFINER, `search_path = ''`)

| Case | Expected |
|---|---|
| Create by owner/manager (hash only stored) | ALLOW; `token_hash` is SHA-256 hex, plaintext never persisted |
| First acceptance by matching email, before expiry | ALLOW; membership inserted and invite marked accepted in one transaction (`for update` row lock) |
| Reuse of an accepted token (same or different user) | DENY — `Invitation has already been accepted` |
| Expired token, correct email | DENY — `Invitation has expired` |
| Valid token, wrong signed-in email | DENY — `Invitation email does not match signed-in account` |
| Unknown/garbage/short token | DENY — `Invalid invitation token` / `Invitation not found` |
| Acceptance while already an ACTIVE member (e.g., invite naming an owner's email) | DENY — `Already an active member of this team` (an invite can never demote an active owner/manager) |
| Acceptance by a previously `removed` member | ALLOW — membership reactivated at the invite's role |

## workload_snapshots

| Op | Manager A | Member B | Member C | Outsider D |
|---|---|---|---|---|
| SELECT own rows | ALLOW | ALLOW | ALLOW | ALLOW (has none; 0 rows) |
| SELECT member rows in managed team | ALLOW | DENY (0 rows — members never read peers) | DENY (0 rows, metadata ignored) | DENY (0 rows) |
| INSERT own row into own active team | ALLOW | ALLOW | ALLOW | DENY (no membership → 42501) |
| INSERT with forged `user_id` | DENY (42501) | DENY (42501) | DENY (42501) | DENY (42501) |
| INSERT into a team without own active membership | DENY (42501) | DENY (42501) | DENY (42501) | DENY (42501) |
| UPDATE own row (same user/team) | ALLOW | ALLOW | ALLOW | n/a |
| UPDATE reassigning `user_id`/foreign `team_id` | DENY (WITH CHECK, 42501) | DENY | DENY | DENY |
| DELETE own rows | ALLOW | ALLOW | ALLOW | n/a |
| DELETE a member's rows (history) | **DENY — managers cannot delete member history (0 rows matched)** | DENY | DENY | DENY |

## latest_team_snapshots (view)

`security_invoker = true`; every cell equals the SELECT column of
`workload_snapshots` for that actor. The view cannot widen access. `anon` has
no grant at all.

## anon (unauthenticated)

Every SELECT/INSERT/UPDATE/DELETE on every table and the view: **DENY**
(`permission denied`, 42501) — privileges are revoked before RLS is even
consulted, and all policies are scoped `to authenticated`.

---

## Mandatory reviewer questions (runbook Prompt 2)

**1. Can a member change `user_id` during insert?**
No. `snapshots_insert_self_member` has `WITH CHECK (user_id = auth.uid() AND
private.is_active_team_member(team_id, auth.uid()))`. A forged `user_id` fails
the first conjunct and the insert errors with 42501. The UPDATE policy carries
the same WITH CHECK, so a row cannot be reassigned after insert either
(tests 15 and 17 in `team_cloud_rls.sql`).

**2. Can a manager join an unrelated team through an RLS helper?**
No. The helpers (`private.is_active_team_member`, `is_team_manager`,
`is_team_owner`, `can_manage_user`) are read-only `STABLE` SQL functions that
only test for an existing `team_memberships` row scoped to the exact
`(team_id, user_id)` being checked; they never insert or widen scope across
teams. Membership rows themselves can only be created by
`create_team_with_owner` (self as owner of a brand-new team) or
`accept_team_invite` (requires a valid, unexpired, email-matching token for
that specific team) — there is no INSERT or UPDATE policy on
`team_memberships` at all.

**3. Can an accepted invite be reused?**
No. `accept_team_invite` locks the invite row with `SELECT … FOR UPDATE`,
rejects any row where `accepted_at IS NOT NULL`, and sets
`accepted_at`/`accepted_by` in the same transaction. Concurrent double-accepts
serialize on the row lock; the loser sees `accepted_at` set and fails.
The table has no UPDATE policy, so nobody can clear `accepted_at` through the
API (test 35).

**4. Can a view bypass RLS?**
No. The only view, `latest_team_snapshots`, is created
`WITH (security_invoker = true)`, so the underlying `workload_snapshots`
policies are evaluated as the querying user (test 11 inspects
`pg_class.reloptions`; tests 21 and 30 assert zero rows for C and D). No other
view exists, and `anon` has no grant on it.

**5. Can an outsider infer team existence?**
No. `teams` SELECT requires an active membership; `team_memberships` and
`team_invites` SELECTs require self-row or manager status; `workload_snapshots`
requires self or manager. All are DENY-by-default (zero rows) for D, so probing
returns the same empty result whether a team exists or not (tests 26–30).
`accept_team_invite` requires a >= 32-char token whose SHA-256 matches a stored
hash, so team-id guessing through the RPC is not feasible; its error messages
reveal nothing about teams the caller cannot access.

**6. Can user metadata grant a role?**
No. Authorization derives exclusively from `team_memberships` rows; no policy,
helper, or RPC reads `raw_user_meta_data`, `raw_app_meta_data`, or JWT custom
claims for authorization. The single read of `raw_user_meta_data`
(`handle_new_user`) copies `display_name` as inert display text into
`profiles`, which carries no role column. Member C carries a forged
`{"role":"owner"}` metadata claim throughout the test file and is still denied
peer reads and invite creation (tests 20 and 22).

---

## Prompt 4 status note (July 19, 2026)

The web team-lifecycle flow (runbook Prompt 4) now exercises this matrix's
paths from application code: `create_team_with_owner` and
`accept_team_invite` are called via authenticated-user RPCs in
`apps/web/app/teams/actions.ts`, and invite creation inserts only the
SHA-256 `token_hash` under the manager-only INSERT policy. The prompt's
"update the RLS matrix with actual outcomes" step remains **pending**: no
local Supabase stack is available (no CLI/psql), so every outcome above is
still SQL-review-only — none has been observed against a running database.
The application-side error mapping (`mapAcceptInviteError`) covers each
RAISE message defined by `accept_team_invite` and is unit-tested
(`npm run test:web`, 13/13), which verifies message contracts, not RLS
behavior.
