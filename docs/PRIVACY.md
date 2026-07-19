# Privacy and Data Flow

Weekform processes potentially sensitive work metadata. This document describes the current prototype behavior so users and contributors can evaluate it accurately.

## Local Data

The desktop app can collect:

- foreground application name
- front-window title
- capture timestamp
- locally imported Outlook calendar metadata
- user corrections, exclusions, and confirmations
- derived activity sessions, work blocks, forecasts, and narratives
- an audit trail of collection and review events

The desktop app persists this data locally with the Tauri Store plugin. Web and demo builds fall back to browser local storage. Weekform does not currently encrypt either store; data remains on the local macOS user account until the user resets prototype data or clears the corresponding application storage.

That browser fallback describes the desktop React app when it is run in web/demo
mode. It is not the `apps/web` account and team site described below.

## AI and OpenAI API Data

OpenAI is Weekform's default and recommended AI provider. A key can be configured in the app's local Settings, or through `OPENAI_API_KEY` in the repository's ignored `.env` file during development. Credentials are never compiled into the Vite bundle. Native classification, review, forecast, narrative, and visual-context requests are sent through the Tauri process. The conversational Agent may use its configured provider directly from the webview so its tools can access current in-memory workload state; in that path, the configured key is available to the running webview and remains stored only in local prototype state.

When an AI feature runs, Weekform sends the prompt context required by that feature to the selected provider. Classification, review suggestions, and forecasts are user-triggered; weekly narrative generation can run automatically after workload evidence exists.

Depending on the feature, prompt context can include:

- active-window app names and window titles
- grouped session timestamps and evidence
- work-block labels and confidence
- calendar-derived meeting metadata
- user corrections
- capacity snapshots
- manager-summary context

Requests set `store: false`. Users should still avoid enabling or invoking AI features when the included work metadata is not permitted to leave their device or organization.

## Visual Context

Visual context is disabled by default and must be enabled in Setup.

When enabled, the app may:

1. Capture the current macOS screen after a sustained activity session.
2. Write the image to a temporary PNG.
3. Read and encode the image for an OpenAI API request.
4. Attempt to delete the temporary local file immediately after a successful read and before the provider request.
5. Store only the derived text insight and audit metadata locally.

Filesystem errors can prevent temporary-file cleanup. The screenshot can also include content outside the active application because the prototype captures the current screen. Do not enable this feature around confidential, regulated, personal, or otherwise sensitive material.

## Weekform Cloud Sharing (Account & Sharing)

