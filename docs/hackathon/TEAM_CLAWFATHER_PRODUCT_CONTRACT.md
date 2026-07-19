# Team Clawfather — Product Contract

**Team:** Weekform Team Clawfather — OpenAI Build Week 2026, Work and Productivity track
**Deadline:** July 21, 2026, 5:00 PM PDT / 8:00 PM EDT (internal submission target 3:00 PM EDT)
**Status of this document:** Approved product contract. Sources of truth: `AGENTS.md`, `docs/WEEKFORM_TEAM_CLAWFATHER_HACKATHON_BLUEPRINT.md` (cited by section below), `docs/PRIVACY.md`, `docs/BUILD_WEEK_2026.md`. Where this document and the blueprint conflict, the blueprint wins; escalate the discrepancy instead of improvising.

**Product statement** (blueprint §1): Weekform gives each teammate private workload intelligence on their Mac and lets them share only approved capacity signals with the people coordinating the work.

**Submission headline** (blueprint §1): *Know what your team can take on — without turning work into surveillance.*

---

## 1. Judging criteria → one 3–4 minute demo

OpenAI judges four criteria: technical implementation, design/UX, potential impact, and quality of idea (`AGENTS.md` "Build to win, then compound"; blueprint §16.2). The submission answers all four with **one** demo narrative rather than four separate pitches.

### 1.1 What each criterion must see

| Criterion | What the demo proves | Where in the demo |
|---|---|---|
| Technical implementation | Real behavior across Tauri/Rust native macOS + React/TypeScript + Next.js web + Supabase Auth/Postgres/RLS + manual/scheduled sync + structured OpenAI output, with Codex/GPT-5.6 build evidence (blueprint §16.2). | Steps 3–6 below span all four surfaces; step 8 shows the round trip. |
| Design / UX | A coherent local-to-cloud experience: role onboarding, polished manager and member views, honest consent, empty, stale, and "Not shared" states (blueprint §7.4, §16.2; `AGENTS.md` "UX and design bar"). | Steps 2, 4, 5, 7. |
| Potential impact | Teams plan capacity from actual reviewed workload without deploying invasive central monitoring (blueprint §16.2). | Steps 1, 5, 6 — the manager makes a better commitment decision. |
| Quality of idea | Local-first, member-governed team intelligence is distinct from both task trackers and employee-surveillance products (blueprint §16.2). | Steps 3, 4, 7 — consent is the product, not a settings page. |

### 1.2 The demo in eight steps

This is the P0 demo. It maps to the blueprint's demo promise (§1) and the timed four-minute script (§16.1); it must be performable in under four minutes from a clean synthetic seed (§6.4, §14.5) without editing the database by hand (§11 Phase 3 exit gate).

1. **Problem + local intelligence** (~0:00–1:00). Show Weekform for Mac turning local signals into reviewed work blocks and an explainable weekly capacity view — task tools show assigned work, not the reactive, fragmented, meeting-heavy work consuming the week. (Inherited core; blueprint §2.1, §16.1.)
2. **Manager sets up the team on weekform.com.** Sign in as synthetic manager Maya Chen, create team "Northstar Analytics," generate a copyable invite link. (§3.1 items 1–2, §7.6.)
3. **Member joins and reaches the authenticated download.** Sign in as teammate, accept the invite, land on the authenticated Mac download page. (§3.1 items 2–3, §7.7.)
4. **Consent on the Mac.** In Account & Sharing, sign in with the same account; sharing is **off by default**. Choose share level Summary + Categories, toggle metrics, and preview the **exact payload**. Point out on camera what is absent: window titles, raw activity, evidence, notes, screenshots. Check "I reviewed what will be shared with this team," then Sync Now. (§3.1 item 4, §5.5, §16.1.)
5. **Manager sees only what was approved.** The manager dashboard shows the member's reliable capacity, reactive load, fragmentation, freshness, share level, and explicit "Not shared" states — no rankings, no productivity score. (§3.1 item 6, §7.4.)
6. **Team Briefing.** Generate an evidence-grounded briefing citing shared metrics, with coordination questions and stated limitations — not conclusions about people. (§9, §16.1; P1 feature with a deterministic non-AI fallback per §15.)
7. **Revocation.** On the Mac, turn off one metric (or delete cloud history) and resync. Refresh the manager view: the field becomes "Not shared" (or the snapshot disappears). Member control is real, not copy. (§3.1 item 7, §16.1.)
8. **Codex + impact close** (~3:40–4:00). State that Codex/GPT-5.6 mapped the pre-existing desktop system, designed the privacy contract, implemented native/web/backend in parallel, and reviewed RLS — with dated evidence per `docs/BUILD_WEEK_2026.md`. Weekform predates Build Week; only the team/cloud loop is new in-period (§16.1; `AGENTS.md` "Build Week evidence and public claims").

