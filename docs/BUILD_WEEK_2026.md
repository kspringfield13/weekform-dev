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

### Manager Access and Simulation access

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
  production team write. Simulation stays an isolated, development-only
  synthetic tool with separate simulator authorization and RLS requirements.
  At this July 19 milestone, live execution was not yet claimed. The July 20
  local implementation below does not change the production or RLS boundary.
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

### Simulation work world and observable live loop

- **Date:** July 20, 2026
- **Outcome:** the administrator tool is now presented as **Simulation** with
  two first-class functions. **Generate span** creates deterministic,
  persona-based duties, work items, communications, and plausibly bounded
  business records across weeks, months, or years. Those records link back to
  synthetic work-item identifiers, while Weekform outcomes still come from the
  real signal → session → work-block → reviewed-evidence → deterministic-model
  pipeline. **Live simulation** uses the same persona catalog to show a short
  business-work loop, a visible synthetic cursor, a return to Weekform, review
  of a real demo-mode work block, and navigation through the actual Week and
  Forecast UI.
- **Implementation:** live actions run in a sandboxed same-origin iframe and
  are limited to exact loopback port `5173` URLs, known persona parameters, and
  allowlisted selectors. The Weekform leg uses persona-shaped synthetic demo
  state and the application's real UI handlers. The stage exposes pause,
  resume, step, restart, speed, a role transcript, and a business-action →
  staged-context → demo-review → decision ribbon so the scripted live path is
  not misrepresented as native foreground capture. A live run is complete only
  after both its finite action plan and deterministic span generation finish.
- **Boundary:** Live simulation exists only in Vite development and requires
  explicit per-run confirmation. Its cursor is rendered inside Weekform; it is
  not the macOS cursor. It does not use AppleScript, OS-wide input automation,
  a dedicated browser profile, external applications, or external network
  mutations. The embedded Weekform session is demo-mode and in-memory: it reads
  no personal `PersistedAppState`, starts no capture/import, and persists no
  simulated UI edits. This is not evidence of production browser automation,
  real workplace-app control, host-level network isolation, or live multi-actor
  RLS behavior.
- **Evidence:** simulator contracts were expanded red-first to cover all ten
  persona work catalogs, linked duties/communications/business records for long
  spans, exact playback URL constraints, and actual Weekform UI actions. The
  simulator suite passes 21/21, including work-item-to-raw-event-to-WorkBlock
  traceability, scenario/persona responsiveness, and calendar bounds. The
  authoritative root `npm run build`
  passes. Browser and native proof remain separate evidence surfaces.

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
- **Canonical workspace follow-through:** primary navigation, sign-in fallback,
  auth callbacks, and Web actions now return to `/app` rather than leaking the
  legacy `/dashboard` route. The live Individual workspace, Manager Access
  chooser, and owner/manager team view share an explicit Individual/Manager
  mode control; Manager mode remains unavailable without an eligible role.
  This follow-through was reproduced red-first, then verified with 224/224 Web
  tests, Web typecheck, optimized Next.js build, root build, and an unauthenticated
  browser check proving `/app` preserves `next=/app` through sign-in.
- **Mac release packaging and download experience:** the protected `/download`
  surface now leads with one native `.dmg` action and replaces developer setup
  instructions with a standard Mac install flow, release notes, product
  features, first-week tips, and accurate local/privacy boundaries. A universal
  `Weekform_0.1.0_universal.dmg` was built locally with Apple silicon and Intel
  slices; `hdiutil verify`, mounted-content inspection, bundle metadata, and
  architecture checks passed. The page was reviewed at 1440px and 390px with
  no console errors or horizontal overflow. Developer ID signing, Apple
  notarization, and private-bucket upload remain explicitly pending. The
  public website-hosted preview path carries an explicit unsigned-preview
  disclosure and is not presented as private or Gatekeeper-trusted
  distribution.
- **July 20 release hardening:** because this machine has no Developer ID
  Application identity, the two public preview DMGs and the static redirect
  fallback were removed. The public release now fails closed unless private
  hosting is accompanied by explicit Developer ID-signature, notarization,
  stapling, checksum, and verification-time metadata. This is a release gate,
  not evidence that signing or notarization occurred.
- **July 20 Gatekeeper and installed-app handoff follow-through:** a Developer ID
  Application identity later became available and produced a correctly signed
  universal beta, but live `spctl` and `stapler` checks proved it remained
  unnotarized and unstapled; Gatekeeper rejected it and macOS launched it through
  App Translocation. The beta's production download configuration was removed
  rather than asking users to bypass macOS security. The authenticated download
  page is now a minimal Desktop/Web choice followed by one Apple-independent
  two-command source install; release status, feature grids, tips, and repeated
  download notes no longer compete with the action. While the official release
  remains fail-closed, users shallow-clone the public repository, then run its
  included `start.sh`. The launcher
  delegates to the reviewed installer, builds on the user's Mac, and never
  claims to be the notarized DMG. Web Inspector traced
  the packaged white window to Tauri's
  `freezePrototype` hardening: freezing `Object.prototype.toString` caused Zod's
  namespace initialization to throw before React could mount. The incompatible
  freeze is now disabled while the production CSP remains enforced, and the
  desktop root also renders a local-data-safe recovery screen for later React
  failures. A source install rendered the full Capacity surface and two
  menu-bar reopen passes each moved the native window count from zero to one.
  Explicit operational handoffs can use the registered `weekform://` scheme,
  with single-instance native handling that restores, activates, and focuses
  the requested window. Download/Get Mac acquisition buttons remain normal,
  prompt-free links to the authenticated download page; they do not trigger a
  browser-owned “Open Weekform.app?” dialog. A fail-closed publisher now encodes the
  signed universal build, Apple notarization, stapling, Gatekeeper, immutable
  private upload, hosted-byte checksum, proof-env, and production deployment
  sequence. A local Keychain notarization profile is now available, but the two
  Apple submissions checked on July 20 still reported `In Progress`; therefore
  no official artifact or trusted-download claim has been published yet.
  The source route was tightened without a downloaded ZIP, `curl | bash`, or a
  quarantine bypass, and the installer repairs only the unidentified ad-hoc
  signature shape produced by a local build. Focused red-first regressions,
  269 desktop service tests, 570 Web tests, the root build, optimized Web build,
  shell syntax check, and both dependency audits passed before deployment.
