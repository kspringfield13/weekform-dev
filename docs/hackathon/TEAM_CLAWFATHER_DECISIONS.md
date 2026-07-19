# Team Clawfather — Decision Register

**Team:** Weekform Team Clawfather — OpenAI Build Week 2026, Work and Productivity track
**Deadline:** July 21, 2026, 5:00 PM PDT / 8:00 PM EDT; internal submission 3:00 PM EDT; feature freeze July 20, 9:00 PM EDT (blueprint §11).
**Sources of truth:** `AGENTS.md`, `docs/WEEKFORM_TEAM_CLAWFATHER_HACKATHON_BLUEPRINT.md` (sections cited per decision), `docs/hackathon/TEAM_CLAWFATHER_PRODUCT_CONTRACT.md`.

Where the blueprint already decided, this register **records** that decision — it does not reopen it. Each entry states the decision, the alternatives rejected and why, and the reversal triggers (the only conditions under which the decision may be revisited, via the fallback named in blueprint §15 where one exists).

---

## D1. Web stack

**Decision** (blueprint §4.1, §7.1): Next.js App Router with TypeScript, deployed on Vercel, living at `apps/web/` alongside the existing `apps/desktop/`. Web sessions use the official `@supabase/ssr` cookie clients. UI reuses the existing Geist design language and CSS variables (shadcn/ui primitives only where genuinely useful), so desktop and web read as one product (`AGENTS.md` "UX and design bar"). Root scripts `web:dev` / `web:build` are added explicitly; the existing root `npm run build` desktop gate is not silently replaced (§7.1).

**Alternatives rejected:**
- *Extend the Tauri/Vite app into a hosted web product* — the desktop webview app is not an SSR/auth/route-handler platform; it would entangle high-conflict desktop files (§10) with the new cloud surface.
- *Any other framework (Remix, SvelteKit, plain Vite SPA + separate API)* — `@supabase/ssr` + Next.js App Router is the officially documented Supabase SSR path (§4.1); a SPA would need a bespoke server for invites, signed download URLs, and the server-side OpenAI route.
- *A new design system for web* — forbidden by `AGENTS.md` ("do not create a parallel design system") and slower.

**Reversal triggers:** Vercel deployment or domain connection is blocked near the deadline → submit the Vercel preview URL and connect weekform.com later (§15 fallback). There is no in-window trigger for changing the framework itself; that would violate the §15 kill criteria (twice-estimate rule) at this date.

---

## D2. Desktop auth path

**Decision** (blueprint §4.2): the user creates the account on weekform.com first; after installing, the Mac app asks for the same email/password and obtains its own Supabase session via `@supabase/supabase-js` with the publishable key — RLS authorizes all reads/writes; no service key ever ships in the app (§4.1). The UI and privacy docs must disclose that the saved session lives in unencrypted prototype local storage; Keychain storage is post-hackathon (§4.2 caveat, §2.4).

**Alternatives rejected:**
- *Deep-link / browser-callback OAuth* — macOS deep-link registration must be declared in app configuration and tested in a bundled build; it is a sensible upgrade, not the fastest P0 dependency (§4.3; also P2 in §3.3 until password auth is stable).
- *Device pairing as the primary path* — more secure in scope but more custom code (web code issuance, exchange function, scoped token); reserved as the fallback, not the default (§4.2).
- *Silently sharing the web session with the desktop app* — no supported mechanism in the window, and it would blur the consent boundary the product depends on.

