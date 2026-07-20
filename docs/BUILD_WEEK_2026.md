# OpenAI Build Week 2026 provenance

Weekform is a pre-existing project being extended for OpenAI Build Week. The official submission period is **July 13–21, 2026**. Source timestamps below are displayed in EDT (UTC−04:00); that display timezone is not a claim about the organizer's deadline timezone. This document separates the inherited prototype from work completed during the period and records the Codex evidence used for the submission.

## Pre-existing baseline

The final source commit before the submission period is:

- Commit: `e66fa9a9f13bb688387bfc655394c3e5c7f1100f`
- Authored: July 12, 2026 at 11:10:34 PM EDT
- Subject: `improve: align collapsed delivery-risk chip labels with their RiskRow labels (#447)`

At that baseline, the project already included the local-first macOS capture pipeline, activity sessionization, reviewable work blocks, the workload/capacity model, forecast and narrative surfaces, audit history, the conversational Agent, Acceleration and saved Skills, calendar/chat/git import paths, privacy controls, and optional AI-assisted generation. Those capabilities are prior work and are not claimed as Build Week inventions.

The first Weekform naming exploration is also prior work. On July 11, GPT-5.6 compared product names and positioning, recommended **Weekform**, proposed a folded five-day “W” concept and launch message, and surfaced `weekform.com` when a preliminary WHOIS check returned no match at that time. That check was not trademark clearance or proof of domain registration. Kyle selected the name, rejected the first logo direction, and requested a stronger compact icon brief. This work is recorded in Codex task `019f5149-518d-7982-aded-c445db8ff3ce` and is disclosed here rather than claimed as submission-period work.

## Work completed during Build Week

The submitted direction builds on that baseline. The table below is a selected material-change record from the reviewed source history through July 16 plus the July 18 public-release work; it is not exhaustive. July 13 work included productionizing the approved identity alongside reliability and accessibility improvements; the larger product refresh followed on July 14. Final-submission behavior takes precedence where a later row removes or replaces an earlier experiment.

| Date (EDT) | Commit | Build Week work |
| --- | --- | --- |
| July 13 | `8ba9e6f`, `2598e05`, `a97cca2`, `d298fa5` | Fixed stored-week normalization, calendar recurrence filtering, forecast accuracy, and Review Copilot blocker derivation. |
| July 13 | `8408c04`, `e4213ae`, `02e5216` | Improved keyboard behavior, error announcements, and Agent disclosure semantics. |
| July 14 | `25dc18b` | Refreshed the Weekform product experience, desktop workflow, and AI-usage interface. |
| July 14 | `0b8f611` | Merged the `codex/weekform-product-refresh` work. |
| July 14 | `21b32f5` | Added a reviewed model-pricing catalog. |
| July 14 | `eb62c21` | Added the Weekform Agent mark and replaced generic AI iconography. |
| July 14 | `f678fb6`, `8888a66` | Reworked capacity and measured-usage workflows. |
| July 15 | `1257151`, `0ad69d2` | Hardened calendar parsing and prevented sensitive flagged insights from entering classification and narrative prompts. |
| July 15 | `cf156f6`, `f96256a`, `b8cdfe2`, `290d8a1` | Hardened usage imports, wrapped chat exports, generated AI data, and persisted state. |
| July 16 | `cf51d8a` | Improved the compact experience and enabled Agent actions. |
| July 16 | `a566eb6` | Added motion polish across review, toasts, dialogs, onboarding, and buttons. |
| July 18 | `1c08a6e` | Published the consolidated Build Week implementation: removed retired integration paths, made OpenAI the recommended path, added audit-data migration, hardened the source installer, migrated the current AI SDK integration, and restored reproducible build inputs. |

The July 13–16 hashes above identify the dated private source evidence. Public commit `1c08a6e` consolidates that in-period implementation on top of the sanitized public baseline without publishing the inherited private commit chain.

## Codex and GPT-5.6 evidence

### Branding implementation during the period

The July 13 continuation of the branding task is submission-period work:

- **Codex Session ID:** `019f522e-e1f6-77b0-ad77-7599b5a01582`
- **Model:** `gpt-5.6-sol`
- **In-period decision:** Kyle locked the Weekform identity and supplied the chosen concept and black logo artwork on July 13 at 8:31 AM EDT.
- **In-period implementation:** Codex carried that approved direction through the React interface, native shell, package metadata, documentation, installer, SVG artwork, application icons, and menu-bar assets; preserved compatibility-sensitive identifiers; and built and visually reviewed the result.
- **Human design direction:** Kyle directed subsequent wordmark, compact-header, and sidebar composition refinements and approved the final treatment.