- **July 20 Web-to-Mac tracking handoff:** Individual Today and every Week view
  now share one Start Tracking action. It attempts the registered desktop app,
  opens the compact top-right native window, and resumes local tracking only
  after the desktop account state is hydrated and signed in. A signed-out app
  opens Account & Sharing without changing the current pause state; a missing
  app falls back to the authenticated download route. No raw activity or native
  permission moves into the browser.

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

### Hybrid Weekform Web explanation

- **Date:** July 19, 2026
- **Outcome:** the Individual `/app` workspace now leads its private-review
  section with a plain-language Mac-to-Web model: the Mac holds the sensitive
  source of truth, the Web receives only review-safe derived fields, and every
  requested change returns to the Mac for approval. The previous dense replica
  paragraph and oversized empty state are replaced by a visual boundary map and
  a three-step Mac setup path.
- **Boundary:** the redesign does not widen the replica allowlist or change sync,
  review-command, approval, persistence, or sharing behavior. Its labels mirror
  `docs/PRIVACY.md`: raw activity, titles, evidence, notes, screenshots, and AI
  credentials remain outside the Web workspace.
- **Evidence:** the explanatory contract was written red-first and passes; Web
  typecheck, the optimized Next.js build, and the authoritative root build pass.
  Dark-theme browser checks at 1440px and 430px show the Mac → Web → Mac approval
  sequence without horizontal overflow. The full Web suite has three unrelated
  bundled-DMG failures in the concurrently changing download lane.

### Native-to-cloud personal Web workspace

- **User-visible outcome:** Weekform for Mac can explicitly enable a private, review-safe Web replica. The authenticated Web dashboard shows derived capacity and reviewable blocks, sends confirm/exclude/relabel requests, and states that the Mac must approve every request. Private Supabase Broadcast invalidations refresh the server-rendered view; the 15-second request-fresh loop remains the fallback.
- **Implementation evidence:** `PersonalWorkloadReplicaV1` is built field-by-field with no raw evidence fields; desktop sync uses registered devices, durable offline batches, idempotent batch ids, server cursors, and block revisions. The additive Supabase migration defines RLS-scoped replicas, commands, hardened RPCs, and private Broadcast authorization. Native capture writes AES-256-GCM journal entries before emitting a sample, keeps the journal/session keys in macOS Keychain, migrates legacy raw samples out of the general Tauri Store, and connects retention/reset to the journal.
- **Boundary:** The replica migration and its duplicate-safety upgrade are applied to the linked Weekform Supabase project and exercised with live RLS actors as part of the July 20 hosted verification below. Browser/demo proof still does not prove native capture or Keychain behavior; native Rust tests and a packaged-app smoke test are separate evidence surfaces.

### Desktop-parity Individual Web workspace

- **Date:** July 20, 2026
- **Outcome:** authenticated Individual access now uses the same primary spatial
  model as the Desktop app: the current light Geist viewport shell, persistent Today / Week / Agent /
  History / Settings navigation, a reliable-capacity rail, contextual Week tabs,
  and distinct selected views. Week opens directly on a decision-first capacity
  surface with dependable headroom, committed/planned/reactive load, work-pattern
  distribution, and safe category allocation. Forecast adds a deterministic,
  explicitly non-AI baseline from bounded review-safe history. Today provides the
  review queue; History separates review-safe Activity from Web sync receipts, and
  Settings mirrors Desktop sections while retaining account, deletion, and sharing controls.
- **Boundary:** Supabase queries, realtime invalidation, retention, deletion, and
  approval-gated confirm/exclude/relabel actions are unchanged. The Web capacity
  presentation derives only from the positive-allowlist personal replica. Agent,
  AI-generated Forecast refinement, AI Usage, generated Summary, Acceleration, and
  Skills remain explicitly Mac-only where the Web lacks the private evidence or
  runtime needed to support them; the UI does not fabricate those capabilities.
- **Evidence:** shell and capacity-presentation contracts were written red-first.
  A follow-up visual-contract pass replaced the obsolete dark shell cascade with
  Desktop's current light tokens, 224px sidebar and 44px toolbar geometry, centered
  brand hierarchy, compact context rail, and 1200px content frame. It also made
  unavailable Web Agent controls natively disabled instead of merely labeling them
  unavailable. A second red-first shell refinement moved Settings to Desktop's
  wide-layout footer position (while retaining it in the narrow navigation) and
  added Desktop's accessible Today review-count badge from the already-loaded,
  review-safe replica. `verify:wave3` passes with 154 desktop-cloud and 265 Web tests plus the optimized
  Next.js build; the authoritative root build passes. Package audit execution was
  attempted but the sandbox could not resolve `registry.npmjs.org`, so this run does
  not claim a fresh vulnerability result. Authenticated browser screenshot proof
  remains separate from the source/build gates.

