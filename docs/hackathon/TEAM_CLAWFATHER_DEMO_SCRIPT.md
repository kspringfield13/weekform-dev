# Team Clawfather — Demo Script, Shot List, and Reset Checklist (Prompt 12)

**Date:** July 19, 2026
**Total runtime target:** 3 minutes 50 seconds (window: 3:30–4:00)
**Data:** Synthetic only — everything on screen comes from `supabase/seed.sql` identities, throwaway local-auth demo users, and Weekform's synthetic demo/imported data. No real accounts, emails, calendars, or activity.

## Honesty preconditions (read before recording)

This script demonstrates what actually runs, using a **local Supabase stack** (`supabase start`) that the operator brings up before recording. Live hosted Supabase, live RLS enforcement, the live OpenAI briefing model, and Developer ID signed/notarized artifact downloads were **not** exercised during development on this machine; the recording must not claim otherwise.

- **Team Briefing:** without `OPENAI_API_KEY` + `OPENAI_TEAM_BRIEFING_MODEL` set server-side, the briefing runs its **deterministic fallback** and the UI labels it "Deterministic fallback". That labeled fallback is what this script demonstrates. If the operator configures a key before recording, keep the narration's disclosure line either way.
- **Download page:** without private artifact env config, `/download` redirects signed-in users to the public, content-addressed universal preview DMG. The exact CDN URL is public, and the app is unsigned/unnotarized; do not narrate private or Gatekeeper-trusted distribution.
- **Invites:** copy-link only. There is no email delivery; the UI says so.
- **Sync:** manual "Sync Now" (optional hourly auto-sync exists but only while the app is open). Never say "always in sync" or "24/7".
- **Desktop baseline vs. new work:** the local workload review/capacity experience is the **inherited pre-Build-Week desktop product**; the web app, Supabase schema, Account & Sharing cloud sync, dashboard, and briefing are the new Team Clawfather slice. The narration keeps that split explicit.

---

## 1. Demo script (3:50)

Two browser profiles: **Profile A = Avery (manager)**, **Profile B = Blake (member)**. Desktop Weekform is signed in as Blake. Local Supabase stack running; web app on `localhost:3000`.

| Time | Screen | Action | Narration |
| --- | --- | --- | --- |
| 0:00–0:20 | Profile A — weekform.com `/login`, then `/dashboard` | Sign in as Avery. Dashboard shows the "Create team" form; type "Team Clawfather", submit; team card appears. | "Weekform is a local-first workload app for analysts — it already runs entirely on your Mac. This week we built the team layer on top of it. I'm Avery, a manager. I sign in on the web and create a team. Nothing about anyone's workload exists here yet — the dashboard is empty by design." |
| 0:20–0:40 | Profile A — `/teams/[teamId]` | Click "Create invite link". The single-use link appears with a "Copy link" button; click Copy. | "I invite Blake with a copy-link invite — this prototype deliberately has no email provider, so I send the link myself. The token is single-use and expires." |
| 0:40–1:00 | Profile B — paste invite URL → `/invite` → `/signup` → back to invite accept | As Blake: open the link, sign up, accept the invite, land on the team page as a member. | "Blake opens the link, creates an account, and joins the team. Membership is the only thing that got created — no workload data moved anywhere." |
| 1:00–1:15 | Profile B — `/download` | Navigate to the authenticated download page; show the universal preview DMG and its unsigned-preview disclosure. | "The download page requires an account, then redirects to a public content-addressed preview DMG. It is universal but not Developer ID signed or Apple-notarized, so this is not a private or Gatekeeper-trusted release." |
| 1:15–1:45 | Desktop Weekform — Week / capacity view (synthetic data) | Switch to the desktop app as Blake. Show reviewed work blocks and the weekly capacity view: allocation, reactive load, meetings, fragmentation, reliable new-work capacity. | "This is the inherited desktop product — everything here was computed locally from Blake's own signals, and every block is reviewable evidence, not surveillance. These capacity numbers are deterministic planning heuristics, not validated performance science. Until this point, none of it has ever left this Mac." |
| 1:45–2:15 | Desktop — Settings → Account & Sharing | Show sharing off by default. Sign-in state, team selector, share level and per-metric toggles. Open the **preview**: human-readable lines plus "Exact JSON that will be uploaded". Point at what is absent. | "Sharing is off by default and metric-by-metric opt-in. Before anything uploads, Blake reviews the exact JSON that will be sent — it's the same object the sync uploads, not a summary of it. Look at what's *not* in it: no window titles, no app names, no evidence, no notes, no calendar or chat details. A disabled metric is omitted — never sent as zero." |
| 2:15–2:30 | Desktop — Account & Sharing | Record consent, click **Sync Now**; show success status and the local audit event. | "Blake consents and syncs manually. One versioned snapshot row goes up under his own session — auto-sync is optional, hourly, and only while the app is open. There is no background daemon." |
| 2:30–2:50 | Profile A — `/dashboard` (refresh) | Refresh the manager dashboard. Blake's snapshot card appears: share level, freshness, shared metrics; non-shared metrics render as "Not shared". | "Avery's dashboard now shows exactly what Blake shared — and honestly marks what he didn't. 'Not shared' is a first-class state, not a zero." |
| 2:50–3:15 | Profile A — `/teams/[teamId]/briefing` | Click **Generate briefing**. The result renders with its disclosure banner; point at the "Deterministic fallback" label (or model attribution if a key is configured). | "The Team Briefing summarizes only these already-shared metrics, server-side. Without an OpenAI key configured it runs a deterministic fallback — labeled as such right here — built from the same allowlisted inputs. With a key, the model call sends `store: false`, the response is schema-validated, and anything citing evidence outside the shared catalog is stripped. Either way it never ranks members or scores performance." |
| 3:15–3:40 | Desktop → Profile A | As Blake: disable one metric (e.g., meetings) in Account & Sharing — consent resets, re-review, Sync Now. Then click **Delete cloud history** for the team. As Avery: refresh dashboard — the metric shows "Not shared", then the snapshot is gone. | "Consent is revocable. Blake turns off one metric — that resets consent and requires a fresh review — resyncs, and Avery's view honors it immediately. Then Blake deletes his cloud history entirely, and the manager view reflects that too. The member always holds the off switch." |
| 3:40–3:50 | Split/closing card — repo `README.md` + `docs/BUILD_WEEK_2026.md` | Show the provenance doc and runbook briefly. | "The team-cloud slice — schema, web app, consent sync, dashboard, briefing — was built during Build Week with Codex on GPT-5.6 running a parallel-agent runbook, with dated provenance and a `/feedback` session ID in the repo. Weekform: know what fits before you commit — and share only what you choose." |