If a step cannot be shown live and reliably, it is cut from the demo — not narrated as if it worked (`AGENTS.md`: no fake success states).

---

## 2. Scope: P0 / P1 / P2

Grounded in blueprint §3. This is the approved scope; do not add to P0 and do not re-litigate P2 during the submission window.

### 2.1 P0 — the required winning slice (blueprint §3.1)

A submission missing any of these has an incomplete product story:

1. **Weekform.com foundation** — landing page, email/password auth, authenticated dashboard shell, role-aware onboarding.
2. **Team management** — manager creates a team, generates a teammate invite link; teammate accepts after sign-in/sign-up; membership roles `owner` / `manager` / `member` (team memberships, never global user roles — §7.3).
3. **Authenticated download** — official Mac download page requires authentication; route returns a short-lived signed URL or authenticated artifact. The public repository stays visible; the gate controls the official packaged experience, not source-code DRM.
4. **Desktop account and sharing** — Account & Sharing settings; sign in with the same Supabase account; team selection; **sharing off by default**; exact payload preview before first sync; share levels Summary / Categories / Projects; project names require an explicit allowlist; manual Sync Now.
5. **Cloud workload snapshot** — only reviewed, derived, aggregated data; versioned payload contract; idempotent upsert; **RLS-protected rows (P0, not "later")**; sync receipt and local audit event.
6. **Manager team dashboard** — latest shared snapshot per active member: reliable capacity, reactive load, meeting load, fragmentation, carryover risk, confidence, freshness, share level. No rankings, no synthetic performance score; missing/stale data is labeled, never read as poor performance.
7. **Privacy control demonstration** — member narrows scope or disables sharing; future sync omits removed fields; member can delete cloud snapshots for a team; manager view reflects it.
8. **Codex/GPT-5.6 evidence and submission package** — dated commits and task/session IDs, README story, demo video, synthetic multi-user seed, reproducible validation log.

### 2.2 P1 — only after the full P0 loop works end to end (blueprint §3.2)

- Hourly automatic sync while Weekform is running, plus startup catch-up when the last success is older than one hour.
- Bounded retry and offline state.
- OpenAI-powered Team Briefing with structured output and metric citations (deterministic fallback stays available — §15).
- Email delivery of invite links; copy-link remains the deterministic fallback.
- Team dashboard history across several snapshots.
- Authenticated download analytics limited to product events (never workload data).
- Manager can change a member's role or remove a membership.

### 2.3 P2 — explicitly deferred; never on the critical path (blueprint §3.3)

Billing/subscriptions/seat limits; enterprise SSO/SCIM; HRIS/Jira/Asana/Linear/Slack-OAuth/Teams-OAuth integrations; real-time streaming dashboards; raw sessions, window titles, screenshots, calendar titles, notes, or evidence in Supabase; per-minute activity views; manager-enforced sharing policies; employee rankings, benchmarks, utilization league tables, or "productivity scores"; multi-region residency; mobile apps; Windows; a full background daemon when the app is quit; a notarized updater pipeline if it threatens the slice; deep-link OAuth before email/password desktop sign-in is stable; complex multi-organization administration; a general-purpose analytics warehouse.

### 2.4 What gets cut when a task overruns (blueprint §11, §15)