The naming recommendation and domain signal belong to the July 11 prior-work disclosure above. The production rebrand and screenshot-led design refinement belong to the July 13 submission-period record.

### Primary project task

The primary Codex project task for the in-period product refresh is:

- **Codex Session ID:** `019f6058-ca64-7510-bcc5-f9416f981036`
- **Task title:** `Redesign top toolbar`
- **Started:** July 14, 2026 at 7:17:39 AM EDT (11:17:39Z)
- **Model:** `gpt-5.6-sol`
- **Linked source evidence:** branch `codex/weekform-product-refresh`; commit `25dc18b` authored at 9:33:37 AM EDT and merged as `0b8f611` at 9:42:48 AM EDT

Because Weekform predates Build Week, this is the task containing the largest coherent body of submission-period work; it is not the task that created the inherited core described above.

### Additional in-period tasks

Two focused GPT-5.6 Codex tasks provide supporting evidence for later timeline entries:

| Date (EDT) | Codex Session ID | Task | Linked source evidence |
| --- | --- | --- | --- |
| July 14 | `019f629a-3cb7-7a01-a817-1103ef57bb15` | `Enhance model prices` | Reviewed pricing, usage, settings, and capacity workflows; commits `21b32f5`, `f678fb6`, and `8888a66`. |
| July 16 | `019f6aba-c925-7173-ad3a-3d730c5dd689` | `Fix compact view overlap` | Compact layout and approval-gated Agent actions; commit `cf51d8a`. |

### Team Clawfather cloud slice (Waves 1–3)

The team-sharing vertical slice was implemented by an Absoloop-supervised Claude agent loop rather than a Codex session; per policy, only mission/loop IDs and outcomes are recorded, not raw prompts:

- **Mission ID:** `ABS-MINIMAL-001`; loop runs `loop-20260719-050445-52108e`, `loop-20260719-052919-0cf644`, and `loop-20260719-055300-166f58`
- **Dates:** July 19, 2026
- **Outcome:** Wave 1 (shared cloud contract with privacy tests, Supabase schema/RLS/seed SQL, Next.js web foundation) and Wave 2 (team creation and hashed-token invites, desktop Account & Sharing with manual privacy-gated sync, manager/member dashboards) per `docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK.md` §0, whose status table carries the per-prompt evidence and limitations. Gate commands at the Wave 1–2 close: `npm run test:cloud` 10/10, `npm run test:desktop-cloud` 12/12, `npm run test:web` 24/24, `npm run web:build` and root `npm run build` exit 0 (the suites grew in later hardening passes — see the Wave 3 entry below for current counts). Supabase SQL is review-only on this machine (no CLI/psql), so live RLS behavior remains unproven.
- **Wave 3 (completeness and intelligence), same mission:** loop runs `loop-20260719-065525-403d03`, `loop-20260719-071047-7592e7`, and the validation pass `loop-20260719-080950-755c05`, all July 19, 2026. Outcome: scheduled auto-sync policy (`apps/desktop/src/services/cloudScheduler.ts`), the server-side AI Team Briefing at `/teams/[teamId]/briefing` (allowlisted aggregates only, deterministic fallback, `docs/PRIVACY.md` updated), and the account-gated `/download` + `/download/artifact` signed-URL path, per the runbook §0 Wave 3 close-out row. Gate command at close: `npm run verify:wave3` (chains `test:desktop-cloud` 55/55, `test:web` 85/85, `web:build` with 12 routes / 11 static pages) exit 0, plus `apps/web` typecheck and root `npm run build` exit 0. A July 19 Wave 3 hardening pass (loop run `loop-20260719-081455-c0b251`) made the previously inspection-only `/download/artifact` signed-URL branch test-proven via a pure dependency-injected planner, growing `test:web` to 91/91 with `verify:wave3` still exit 0; a second hardening pass the same day (loop run `loop-20260719-081455-c0b251`, iteration 2) test-proved the Team Briefing orchestrator's remaining branches (real-timer timeout/abort, network-rejection fallback, `output[]` extraction, API-key non-leak guard), growing `test:web` to 95/95 with `verify:wave3` still exit 0. A third hardening pass (loop run `loop-20260719-081455-c0b251`, iteration 3) test-proved the desktop auto-sync real-timer wiring by extracting the plan→timer translation into the pure injectable `armAutoSyncTimer` helper in `cloudScheduler.ts` (5 new tests, including a real-platform-timer end-to-end fire), growing `test:desktop-cloud` to 60/60 with `verify:wave3` still exit 0. Live-stack, live-model, and live-app-soak verification remain environment-blocked, as documented in the runbook.