Cloud sharing is **off by default** and exists only in builds configured with a publishable Supabase URL and anon key (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`). Without that configuration the Account & Sharing tab states that no upload path exists and the app remains fully local. There is no secret or service key in the desktop app; row access is governed entirely by Supabase row-level security under the signed-in user's own session.

To share anything, the user must, in order: sign in with the account created on weekform.com; select exactly one recipient team they belong to; turn sharing on; choose a share level and individual metric toggles (and, at the "projects" level, an explicit project-name allowlist); review the **exact JSON payload** that will be uploaded; and record consent. Only then does a manually approved "Sync Now" upload one `SharedWorkloadSnapshotV1` row — a versioned, allowlist-built weekly summary produced by `packages/inference/src/sharedSnapshot.ts`. The preview and the upload are the same object; a disabled metric is omitted, never sent as zero. Changing the recipient team or the shared fields clears the recorded consent and requires a new review.

The shared payload can contain only: team and ISO week identifiers, timestamps, the share level, the selected capacity metrics, sanitized category/work-mode allocation, allowlisted project-name allocation from user-verified blocks, and review-coverage counts. It never contains raw activity samples, sessions, app names, window titles, evidence, notes, stakeholder names, calendar or chat details, screenshots, Visual Context insights, audit details, or AI keys.

An optional hourly auto-sync preference is stored but off by default, and scheduled sync can only run while the app is open. The Supabase session (auth tokens) lives in local prototype storage (unencrypted), is never written to `PersistedAppState`, and is excluded from every JSON export; the full backup includes only the sharing policy and sync bookkeeping. Users can delete their previously synced snapshots for the selected team from the cloud, and disconnecting (or "Reset all local data") clears the session, policy, and sync state so no upload path remains. Every connect, policy change, sync success/failure, snapshot deletion, pause, and disconnect emits a local audit event.

Immediately before either a manual or automatic upload, the desktop app
re-fetches the selected membership and current team narrowing policy. A failed
refresh, revoked membership, or changed effective policy stops before the
request body is constructed; a policy change clears prior consent and requires the on-screen preview to
rebuild before another attempt. Unchanged scheduled state is reconciled against
the authenticated snapshot row. If that row was deleted on the website, the
desktop stops automatic recreation and requires an explicit Sync Now (or a
fresh sharing re-arm). A native Tauri Store failure does not fall through to a
second localStorage token copy. Browser localStorage remains a web/demo-only
credential-envelope fallback; native builds may store a credential-free
revocation marker there so a failed Store deletion cannot resurrect an old
session. Only a later successful replacement write clears that marker. Durable
clear failure is surfaced instead of recording a false successful reset. Local
storage is still unencrypted.

## Weekform.com browser and persistence boundary

The account/team website uses server-side Supabase API calls under the signed-in
user's row-level-security session. It has no browser `localStorage`,
`sessionStorage`, IndexedDB, browser Supabase data client, or
application-managed persistent workload cache. Client components keep only
mounted React state. Standard Supabase auth cookies persist the account session
and are cleared by sign-out. Production Manager Access has one additional
HTTP-only cookie scoped to `/admin`; it stores only allowlisted theme, accent,
density, and motion values. It contains no workload, simulator, identity, or
authorization data and can be reset from the portal.

Raw Mac activity never reaches the website. Approved workload snapshots and
explicit multi-user coordination records (accounts, teams, memberships,
invites, and manager actions) persist in Supabase because other authorized
users need them. Dashboard and team pages are request-fresh dynamic routes;
while visible and online they request a fresh server render every 15 seconds.
This is bounded near-real-time polling, not a Realtime subscription, and can lag
a successful desktop sync by the interval plus network time. Snapshot latest
selection and web freshness use a server-owned `synced_at` receipt timestamp;
client `observed_at` and `source_updated_at` remain provenance and cannot win
latest ordering through clock skew.

## Team Briefing (weekform.com, server-side AI)

The weekform.com manager dashboard includes an optional Team Briefing that summarizes already-shared team workload signals. It is a server-side feature of the web app (`apps/web/lib/briefing.ts`); the desktop app is not involved and no new data is collected for it.

The briefing can call OpenAI only when the site operator configures **both** `OPENAI_API_KEY` and `OPENAI_TEAM_BRIEFING_MODEL` as server-only environment variables. Without both, the feature runs in a deterministic fallback mode computed locally on the server from the same shared metrics, and makes no network call to any AI provider. The API key is read only inside that server-only module; it is never sent to the browser, included in a response, or exposed to team members.

When the model path is configured, a manager-triggered briefing sends only an allowlisted input: the team name, member display names (or neutral labels such as "Member 2" — never account identifiers), each member's share level, snapshot freshness, review-coverage percentage, the capacity and allocation percentages that member already chose to share, and the deterministic risk flags derived from them. Metrics a member disabled are omitted, never sent as zero. Raw activity samples, window titles, evidence, notes, calendar or chat details, screenshots, and credentials never enter the briefing input — the briefing sees strictly less than the manager dashboard already displays.

Requests set `store: false`. The model's response is validated against a fixed schema before display; any risk or opportunity that cites evidence outside the allowlisted catalog is stripped rather than trusted. The briefing UI labels its output as AI-generated from shared workload signals, and both the prompt and the fallback are constrained to avoid ranking members, productivity or performance scoring, and burnout/HR/medical/legal language.

## Manager Actions (weekform.com)

Team owners and managers can record one coordination action of up to 500
characters and optionally link it to one allowlisted deterministic briefing risk
key. This is team-scoped cloud data in `team_actions`, protected by the same
manager-membership RLS boundary as the manager dashboard. The action record does
not contain briefing prose, raw activity, member evidence, notes, screenshots, or
per-member outcomes. Managers should still avoid putting names, customer details,
or other sensitive information in the action text.

Every mutation is RPC-only. Authenticated clients have SELECT-only table access
and no direct INSERT, UPDATE, or DELETE privilege. Creation accepts only the team
id, action text, and optional allowlisted risk key, then derives the authenticated
actor, id, open status, creation time, and null resolution time. Resolve/drop
accepts only team id, action id, and a closed status and derives the resolution
time; delete accepts only team id and action id. Every security-definer RPC
reauthorizes the manager server-side. Static contract tests and an unapplied
four-actor pgTAP specification pin these boundaries.

Weekform may compare the linked metric's team median across later approved weekly
snapshots. It shows no result until two distinct later weeks share that metric,
excludes dropped actions, and labels the readout as “What changed after”: a
correlation, never evidence that the action caused the change or that any person
contributed to it. The migration in this repository is a SQL-review artifact and
has not been applied or verified against a live Supabase project here.

## Controls

- **Private mode / Pause Tracking** stops new active-window and visual-context capture.
- **Visual Context** can be enabled or disabled independently.
- **Exclude** removes a work block from the reviewed workload model.
- **Reset Prototype Data** clears the app's persisted prototype state.

## Not Collected

The current implementation does not intentionally collect:

- keystrokes
- webcam or microphone input
- file contents
- email bodies
- meeting notes
- browser page bodies

Window titles and screenshots can nevertheless reveal some of this information indirectly. Treat both as sensitive.

## Span Simulator

Weekform Span Simulator generates synthetic workload evidence for product testing and demonstrations. It must not read from or write to the personal `PersistedAppState`, foreground capture stream, Outlook/chat imports, or real `workload_snapshots`. Simulated members, artifacts, and week snapshots live in separate simulation tables and carry `is_synthetic`, `simulation_run_id`, `persona_version`, `generator_version`, and `seed` markers. Member surfaces and exports remain visibly labeled **SIMULATED**.

Simulator input must not contain real people, organizations, customers, email addresses, account identifiers, credentials, window/calendar titles, screenshots, file contents, message bodies, or local paths. Synthetic email fixtures use reserved domains such as `example.test`. Generator-owned synthetic titles may describe generic work, but arbitrary scenario text must not be copied into title/path/identity fields. Validation reduces accidental leakage but is not a perfect PII detector; administrators remain responsible for using synthetic context only.

The cloud authorization contract is an authenticated user explicitly granted in `private.simulator_admins`. The production portal checks that grant through the argument-free, current-user-only `public.has_simulator_admin_access()` RPC and authorizes only an exact `true` response. Team membership, a manager role, user metadata, a local browser-session marker, or a development environment flag does not grant cloud simulator access. RPC errors, malformed responses, and missing configuration fail closed. All public simulation tables use admin-only RLS. The isolated simulation manager view is not unioned with real workload data. “Include simulations” defaults off, requires simulator-admin access, and renders simulated rows separately rather than changing real team totals.

Fast Forward performs no workplace-app automation. The optional Controlled Local Playback proof of concept validates an action plan against exact Weekform-owned loopback `/simulator-sandbox/` pages and rejects arbitrary localhost routes, real sites, files, query strings, and fragments. Its UI requires a separate local feature flag and an explicit confirmation. It currently previews mock pages rather than launching a dedicated browser profile or enforcing host-level network isolation; those controls are required before automated playback may be described as operational. It must never use OS-wide input automation or perform a real message, email, purchase, commit, or other external mutation.

Simulation JSON/CSV exports are prepared locally and repeat the synthetic provenance markers. An audit receipt records that an export was prepared; it does not claim the operating system completed the save. Archiving hides a run from the active simulation view without deleting it. Permanent run deletion cascades through generated members, artifacts, and week snapshots; a minimal deletion receipt remains without preserving the deleted payload. Personal backup/reset and simulation export/delete are separate controls and do not imply one another.

The simulator migrations and RLS tests in this repository are review artifacts; they have not been applied to or verified against a live Supabase project here. Local Manager Access is automatically available only in Vite development mode. Its published synthetic demo credentials create a tab-scoped `sessionStorage` marker and grant no production or cloud access. The local Manager Mode demo uses synthetic, allowlisted summary metrics only; it does not read personal `PersistedAppState` or widen the production manager data contract. Local workspace-only theme, accent, density, and motion preferences are stored separately in browser `localStorage`; they contain no workload data and can be reset from the workspace. The Next.js `/admin` route is a separate production surface: it never accepts the local session, rechecks the signed-in database grant on each request, stores appearance only in its narrow HTTP-only cookie, and shows no administration tools when authentication or the role RPC is unavailable. Production Span Simulator execution remains unconnected until the migrations, Supabase environment, real user, explicit grant, and live RLS proof are in place. Browser-development runs use a simulator-only IndexedDB database rather than personal Weekform state; local prototype storage remains unencrypted.

Current modeling limitations also matter to privacy and interpretation: capacity still uses a fixed 40-hour denominator, PTO does not redefine that denominator, and some time-of-day inference uses the host machine timezone rather than the configured scenario timezone. Simulation results are prototype planning evidence, not observed facts or organizational benchmarks.

## Reporting Privacy Issues

Do not include real credentials, private screenshots, customer data, or confidential work metadata in a public GitHub issue. Report a vulnerability through GitHub's private security reporting feature when it is available for the repository.