- **July 20 Capacity composition follow-through:** the populated Individual Web
  Capacity view now preserves the Desktop dashboard order and density: gauge-led
  decision hero, icon-led capacity cards, commitment/headroom and category detail,
  a work-mode composition panel, contextual guidance, and collapsed explainability.
  The duplicate Web-only hero was removed without changing replica, realtime,
  error, empty, approval, or Manager Access wiring. Web work-mode composition is
  calculated only from disjoint review-safe block modes—not overlapping summary
  signals—and overload above 100% remains visible in labels while chart geometry
  stays bounded. Ratio-based context-switch and WIP scores retain the Desktop
  0..1 model semantics. Red-first Capacity contracts reached 10/10, the expanded
  Individual parity set reached 24/24, and `verify:wave3` passed with 154/154
  desktop-cloud tests, 271/271 Web tests, and the optimized Next.js build. An
  independent critic found no blocker in this bounded slice. The root TypeScript
  build is not claimed in this follow-through because concurrently existing Span
  Simulator edits currently fail in `packages/simulator/src/engine.ts`; package
  audit also remains environment-blocked by registry DNS. Authenticated rendered
  proof and full Today body parity remain open.

- **July 20 Today composition follow-through:** authenticated Individual Web
  Today now follows the Desktop Daily Review hierarchy: queue-aware headings,
  verified/total progress, a pending-only single-column ledger, dense review
  cards, and distinct load-error, disconnected, empty, and all-reviewed states.
  The Web cards expose only review-safe replica fields and explicitly identify
  the private project, stakeholder, and evidence detail that remains on Mac.
  Confirm, exclude, and category-change forms still submit the existing block,
  week, revision, and action fields through the approval-gated server action;
  no browser workload storage or direct mutation was added. Red-first Today
  contracts reached 10/10, `verify:wave3` passed with 154/154 desktop-cloud
  tests, 281/281 Web tests, and the optimized Next.js build, and the
  authoritative root build passed. Package audit was retried but remains
  environment-blocked by registry DNS. The sandbox also denied binding the
  local Web dev-server port, so authenticated rendered browser proof is not
  claimed in this follow-through.

- **July 20 Weekly Review and Settings parity follow-through:** Week → Review
  now uses the Desktop close-out composition rather than an inline percentage
  summary: progress, an ordered checklist, status chips, explicit next actions,
  and the calm completion footer. Only non-empty, fully reviewed blocks from the
  positive-allowlist replica can become Ready. Forecast accuracy, narrative
  evidence, and the completion audit remain visibly Mac-only; Web completion is
  natively disabled and links to the Mac app instead of inventing success. The
  Settings surface now also preserves Desktop's one-to-one tab-to-tabpanel
  relationships, including stable labels, hidden inactive panels, and keyboard
  focus. Red-first focused contracts pass 9/9; `verify:wave3` passes with
  154/154 desktop-cloud tests, 288/288 Web tests, and 11/11 generated static
  pages; the root build, Web typecheck, and diff check pass. Package audit was
  attempted but registry DNS returned `ENOTFOUND`, and the sandbox denied the
  local Web server bind with `EPERM`, so neither a fresh vulnerability result
  nor authenticated rendered browser proof is claimed.

- **July 20 AI Usage and Summary parity follow-through:** Week → AI Usage and
  Summary now use dedicated Desktop-shaped compositions instead of generic
  Mac-only placeholder cards. AI Usage preserves the Desktop hierarchy while
  stating that provider activity, pricing, budgets, and assistant-session
  detail remain local; it displays no reconstructed token, prompt, cost, or
  model measurements. Summary derives a deterministic allocation readout only
  from the existing positive-allowlist personal replica and explicitly does not
  claim an AI-generated narrative, private evidence, editing, export, or Web
  completion. Both surfaces hand local-only work back to the Mac app. The
  change adds no Supabase, API, schema, action, storage, or sync wiring.
  Red-first focused contracts moved from 0/4 to 4/4; the combined lead-focused
  suite passes 14/14; `verify:wave3` passes with 154/154 desktop-cloud tests,
  294/294 Web tests, and 11/11 generated static pages; the authoritative root
  build, Web typecheck, and diff check pass. An independent read-only critic
  approved the slice with no blocking issue. Package audit was retried but
  registry DNS returned `ENOTFOUND`, so no fresh vulnerability result is
  claimed. Authenticated rendered browser proof also remains unclaimed because
  the prior sandbox server-bind restriction was not lifted in this iteration.