**Reversal triggers:** desktop email/password session proves unreliable in integration smoke tests → switch to the one-time device-pairing code (signed-in web user mints a short-lived code; desktop exchanges it for a revocable, narrowly scoped device token that can only write that user's snapshots and read their memberships), or a manually entered short-lived token at worst (§4.2 fallback, §15).

---

## D3. Invitation path

**Decision** (blueprint §4.1, §6.1, §7.6): a Weekform-owned `team_invites` table plus a tokenized accept flow. The manager route generates a random token, stores **only its hash** (`token_hash`), 72-hour expiry, one-time use, and returns a copyable invite URL. Acceptance goes through a security-definer RPC `accept_team_invite(raw_token)` that hashes, verifies expiration/email/authenticated user, inserts the membership, and marks the invite accepted (§6.3). Copy-link is the deterministic P0 delivery; email (Resend/SMTP) is optional P1 (§3.2, §7.6).

**Alternatives rejected:**
- *Supabase Auth Admin invites as the team model* — works poorly for already-existing confirmed accounts and couples team membership to auth-admin behavior; the custom table works for both existing and new users (§7.6).
- *Email delivery as a P0 dependency* — email failure is a High-probability risk (§15); the demo must never depend on deliverability.
- *Open join codes / public team URLs* — no recipient binding, no expiry/one-time-use semantics, weaker story under judging.

**Reversal triggers:** invite email fails or is slow → copy link only (§15). Invite RPC problems late in the window → managers pre-create the synthetic demo memberships via the reviewed seed (§6.4), never by hand-editing production tables during the demo (§11 Phase 3 exit gate).

---

## D4. Official download gate

**Decision** (blueprint §3.1 item 3, §4.1, §7.7): `/download` requires an authenticated session; a server route returns a short-lived (5–10 minute) signed URL to the official artifact in **private Supabase Storage**. The artifact may be the guided source ZIP containing `scripts/install.command` for the hackathon. The public repository stays public — the gate controls the official packaged experience, not source-code DRM. Optional analytics limited to `download_requested`/version/account ID; never workload data (§7.7, §3.2).

**Alternatives rejected:**
- *No gate (public download link)* — breaks the account → team → download product story that P0 requires (§1 demo promise, §3.1).
- *Making the repository private for enforcement theater* — conflicts with submission proof requirements (public repository, §16.3) and the Build Week provenance posture (`AGENTS.md`).
- *Signed/notarized DMG pipeline as a P0 requirement* — explicitly deferred if it threatens the vertical slice (§3.3); the source-build installer already exists (§2.1).

**Reversal triggers:** private-storage artifact too large or bucket limits block delivery → authenticated download page that links the current public source archive and honestly documents the limitation; **do not fake enforcement** (§7.7, §15). macOS build/signing blocks → authenticated source ZIP (§15).

---

## D5. Shared payload levels

**Decision** (blueprint §5.1–§5.4): the cloud receives only `SharedWorkloadSnapshotV1`, built by a pure allowlist function (`packages/inference/src/sharedSnapshot.ts`, types in `packages/domain/src/cloud.ts`) — never the desktop state object or a filtered copy (§5.1). Three member-chosen share levels: **Summary** (toggled numeric metrics only) → **Categories** (adds category and work-mode label/value aggregates) → **Projects** (adds per-project allocation for explicitly allowlisted names only, reviewed blocks only, "Unassigned work" grouped, no stakeholders or notes) (§5.2). Sharing defaults **off**; consent timestamp required; the preview is generated from the same object that uploads (§5.4 req. 10, §5.5). `user_id` is assigned by the authenticated write path, never trusted from the payload (§5.3). Contract tests assert forbidden keys and sensitive sentinel strings can never appear (§5.4 req. 9, §14.1).

**Alternatives rejected:**
- *Blocklist filtering of local state* — leaks by default as local models evolve; explicitly named as the failure the allowlist prevents (§5.1).
- *A single all-or-nothing share switch* — destroys the granular-consent novelty claim and the revocation demo step.
- *Uploading raw sessions/titles/evidence "for richer dashboards"* — hard P2 exclusion (§3.3) and a runbook rejection criterion; violates `AGENTS.md` local-first invariant.

**Reversal triggers:** none for the boundary itself — a privacy-contract change after Phase 1 is a §15 kill criterion, not a tuning knob. If the builder or tests slip, the level set may be narrowed for P0 (ship Summary + Categories; defer Projects), never widened.

---

## D6. Manager metrics

**Decision** (blueprint §3.1 item 6, §7.4): the manager dashboard shows, per active member: latest shared snapshot with reliable capacity, reactive load, meeting load, fragmentation, carryover risk, confidence/review coverage, freshness, and share level, with explicit "Not shared" states for omitted fields. Team overview uses **medians, ranges, and counts** — never percentages summed across people labeled "team capacity" (§7.4). Team risks are deterministic threshold heuristics labeled as planning flags/conversation starters (§7.4). **No rankings, no benchmarks, no synthetic productivity score**; missing or stale data is labeled, never interpreted as poor performance (§3.1 item 6; `AGENTS.md` "No surveillance framing").

**Alternatives rejected:**
- *Any composite score or sorted member ranking* — categorically forbidden (§3.3, `AGENTS.md`); it is also the exact "most dangerous interpretation" the contract guards against.
- *Summed team-capacity percentage* — statistically dishonest across people with different baselines; explicitly banned (§7.4).
- *Per-minute or activity-level views* — P2 exclusion (§3.3); reintroduces surveillance semantics.

**Reversal triggers:** dashboard reads as surveillant in demo rehearsal (§15 critical product risk) → remove individual member detail and show team-level aggregates only. Member detail/history views are added only if P0 is already stable (§7.4).

---

## D7. AI boundary

**Decision** (blueprint §4.1, §9): the only new AI surface is the **Team Briefing Agent**, running server-side in a web route (`apps/web/app/api/team-briefing/route.ts`, §7.1) via the OpenAI Responses API with structured output (`TeamBriefingResult`, §9.3) and `store: false` where supported; model ID configured via `OPENAI_TEAM_BRIEFING_MODEL` and verified against current official docs — never guessed or frozen (§9.5; `AGENTS.md` "AI and OpenAI boundaries"). Inputs are strictly the shared, permitted data: team name, time window, latest permitted snapshots, share level/freshness, deterministic aggregates and risk flags — no raw titles, evidence, notes, screenshots, audit trail, credentials, or unshared fields (§9.2). Deterministic SQL/TypeScript computes the metrics; the model explains and synthesizes, it does not calculate the source of truth (§9.5). Prompt rules: absent ≠ zero, mention stale/partial sharing, no employee comparisons, no mental-health/medical/legal/HR conclusions, no disciplinary recommendations, prefer team/process interventions, cite metric/member references, state it is a planning aid (§9.4). The secret OpenAI key exists only server-side (§4.1). Build-time Codex/GPT-5.6 provenance is a separate concern from the runtime model and must not change runtime defaults for optics (`AGENTS.md`).

**Alternatives rejected:**
- *Calling OpenAI from the browser or desktop for the briefing* — exposes the secret key and the unshared-data boundary; server-side route is the §4.1 decision.
- *Letting the model compute capacity/risk numbers* — violates the deterministic-core invariant (`AGENTS.md`; §9.5).
- *More AI surfaces (auto-allocation, burnout detection, member scoring)* — explicitly out of the Agent's purpose (§9.1) and P2/forbidden territory (§3.3).

**Reversal triggers:** ungrounded or unreliable model output near the deadline → ship the deterministic briefing (aggregates + risk flags rendered without AI) (§15 fallback); the briefing is P1, so it is also first in the cut order after hourly sync polish.

---

## D8. Scheduled-sync semantics

**Decision** (blueprint §4.1, §8.4–§8.6): synchronization is **push from the desktop only**, because only the local app possesses the current approved data — database cron cannot and must not be framed as pulling from a sleeping/closed Mac (§4.1). P0 is **manual Sync Now** with the full verification chain (signed-in → active membership → sharing enabled + consent → pure build → validate → preview hash → RLS upsert → receipt → local audit event without the payload → toast) (§8.4). P1 adds a 60-minute interval **only while the app process is running**, startup/resume catch-up when the last success is >60 minutes old and data/policy changed, retries at ~1/5/15 minutes capped, retry reuse of the same `clientSnapshotId`, a new snapshot ID only when the approved payload changes, and a data-change fingerprint to avoid redundant rows (§8.5–§8.6). Retries stop on sign-out, policy disable, membership loss, or invalid auth; no sync in demo mode without a dedicated flag; app closure means no schedule guarantee, and the UI says so honestly (§8.5; §15: label "while Weekform is running"). Audit copy follows §8.7; never "all data synced."

**Alternatives rejected:**
- *Supabase Cron pulling member data* — physically impossible against a closed Mac and a runbook rejection criterion; cron is reserved for later server-side rollups/retention/stale markers (§4.1).
- *A background daemon running after quit* — P2 exclusion (§3.3).
- *Aggressive real-time streaming* — P2 exclusion (§3.3); freshness labels make hourly honesty sufficient.

**Reversal triggers:** hourly scheduling slips or misbehaves → it is P1 and is cut; manual Sync Now is the P0 guarantee and the honest "while Weekform is running" label covers the gap (§15). Redundant-row noise on the dashboard → tighten the fingerprint (§8.6) rather than widening writes.

---

## D9. P0 / P1 / P2 scope

**Decision** (blueprint §3; recorded in full in `docs/hackathon/TEAM_CLAWFATHER_PRODUCT_CONTRACT.md` §2): P0 is the eight-part vertical slice — web foundation, team management with `owner`/`manager`/`member` **team memberships (no global user roles**, §7.3), authenticated download, desktop Account & Sharing with off-by-default consent and exact preview, versioned RLS-protected snapshot upload (**RLS is P0, not "later"**, §3.1 item 5, §6.2, Q-01 in §12), manager dashboard without rankings, the live revocation demonstration, and the Codex/GPT-5.6 evidence package. P1: hourly sync + catch-up, retry/offline UX, Team Briefing Agent, invite email, dashboard history, download analytics, membership management (§3.2). P2: everything in §3.3 — including billing, SSO, Realtime, multi-integration, raw data in Supabase, and rankings — is off the critical path, full stop.

**Alternatives rejected:**
- *A broader workforce-management platform* — rejected in the executive decision (§1): the winning move is one complete privacy-governed team loop, not breadth.
- *Deferring RLS or shipping direct table access "for now"* — an RLS mistake is a critical risk (§15); the fallback is demo-only server routes with strict server checks, never unprotected tables; leaving RLS to later is a runbook rejection criterion.
- *Global "manager vs user" account flags* — rejected by §7.3; roles belong to team memberships so one person can manage one team and be a member of another.
- *Pulling any P1 item into P0 for demo sparkle* — the §11 Phase gates order the work; P1 starts only after the P0 loop passes its exit gate (one real authenticated snapshot through RLS, manager-only read, member-to-member denial, no forbidden fields).

**Reversal triggers:** scope moves in only one direction — down. Triggers and cut order are the §15 kill criteria and fallbacks as recorded in the product contract §2.4: any task at 2× estimate without a P0 demo artifact is cut or falls back; overruns cut P1 first (hourly sync, invite email, AI briefing → deterministic briefing), then degrade P0 edges (signed download → honest authenticated source page; password auth → pairing code; member cards → team aggregates). Manual sync, RLS, exact-preview consent, and revocation are never cut.

---

## Cross-cutting constraints binding every decision

- **No raw-activity upload, ever** — §3.3, §5.2, runbook rejection criteria.
- **No global user roles** — team memberships only (§7.3).
- **RLS ships in P0** with the negative test matrix of §14.2 (Manager A / Member B / Member C / Outsider D).
- **No billing, SSO, Realtime, or multi-integration in P0** (§3.3).
- **One desktop writer** owns `apps/desktop/src/App.tsx`, `apps/desktop/src/components/settings/SetupScreen.tsx`, `apps/desktop/src/components/shell/ScreenRouter.tsx`, and `apps/desktop/src/services/localStore.ts` at any time (§10 parallel-writing rule).
- **Synthetic data only** in demos, seeds, screenshots, and evidence (§6.4; `AGENTS.md`).
- **The local-only Weekform experience keeps working with no cloud configuration** (§14.3, §18) — cloud is opt-in, and the existing demo must run without Supabase env.
