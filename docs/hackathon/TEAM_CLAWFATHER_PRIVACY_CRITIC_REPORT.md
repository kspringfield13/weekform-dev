# Team Clawfather — Prompt 10 Adversarial Privacy/Security Critic Report

Status: **DONE** — July 19, 2026. All six Prompt 10 categories reviewed by three parallel read-only reviewers. No BLOCKER or HIGH findings. MEDIUM: (3.1) `safeNextPath` open-redirect via backslash `?next=/\evil.com` bypass in login/signup `redirect(next)` — confirmed at `apps/web/app/auth/actions.ts:13` (rejects `//` but not `/\`); (5.1) prototype-key evidence-ref bypass in `briefing.ts:257`. LOW: invite-token-in-URL log exposure; RLS test-matrix gap (manager-mints-manager-invite deny untested; pgTAP suite authored but unrun); non-UUID fallback `client_snapshot_id` for one render; superseded snapshot rows never pruned. Categories 4 (Sync integrity) and 6 (Product honesty): NO_BLOCKING_FINDINGS — idempotency, retraction-on-display, retry caps, stop conditions, and every honesty claim (no encryption/notarization/24-7/gated-source overstatement) verified against code. Result: **no blocking issue** — the P0 privacy/security boundary holds under adversarial static review; both MEDIUM items had one-line remediations and were fixed the same day (see "Remediation status" below). Live four-actor RLS proof (QA-01) remains environment-blocked (no Supabase CLI/psql).

Mode: read-only adversarial review per `docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK.md` Prompt 10. Findings only — no code fixed in this pass. Taskboard mapping: this report is the QA-02 payload audit (code-level) plus the static-analysis half of QA-01 (the live four-actor RLS proof remains environment-blocked — no Supabase CLI/psql on this machine).

Gate state at review time: `npm run verify:wave3` exit 0 (55/55 desktop-cloud tests, 85/85 web tests, 12 routes / 11 static pages). Secret scan (`grep -rnEi "(service_role|sb_secret|sk-…|supabase\.co|eyJhbGciOi)"` over `apps packages supabase docs .env.example`, excluding env-var references): no leaked keys or project URLs — only documented env-var names in `apps/web/README.md`, `apps/web/lib/download.ts`, and its test fixture.

## Findings summary

| ID | Category | Severity | File:line | One-line |
|----|----------|----------|-----------|----------|
| 3.1 | Auth/session | MEDIUM — **REMEDIATED July 19, 2026** | `apps/web/app/auth/actions.ts` (was :11-17) | Open redirect: `safeNextPath` rejected `//evil.com` but not the backslash form `/\evil.com` — browsers parse `\` as `/`, so login/signup `redirect(next)` could bounce a just-authenticated user off-site |
| 5.1 | AI | MEDIUM — **REMEDIATED July 19, 2026** | `apps/web/lib/briefing.ts:257` | Prototype-key evidence refs (`toString`, `__proto__`, …) survived the invented-ref strip because the membership test used `ref in catalog`, which walks the prototype chain |
| 3.2 | Auth/session | LOW — noted | `apps/web/lib/invites.ts:97-100` | Invite token travels in GET query strings (`/invite?token=…`, re-embedded into login/signup `?next=…`), so it can land in server/proxy logs and browser history; mitigated by hashing-at-rest, single-use, email binding, and expiry |
| 2.1 | RLS | LOW — noted | `supabase/tests/team_cloud_rls.sql:3-5` | Test-matrix gap: manager-mints-manager-invite deny (the owner-only branch of `invites_insert_managers`) is untested, and the pgTAP suite is authored but unrun (no Supabase CLI/psql on this machine) |
| 2.2 | RLS | LOW — noted | `supabase/migrations/202607190001_team_cloud_v1.sql:687-693` | Superseded snapshot rows are never pruned: `latest_team_snapshots` hides them from the dashboard, but managers can read older, higher-detail rows straight from `workload_snapshots` after a member narrows sharing, until the member deletes cloud history |
| 4.1 | Sync integrity | LOW — noted | `packages/inference/src/sharedSnapshot.ts:456-459` | Builder falls back to a non-UUID `wfsnap1-<fingerprint>` `client_snapshot_id` for the single render before `useCloudSync`'s effect reserves a `crypto.randomUUID()`; a Sync Now clicked in that window sends a value the `uuid` column rejects (transient, self-healing) |

## Remediation status (July 19, 2026 follow-up pass)

Both MEDIUM findings were fixed the same day by the remediation pass; the LOW items remain noted-only (two are environment-blocked, one is an accepted prototype trade-off).

- **3.1 fixed.** The open-redirect guard now lives in one shared helper, `apps/web/lib/safeNextPath.ts`, which rejects a second character of either `/` or `\`, and all four `next`-consuming sites import it instead of hand-rolling the check: `apps/web/app/auth/actions.ts` (login + signup actions), `apps/web/app/auth/callback/route.ts`, `apps/web/app/login/page.tsx`, and `apps/web/app/signup/page.tsx`. Covered by 6 tests in `apps/web/lib/safeNextPath.test.ts` (normal path allowed; `//host`, `/\host`, `\\host`, absolute URLs, and empty/missing all fall back to `/dashboard`).
- **5.1 fixed.** `sanitizeEvidenceRefs` in `apps/web/lib/briefing.ts` now uses `Object.prototype.hasOwnProperty.call(catalog, ref)` instead of `ref in catalog`, so prototype keys can no longer masquerade as catalog citations. Regression test in `apps/web/lib/briefing.test.ts` feeds `evidenceRefs: ["toString", "__proto__", "member:1:risk:low-headroom"]` and asserts only the real catalog ref survives.
- **Gate after remediation:** `npm run verify:wave3` exit 0 — 60/60 desktop-cloud tests, 102/102 web tests, 12 routes / 11 static pages; `apps/web` `npx tsc --noEmit` exit 0.

---

## Category 1 — Payload leakage: NO_BLOCKING_FINDINGS

Negative checks executed (all read in full, spread/field-audited):

- `packages/domain/src/cloud.ts` — `SharedWorkloadSnapshotV1` is a closed allowlist (ids, week, timestamps, `Partial<>` of 10 numeric metric keys, taxonomy-bounded allocation arrays, review-coverage counts). No raw-string fields (titles, notes, evidence, app names) exist on any shared type. `CloudAccountSummary` (139–147) excludes access/refresh tokens.
- `packages/inference/src/sharedSnapshot.ts` — payload assembled field-by-field (`buildSharedWorkloadSnapshot`, 436–453); the only spread is `{ ...snapshot.metrics }` over already-allowlisted numeric keys — no spread from `WeeklyCapacitySnapshot`, `WorkBlock`, or `policy`. Metrics gated by both `METRIC_RULES` and `policy.metrics[key] === true` (411–416); non-finite → omitted, never zeroed. `sanitizeAllocation` (204–217) re-validates labels against the fixed taxonomy, so corrupted persisted labels cannot smuggle free text. `buildProjectAllocation` (224–250) counts only `user_verified === true` blocks whose trimmed `project_name` exactly matches the member allowlist.
- `apps/desktop/src/services/cloudPolicy.ts` — `sharedSnapshotToRow` (382–413) maps field-by-field, no spread; disabled metric → `null` column. `buildCloudBackupMetadata` (302–332) omits `session`/tokens by construction.
- `apps/desktop/src/services/cloudClient.ts` — `upsertWorkloadSnapshot` (224–252) sends exactly the `WorkloadSnapshotRow`. `failureMessage` (57–71) reads only `error_description/msg/message`, capped 200 chars — never echoes response bodies. Anon key + user session only; no service key on the desktop.
- `apps/desktop/src/services/cloudStore.ts` — session tokens stored under a separate key, wiped by `clearPersistedCloudState`, never merged into exports.
- `apps/desktop/src/lib/audit.ts` + `useCloudSync.ts` — `createCloudSharingAuditEvent` (181–203) hardcodes `auth_tokens: false, raw_activity: false`; actual callers (`useCloudSync.ts:130-142, 299-308`) pass only team/week ids, share level, metric **count**, `client_snapshot_id`, fingerprint — never metric values or raw data.
- `apps/desktop/src/lib/dataExport.ts` — `FullBackup` is `Omit<PersistedAppState, "version" | "aiConfig">` (235), so AI credentials excluded; cloud metadata uses the token-free projection. (The full backup contains the local work ledger — a user-initiated local file of the user's own data, not a network path; out of the cloud-sharing claim's scope.)
- `SharePreview.tsx` / `CloudAccountPanel.tsx` — the preview renders the **same object reference** returned as `snapshot` from the builder (`sharedSnapshot.ts:465`), dumped verbatim (`SharePreview.tsx:37`): preview == upload. Consent gating (`consentedAt === null` disables Sync) enforced at `CloudAccountPanel.tsx:432-433`.

## Category 5 — AI (Team Briefing): one MEDIUM finding

### Finding 5.1 — Prototype-key evidence refs survive the invented-ref strip (MEDIUM)

- **File:line:** `apps/web/lib/briefing.ts:257` (`sanitizeEvidenceRefs`)
- **Expected:** every model-returned `evidenceRef` not in the sent catalog is dropped ("unknown refs are dropped, not trusted", module header 22–23).
- **Actual:** the membership test uses `ref in catalog`, which walks the prototype chain; the catalog is a plain object literal (`briefing.ts:84`). A model emitting `evidenceRefs: ["toString"]` (or `constructor`, `valueOf`, `hasOwnProperty`, `__proto__`, …) passes validation and is rendered to the manager as a real citation (`BriefingPanel.tsx:69`, `:85`).
- **Impact bound:** limited to the fixed `Object.prototype` key names; no member PII leaks — but it is a fabricated citation displayed as grounded evidence, exactly what the strip claims to prevent.
- **Smallest safe remediation:** replace `ref in catalog` with `Object.prototype.hasOwnProperty.call(catalog, ref)` (optionally build the catalog with `Object.create(null)`).
- **Regression test:** extend `briefing.test.ts` — feed `validateBriefingResult` a candidate with `evidenceRefs: ["toString", "__proto__", "member:1:risk:low-headroom"]`; assert the sanitized result is exactly `["member:1:risk:low-headroom"]`.
- **Remediation status:** Fix applied in this working tree (see regression tests)

### Category 5 negative checks executed (no other findings)

- Allowlisted input: `BriefingInput`/`BriefingMemberInput` (briefing.ts:35–187) carry only neutral refs, display name (explicitly permitted), share level, freshness label, four shared percentages, and deterministic `riskFlags`. `MemberWorkloadInput` (`workload.ts:35–49`) has no title/note/project/evidence field, so raw data cannot reach the prompt. Unshared metrics stay `null` → "did not share …" wording (briefing.ts:129–147), never zeroed.
- No ranking/HR/medical language: `SYSTEM_INSTRUCTION` (506–516) forbids it; `deterministicFallbackBriefing` (403–500) is process-level only; `briefing.test.ts:153–190` pins the ban ("burnout/discipline/terminat/diagnos/fire", no "ranked/ranking").
- API key: `OPENAI_API_KEY` read only in `getBriefingModelConfig` (566), used only in the Authorization header (663); server action returns no key; `BriefingPanel.tsx` (client) never imports the server-only module (`briefingState.ts:8-13` documents the deliberate disclosure-string duplication).
- Retention: `store: false` set (briefing.ts:669) and pinned by `briefing.test.ts:356`; model output flows only into transient action state — grep for inserts/persists found no write of model output to any table.

---

## Category 2 — RLS/authorization: NO_BLOCKING_FINDINGS (two LOW notes)

Negative checks executed against `supabase/migrations/202607190001_team_cloud_v1.sql` (read in full), `supabase/tests/team_cloud_rls.sql`, and every web/desktop query surface:

- Cross-team reads: every policy on `teams`/`team_memberships`/`team_invites`/`workload_snapshots` gates through the `private.*` helpers scoped by `team_id` (migration 574–679); the pgTAP outsider-D block asserts zero enumeration of teams, memberships, snapshots, invites, and the view (tests 275–279). RLS is both **enabled and forced** on all five tables in the same migration (538–548), and `anon` has table privileges revoked entirely (699–704; test 359–364).
- Forged `user_id`/`team_id`: `snapshots_insert_self_member` WITH CHECK requires `user_id = auth.uid()` **and** active membership in `team_id` (653–660); the UPDATE policy re-checks both sides (662–673), so a row cannot be reassigned post-insert. pgTAP covers forge-as-peer, write-into-foreign-team, and UPDATE-reassignment (tests 141–184).
- Member reading peers: `snapshots_select_authorized` (644–651) allows self or manager only; member B sees only their own membership row, not the roster (test 193–198); member C — whose `raw_user_meta_data` deliberately claims `"role":"owner"` — is denied peer reads both on the table and through the view (tests 49, 204–218).
- Manager overreach: managers read rosters and member snapshots but the snapshot DELETE policy is self-only (675–679; test 247–255 pins the silent zero-row match); there is **no INSERT or UPDATE policy at all** on `team_memberships` (63–65, 593–594), so role creation/mutation is RPC-only and self-promotion is structurally impossible; `leave_team` refuses owners (517–519); `accept_team_invite` refuses to overwrite an active membership, so an invite can never demote an active owner/manager (470–474).
- Invite token replay/wrong email: only the SHA-256 hash is stored (CHECK `'^[a-f0-9]{64}$'`, 94; contract comment 715–722); `accept_team_invite` serializes on `for update` (441–445), enforces one-time acceptance (451–453), expiry (455–457), and exact lowercase email match against `auth.users` (430–437, 459–461). pgTAP covers wrong-email denial, one-time replay denial, and expired-invite denial (tests 295–300, 322–327, 346–351).
- User-metadata role escalation: `private.handle_new_user` copies `display_name` as truncated text only (338–353); no policy or function reads `raw_user_meta_data` for authorization (header 28–30); member C's forged metadata grants nothing (tests 206–232), including invite minting (220–232).
- SECURITY DEFINER `search_path`: every definer function pins `set search_path = ''` (238, 254, 271, 288, 342, 381, 413, 495); pgcrypto is pinned to the `extensions` schema and called as `extensions.digest(...)` (34–35, 439); all helpers are revoked from `public` and granted to `authenticated` only (303–310, 355–356, 527–532); the `private` schema grants USAGE only — table access inside it stays revoked (37–38, 312–317).
- View bypass: `latest_team_snapshots` is created `with (security_invoker = true)` (687–693), so it evaluates the base table's RLS as the querying user; the pgTAP suite asserts the reloption (65–74) and denies C and D through the view (213–218, 279).
- Service key exposure: the desktop app uses only `VITE_SUPABASE_URL` + anon key under the user's own session (`apps/desktop/src/services/cloudClient.ts:1-11, 34-48`); the web server client uses the anon key (`apps/web/lib/supabase/server.ts:21`). The only service-role usage in the product is the download signed-URL bridge, where the key is read from server env inside the route, used to mint a signed URL, and never returned or bundled (`apps/web/app/download/artifact/route.ts:39-49`). The repo-wide secret grep (header) found no leaked keys.
- Web query surfaces select explicit columns and rely on RLS rather than filtering for security: `apps/web/lib/snapshots.ts:81-106` (view), `apps/web/lib/teams.ts:62-181`, `apps/web/lib/profile.ts:22-44`; team/invite mutations go through RPCs or RLS-checked inserts under the user session (`apps/web/app/teams/actions.ts:75-77, 141-148, 199-201, 319-321`).

### Finding 2.1 — RLS test matrix authored but unrun, with one deny branch untested (LOW)

- **File:line:** `supabase/tests/team_cloud_rls.sql:3-5` (header: "NOT EXECUTED IN THIS REPOSITORY … EXPECTED, not VERIFIED"); migration `202607190001_team_cloud_v1.sql:620-631` (`invites_insert_managers`).
- **Expected:** every deny branch in the policy matrix has an executable pgTAP assertion, run at least once against a local stack.
- **Actual:** the 39-assertion suite has never run (no Supabase CLI/psql in this environment), and no fixture exercises the owner-only branch of `invites_insert_managers`: there is no non-owner **manager** actor, so "manager mints a `role='manager'` invite → denied" (627–630) is asserted nowhere. All invite-mint tests use owner A (member role, 257–267) or non-managers C/D (220–232, 281–293).
- **Evidence:** `grep -n -i manager supabase/tests/team_cloud_rls.sql` — every hit is owner A or the schema-contract check; no `set local "request.jwt.claim.sub"` for a manager-role, non-owner user exists.
- **Smallest safe remediation:** add a manager-M fixture (`role='manager'`, active, non-owner in T1) plus one `throws_ok` for a `role='manager'` invite insert (42501) and one `lives_ok` for a `role='member'` insert; bump `plan(39)` accordingly; run `supabase test db` in CI.
- **Regression test:** the added pgTAP cases are the regression test; QA-01 (live four-actor proof) remains the tracking item.
- **Severity:** LOW — the policy SQL itself is correct on inspection; the gap is verification coverage, not a defect.

### Finding 2.2 — Superseded snapshot rows are never pruned (LOW)

- **File:line:** migration `202607190001_team_cloud_v1.sql:687-693` (view hides, does not delete); `apps/desktop/src/services/cloudPolicy.ts:245-252` (new `client_snapshot_id` per content fingerprint → new row per change); `apps/desktop/src/services/cloudClient.ts:224-252` (upsert only ever merges the *same* id).
- **Expected:** a member who narrows sharing (e.g. drops from `projects` to `summary`, or disables metrics) reasonably expects the manager surface to reflect only the current consent.
- **Actual:** every content change inserts a new row and nothing deletes prior ones. `latest_team_snapshots` hides superseded rows from the dashboard, but `snapshots_select_authorized` (644–651) lets a manager query `workload_snapshots` directly and read the member's full history — including older, higher-detail rows shared under an earlier, broader policy — until the member runs "Delete my cloud history" (`apps/web/app/teams/actions.ts:226-268`) or the desktop delete (`cloudClient.ts:259-284`).
- **Evidence:** repo-wide search finds no other DELETE against `workload_snapshots`; both delete paths are user-initiated and all-rows-for-team.
- **Smallest safe remediation:** after a successful upsert, have the client delete its own older rows for the same `(team_id, week_id)` (self-delete passes `snapshots_delete_self`); or document the retention behavior explicitly in `docs/PRIVACY.md`.
- **Regression test:** sync twice with changed content for the same week; assert exactly one row remains for `(user, team, week)` — or assert the PRIVACY.md wording if the documentation route is chosen.
- **Severity:** LOW — every retained row is an allowlisted payload the member explicitly previewed and consented to at the time it was shared; this is a retention-expectation gap, not an exposure of unshared data.

## Category 3 — Auth/session: one MEDIUM finding, one LOW note

### Finding 3.1 — Open redirect via backslash bypass in `safeNextPath` (MEDIUM)

- **File:line:** `apps/web/app/auth/actions.ts:11-17` (`safeNextPath`), consumed at `:25/:47` (login) and `:52/:95` (signup).
- **Expected:** `next` may only ever be a same-origin relative path (the function's own comment, line 12).
- **Actual:** the guard accepts any string starting with `/` unless it starts with `//` — but not the backslash form. `next=/\evil.com` passes, and `redirect(next)` emits `Location: /\evil.com`; WHATWG URL parsing treats `\` as `/`, so browsers navigate to `//evil.com` — a protocol-relative, off-site redirect fired immediately after a successful login or signup.
- **Reproduction:** submit the login form with a hidden `next` field of `/\evil.com` (e.g. from a crafted link to `/login?next=%2F%5Cevil.com`, which `login/page.tsx` threads into the form); after correct credentials, the browser lands on `https://evil.com/` — prime post-auth phishing position. No cookie/token crosses origins; the harm is the off-site bounce of a user who just proved they trust weekform.com.
- **Impact bound:** redirect-only, with a workaround (a wary user can notice the destination) — hence MEDIUM, not HIGH.
- **Smallest safe remediation:** reject a second leading `/` **or** `\` — e.g. `value.startsWith("/") && !/^\/[/\\]/.test(value)` — or resolve `next` with the WHATWG URL parser against the request origin and require the result stay same-origin. Apply in one shared helper used by every `next` consumer (login/signup actions and pages).
- **Regression test:** unit-test the guard so `"/\\evil.com"`, `"/\\/evil.com"`, `"//evil.com"`, and `"https://evil.com"` all fall back to `/dashboard`, while `"/teams/abc"` passes through unchanged.
- **Severity:** MEDIUM.
- **Remediation status:** Fix applied in this working tree (see regression tests)

### Finding 3.2 — One-time invite token carried in URL query strings (LOW)

- **File:line:** `apps/web/lib/invites.ts:97-100` (`buildInviteUrl` → `/invite?token=…`), re-embedded into `?next=` at `apps/web/app/invite/page.tsx:137-143` and `apps/web/app/teams/actions.ts:283-287, 316`.
- **Expected:** a single-use secret is not written to surfaces that routinely record full URLs.
- **Actual:** the raw invite token rides in the GET query string of `/invite?token=…` and is copied into login/signup `?next=` return paths, so it can be captured by server/reverse-proxy access logs, browser history, and `Referer` headers.
- **Evidence:** `buildInviteUrl` composes `?token=${encodeURIComponent(token)}` (`invites.ts:99`); `invite/page.tsx:23-25` reads `searchParams.token` and threads it into `next` (`:137-143`).
- **Impact bound:** heavily mitigated — only the SHA-256 hash is persisted (migration 78–84, 94), acceptance is one-time (`accept_team_invite` 451–453), email-bound (459–461), and expires within 30 days (96); rendering `/invite` never mutates state (page docstring 17–21), so prefetchers/scanners cannot consume the token.
- **Smallest safe remediation:** prefer a POST body / form field for the token where feasible, and scrub the `token` param from any request logging; document the residual exposure.
- **Regression test:** assert acceptance still succeeds when the token is submitted through the POST form (not the query string), and that `buildInviteUrl` output is covered.
- **Severity:** LOW — defense-in-depth on an already hashed, single-use, expiring, email-bound token.

## Category 4 — Sync integrity: NO_BLOCKING_FINDINGS (one LOW note, 4.1)

Negative checks executed:

- **Duplicate retries.** `client_snapshot_id` is reserved once per content fingerprint and persisted (`cloudPolicy.ts:245-252`, `useCloudSync.ts:79-87`); the upsert uses `on_conflict=user_id,client_snapshot_id` with `Prefer: resolution=merge-duplicates` (`cloudClient.ts:224-252`) against the per-user uniqueness constraint (migration 135), so a retry or relaunch updates one row rather than duplicating.
- **Changed policy but stale payload.** The previewed object reference IS the uploaded row (`sharedSnapshot.ts:461-467`, `useCloudSync.ts:1-9, 108`); consent-sensitive policy changes null `consentedAt` (`useCloudAccount.ts:192-226`) and the scheduler requires `hasConsent` (`cloudScheduler.ts:87-103`), so a stale payload cannot ride a changed policy.
- **Disabled fields represented as zero.** `metricOrNull`/`allocationOrNull` (`cloudPolicy.ts:365-374`) emit `null`, and the DB `workload_snapshots_level_shape` CHECK (188–198) forbids breakdowns above the share level; a disabled metric is omitted, never zeroed.
- **Offline loops.** Transient retries are capped at three (~1/5/15 min) then stop until a fresh trigger (`cloudScheduler.ts:28-31, 60-69`); 401/403 classify as `auth` and stop retries immediately (`:56-58`, `useCloudSync.ts:245-267`). Unchanged content performs no network call (`shouldPerformSyncAttempt`, `:115-119`).
- **Membership removal.** `hasTeamMembership` is recomputed from the live team list (`useCloudSync.ts:202-205`); losing membership collapses the plan to `NOT_SCHEDULED` (`cloudScheduler.ts:83-84, 93-104`). RLS independently denies inserts into a team the caller no longer belongs to (`snapshots_insert_self_member`).

### Finding 4.1 — Non-UUID fallback `client_snapshot_id` for one render (LOW)

- **File:line:** `packages/inference/src/sharedSnapshot.ts:456-459`.
- **Expected:** the `client_snapshot_id` sent to the `uuid` column is always a UUID.
- **Actual:** the builder defaults `clientSnapshotId` to `wfsnap1-<fingerprint>` when no reserved id is supplied. `useCloudSync` reserves a real `crypto.randomUUID()` in a `useEffect` (`:81-87`) that commits one render *after* the first build, so for the single initial render (or where `crypto.randomUUID` is unavailable) the buildable payload carries the non-UUID sentinel. A Sync Now fired in that window sends `wfsnap1-…`, which the `workload_snapshots.client_snapshot_id uuid` column rejects (400 / 22P02).
- **Evidence:** `sharedSnapshotToRow` copies `snapshot.clientSnapshotId` verbatim (`cloudPolicy.ts:388`); no UUID coercion exists between the builder and the wire.
- **Impact bound:** transient and self-healing — the reserving effect replaces the sentinel on the next render, and the failure is a rejected write, not a bad row or a leak.
- **Smallest safe remediation:** reserve the UUID synchronously in the build memo, or have the builder mint a UUID fallback via an injected generator, so preview and upload never carry the sentinel.
- **Regression test:** build a payload with no supplied `clientSnapshotId` and assert the id is a UUID (or that `syncNow` refuses to send a non-UUID id).
- **Severity:** LOW — a narrow, self-correcting failed-write window, not a privacy or authorization defect.

## Category 6 — Product honesty: NO_BLOCKING_FINDINGS

Every core claim was checked against code and found accurate — no overstatement of encryption, notarization, always-on behavior, or gated source:

- **"Local-first" after the cloud addition.** README (`:10`, `:245`) and PRIVACY (`:53-59`) claim local-first, and code holds it: cloud sharing is OFF by default (`cloudPolicy.ts:83-96`), requires explicit sign-in + team + level + per-metric consent recorded against the exact previewed payload, and when `VITE_SUPABASE_*` is absent every cloud feature renders an honest "not configured" state (`cloudClient.ts:33-48`) with the app fully local. No secret/service key ships in the desktop app (verified in Category 2).
- **App-closed hourly behavior.** PRIVACY (`:59`) states "scheduled sync can only run while the app is open" — matched by `useCloudSync.ts:323-354`, where the single `window.setTimeout` is the only timer and dies with the webview; there is no background/daemon path, and the interval is pinned to 60 minutes (`cloudScheduler.ts:25`, `useCloudAccount.ts:195`). No "24/7" or "always syncing" claim appears anywhere.
- **Account-gated download vs public source.** The `/download` page (`:67-124`) and the artifact route (`route.ts:9-23`) explicitly state the gate "controls the packaged distribution path, not the source code, which has always been public," and link straight to the public GitHub repo/source archive — no false "source is inaccessible" claim (the runbook's forbidden overstatement, lines 802–803). The route returns an honest 503 when no private bucket is configured rather than faking a build.
- **Prototype credential storage.** PRIVACY (`:17`, `:59`, `:103`), README (`:223`), and the download page (`:160-183`) all state local storage is **unencrypted** prototype storage and the app is **not Apple-notarized** — consistent with `cloudStore.ts` (Tauri Store / localStorage, no encryption) and the AI-key handling in PRIVACY (`:21`). The "prototype, not a production workforce-management system" caveat is prominent (README `:32`).
- **No fabricated deployment status.** PRIVACY (`:103`) and the migration header (1–5) both state the SQL/RLS tests are review artifacts not applied to or verified against a live project — matching the unrun-suite reality in Finding 2.1, so the docs do not overclaim verification.

---

*All six Prompt 10 categories are now written into this file. Conclusions: Categories 1, 4, and 6 closed NO_BLOCKING_FINDINGS (4 carries LOW note 4.1); Category 2 produced LOW findings 2.1 and 2.2; Category 3 produced MEDIUM 3.1 and LOW 3.2; Category 5 produced MEDIUM 5.1. Both MEDIUM findings (3.1, 5.1) were remediated in this working tree the same day — see the per-finding "Remediation status" lines and the "Remediation status" section above. No BLOCKER or HIGH finding was found; the live four-actor RLS proof (QA-01) remains environment-blocked.*