- **Feature freeze:** Monday, July 20, 9:00 PM EDT. **Internal submission:** Tuesday, July 21, 3:00 PM EDT. The 8:00 PM EDT official deadline is not the working target.
- **Kill criteria** (§15): stop or defer any feature that has consumed twice its estimate without a P0 demo artifact; requires changing the privacy contract after Phase 1; introduces a second writer into desktop integration files (`apps/desktop/src/App.tsx`, `apps/desktop/src/components/settings/SetupScreen.tsx`, `apps/desktop/src/components/shell/ScreenRouter.tsx`, `apps/desktop/src/services/localStore.ts` — §10); cannot be tested with synthetic data; weakens an RLS or validation gate; or does not improve the judge-facing golden path.
- **Cut order when the deadline bites** (§15 fallbacks): P1 items go first (hourly sync → invite email → briefing AI, replaced by the deterministic briefing). Within P0: signed-artifact download degrades to an authenticated page linking the source ZIP with the limitation stated honestly (§7.7); desktop password auth degrades to a one-time device-pairing code (§4.2); a surveillance-feeling dashboard degrades to team-level aggregates only (§15). Manual Sync Now, RLS, the exact-preview consent flow, and revocation are never cut — without them there is no product thesis.

---

## 3. Novelty claim and the surveillance risk

### 3.1 The strongest novelty claim

**Consent is the architecture, not a checkbox.** Weekform is a local-first workload-intelligence engine where each member's raw evidence never leaves their Mac; the cloud receives only a separately constructed, versioned, allowlisted snapshot (`SharedWorkloadSnapshotV1`) that the member previewed and approved — and the member can narrow or revoke it at any time and watch the manager view honor it live (blueprint §1, §5.1, §16.2). Every comparable category fails one half of this: task trackers see only assigned work, not the real week (§7.2); employee-monitoring products see the real week by seizing raw activity centrally. Weekform's shared payload is *derived from reviewed truth* — user-corrected work blocks and a deterministic capacity model (§2.1) — so the manager signal is both more trustworthy and less invasive than an activity feed. The demo's step 4 (exact preview) and step 7 (live revocation) are the novelty made visible.

### 3.2 The most dangerous interpretation: "boss-ware with extra steps"

The single largest product risk (§15: "Manager dashboard feels surveillant" — critical product risk) is a judge reading this as employee monitoring with a consent veneer. `AGENTS.md` is categorical: Weekform is never a system to rank, monitor, or discipline employees, and "performance" never means employee ranking or a universal productivity score.

**Language and UX constraints that preserve member consent** (binding on all copy, UI, prompts, and submission material; blueprint §3.1 item 6, §5.5, §7.4, §8.7, §9.4; `AGENTS.md` invariants):

1. **No rankings, ever.** No leaderboards, sorted "top/bottom performer" lists, benchmarks, utilization league tables, or any synthetic "productivity score" (§3.3, §3.1 item 6).
2. **"Not shared" is a first-class state.** Omitted metrics render as explicit "Not shared," and missing or stale data is labeled as such — never interpreted, colored, or phrased as poor performance (§3.1 item 6, §7.4).
3. **Absence ≠ zero.** Dashboards and the Briefing Agent must distinguish absent data from zero and mention stale or partial sharing (§9.4).
4. **Sharing is off by default** and gated on the member's explicit confirmation: "I reviewed what will be shared with this team" (§3.1 item 4, §5.5).
5. **The exact preview is generated from the same object that uploads** — the preview cannot lie (§5.4 requirement 10).
6. **Member-controlled, never manager-enforced.** No manager-enforced sharing policies (§3.3); sharing scope changes only in the member's Mac app; members can pause, narrow, and delete cloud history, and the dashboard responds (§3.1 item 7, §7.5).
7. **Risk flags are conversation starters, not conclusions.** Team-risk heuristics are labeled planning flags; the Briefing Agent avoids employee-comparison language, mental-health/medical/legal/HR conclusions, and disciplinary recommendations, prefers team/process interventions, and states it is a planning aid requiring human conversation (§7.4, §9.4).
8. **No false team math.** Never sum percentages across people and call it "team capacity"; use medians, ranges, counts, and per-member cards (§7.4).
9. **Honest audit and status language.** Desktop copy follows §8.7 ("Shared 7 approved metrics and category allocation," "Disconnected Weekform account and stopped future uploads"); never "all data synced." Hourly sync is honestly labeled "while Weekform is running" (§15).
10. **Framing is "member-controlled sharing," not telemetry** (§2.5). Copy on the landing page says what managers see and what teammates control, plus an honest prototype disclosure (§7.2), including that the saved desktop session lives in unencrypted prototype storage (§4.2).