- **July 20 Agent workspace parity follow-through:** Agent → Ask, Accelerate,
  and Skills now use dedicated Desktop-shaped compositions instead of the
  generic Mac-only fallback. Ask follows the Desktop's vertical Agent header,
  review-safe workload briefing, common-question grid, Mac handoff, and composer
  hierarchy. Accelerate retains the Desktop decision structure for synthesis,
  realized savings, and play evidence, while Skills retains the Desktop library
  empty state and cross-links back to Accelerate. Because the existing Web
  allowlist contains no raw activity, play evidence, recipes, saved skills,
  prompts, or AI credentials, every unsupported control is natively disabled,
  omitted values are explicitly unavailable, and no browser-side substitute is
  fabricated. The change adds no Supabase, API, schema, action, persistence, or
  sync wiring. Red-first Agent contracts moved from 0/4 to 9/9 across the focused
  suites; `verify:wave3` passes with 154/154 desktop-cloud tests, 299/299 Web
  tests, and 11/11 generated static pages. Web typecheck and diff checks pass.
  The authoritative root build is not claimed because unrelated concurrent Span
  Simulator edits currently omit the required `step` and `setStep` props in
  `SpanSimulatorApp.tsx`. Package audit was retried, but registry DNS returned
  `ENOTFOUND`; authenticated rendered proof remains a separate pending surface.

- **July 20 operational Individual Web Ask follow-through:** the authenticated
  Agent → Ask surface now completes a bounded review-safe question loop instead
  of stopping at disabled Desktop-shaped controls. Starters and typed questions
  reach a same-origin route that re-authenticates the caller, reloads only that
  user's latest RLS-scoped personal replica, and reduces it again to week-level
  aggregate evidence. The mounted conversation is temporary and capped; it is
  not written to Supabase or browser storage. An explicitly configured
  server-only personal Agent model can answer through the Responses API with
  `store: false`; absent configuration, provider failure, timeout, malformed
  output, or unsupported evidence produces a visibly labeled deterministic
  fallback. Model answers must retain at least one server-known evidence
  reference. Explicit state-changing requests run neither a model call nor a
  mutation and hand off to the approval-gated Mac workflow. Focused Ask/parity
  contracts pass 21/21, including direct no-store, request-minimization, timeout,
  invented-evidence, configuration-isolation, and action-boundary checks.
  `verify:wave3` passes with 157/157 desktop-cloud tests, 334/334 Web tests, and
  the optimized Next build including dynamic `/api/personal-agent`; Web
  typecheck, the authoritative root build, and diff checks pass. An independent
  critic found no blocking issue. Package audit was attempted but registry DNS
  returned `ENOTFOUND`; the sandbox also denied the local server bind with
  `EPERM`, so authenticated rendered/network/storage proof is not claimed.

- **July 20 History parity follow-through:** History → Activity and Audit now
  reuse the Desktop information hierarchy instead of generic Web cards.
  Activity presents the current review-safe block, compact search, structured
  block cards, review state, confidence, duration, and modeled capacity. Audit
  adds pressed scope filters, searchable and expandable Web receipt rows, and
  explicit no-match recovery. Local audit events and conditional Flagged
  Captures remain visible as Mac-only boundaries because the existing positive
  allowlist contains no raw window titles, screenshots, notes, visual summaries,
  or local audit detail; no Supabase, API, schema, sync, or browser-storage
  wiring changed. The red-first History contract moved from 0/2 to 9/9 across
  the focused suites. `verify:wave3` passes with 154/154 desktop-cloud tests,
  301/301 Web tests, and the optimized Next.js build; the authoritative root
  build and diff check also pass. Package audit remains environment-blocked by
  registry DNS (`ENOTFOUND`), and the sandbox denied the local Web server bind
  with `EPERM`, so authenticated rendered proof is not claimed.

- **July 20 addressable Individual workspace follow-through:** authenticated
  Individual Web navigation now maps every review-safe Desktop screen to one
  validated, canonical `?screen=` state. Initial loads restore that surface;
  sidebar, mouse, and keyboard context navigation update browser history; and
  Back/Forward resolve through the same allowlist. Unknown, local-only, and
  cross-section screen/subview combinations fail closed to a valid default
  instead of hiding every panel. Approval-gated Today review requests now
  return feedback to Today, while private-history deletion returns feedback to
  Settings; the notice is rendered above conditional surfaces. This adds no
  browser workload storage, direct mutation, replica fields, or change to Mac
  approval authority. The red-first focused contract moved from a missing
  module and 2 composition failures to 10/10 passing. `verify:wave3` passes
  with 157/157 desktop-cloud tests, 308/308 Web tests, and the optimized Next.js
  build with 11 generated static pages; Web typecheck, the authoritative root
  build, and diff check pass. An independent read-only critic found no code
  blocker after catching and verifying a mouse-tab routing repair. Package
  audit remains environment-blocked by registry DNS (`ENOTFOUND`). The sandbox
  also denied a local server bind and browser-daemon startup, so authenticated
  rendered Back/Forward proof is explicitly not claimed.

- **July 20 private Web replica integrity follow-through:** the authenticated
  Individual workspace now validates the complete Desktop replica contract at
  its server-side read boundary before any derived week reaches a Web screen.
  Exact positive allowlists, canonical timestamps, ISO weeks, matching
  row/payload/block identities, deterministic revision formats, block chronology, and
  Desktop metric ranges fail closed as one batch; a malformed newest row can no
  longer disappear or expose an older week as current. Every Individual route
  shows the same assertive, sanitized resync recovery state, while future
  calendar blocks and independent Desktop/server clock skew remain valid. Web
  review requests also reject malformed block, week, and revision identifiers
  before the RPC boundary. This adds no replica fields, browser persistence,
  direct mutation, or change to Mac approval authority. Red-first focused
  contracts moved from 5 integrity failures to 19/19 passing; Web typecheck and
  `verify:wave3` pass with 157/157 desktop-cloud tests, 320/320 Web tests, and
  the optimized Next.js build. The authoritative root build and diff check also
  pass. Package audit remains environment-blocked by registry DNS (`ENOTFOUND`),
  and authenticated rendered browser proof remains a separate pending surface.