### Team Clawfather release wave (Wave 4)

The privacy-critic, integration/release-gate, and submission-package prompts (runbook Prompts 10–12) closed the mission on the same working tree:

- **Dates:** July 19, 2026
- **Prompt 10 — adversarial privacy critic:** completed with **no BLOCKER or HIGH findings**; two MEDIUM findings were remediated the same day with regression tests. Report: `docs/hackathon/TEAM_CLAWFATHER_PRIVACY_CRITIC_REPORT.md`.
- **Prompt 11 — integration and release gate:** all gates re-run on the final tree, recorded in `docs/hackathon/TEAM_CLAWFATHER_RELEASE_REPORT.md`. Results: `npm run test:cloud` 10/10; `npm run verify:wave3` exit 0 (60/60 desktop-cloud tests, 102/102 web tests, web build with 12 routes / 11 static pages); root `npm run build` exit 0; secret scan clean. Live-RLS / synthetic golden-path verification (no Supabase CLI, psql, or live stack on this machine) remains explicitly **operator-pending / environment-blocked** — documented, not claimed as passed. The `npm audit` gate closed later on July 19, 2026: `npm run audit:check` exit 0 with 0 vulnerabilities at root and in `apps/web`, after remediating postcss GHSA-qx2v-qp2m-jg93 with an `overrides: { "postcss": ">=8.5.10" }` pin (8.4.31 → 8.5.20) and re-running all gates green. No test, RLS policy, privacy copy, or build gate was weakened to produce these results.
- **Prompt 12 — submission package:** demo script and Devpost copy prepared as part of this wave (`docs/hackathon/TEAM_CLAWFATHER_DEMO_SCRIPT.md`, `docs/hackathon/TEAM_CLAWFATHER_DEVPOST.md`), alongside the README restructure around the team-cloud product story and this provenance entry. The demo sequence uses synthetic data only and keeps inherited desktop capabilities distinct from Team Clawfather work.

### Supplemental submission-readiness task

### Part 2 forecasting, experience excellence, weekly review, and action follow-through

- **Date:** July 19, 2026
- **Absoloop loop:** `loop-20260719-111613-cf7d72`
- **Outcome:** PT2 Prompt 13 added deterministic, self-calibrated team
  forecasting. PT2 Prompt 14 then completed an audit-first coherence pass over
  desktop and web: 20 identified loading, error, destructive-action,
  terminology, provenance, and accessibility gaps were resolved without adding
  a product capability or widening data flow. PT2 Prompt 15 then added the
  optional local weekly-review ritual: a deterministic closing-week checklist,
  handoffs to existing correction/review/share-preview surfaces, and one
  ids/counts-only completion audit event. PT2 Prompt 16 then added the first
  manager action follow-through loop: a manager-only, team-scoped action record
  created through a narrow RPC that server-sets identity and lifecycle fields,
  linked to an allowlisted briefing risk signal and a correlation-only team
  median after two distinct later weeks. Create, resolve/drop, and delete now use
  manager-authorized security-definer RPCs; direct table INSERT, UPDATE, and DELETE
  are revoked and covered by static plus pgTAP contracts. The migration is an unapplied
  SQL-review artifact; no live RLS claim is made.
- **Evidence:** `docs/hackathon/TEAM_CLAWFATHER_UX_AUDIT.md` maps each fix row
  to its source resolution. Loop `loop-20260719-135748-556358` tightened Prompt
  16 to RPC-only create/resolve/delete and server-derived lifecycle fields; its
  focused boundary suite passes 18/18; its additive hardening migration repairs
  already-applied databases without relying on rewritten history, and its
  unapplied pgTAP specification now has 80 assertions, including direct
  table/column privilege checks, direct member UPDATE/DELETE, and outsider
  resolve/delete abuse cases. `npm run verify:wave3` passes with
  133/133 desktop tests and 199/199 web tests; the
  root build passes. The final clean integration reran `npm run audit:check`
  successfully with zero vulnerabilities in both workspaces, after eighteen
  earlier attempts had been blocked by registry DNS. Prompt 16 is complete at
  the repository level; live Supabase/RLS execution remains unclaimed. No live
  Supabase, OpenAI, Keychain, or release proof is implied by these local gates.