**Timing note:** if running long, compress segment 1:15–1:45 (inherited desktop tour) to 20 seconds; do not cut the preview (1:45–2:15) or revoke (3:15–3:40) segments — they are the privacy proof.

---

## 2. Shot list

Capture at 1920×1080 (or native Retina, downscaled), light theme consistent across shots, synthetic data only. Check every frame for real names/emails before publishing.

1. **S1 — Manager dashboard, empty state:** `/dashboard` as Avery immediately after "Create team" (Team Clawfather card, no snapshots).
2. **S2 — Invite creation:** `/teams/[teamId]` with the generated invite link, "Copy link" button, and the "no email delivery" caption visible.
3. **S3 — Member join:** `/invite` accept screen in Profile B after signup.
4. **S4 — Authenticated download page:** `/download` showing the account gate, universal preview DMG, and explicit public/unsigned distribution boundary.
5. **S5 — Desktop weekly capacity:** inherited Week view with allocation/reactive/meetings/fragmentation and reliable capacity (synthetic data).
6. **S6 — Account & Sharing consent preview (hero shot):** metric toggles plus the expanded "Exact JSON that will be uploaded" details block. This is the single most important frame.
7. **S7 — Sync Now success:** sync status + the local audit event entry.
8. **S8 — Manager dashboard with data:** Blake's snapshot card, including at least one "Not shared" metric visible.
9. **S9 — Team Briefing:** generated briefing with the AI-disclosure banner and the "Deterministic fallback" label in frame.
10. **S10 — Revocation honored:** side-by-side or sequence — desktop metric toggled off / Delete cloud history dialog, then the refreshed manager dashboard without it.
11. **S11 — Provenance:** `docs/BUILD_WEEK_2026.md` open at the Team Clawfather cloud-slice section.

Video B-roll (optional): cursor pass over the SharePreview JSON; the invite "Copied" state; the briefing "Generating…" pending state.

---

## 3. Synthetic-state reset checklist

Run before every recording take and before judge hand-off.

**Supabase (local stack):**
1. `supabase stop` (if running), then `supabase start`.
2. `supabase db reset` — applies `supabase/migrations/202607190001_team_cloud_v1.sql` (and the simulator migration) and runs `supabase/seed.sql` (synthetic-only; its seeded `auth.users` rows have NULL passwords and cannot be signed into).
3. In Studio (Auth → Users), create two throwaway demo users — Avery (manager) and Blake (member) — with disposable credentials. The `on_auth_user_created` trigger bootstraps their profiles. If you want the seed's `public.*` rows attached to them, substitute their UUIDs per the instructions in the `supabase/seed.sql` header; otherwise create the team/invite live on camera (the script assumes live creation).
4. Confirm `apps/web/.env.local` points at the **local** stack URL/anon key only. No service-role key anywhere client-side.

**Desktop app:**
5. In Weekform Settings, run **Reset Prototype Data** (clears persisted local state), or delete the Tauri Store data for a hard reset; for the browser/demo build, clear the site's localStorage instead.
6. Verify Account & Sharing shows the disconnected, sharing-off default (no session token, no team, no recorded consent, empty sync state).
7. Re-import/regenerate the synthetic week so the capacity view is populated, then sign the desktop app in as Blake only when the script reaches that step.

**Browsers:**
8. Create two fresh browser profiles (or one fresh profile + one private window): Profile A for Avery, Profile B for Blake. No shared cookies/sessions between them.
9. Clear both profiles' cookies/localStorage for the web app origin; confirm both land on `/login` logged out.
10. Pre-stage tabs: A → `/login`; B → blank (Blake receives the invite link on camera).

**Final pre-flight:**
11. `npm run verify:wave3` and `npm run test:cloud` pass at repo root; `npm --prefix apps/web run dev` serving.
12. Decide the briefing mode: no OpenAI env vars → deterministic fallback (default, and what this script narrates). If demonstrating the model path, set `OPENAI_API_KEY` + `OPENAI_TEAM_BRIEFING_MODEL` server-side only, and keep the disclosure narration.
13. Screen-record with notifications/Do Not Disturb enabled; confirm no real calendar/chat data is loaded anywhere in the desktop app.