**Deadline fallback** if the dashboard still reads as surveillance in rehearsal: remove individual member detail and show team-level aggregates only (§15).

---

## 4. The shared-data contract, in plain language

This section is the contract as a human explanation. Normative source: blueprint §5 (and §5.3 for the exact TypeScript shape, to be implemented in `packages/domain/src/cloud.ts` and `packages/inference/src/sharedSnapshot.ts`).

### 4.1 The one non-negotiable rule (§5.1)

The cloud **never** receives the desktop's state object, or a filtered copy of it. It receives a separately constructed, versioned snapshot (`SharedWorkloadSnapshotV1`) built by a pure allowlist function: every field in the payload is there because the builder explicitly put it there and the member's policy explicitly allowed it. If the local model gains new fields tomorrow, they cannot leak, because nothing is "everything minus a blocklist."

### 4.2 What can never leave the Mac (§5.2 "Always local")

Foreground app names. Window titles. Raw active-window samples. Activity sessions and source IDs. Work-block evidence arrays. Notes. Calendar titles, locations, organizers, or attendee identities. Chat channels, message text, or raw chat events. Screenshots and Visual Context insights. AI provider keys. The Supabase secret/service key. Full audit details. Generated skill recipes (unless the user separately exports them). Contract tests must prove sentinel window-title/evidence/note strings can never appear in the payload (§5.4 requirement 9, §14.1).

### 4.3 Share levels — how much structure the member reveals (§5.2)

The member picks one of three levels; each level adds one kind of aggregate, never raw activity:

- **Summary** — numbers only. Weekly percentages and scores (see 4.4), with no breakdown of what the work was.
- **Categories** — Summary plus how the week divided across work categories and work modes (e.g. "40% meetings, 25% deep work"), as label/value aggregates.
- **Projects** — Categories plus per-project time allocation, but **only** for project names the member has explicitly allowlisted, and only from work blocks the member reviewed. Everything else is grouped as "Unassigned work," never expanded. No stakeholder names, no notes.

### 4.4 Metric toggles — each number is individually consented (§5.2, §5.3)

Within any level, every metric has its own on/off switch, and a disabled metric is **omitted** from the payload (not sent as zero — §14.1 case 7). The full set: reliable new-work capacity, allocated %, reactive %, meeting %, fragmented-work %, blocked %, carryover-risk %, context-switch score, work-in-progress score, and summary confidence. Every snapshot also carries review coverage and data freshness so managers know how trustworthy and how current the numbers are — which is what makes "stale, labeled honestly" possible on the dashboard.

### 4.5 How a sync actually works (§5.4, §5.5, §8.4)

1. The member's policy records team, level, metric toggles, project allowlist, and a consent timestamp; sharing is off until the member approves the initial policy.
2. On sync, a pure builder constructs the snapshot from the deterministic weekly model and reviewed work blocks, includes only policy-enabled fields, validates and clamps values, and refuses to serialize unknown fields.
3. The preview shown to the member is generated from the very object that will upload.
4. The authenticated desktop client upserts the row; the server assigns `user_id` from the authenticated session — never trusted from the payload (§5.3).
5. Postgres RLS guarantees a member writes only their own snapshots; a manager reads only their team's; a fellow member cannot read another member's snapshot; an outsider gets nothing (§6.2, §14.2).
6. The member sees a receipt, and a local audit event records team, schema version, share level, metric names, and payload hash — not the payload itself (§8.4).
7. Narrowing the policy changes future payloads; deleting cloud history removes past ones; the manager dashboard shows "Not shared" or no current snapshot accordingly (§3.1 item 7).

### 4.6 What this means for each audience

- **Members:** your raw week is yours. The team sees at most a handful of approved weekly numbers and aggregates you previewed, and you can shrink or erase that at any time from your Mac.
- **Managers:** you get honest, reviewed capacity signals — enough to plan, flag risk, and start conversations — and an explicit record of what each person chose to share and how fresh it is. You cannot see activity, titles, content, or anyone who opted out.
- **Judges:** the payload contract is versioned, allowlisted, tested against sensitive-string sentinels, and enforced twice — once in the pure builder on the Mac, once by RLS in Postgres.
