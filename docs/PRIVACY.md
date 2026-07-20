# Privacy and Data Flow

Weekform processes potentially sensitive work metadata. This document describes the current prototype behavior so users and contributors can evaluate it accurately.

## Local Data

The desktop app can collect:

- foreground application name
- front-window title
- capture timestamp
- optionally imported or live-synced Outlook, Google, and Apple calendar metadata
- user corrections, exclusions, and confirmations
- derived activity sessions, work blocks, forecasts, and narratives
- an audit trail of collection and review events

The native desktop collector writes each successful foreground sample to an AES-256-GCM encrypted, append-only journal before it emits that sample to the React review layer. A fresh nonce is used per entry and the journal key is stored in macOS Keychain. Native persistence does not duplicate raw foreground samples into the general Tauri Store; older unencrypted sample arrays are migrated into the encrypted journal before the legacy copy is cleared. Other local prototype data in Tauri Store remains unencrypted. Web and demo builds have no native collector or encrypted journal and retain the browser-local fallback for the desktop React demo only. Data remains on the local macOS user account until retention or reset removes it.

That browser fallback describes the desktop React app when it is run in web/demo
mode. It is not the `apps/web` account and team site described below.

## Calendar Sources

Outlook Calendar, Google Calendar, and Apple Calendar are optional sources. All
three accept a user-selected date range and feed the same local, reviewable
calendar-event and work-block pipeline. Local `.ics` imports are parsed on the
device and do not make a network request. Import and live-sync ranges are capped
at 366 days; the selected end date is inclusive.

Google and Outlook live sync are available only when the desktop build is
configured with the corresponding public native-app client identifier
(`GOOGLE_CALENDAR_CLIENT_ID` or `MICROSOFT_CALENDAR_CLIENT_ID`). They use the
system browser, a random loopback callback port, OAuth authorization code flow
with PKCE, and read-only calendar scopes. Refresh tokens are stored only in
macOS Keychain and are excluded from app state and exports. The native process
requests bounded event pages and returns only event id/UID, title, start/end,
location, organizer display name when available, attendee count, and all-day
status to the React layer. Event descriptions, meeting bodies/notes, attendee
identities, attachments, and email bodies are neither normalized nor stored.
The provider still processes the account identity and calendar data needed to
answer the authorized request.

Apple Calendar live sync uses EventKit against the local macOS Calendar store.
It requires explicit Calendar permission and makes no calendar-provider network
request from Weekform. If access is denied, the app remains disconnected and
directs the user to macOS Privacy & Security settings. Disconnect stops future
reads and removes Weekform's connection marker; macOS permission itself remains
under System Settings. Previously imported evidence is retained until the user
excludes it or Reset Local Data clears the app state.

Connected sources refresh a rolling two-weeks-back to six-weeks-ahead range
every 15 minutes while Weekform is open and online. Manual Sync uses the visible
selected range. A live sync replaces that provider's events only inside the
requested range, so provider-side deletions do not remain as current evidence;
other providers and dates are untouched. Connect, sync, import, disconnect, and
reset boundaries emit local audit records without storing credentials. Reset
Local Data attempts to remove all three calendar connection records from
Keychain in addition to clearing imported calendar events.

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

## Weekform Web Sharing (Account & Sharing)