This pass used Codex teammates for independent desktop, web, and critic slices;
the product vocabulary and approval boundaries remained human-directed.

### Desktop/web alignment and local-data boundary hardening

- **Date:** July 19, 2026
- **Absoloop loop:** `loop-20260719-144536-63efe8`
- **Outcome:** parallel desktop, web, and independent security reviews repaired
  the request-consistency seams between the local Mac model, approved Supabase
  snapshots, and the server-rendered team site. Desktop writes now revalidate
  membership and the current narrowing policy immediately before upload;
  unchanged state reconciles the authenticated row so website deletion cannot
  remain falsely "Up to date" or be automatically recreated without an
  explicit re-arm/manual sync. Retry exhaustion resets on changed reviewed
  content. Native Store failure no longer creates a second browser-storage
  credential envelope, and corrupt pending snapshot IDs are discarded.
- **Web/data boundary:** dashboard and team pages are force-dynamic and request
  fresh server/RLS data every 15 seconds while visible and online. The website
  has no application-managed persistent browser workload cache or browser Supabase client; Supabase auth
  cookies are the documented persistent exception. Supabase now server-stamps
  `synced_at`, and latest/freshness ordering uses it rather than a client clock.
- **Evidence:** tests-first focused failures were observed for UUID parsing,
  native fallback selection, server-clock mapping, refresh mounts, fresh-policy
  upload guarding, retry reset, and remote reconciliation. A credential-free
  revocation tombstone also prevents stale cloud credentials
  from rehydrating when primary deletion fails. A failed explicit re-sync cannot
  erase the guard and allow automatic recreation, and an additive migration
  applies the server receipt clock to already-provisioned databases.
  `npm run verify:wave3` passes 128/128 desktop-cloud and 188/188 web tests with
  12 routes; root `npm run build`, `npm run audit:check` (zero vulnerabilities
  in both workspaces), and `git diff --check` pass.

### Manager Access and Span Simulator access

- **Date:** July 19, 2026
- **Outcome:** **Manager Access** is the only manager-facing product surface.
  The Next.js web app owns the canonical, non-indexed `/manager-access` entry
  inside the normal Weekform shell. It filters the signed-in user's active team
  memberships to owner/manager roles, opens a sole managed team directly, and
  presents a chooser when several teams are eligible. Legacy `/admin` now does
  nothing except redirect to `/manager-access`; the standalone portal client,
  appearance cookie, and portal-only styling were removed.
- **Desktop Manager Mode:** a signed-in desktop account sees Manager Access in
  the Weekform sidebar only while at least one cloud membership has an owner or
  manager role. Signing out or losing the eligible membership closes the mode.
  Individual mode returns to the real personal workspace without replacing its
  state. Manager Mode reuses Weekform's Today, Week, Agent, History, and Settings
  hierarchy with approved-summary filters, team medians and ranges, briefings,
  approval-gated coordination actions, history, and a six-person comparison
  limit. Live team administration continues in authenticated web Manager Access.
- **Theme:** both surfaces use the Weekform black-and-white system. Manager
  color-accent controls and purple palette values were removed; legacy stored
  preference fields remain parseable only for compatibility and no longer
  control rendered color.
- **Boundary:** the current desktop manager workspace is visibly labeled
  **Synthetic preview**. It uses deterministic synthetic approved summaries,
  makes no model request, reads no personal `PersistedAppState`, and performs no
  production team write. Span Simulator stays an isolated, development-only
  synthetic tool with separate simulator authorization and RLS requirements.
  Live simulator execution and live multi-actor RLS proof are not claimed.
- **Evidence:** tests cover owner/manager filtering, single-team routing,
  authenticated-route protection, six-person comparison, combined roster
  filters, approval/cancellation behavior, safe web handoff, and monochrome
  source contracts. The simulator suite passes 15/15, the desktop service suite
  passes 145/145, and the web suite passes 201/201. The authoritative root
  TypeScript/Vite build and optimized Next.js build pass with `/app`,
  `/manager-access`, and the legacy redirect present. Browser verification
  covered the fail-closed web state, `/admin` redirect, signed-out desktop gate,
  authenticated local synthetic Manager Mode, and black-and-white rendering at
  desktop and 390-pixel widths with no horizontal overflow or console errors.

