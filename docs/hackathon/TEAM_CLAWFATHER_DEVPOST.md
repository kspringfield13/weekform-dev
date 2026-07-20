# Weekform Team Clawfather — Devpost Submission Copy

Prepared July 19, 2026 for OpenAI Build Week 2026. Every claim below is traceable to this repository; environment-blocked items are marked as such rather than claimed.

## Tagline

> **Local-first workload intelligence. Teams see only the metrics each member consented to share.**

93 characters (limit: 100).

## Problem / Solution

**Problem.** Managers need visibility into team capacity, but every existing path to it — screenshot monitors, activity trackers, status theater — either surveils workers or produces numbers nobody trusts. Workers who *do* understand their own week have no safe way to share just the conclusion ("I'm at 85%, mostly reactive") without also surrendering the raw evidence behind it.

**Solution.** Weekform already computes explainable weekly capacity entirely on the analyst's Mac from locally reviewed work blocks. During Build Week we added a consent-first team layer: a member opts in metric-by-metric, reviews the exact JSON payload before anything uploads, and syncs a single versioned snapshot to their team. Managers get a dashboard and an AI briefing built strictly from those already-shared metrics. Raw activity, window titles, and evidence never leave the member's machine — and every share is revocable, with the manager view honoring removal and deletion.

## What it does

- **Desktop (inherited baseline, predates Build Week):** a local-first macOS menu-bar app (Tauri 2 / React / Rust) that turns calendar and foreground-app signals into reviewable work blocks and a deterministic weekly capacity model — allocation, reactive load, fragmentation, and reliable new-work headroom. Capacity heuristics are planning aids, not validated performance science.
- **New this week — the Team Clawfather cloud slice:**
  - weekform.com web app: signup/login, team creation, member management, single-use **copy-link invites** (no email provider by design), and an **account-gated download page** that redirects signed-in users to a public, content-addressed universal preview DMG. The preview is unsigned and Apple-notarization is pending; its exact CDN URL is not private.
  - Desktop **Account & Sharing**: off by default; sign-in, one recipient team, share level + per-metric toggles, a consent preview showing the **exact JSON that will be uploaded** (the same object the sync sends), recorded consent, manual **Sync Now**, optional hourly auto-sync only while the app is open, cloud-history deletion, and a local audit event for every cloud action.
  - **Manager dashboard**: per-member snapshot cards showing share level, freshness, and shared metrics — with disabled metrics rendered as "Not shared," never as fake zeros.
  - **Team Briefing**: a server-side summary of already-shared metrics. With `OPENAI_API_KEY` + `OPENAI_TEAM_BRIEFING_MODEL` configured it calls the OpenAI Responses API (`store: false`, schema-validated output, evidence citations outside the shared catalog stripped); without them it runs a labeled **deterministic fallback** from the same allowlisted inputs — the fallback is the path demonstrated in our demo. Both paths refuse member ranking, performance scoring, and HR/medical language.
  - **Supabase schema + RLS policies** (`supabase/migrations/202607190001_team_cloud_v1.sql`) so members write only their own snapshots and managers read only their own team, plus a synthetic-only seed and an RLS test script.

## How we built it

**Process.** One human operator ran Codex (GPT-5.6) through a written parallel-agent runbook (`docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK.md`): 13 numbered prompts across four waves — contract first (shared `SharedWorkloadSnapshotV1` type + product contract), then the Supabase migration, the web foundation, teams/invites, desktop sync, dashboards and briefing, revoke/delete, hardening, an independent privacy-critic review, a read-only drift audit across all surfaces, and finally integration and this submission package. Each prompt carried explicit privacy constraints and release gates; a taskboard and dated provenance doc (`docs/BUILD_WEEK_2026.md`) record the evidence trail and the `/feedback` session ID.

**Stack.**
- Desktop: Tauri 2, React, TypeScript, Rust (inherited); new cloud client/policy/scheduler/store modules with dependency-free, node-testable cores.
- Web: Next.js App Router with `@supabase/ssr` (server components + server actions; 12 routes), deployed-ready but pending deploy.
- Data: Supabase Postgres with row-level security; anon key only on clients — no service key ships anywhere client-side.
- AI: OpenAI Responses API, server-side only, for the Team Briefing — with a deterministic fallback so the feature is honest and functional with zero keys.
- Shared contract: an allowlist-built snapshot type in `packages/inference/src/sharedSnapshot.ts` consumed identically by the desktop preview, the upload, and the web dashboard, so the preview cannot diverge from what is sent.

## Challenges we ran into