- **July 20 Web-to-Mac review lifecycle follow-through:** Individual Web Today
  now reloads the signed-in user's review-request lifecycle through the same
  RLS-scoped API boundary and shows action-specific pending, applied, rejected,
  and conflict states in the Desktop-shaped review cards. Invalid chronology,
  wrong-week rows, duplicate command ids, duplicate pending targets, malformed
  server fields, and oversized result sets fail closed before actions render.
  A partial unique index and hardened security-definer RPC permit one pending
  request per user/block revision: identical retries return the existing id,
  contradictory retries fail loudly, and terminal history remains intact. The
  browser still cannot apply local truth. Focused lifecycle/parity contracts
  pass 25/25; `verify:wave3` passes with 157/157 desktop-cloud tests, 342/342 Web
  tests, and the optimized Next.js build; Web typecheck, the authoritative root
  build, and diff check pass. The dedicated 25-assertion pgTAP contract passes
  against both local and linked hosted Supabase. Authenticated rendered checks
  remain separate because the sandbox denies local server binding. Package audit
  is separately blocked by registry DNS (`ENOTFOUND`).

- **July 20 review-protocol compatibility hardening (not yet deployed):** the
  released v1 queue, table shape, registration signature, and direct completion
  behavior remain available while a separate v2 queue owns the two-phase claim,
  durable local-application receipt, and idempotent completion protocol. Pending
  v1 rows are never moved, copied, or rollout-deleted. The new desktop polls and
  drains v1 with the released RPC path and persists an explicit protocol on every
  local outbox item, preventing cross-protocol lifecycle calls. Web advances to
  v2 only when every active device advertises v2 and the v1 backlog is empty;
  per-user transaction locks serialize routing with registration, and pending v2
  work blocks a v1 downgrade. A foreign v2 Mac can close an `ack_pending` row
  from its durable receipt without reapplying the local mutation, preserving the
  original device attribution and emitting recovery audit evidence; this closes
  command lifecycle but does not claim the unavailable Mac uploaded a newer Web
  replica. Red-first protocol tests now pass 77/77, the complete local Supabase
  suite passes 372/372, desktop service tests pass 233/233, Web tests pass
  535/535, and both root and Web production builds pass. No hosted migration,
  Web deployment, or public desktop release is claimed by this entry.

- **July 20 atomic Today Confirm-all follow-through:** Individual Web Today now
  exposes the Desktop-primary `Confirm all N` action for review-safe blocks that
  do not already have a current pending, applied, or conflict request. Web sends
  only a bounded set of block id, week id, and expected-revision triples. The
  authenticated security-definer RPC derives confirmation semantics, ownership,
  status, and chronology; validates all targets against the caller’s current
  unverified replica before writing; returns existing ids for identical retries;
  and rolls back the whole batch on a stale, malformed, duplicate, unauthorized,
  or contradictory target. Rejected and stale-revision requests remain retryable,
  and no browser persistence or local-truth mutation was added. Red-first focused
  contracts began at 0/11 and finish at 13/13 after the capped-batch UX edge was
  added; the full Web suite passes 355/355 and Web
  typecheck and diff check pass. The dedicated 23-assertion pgTAP contract passes
  against both local and linked hosted Supabase, including atomic rollback,
  ownership, idempotency, validation, and server-owned lifecycle checks.

- **July 20 Span Simulator decision-cockpit refresh:** The admin-only local
  simulator now replaces its five-step explanatory wizard with one compact
  People → Pressure → Time Lens cockpit. The primary canvas keeps role counts,
  scenario presets, correlated pressure controls, live output estimates,
  readiness, and launch visible together; schedule, sharing, seed, and fine
  pressure remain available under Advanced setup. Scenario presets now update
  the complete deterministic pressure shape rather than changing only the
  scenario label. Completed runs lead with the resulting reliable capacity and
  consolidate eight dense tabs into Decision, Evidence, Forecast, and Integrity
  without removing raw evidence, work-world records, timelines, projections,
  manager-safe snapshots, validation, export, or audit access. Result-to-result
  comparison now opens from Results, resets after closing, and traps keyboard
  focus correctly. Synthetic isolation, the IndexedDB run repository,
  resumable checkpoints, cancel/resume, archive/delete, export, and live
  same-origin playback boundaries remain unchanged. Rendered synthetic-data
  proof covered dark and light themes at `1024×720`, the narrow responsive
  layout, a completed 26-week generation, a completed one-week live playback,
  keyboard tab navigation, and a two-run comparison with no browser errors.
  `test:simulator` passes 22/22, `test:desktop-cloud` passes 157/157, the
  authoritative root build passes, `npm audit --audit-level=moderate` reports
  zero vulnerabilities, and `git diff --check` passes. Live local Supabase
  proof now closes the former infrastructure gap: Docker Desktop reports a
  running `29.6.1` server, migration history confirms `202607180001` and the
  `202607190006` current-user admin-access seam are applied, and the simulator
  RLS plus Admin Portal authorization contracts pass 38/38 pgTAP assertions.
  The live contract separately proves both authenticated-admin RLS rejection
  and privileged-path check-constraint rejection when synthetic provenance is
  dropped. The complete authorization suite now passes 198/198 assertions
  locally and 198/198 against hosted project `fytospjjbcksmppmvupy`: personal
  replica isolation, duplicate-safe and atomic batch review commands, simulator
  admin access, Span Simulator RLS, and Team Cloud RLS all pass. The hosted
  migration ledger was initialized and reconciled after the project was found
  to contain the schema without `supabase_migrations.schema_migrations`; local
  and hosted histories now match from `202607180001` through `202607200003`, and
  a linked dry run reports the remote database is up to date. Authenticated users
  have no direct `UPDATE` privilege on append-only simulator personas. No seed
  data was pushed.