The work used separate desktop and web implementers plus an independent critic;
the maintainer supplied the local-first/cloud-complexity boundary and requested
the alignment QA.

### Weekform Web and Mac entry choice

- **Date:** July 19, 2026
- **Outcome:** the verified `apps/web` build presents **Open in Web** and
  **Download for Mac** as distinct choices in the hero, global navigation,
  closing action, and footer. A stable protected `/app` route opens the
  authenticated Weekform Web workspace instead of returning 404, and the
  dashboard is labeled Weekform Web. Production publication remains a separate
  deployment action.
- **Boundary:** the choice UI states that the browser workspace handles approved
  shared snapshots, teams, commitments, and Manager Access, while local activity
  capture, reviewed raw evidence, native permissions, and the full local model
  remain in the Mac app. No browser-native capture equivalence is claimed.
- **Evidence:** the product-entry contract was written red-first; focused route
  tests and the full 201-test web suite pass. The optimized Next.js build includes
  `/app`, and rendered desktop plus 390px browser checks confirm both choices,
  responsive layout, and a clean development console.

### Layered Supabase sign-in

- **Date:** July 19, 2026
- **Outcome:** the Weekform sign-in card prioritizes Google and GitHub, keeps a
  passwordless email Magic Link directly below them, and collapses the legacy
  email/password form by default. Every path returns through the existing
  `/auth/callback` or server action and preserves the protected destination.
- **Boundary:** production email delivery still depends on the Supabase email
  provider and its configured SMTP/rate limits; Google and GitHub depend on
  their Supabase provider configuration. No auth path sends Mac activity or
  workload evidence to an identity provider.
- **Evidence:** focused OAuth, email/callback, order, disclosure, and visual
  contract tests cover the layered sign-in hierarchy. The optimized Next.js
  build and browser verification remain separate release gates.

### Role-aware Weekform Web intro and workspace

- **Date:** July 19, 2026
- **Outcome:** the authenticated Web workspace now follows the Desktop first-run
  rhythm: a focused welcome, keyboard-accessible guided tour, completion/skip,
  and replay. Every user sees the private-review, optional-team, sharing, and
  Mac-boundary steps; authorized owners/managers receive one additional Manager
  Access step. The dashboard is organized around real anchored destinations and
  a visible review-decide-request-coordinate path instead of a single long form.
- **Boundary:** completion stores only a versioned, user-scoped browser
  preference—never workload or auth data. Manager orientation is derived from
  active owner/manager memberships, while authorization remains in Supabase RLS.
  The intro explicitly states that browsers do not perform native capture and
  that review requests require approval on the Mac.
- **Evidence:** contracts were written red-first for individual/manager step
  composition, storage scoping, target coverage, and workspace structure. A
  production-backed synthetic user exercised password sign-in, first-run
  completion/replay, team creation, manager-role detection, and Manager Access;
  desktop and 390px browser checks caught and corrected overlay clipping and a
  signed-in header overflow before release.

The hackathon-readiness and provenance task is supplemental evidence:

### Native-to-cloud personal Web workspace

- **User-visible outcome:** Weekform for Mac can explicitly enable a private, review-safe Web replica. The authenticated Web dashboard shows derived capacity and reviewable blocks, sends confirm/exclude/relabel requests, and states that the Mac must approve every request. Private Supabase Broadcast invalidations refresh the server-rendered view; the 15-second request-fresh loop remains the fallback.
- **Implementation evidence:** `PersonalWorkloadReplicaV1` is built field-by-field with no raw evidence fields; desktop sync uses registered devices, durable offline batches, idempotent batch ids, server cursors, and block revisions. The additive Supabase migration defines RLS-scoped replicas, commands, hardened RPCs, and private Broadcast authorization. Native capture writes AES-256-GCM journal entries before emitting a sample, keeps the journal/session keys in macOS Keychain, migrates legacy raw samples out of the general Tauri Store, and connects retention/reset to the journal.
- **Boundary:** The migration is a reviewed repository artifact until it is applied to a configured Supabase project and exercised with live RLS actors. Browser/demo proof does not prove native capture or Keychain behavior; native Rust tests and a packaged-app smoke test are separate evidence surfaces.