- **Making consent mechanical, not aspirational.** The preview renders the same object reference the sync uploads, snapshot rows are built by field-by-field mapping (no object spread) so a local field cannot leak, and disabled metrics are omitted rather than zeroed — "Not shared" had to become a first-class UI state end to end.
- **No live cloud in the build environment.** This machine had no Supabase CLI/psql, no project keys, and no OpenAI key, so live RLS enforcement, live auth/sync, artifact signing, and the live briefing model were never exercised here. We responded by writing an RLS test script and a four-actor access matrix, building deterministic fallbacks as the demonstrated paths, and documenting every unproven claim instead of making it.
- **AI output you can't fully trust.** The briefing response is schema-validated and any risk/opportunity citing evidence outside the allowlisted catalog is stripped rather than rendered.
- **Keeping a parallel-agent process coherent.** Contract-first ordering, per-prompt gates, a privacy critic, and a cross-surface drift audit kept desktop, web, SQL, and docs telling the same story.

## Accomplishments we're proud of

- A complete consent pipeline where the user reviews the literal upload payload — and revocation (metric removal, history deletion, disconnect) is honored in the manager view.
- 172 passing focused tests across the slice (10 shared-snapshot privacy tests, 60 desktop-cloud, 102 web) plus green production builds, verified via `npm run verify:wave3`, `npm run test:cloud`, and `npm run build` on July 19.
- An independent privacy-critic pass with no blocker/high findings and both medium findings remediated with regression tests (`docs/hackathon/TEAM_CLAWFATHER_PRIVACY_CRITIC_REPORT.md`).
- A release report that states what is *not* proven as plainly as what is (`docs/hackathon/TEAM_CLAWFATHER_RELEASE_REPORT.md`).

## What we learned

- Privacy features survive review only when the honest state is the rendered state: previews that are the payload, "Not shared" as data, fallbacks that are labeled.
- A written prompt runbook with explicit gates makes multi-surface AI-assisted development auditable — the provenance doc practically wrote itself because every wave left dated evidence.
- Deterministic fallbacks are not a downgrade; they made the briefing demonstrable, testable, and truthful without any credentials.

## What's next

- Run the environment-blocked gates live: execute `supabase/tests/team_cloud_rls.sql` against a real stack and run the golden path on hosted Supabase. (`npm audit` is no longer pending — `npm run audit:check` reports 0 vulnerabilities in both workspaces as of July 19, 2026, after a `postcss >=8.5.10` override in `apps/web`.)
- Replace the public preview fallback with a Developer ID signed, Apple-notarized artifact in the private bucket so `/download/artifact` can issue short-lived signed URLs.
- Email invite delivery, hardened credential storage on desktop (session tokens are currently in unencrypted prototype storage), and multi-week trends on the manager dashboard.
- Validate capacity heuristics against real planning outcomes before presenting them as more than heuristics.

## Track: Work & Productivity

Weekform is squarely a work-planning tool: it measures individual workload, models weekly capacity, and — with this submission — lets teams plan against shared capacity signals. Its contribution to the track is showing that team-level productivity visibility does not require surveillance: managers plan with consented, member-controlled metrics, and the AI briefing is constrained to workload signals a member already chose to share.

---

## Submission checklist

| Item | Value / status |
| --- | --- |
| Repository URL | `https://github.com/kspringfield13/weekform-dev` (placeholder — operator to confirm the final public repo) |
| Live URL | **Pending deploy** — the Next.js app builds green (`npm run web:build`) but has not been deployed |
| Video URL | **Pending recording** — script and shot list in `docs/hackathon/TEAM_CLAWFATHER_DEMO_SCRIPT.md` |
| Primary Codex Session ID (`/feedback`) | `019f6058-ca64-7510-bcc5-f9416f981036` (from `docs/BUILD_WEEK_2026.md`; **operator to confirm/replace** with the final submission-period session ID) |
| Screenshots | Shot list S1–S11 in the demo script; minimum set for Devpost: S5 (desktop capacity), S6 (consent preview with exact JSON), S8 (manager dashboard with "Not shared"), S9 (briefing with fallback label), S10 (revocation honored) |
| Provenance | `docs/BUILD_WEEK_2026.md` — pre-existing baseline vs. Build Week work, dated evidence |

**Setup verification (real root scripts, run from repo root):**

```bash
npm ci
npm run verify:wave3   # 60/60 desktop-cloud tests, 102/102 web tests, web production build
npm run test:cloud     # 10/10 shared-snapshot privacy allowlist tests
npm run build          # tsc -b + pricing check + vite build (desktop web bundle)
```

Verified July 19, 2026: `npm run audit:check` (npm audit at root and in `apps/web`) — 0 vulnerabilities in both workspaces after remediating GHSA-qx2v-qp2m-jg93 via a `postcss >=8.5.10` override. Operator-only, still pending (environment-blocked — no live Supabase credentials on this machine): `supabase db reset` + `supabase/tests/team_cloud_rls.sql` against a live local stack; the manual golden path ×2 in the demo script.

**Known limitations disclosed to judges:** live RLS/auth/sync/briefing-model/artifact-signing unproven on the build machine (deterministic fallbacks are the demonstrated paths); copy-link invites only; a public unsigned/unnotarized universal preview DMG; prototype (unencrypted) credential and local-state storage; sync runs only while the app is open; capacity numbers are unvalidated heuristics; synthetic data only in all demo material.