- **July 20 calendar-source parity:** Data Sources now gives Outlook, Google,
  and Apple Calendar one bounded, provider-neutral path: each can import a local
  `.ics` file over selected dates, while the native app exposes optional live
  connection and manual range sync. Google and Outlook use read-only OAuth with
  PKCE, paginated bounded requests, and Keychain-held refresh tokens; Apple uses
  explicit EventKit permission. Provider payloads are allowlist-normalized into
  the inherited reviewable calendar/work-block model, and live reconciliation
  removes stale events only for that provider and requested range. Automatic
  refresh runs only while Weekform is open. Focused TypeScript tests pass 6/6,
  native normalization/boundary tests pass 3/3, the authoritative root build,
  Cargo check, and release-mode Tauri `.app`/`.dmg` bundle gate pass, and package
  audit reports zero vulnerabilities. No live Google or
  Microsoft account proof is claimed because this checkout has no configured
  provider client ids; no Apple permission grant is claimed without an installed
  app interaction.

- **July 20 first-run wizard handoff:** The branded Weekform introduction is
  now step one of a single six-step setup wizard instead of a separate overlay.
  Completing or deferring the wizard consistently opens Settings, where the
  user can review data sources, privacy controls, optional AI, notifications,
  retention, export/reset behavior, and the Replay walkthrough action before
  exploring the rest of the app. The wizard no longer bypasses that review with
  direct demo, tour, or Today shortcuts. Focused tests were written red-first
  and pass 3/3 for step order and both exit outcomes; the full desktop service
  suite passes 160/160 and the authoritative root build passes. Rendered browser
  verification covered the introduction, all six steps, the final Settings
  handoff, the defer handoff, the visible Replay walkthrough control,
  keyboard-focused primary actions, and a clean console.

- **July 20 onboarding clarity follow-through:** The same six-step wizard now
  uses a persistent labeled setup rail, a distinct decision-led title for every
  step, direct radio-card retention choices, and a Codex-first AI step that
  recommends ChatGPT/Codex for the full Weekform experience while keeping the
  Platform API-key form inside a collapsed advanced disclosure. Continuing
  without AI remains explicit. The final page summarizes tracking, raw-sample
  retention, and AI state. Dense
  privacy and permission paragraphs were replaced with scannable, truth-preserving
  evidence/control rows; the data flow and approval boundaries are unchanged. The
  final page also restores a clearly labeled synthetic-week preview alongside the
  normal Settings handoff. That preview flushes the onboarding outcome before
  navigation, opens the populated weekly demo without loading the user's data,
  and returns to the real profile without reopening the wizard. Six focused
  presentation contracts plus six setup-flow contracts pass, the complete
  desktop service suite passes 248/248, and the authoritative root build passes.
  Browser verification walked all six screens at the native 1024×720 minimum,
  checked the final and AI layouts in dark and light themes, verified the API-key
  disclosure opens only on request, exercised the simulated-week entry and exit
  path, and found no console warnings or errors.

- **July 20 ChatGPT/Codex-plan connection:** Weekform can now use OpenAI's
  Codex app-server with OpenAI-managed ChatGPT sign-in instead of trying to mint
  or copy a Platform API key from a subscription account. The native boundary
  uses a Weekform-owned Codex home and empty workspace, requires macOS Keychain
  credential storage, disables apps/plugins/hooks/browsing/shell/file/computer-
  use/multi-agent tools, and creates one read-only, approval-free, ephemeral
  thread per generation. Existing API-key/provider behavior remains available.
  Classification, Review Copilot, forecast, narrative, acceleration, Agent chat,
  and opt-in Visual Context all route through the selected connection; reset and
  switching back to an API key sign out the isolated Codex account. A synthetic
  live protocol check discovered the managed default model, honored an exact
  JSON schema, completed without a tool call, and left the thread ephemeral.
  Focused native tests pass 4/4, the full native suite passes 11/11, the desktop
  service suite passes 163/163, the authoritative build and packaged macOS
  app/DMG build pass, and `npm audit --audit-level=moderate` reports zero
  vulnerabilities. A fresh Weekform-specific browser sign-in remains a user-
  performed authentication step and is not claimed as completed by automation.

- **July 20 Web Forecast parity:** The authenticated individual Web workspace
  now mirrors the Desktop Forecast history context with a bounded six-week,
  five-signal capacity trajectory (allocated, reactive, deep work, reliable
  capacity, and meeting density), an accessible chart-equivalent data table,
  and deterministic newest-replica selection when a week is duplicated. Replica
  load or integrity failures render as errors rather than plausible empty
  forecasts, and the scenario range geometry is clamped and labeled. The Web
  copy explicitly identifies these as observed review-safe baselines, not saved
  predictions or forecast-accuracy evidence; AI forecast generation remains a
  Mac handoff. Focused Forecast tests pass 11/11, Web typecheck passes, and
  `verify:wave3` passes 157/157 desktop-cloud tests, 359/359 Web tests, and the
  optimized 12-page Web build. The root build passes. At that validation point,
  package audit refresh was blocked by registry DNS, and rendered authenticated
  proof was not claimed because the managed runner rejected local port binding.