Cloud sharing and the private Web replica are **off by default** and exist only in builds configured with a publishable Supabase URL and anon key (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`). Without that configuration the Account & Sharing tab states that no upload path exists and the app remains fully local. There is no secret or service key in the desktop app; row access is governed entirely by Supabase row-level security under the signed-in user's own session.

Desktop Google and GitHub sign-in opens the provider flow in the system browser and uses PKCE. While sign-in is active, Weekform listens only on `127.0.0.1:49321` for the exact `/cloud-auth/callback` path for up to five minutes; the Supabase project must allow that exact loopback redirect. The callback contains a short-lived, single-use authorization code and a random state value, not workload data or session tokens. The app verifies the state and exchanges the code together with the in-memory PKCE verifier, then keeps the resulting native session in macOS Keychain under the same boundary as password sign-in. Browser/demo mode does not start this native callback flow.

The private Web workspace is a separate contract from team sharing. After the signed-in user explicitly enables it, the Mac registers a device id and uploads idempotent, cursor-receipted batches containing `PersonalWorkloadReplicaV1`. That allowlist contains only week ids, block ids, times, capacity percentage, category, work mode, planned status, confidence, reviewed/blocker flags, deterministic revisions, and derived capacity metrics. It cannot contain raw samples, sessions, app/window titles, evidence, notes, project or stakeholder names, calendar/chat details, screenshots, audit detail, AI outputs, or credentials. Offline batches remain in the local cloud envelope until a later successful sync; a newer unsent revision replaces an older revision for the same week.

Web review actions create `review_commands`; they do not mutate the replica or desktop state. The Mac polls pending commands while open and shows Approve on Mac and Reject controls. Approval applies only a closed set of confirm, exclude, category, mode, planned-status, and blocker changes. Every command carries the block revision it was created against; stale commands become visible conflicts rather than overwriting newer local work. Applied changes enter the normal local correction and audit path, then the next derived replica sync reflects the result.

To share anything, the user must, in order: sign in with the account created on weekform.com; select exactly one recipient team they belong to; turn sharing on; choose a share level and individual metric toggles (and, at the "projects" level, an explicit project-name allowlist); review the **exact JSON payload** that will be uploaded; and record consent. Only then does a manually approved "Sync Now" upload one `SharedWorkloadSnapshotV1` row — a versioned, allowlist-built weekly summary produced by `packages/inference/src/sharedSnapshot.ts`. The preview and the upload are the same object; a disabled metric is omitted, never sent as zero. Changing the recipient team or the shared fields clears the recorded consent and requires a new review.

The shared payload can contain only: team and ISO week identifiers, timestamps, the share level, the selected capacity metrics, sanitized category/work-mode allocation, allowlisted project-name allocation from user-verified blocks, and review-coverage counts. It never contains raw activity samples, sessions, app names, window titles, evidence, notes, stakeholder names, calendar or chat details, screenshots, Visual Context insights, audit details, or AI keys.

An optional hourly team-snapshot auto-sync preference is stored but off by default, and scheduled sync can only run while the app is open. The Supabase session (auth tokens) lives in macOS Keychain in native builds, is never written to `PersistedAppState`, and is excluded from every JSON export; the full backup includes only policy and sync bookkeeping. Users can delete their previously synced snapshots for the selected team from the cloud, and disconnecting (or "Reset all local data") clears the session, policy, replica queue, and sync state so no upload path remains. Every connect, policy change, sync success/failure, snapshot deletion, pause, and disconnect emits a local audit event.

Immediately before either a manual or automatic upload, the desktop app
re-fetches the selected membership and current team narrowing policy. A failed
refresh, revoked membership, or changed effective policy stops before the
request body is constructed; a policy change clears prior consent and requires the on-screen preview to
rebuild before another attempt. Unchanged scheduled state is reconciled against
the authenticated snapshot row. If that row was deleted on the website, the
desktop stops automatic recreation and requires an explicit Sync Now (or a
fresh sharing re-arm). A native Keychain failure does not fall through to a
Tauri Store or localStorage token copy. Browser localStorage remains a web/demo-only
credential-envelope fallback; native builds may store a credential-free
revocation marker there so a failed Store deletion cannot resurrect an old
session. Only a later successful replacement write clears that marker. Durable
clear failure is surfaced instead of recording a false successful reset. The
general local prototype store remains unencrypted even though raw capture journal entries and session credentials now use the native encrypted boundaries above.

## Weekform.com browser and persistence boundary

The account/team website uses server-side Supabase API calls under the signed-in
user's row-level-security session. It stores one user-scoped, versioned
`localStorage` preference recording only whether the Web workspace intro was
completed. That preference contains no workload data, email address, role,
team record, credential, or auth token. The website has no `sessionStorage`,
IndexedDB, or application-managed persistent workload cache.
The private Web workspace mounts one ephemeral browser Supabase client solely to
subscribe to the signed-in user's private Broadcast topic; the event requests a
fresh server render and is not a workload cache. Client components otherwise keep only
mounted React state. Standard Supabase auth cookies persist the account session
and are cleared by sign-out. Manager Access uses that same signed-in account
session and adds no portal-specific browser storage or appearance cookie. It
filters active team memberships to owner and manager roles before presenting a
team workspace; authorization for team records still comes from RLS.

The sign-in page also supports passwordless email Magic Links through Supabase
Auth. The submitted email address is processed by Supabase and the configured
email-delivery service solely to deliver the one-time sign-in link; the flow
does not send Mac activity, workload evidence, replicas, snapshots, or team
records to the email service.

Google and GitHub sign-in use Supabase OAuth. Choosing one sends the account
authorization request to that provider and returns through Supabase Auth; the
provider and Supabase may process the account identity needed to authenticate
the user. Weekform does not include Mac activity, workload evidence, replicas,
snapshots, or team records in the OAuth request.

Raw Mac activity never reaches the website. Private derived replicas, approved workload snapshots, and
explicit multi-user coordination records (accounts, teams, memberships,
invites, and manager actions) persist in Supabase because other authorized
users need them. Dashboard and team pages are request-fresh dynamic routes. The
personal dashboard subscribes to a private Supabase Broadcast topic and requests
a fresh server render when a replica or command changes. While visible and online
it also requests a fresh server render every 15 seconds as a fallback. Snapshot latest
selection and web freshness use a server-owned `synced_at` receipt timestamp;
client `observed_at` and `source_updated_at` remain provenance and cannot win
latest ordering through clock skew.

## Individual Web Ask (weekform.com, server-side AI)

An authenticated individual can explicitly send a question from the private Web
workspace. The server re-authenticates the request and reloads that user's latest
positive-allowlist personal replica under row-level security; it never accepts a
replica, account identity, team, model, or evidence catalog supplied by the
browser. Before optional provider processing, Weekform reduces the replica again
to week-level capacity metrics, review counts, blocker count, and category/work-
mode counts. Block identifiers, per-block timestamps, revisions, raw activity,
window or app titles, notes, project or stakeholder names, calendar or chat
detail, screenshots, audit detail, local evidence, and AI credentials are not
included.

When both the server-only `OPENAI_API_KEY` and
`OPENAI_PERSONAL_AGENT_MODEL` are configured, the typed question and minimized evidence catalog are sent to the
OpenAI Responses API with `store: false`. OpenAI still processes that request.
The response is schema-checked, and evidence references outside the server-built
catalog are rejected. Without complete configuration, or after a provider,
timeout, or validation failure, Weekform returns a visibly labeled deterministic
answer from the same review-safe aggregates and makes no false model-success
claim. Requests that would change local truth are not sent to the model or run on
the Web; they hand off to the approval-gated Mac workflow.

The Web Ask transcript and draft exist only in mounted React state. Weekform does
not write questions or answers to Supabase, `localStorage`, `sessionStorage`,
IndexedDB, cookies, or an application-managed cache; reloading the page clears
them. The API response is marked `no-store`. Standard infrastructure and provider
processing boundaries still apply, so users should not type sensitive or
regulated information into Web Ask.

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
- **Reset Prototype Data** clears the app's persisted prototype state, encrypted capture journal and journal key, Keychain cloud session, replica queue/policy, and team-sharing policy. Cloud rows already received remain until the user deletes them through the corresponding cloud control.

## Not Collected

The current implementation does not intentionally collect:

- keystrokes
- webcam or microphone input
- file contents
- email bodies
- meeting notes
- browser page bodies

Window titles and screenshots can nevertheless reveal some of this information indirectly. Treat both as sensitive.

## Weekform Simulation

Weekform Simulation has two synthetic-only functions for product testing and demonstrations. **Generate span** deterministically creates persona-based work items, communications, business records, and workload evidence for long spans before running them through Weekform's real inference pipeline. **Live simulation** is a Vite-development-only observable loop that drives embedded Weekform-owned business sandboxes and Weekform's actual demo UI with a rendered synthetic cursor. Neither function may read from or write to personal `PersistedAppState`, the foreground capture stream, Outlook/chat imports, or real `workload_snapshots`. Simulated members, artifacts, and week snapshots live in separate simulation tables and carry `is_synthetic`, `simulation_run_id`, `persona_version`, `generator_version`, and `seed` markers. Member surfaces and exports remain visibly labeled **SIMULATED**.

Simulator input must not contain real people, organizations, customers, email addresses, account identifiers, credentials, window/calendar titles, screenshots, file contents, message bodies, or local paths. Synthetic email fixtures use reserved domains such as `example.test`. Generator-owned synthetic titles may describe generic work, but arbitrary scenario text must not be copied into title/path/identity fields. Validation reduces accidental leakage but is not a perfect PII detector; administrators remain responsible for using synthetic context only.

The cloud authorization contract is an authenticated user explicitly granted in `private.simulator_admins`. The production portal checks that grant through the argument-free, current-user-only `public.has_simulator_admin_access()` RPC and authorizes only an exact `true` response. Team membership, a manager role, user metadata, a local browser-session marker, or a development environment flag does not grant cloud simulator access. RPC errors, malformed responses, and missing configuration fail closed. All public simulation tables use admin-only RLS. The isolated simulation manager view is not unioned with real workload data. “Include simulations” defaults off, requires simulator-admin access, and renders simulated rows separately rather than changing real team totals.

Generate span performs no workplace-app automation. Live simulation requires an explicit confirmation and validates every action against exact loopback port `5173` URLs: allowlisted `/simulator-sandbox/` pages with a known persona and an exact Weekform demo URL with allowlisted parameters. It rejects arbitrary localhost routes, real sites, files, unexpected query strings, and fragments. The runner operates only inside a sandboxed same-origin iframe and draws a synthetic cursor overlay; it does not move the operating-system cursor, use AppleScript or OS-wide input automation, launch external applications, or use a dedicated browser profile. It must never perform a real message, email, purchase, commit, or other network/workplace mutation. This local constraint is not host-level external-network isolation and must not be described as real-application automation.

The Weekform portion of Live simulation uses the actual application components and handlers with persona-shaped demo data, but it remains demo-mode and in-memory. It does not load personal state, start native capture, invoke personal imports, sync cloud data, or persist simulated review/navigation changes. Generated long-span runs may be checkpointed only in the separate simulator IndexedDB store described below; that does not widen personal persistence.

Simulation JSON/CSV exports are prepared locally and repeat the synthetic provenance markers. An audit receipt records that an export was prepared; it does not claim the operating system completed the save. Archiving hides a run from the active simulation view without deleting it. Permanent run deletion cascades through generated members, artifacts, and week snapshots; a minimal deletion receipt remains without preserving the deleted payload. Personal backup/reset and simulation export/delete are separate controls and do not imply one another.

The simulator migrations and RLS tests in this repository are review artifacts; they have not been applied to or verified against a live Supabase project here. Local Manager Access and Live simulation are available only in Vite development mode. Published synthetic demo credentials create a tab-scoped `sessionStorage` marker and grant no production or cloud access. The desktop Manager Mode entry is shown only while the cloud account is signed in and has an active owner or manager membership. Its current manager workspace remains visibly labeled as a synthetic preview: it uses synthetic, allowlisted summary metrics only, does not read personal `PersistedAppState`, and does not widen the production manager data contract. Its question responses are deterministic local demo copy and make no model or network request. Proposed coordination actions remain approval-gated and, when approved, are added only to the current in-memory synthetic history; they do not notify a person or mutate production data. Local workspace-only monochrome theme, density, and motion preferences are stored separately in browser `localStorage`; they contain no workload data and can be reset from the workspace. The authenticated Next.js `/manager-access` route is the production web entry for owner/manager team memberships; legacy `/admin` only redirects there. Production Simulation execution remains unconnected until the migrations, Supabase environment, real user, explicit simulator grant, and live RLS proof are in place. Browser-development Generate span runs use a simulator-only IndexedDB database rather than personal Weekform state; local prototype storage remains unencrypted. Live simulation's embedded Weekform state is not written to that database.

Current modeling limitations also matter to privacy and interpretation: capacity still uses a fixed 40-hour denominator, PTO does not redefine that denominator, and some time-of-day inference uses the host machine timezone rather than the configured scenario timezone. Simulation results are prototype planning evidence, not observed facts or organizational benchmarks.

## Reporting Privacy Issues

Do not include real credentials, private screenshots, customer data, or confidential work metadata in a public GitHub issue. Report a vulnerability through GitHub's private security reporting feature when it is available for the repository.