- **Codex Session ID:** `019f75f1-73fc-7850-98a4-c23ec0aae893`
- **Task title:** `Prepare Weekform for Build Week`
- **Started:** July 18, 2026 at 11:56:26 AM EDT (15:56:26Z)
- **Model:** `gpt-5.6-sol`

### README product presentation

The public product-presentation refresh is recorded in a separate in-period task:

- **Codex Session ID:** `019f7666-06b1-7a73-80dd-b8ff3a8f9933`
- **Date:** July 18, 2026
- **Outcome:** Codex reorganized the README around the approved Weekform identity and product story, captured the real weekly-capacity interface with synthetic demo data, clarified installation and privacy boundaries, and retained the full Build Week evidence record.
- **Human design direction:** Kyle required the application icon and name to lead the page, selected the weekly-capacity view as the primary product image, and set the `xai-org/grok-build` README as the visual-quality reference while keeping prototype and licensing status explicit.

This task is supporting evidence for the public presentation only. It does not replace the primary Project-thread value used for `/feedback`.

### Week dashboard redesign

The Week dashboard simplification is recorded in a separate in-period task:

- **Codex Session ID:** `019f772b-35f4-72f3-a82e-07762259cbd0`
- **Date:** July 18, 2026
- **Outcome:** Codex rebuilt the weekly-capacity content below the breadcrumb around clearer labels, stronger visual hierarchy, and a simpler container layout while preserving the existing capacity data, app context, and Weekform palette. The model breakdown, personal baselines, delivery-risk inputs, and privacy-safe interruption evidence remain available in a collapsed explanation layer. Follow-ups aligned the two primary panels, added reduced-motion-aware chart entrances and keyboard-accessible detail, and replaced the pastoral hero artwork with a lazy-loaded Three.js capacity signal. Its segmented surface uses the live committed-load and reliable-capacity values, updates with the app theme, pauses offscreen or while hidden, respects reduced motion, and retains a polished static fallback when WebGL is unavailable.
- **Human design direction:** Kyle supplied the visual reference, limited the redesign to the Week dashboard below “Weekly capacity,” required reuse of the app’s existing data and context, and prioritized immediate comprehension over the prior dense presentation. His follow-up direction called for equal-height panels, restrained chart motion, detail available to both pointer and keyboard users, and a higher-quality animated hero graphic with a modern technical character.

Only the session IDs and concise evidence summaries are intended for publication. Raw Codex rollout/session files can contain prompts, local paths, tool output, or other private context and are not part of the repository.

## Required `/feedback` submission field

Use this primary Project-thread value for the required feedback field:

```text
019f6058-ca64-7510-bcc5-f9416f981036
```

Keep this as the single primary value in the submission form. The July 18 task remains supplemental evidence.

## Evidence and reproducibility

The original source baseline is permanently identified above by full hash. It belongs to the private source history and was not copied into the public repository because that history contains retired names and metadata.

The clean public history is anchored by:

- **Sanitized pre-Build Week baseline:** `fb16b3a7506f4119fd8e95403e80d68825aa3b2c`
- **Baseline tag:** `pre-build-week-2026`
- **Consolidated Build Week implementation:** `1c08a6eb1fe3e888de940372324185736651aeed`

Verify the public comparison with:

```bash
git show --stat pre-build-week-2026
git diff --stat pre-build-week-2026..HEAD
git log --date=iso-strict --oneline pre-build-week-2026..HEAD
```

The maintainers retain the private source history needed to verify `e66fa9a9f13bb688387bfc655394c3e5c7f1100f`, `25dc18b`, and `0b8f611`. Those source objects are maintainer-held evidence references rather than promised objects in the clean public history.

## Public-repository integrity

The public `weekform-dev` repository should start with an explicitly labeled **pre-existing baseline snapshot**, followed by dated Build Week commits. The baseline must be described as a public-release snapshot derived from the source baseline, with publication-only redactions documented, rather than claimed as the original commit. This structure keeps the prior/new boundary visible without publishing private Codex logs, retired history, or a false claim that prior work was created during the submission period.

The publication process requires these checks before the first public push:

1. Confirm the intended baseline snapshot is complete and buildable.
2. Create a new root history; do not push inherited branches, tags, or commit objects.
3. Label the public-release baseline snapshot `pre-build-week-2026`.
4. Commit Build Week changes separately with accurate dates and authorship.
5. Record the public baseline and final cleanup hashes in this document.
6. Run a secret scan and the full validation checklist.