- **July 20 Team coordination workspace redesign (not yet deployed):** the
  authenticated Web team page now follows a coordination-ledger hierarchy:
  current sharing coverage, an identity-first roster, planning evidence,
  approval-gated actions, and team controls. Member cards show display name,
  manager-authorized account email, role, consent state, freshness, and only the
  workload metrics that member approved. Account email remains in Supabase Auth
  and crosses the boundary through an additive security-definer RPC that
  reauthorizes the active owner/manager role; plain members, outsiders, and
  anonymous callers are denied, and email is excluded from Team Briefing model
  input. Focused roster and presentation contracts pass 19/19, the live local
  Team Cloud pgTAP boundary passes 85/85, its dedicated roster-identity proof
  passes 6/6, and both optimized Web and authoritative root builds pass.
  Authenticated synthetic-data browser review covered the
  1440×1000 desktop and 390×844 narrow layouts with all roster emails visible
  and no page errors. No hosted migration or weekform.dev deployment is claimed
  by this entry.

- **July 20 Chat-source intelligence:** Native Data Sources now follows Calendar
  with a truthful unavailable Email row and then one bounded, manual Chat
  connection path for exactly Slack, Google Chat, and Webex.
  Native OAuth, Keychain-held credentials and cursors, provider pagination, and
  coverage receipts project provider responses into a canonical content-free
  evidence contract before React or persisted app state. Ambient traffic is
  ignored; directed requests remain 0%-capacity review cards until measured;
  safely correlated self actions become bounded, correctable response episodes,
  while uncorrelated self-sent bursts become proactive coordination. Partial
  pages are accumulated without entering the workload model. Completed intact
  Google Chat and Webex runs can authoritatively reconcile their provider/range;
  Slack reads top-level history from currently listed non-archived conversations,
  excludes thread replies, applies additively, and never claims deletion
  authority. Google Chat's documented empty message-list object is accepted as
  valid empty coverage. Resumable pages remain visibly in progress; terminal
  blocked receipts do not update the last-successful time or claim a completed
  audit. Zero-capacity Chat cards cannot change capacity, confidence, focus
  overlap, acceleration recurrence, or manager review counts. Managers receive
  only the member-approved aggregate workload contract already governed by
  Account & Sharing. AI and the private Web replica receive provider-free Chat
  projections with opaque block ids, and returned review actions resolve
  fail-closed on the Mac. The authenticated Web Settings surface places the
  same three-option Chat section directly below Email and hands connection
  control to the authoritative Mac. The Webex route and native connector both
  fail closed unless operators set
  `WEBEX_CHAT_BROKER_SECURITY_VERIFIED=true` after verifying deployed rate
  limiting and credential-safe logging. Focused Chat contracts pass 74/74;
  native Chat boundary tests pass 30/30; desktop service tests pass 173/173;
  Web tests pass 413/413. Root and optimized Web production builds, Web
  typecheck, Cargo check, the new Chat module's `rustfmt --check`, diff check,
  and root/Web package audits pass; both audits report zero vulnerabilities.
  Browser verification covered the native-shaped Data Sources view at the
  1024×720 minimum in light and dark themes with no console errors. Provider app
  registration, Google restricted-scope verification, a deployed/rate-limited
  Webex token broker, and live-account transfer remain unclaimed. Codex task
  `019f7f6c-b19e-7d71-a333-58c951ef34c5` contains the implementation and review
  evidence; raw task artifacts are not public submission material.
  A July 20 connection-UX follow-through replaces duplicated provider-guide
  metadata with one shared integration capability registry. In an unconfigured
  build, **Connect now** opens end-user copy that says the connector is
  unavailable, keeps operator requirements behind progressive disclosure, and
  points back to the existing sanitized local import instead of instructing the
  user to configure build variables. In a configured build, the same modal
  presents access review, system-browser authorization, native content-free
  filtering, bounded initial-transfer progress, retryable failure, and intact-run
  completion without dismissing itself during an active step. Typed readiness
  codes cross the native boundary while unknown or older payloads normalize to
  generic safe copy. Slack capability truth records desktop PKCE availability,
  user-scope-only redirects, rotating 30-day refresh tokens, and the applicable
  1-request/minute, 15-row history limit; Google records loopback PKCE and its
  restricted read scope; Webex remains confidential and uses the existing
  token-only HTTPS broker. Native secret wrappers use the narrow `zeroize`
  dependency so transient authorization, token, self-id, and serialized
  credential/cursor buffers clear on drop without changing Keychain
  serialization; no generic provider SDK was added. Live provider authorization,
  provider-console configuration, Google restricted-scope verification, the
  deployed Webex broker, packaged-app behavior, and account-level transfers
  remain explicitly unclaimed. Focused Chat contracts pass 78/78, native Chat
  tests pass 35/35, and the authoritative root build, Cargo check, Rust format
  check, diff check, and live-registry root package audit pass; the audit reports
  zero vulnerabilities. Rendered browser review at the 1024×720 minimum covered
  the unavailable-build flow in light and dark themes with no page errors. The
  configured live-account authorization and transfer flow remains unclaimed.

- **July 20 production Manager Mode:** The desktop Manager Mode replaced its
  synthetic roster, metrics, briefing, history, and coordination queue with
  RLS-scoped Supabase reads of active team membership, profile display names,
  and members' latest approved workload snapshots. The signed-in owner or
  manager is retained in the roster and labeled as the current user. Missing,
  stale, unshared, and failed reads remain explicit and never become zero or
  placeholder data. Today and Week derive only from live approved fields;
  Agent and History provide a deterministic live summary and hand off generated
  briefings, approval-gated actions, and full audit history to authenticated
  Web. Manager Mode also restores draggable native chrome with minimize and
  resize controls. Focused desktop cloud/manager tests, the root production
  build, and live Supabase/browser proof are recorded separately; repository
  code alone is not claimed as deployed production evidence.
  A same-day Team workspace follow-through replaces the former Manager Access
  side-nav entry with a membership-gated **Team** destination on Desktop and
  Web. Members receive a generalized connection, sharing, and personal-signal
  view; owners/managers receive team-wide approved summaries, with the signed-in
  manager included. Both roles can open a large Workload Gantt backed by real
  RLS-scoped snapshot history, zoom between 1-, 4-, and 13-week horizons, and
  drill into the approved metrics and review coverage for one week. Missing
  periods and roster members remain **Not shared** rather than zero or omitted.
  The chart fetch is bounded to 650 explicit summary rows and adds no raw
  evidence, AI, or browser-persistence path. Its modal owns Escape, focus-loop,
  focus-return, background-scroll, and responsive overflow behavior.

- **July 20 capacity drill-in parity:** The desktop sidebar's Reliable capacity
  card is now keyboard- and pointer-actionable in both workspace modes. The
  shared modal shows the individual's deterministic local weekly breakdown in
  Individual mode and an approved-summary-only team median, spread, signal
  bands, and sharing coverage in Manager mode. Missing team values remain
  unknown and do not enter the median. Seven focused red-first contracts, the
  254-test desktop service suite, the root production build, and browser checks
  at 1024x720 in light and dark themes passed. The local Manager browser run
  proved the fail-closed empty state, not live authenticated team data.

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

### End-user positioning and three-minute demo

The final positioning and product-demo narrative were refined in a separate in-period task:

- **Codex Session ID:** `019f81e2-cb5a-7c60-b548-dc312f8ea687`
- **Date:** July 20, 2026
- **Outcome:** Codex reframed the README around the individual analyst's commitment decision, made the reviewed-evidence → deterministic-model → action-and-learning loop explicit, moved the optional team layer behind the personal value, and prepared a timed three-minute product demo with truthful screen actions and a concise explanation of the human–Codex build process.
- **Observable evidence:** The script uses the synthetic demo's verified review correction from Planned to Unplanned, which changes reliable capacity from 24% to 17%, committed load from 56% to 63%, and reactive load from 21% to 30%. It then uses the existing forecast-bias, forecast-track-record, acceleration, and realized-savings surfaces without claiming that the browser demo proves native capture or AI commands.
- **Human product direction:** Kyle requested a clearer end-user use case, a README refresh, and a three-minute flow that explains both the application and how Codex supported the build. The resulting story keeps the workload decision and user control ahead of integrations, team breadth, or AI spectacle.

This task is positioning and presentation evidence. It does not claim new workload-model functionality or replace the primary Project-thread value used for `/feedback`.

### Week dashboard redesign

The Week dashboard simplification is recorded in a separate in-period task:

- **Codex Session ID:** `019f772b-35f4-72f3-a82e-07762259cbd0`
- **Date:** July 18, 2026
- **Outcome:** Codex rebuilt the weekly-capacity content below the breadcrumb around clearer labels, stronger visual hierarchy, and a simpler container layout while preserving the existing capacity data, app context, and Weekform palette. The model breakdown, personal baselines, delivery-risk inputs, and privacy-safe interruption evidence remain available in a collapsed explanation layer. Follow-ups aligned the two primary panels, added reduced-motion-aware chart entrances and keyboard-accessible detail, and replaced the pastoral hero artwork with a lazy-loaded Three.js capacity signal. Its segmented surface uses the live committed-load and reliable-capacity values, updates with the app theme, pauses offscreen or while hidden, respects reduced motion, and retains a polished static fallback when WebGL is unavailable.
- **Human design direction:** Kyle supplied the visual reference, limited the redesign to the Week dashboard below “Weekly capacity,” required reuse of the app’s existing data and context, and prioritized immediate comprehension over the prior dense presentation. His follow-up direction called for equal-height panels, restrained chart motion, detail available to both pointer and keyboard users, and a higher-quality animated hero graphic with a modern technical character.

### Forecast trajectory chart refresh

- **Date:** July 20, 2026
- **Outcome:** Codex refreshed the weekly-capacity trajectory on Forecast with cubic curves that preserve every observed weekly value, low-opacity series halos, luminous point markers, a softly tinted square plotting grid, line-shaped legend keys, and responsive light/dark treatments. The existing five deterministic series, values, deltas, hover/focus isolation, SVG description, and screen-reader data table remain intact.
- **Observable evidence:** The synthetic four-week demo was reviewed in dark and light themes and at the native 1024×720 minimum. Hover isolation continued to dim peer series, the browser console had no application errors, the focused curve tests passed 2/2, the 273-test desktop service suite passed, and the authoritative root build exited 0.
- **Human design direction:** Kyle supplied the before state and a modern dark-green reference, specifically requesting a closer theme and structure with more rounded lines.

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
