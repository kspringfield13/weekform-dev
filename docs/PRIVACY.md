# Privacy and Data Flow

Weekform processes potentially sensitive work metadata. This document describes the current prototype behavior so users and contributors can evaluate it accurately.

## Local Data

The desktop app can collect:

- foreground application name
- front-window title
- capture timestamp
- optionally imported or live-synced Outlook, Google, and Apple calendar metadata
- optionally live-synced, content-free attention evidence from Slack, Google Chat, or Webex
- user corrections, exclusions, and confirmations
- derived activity sessions, work blocks, forecasts, and narratives
- an audit trail of collection and review events

The native desktop collector writes each successful foreground sample to an
AES-256-GCM encrypted, append-only journal before it emits that sample to the
React review layer. A fresh nonce is used per entry and the journal key is stored
in macOS Keychain. New v2 records authenticate the envelope version and outer
timestamp as AES-GCM additional data; existing v1 records remain readable, and
both versions must match the timestamp inside the decrypted payload. Append,
read, import, retention, export, and reset share one process-local serialized
journal owner. Appends flush and sync before success, roll a partial write back
to its prior length on an in-process error, and repair only the final
uncommitted fragment; authenticated corruption before the final record fails
closed instead of returning partial history.

Sampling itself happens outside the journal lock, but committing the encrypted
record and emitting the React event share the same lifecycle lock as Pause. If
Pause wins first, the already-sampled value is dropped; if a commit has already
entered, Pause waits for that commit and event to drain before it returns. Reset
closes the React delivery guard synchronously and waits for this native pause
barrier before clearing the journal, so a capture started before Reset cannot
recreate or emit sensitive state after the pause boundary.

The React UI keeps only the newest 2,000 raw samples as a responsive visible
cache. That cap does not bound the workload model: startup separately scans the
encrypted journal backward in 64 KiB chunks and reconstructs a bounded eight-day
native session window, stopping at the authenticated time boundary and failing
closed on out-of-order history. Post-cutoff live samples merge into that rollup,
so a full reviewed week remains available without transferring a week's raw
five-second rows into React. Retention runs at most once per local day (or after
a policy change), decrypts and validates every retained record, streams the
replacement in constant memory, syncs it, and atomically renames it. Status and
the one-time legacy import can still scan the journal, and the lock does not
coordinate a second Weekform process.

The user-triggered native full backup validates and streams every decrypted
journal record into an atomic JSON file in Downloads instead of exporting the
2,000-row cache. It also includes the saved Agent conversation/draft and all
other non-credential backup state. That exported file is deliberately plaintext
and can contain sensitive window titles and questions; the UI warns the user to
store it securely. Failed exports remove their partial file. Native persistence
does not duplicate raw foreground samples into the general Tauri Store or its
plaintext audit trail; legacy Store sample arrays and legacy per-sample audit
rows are removed during migration. Other prototype state in Tauri Store remains
unencrypted. Web and demo builds have no native collector or encrypted journal
and retain the browser-local fallback for the desktop React demo only. Data
remains on the local macOS user account until retention or reset removes it.

Calendar, Chat, and usage file imports and the full-backup action share a
Reset-owned local-operation fence. Reset closes that fence before deletion,
aborts active browser `FileReader` imports, waits any import or native export
that already crossed its commit boundary, and rejects its late UI/audit result.
The fence reopens only after cleared state is installed. This lifecycle control
does not encrypt the exported backup; the plaintext warning above still
applies.

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
uses a 10-second connection bound and 45-second total bound for token exchange,
refresh, and provider event requests. It requests bounded event pages and
returns only event id/UID, title, start/end,
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
Local Data first rejects new calendar work, invalidates a pending native
loopback callback, and waits any authorization or sync that already advanced
into provider exchange before it attempts to remove all three calendar
connection records from Keychain and clear imported calendar events. A
cancellation, quiescence, or Keychain failure remains visible and prevents a
full-success Reset receipt.

## Chat Sources

The three live Chat connection options are exactly **Slack, Google Chat, and
Webex**. They are optional, individual-account sources controlled in Weekform
for Mac; weekform.dev does not expose source-connection controls. Legacy
Weekform-normalized Microsoft Teams JSON remains readable as a local,
import-only compatibility path. Teams is not a fourth live connector.

Each live connector uses a user-selected inclusive range capped at 90 days; the
default covers the prior 14 days through today. Transfers are manual and
bounded, not continuous background monitoring. Receipts report complete,
scope-limited, partial, rate-limited, or permission-limited coverage. Resumable
pages may add canonical, content-free evidence locally, but they do not enter
the workload model until an intact run that began at the first page finishes.
Only that intact completion updates the displayed last-successful sync time. A
resumable page is labeled as retained/in progress; a terminal rate-limit,
permission, malformed, or orphaned receipt is labeled incomplete and leaves the
previous successful time unchanged.

Provider reconciliation follows the receipt rather than assuming every empty
result proves absence:

- Slack reads top-level history from the user's currently listed,
  non-archived conversations. It does not call the separate thread-replies
  endpoint. Even an intact Slack run is therefore scope-limited, applies
  additively, and never removes existing Slack evidence based on absence.
- A completed, intact Google Chat or Webex run can authoritatively reconcile
  that provider inside the requested range, including removing missing,
  unreviewed evidence. A documented empty Google Chat message-list object is a
  valid empty collection, not a malformed response. Other providers and dates
  remain untouched.
- Partial, interrupted, permission-limited, or orphaned runs have no deletion
  authority. User-confirmed blocks and explicit exclusions remain reviewed
  truth under every receipt state.

Provider APIs can return message content and account/conversation details while
answering an authorized request. The Rust process minimally inspects the fields
needed to distinguish the authorized user, a direct message or explicit
mention, and a self-sent action. Before anything crosses into React, it projects
the result into a versioned, content-free contract and drops ambient inbound
traffic. The retained local contract contains only salted hashes for event and
conversation/thread correlation, timestamp, a local provider tag, coarse
surface and participant-count bucket when available, direction, attention
grade, revision state, and coverage receipt.

Message bodies, attachments, URLs, workspace/space/channel/room names, people
names and email addresses, raw provider identifiers, and exact participant
counts are discarded at the native boundary. The normalized JSON import path
applies the same ambient and display-name discard boundary before it creates
workload evidence. Discarded fields are not persisted, included in a Weekform
export, sent to an AI provider, placed in audit records, or shared with Web or
Manager Access. Canonical content-free Chat evidence can be included in the
user-triggered local full-data backup. A random salt held in macOS Keychain
scopes its hashes to this installation; the raw identifiers are not retained
alongside those hashes.

The local transformation is deliberately attention-based, not volume-based:

1. Ambient inbound channel/space traffic is discarded at the native or import
   boundary. It cannot affect workload, and Weekform does not score message
   volume, availability, after-hours activity, or response speed.
2. An inbound direct message or explicit mention without a safely correlated
   self action becomes one local 0%-capacity review card. It cannot affect
   capacity, confidence, focus overlap, acceleration patterns, or
   manager-visible review counts unless the user assigns measured time and
   confirms it.
3. Live adapters currently produce directed inbound and observed self-sent
   message evidence. A self-sent action correlated to the same direct-message
   context or explicit thread within the bounded response window becomes a
   reactive response episode; an uncorrelated self-sent burst becomes proactive
   coordination. Response latency is never converted into work time. Nearby
   observed actions are sessionized, and the deterministic prototype window
   starts five minutes before the first observed action and ends one minute
   after the last. That is modeled time, not a claim of continuous activity.
4. The broader normalized compatibility contract can represent a self reaction
   or joined call, and the legacy JSON importer can map explicit call/huddle
   records into collaborative meeting blocks. The current live message adapters
   do not collect reactions, huddles, or call attendance. Calendar provenance
   is required before an imported Chat call can be deduplicated as the same
   meeting.
5. The user can correct, confirm, annotate, or exclude every resulting work
   block through the existing review flow.

On load or upgrade, persisted Chat evidence is revalidated against explicit
field and value allowlists. Legacy provider-bearing raw events are reduced to
generic `Workplace chat` evidence, and unreviewed auto-generated conversation
labels are replaced with generic response, coordination, call, or directed-card
labels. User-confirmed corrections remain reviewed truth and are not silently
rewritten by that migration.

Canonical Chat evidence and sync receipts are not included in AI requests. Once
that evidence becomes a work block, every AI serializer projects it through the
same external-safe boundary: the provider and canonical hashes are removed;
source evidence and notes are replaced or omitted; labels become generic; and
the local block id becomes a stable opaque `wfb-...` id. Corrections use the
same mapping. Returned ids are resolved to local blocks on the Mac and unknown
or provider-bearing ids fail closed. The generic derived block can then
participate in optional classification, forecast, narrative, Review Copilot,
or Agent context under the AI controls below; source identity is not added back.

If the user separately enables the private Weekform Web replica, a derived Chat
work block can enter that review-safe block contract only under its opaque id
and fixed workload fields. The replica has no provider, hashes, receipt,
conversation, person, project/stakeholder label, evidence, notes, or message
content. Web review commands refer to the opaque id and still require approval
on the Mac.

Manager sharing is a separate, explicit boundary. A manager can receive only
the exact allowlisted aggregate workload fields in the member-previewed and
member-approved snapshot. Zero-capacity directed cards are excluded even from
its review-coverage counts. Provider, workspace, conversation, person, Chat
event timing, response-pattern, and volume details are never manager snapshot
fields.

Slack uses its [generally available desktop authorization-code flow with
PKCE](https://docs.slack.dev/changelog/2026/03/30/pkce/) over a loopback
callback at `http://localhost:49324/chat-auth/callback`, matching the checked-in
Slack app manifest. Slack desktop redirects grant user scopes only; the
registered app must issue rotating tokens, and Slack's PKCE refresh tokens
expire after 30 days. For non-Marketplace apps, Slack can limit
[`conversations.history`](https://api.slack.com/methods/conversations.history)
to one request per minute and 15 rows per request, so a bounded transfer may
need resumable pages and visible retry guidance. Google Chat uses Google's
[macOS installed-app flow](https://developers.google.com/identity/protocols/oauth2/native-app)
with the system browser, loopback callback, and PKCE, requesting
`chat.spaces.readonly` and `chat.messages.readonly` plus identity. Google
classifies [`chat.messages.readonly` as
restricted](https://developers.google.com/workspace/chat/authenticate-authorize),
so a production OAuth app can require verification. Slack and Google token
exchange and refresh occur directly between the Mac and the provider.

Webex also uses authorization code with PKCE, but [Webex
Integrations](https://developer.webex.com/docs/integrations) require the
registered integration's confidential secret at token exchange and refresh.
The Mac sends only the authorization or refresh credential to the configured
HTTPS Weekform broker; the broker adds the server-only secret, exchanges with
Webex, allowlists the token response, and returns it with `no-store`. The broker
streams at most 16 KiB of request text, cancels an over-limit body even when it
is chunked or understates `Content-Length`, and marks success and every error
response `no-store, max-age=0` with `Pragma: no-cache`. Chat
messages and canonical Chat evidence never transit that broker or weekform.dev.
Only the optional
provider-free derived replica and separate approved aggregate snapshot can
reach weekform.dev under the boundaries above. Before any Webex exchange, the
broker now requires a distributed Supabase lease and replay-safe receipt with a
20-request UTC-daily budget per secret-keyed client-IP subject. Vercel's
overwritten `x-forwarded-for` is the only accepted source; raw IP addresses,
credentials, bodies, authorization codes, and token responses are not stored in
the receipt. Missing request-control secrets, database claim digest, exact
Vercel proxy proof, or migration fails closed before Webex. Operators must still
verify that deployed application, proxy, and observability logging excludes
credential bodies. The broker returns 503 until that operational check is
attested with `WEBEX_CHAT_BROKER_SECURITY_VERIFIED=true`; the flag does not
replace the implemented distributed limiter or the deployment logging review.

Refresh tokens, provider self identifiers, bounded pagination cursors, the
hash salt, and saved public Chat connection details live in macOS Keychain and
are excluded from Weekform exports. A public value exists transiently in the
React form while the user enters it, then clears after a verified save; native
status responses do not return the stored value. Slack and Google Chat store a
public Client ID. Webex stores its public Client ID, exact loopback redirect,
and credential-free HTTPS broker address. The inputs validate only those public
values and never request a Client Secret. Webex's secret stays on the broker,
and its security attestation remains release-controlled. On the Mac, access
tokens are held only for the native provider request. Native secret wrappers
clear PKCE verifiers, authorization
codes, access and refresh tokens, provider self identifiers, and serialized
credential/cursor buffers on drop. The narrow `zeroize` dependency implements
that memory-clearing boundary without replacing the existing Keychain format or
adding a provider SDK.

Each Chat source row provides inline public connection fields when setup is
missing and a change action while the source remains disconnected. Slack and
Google Chat ask only for their public Client ID. Webex asks for the public
Client ID, exact redirect URI, and HTTPS broker address. Saving a ready
connector opens the existing access review; it does not start browser
authorization by itself. If Webex's deployment security review is incomplete,
the public details can be saved but **Connect now** remains disabled with an
explicit blocker. No connector asks the user to set a build variable or paste a
secret. The existing sanitized local JSON import remains available. A configured connector first shows the requested access,
then system-browser authorization, native content-free filtering,
bounded initial-transfer progress, retryable errors, and completion. The wizard
does not dismiss itself while authorization or transfer is active. Native
readiness reaches React only as an allowlisted code; missing or unknown codes
remain backward-compatible and render generic safe copy rather than native
configuration detail.
Disconnect removes the selected provider's local token and cursor and stops
future Weekform transfers; it retains already derived evidence for review and
does not revoke the provider-side grant. Users can revoke that grant in the
provider's own account controls. Raw-evidence retention expires canonical Chat
evidence and derived Chat raw events while leaving reviewable work blocks.
Reset Local Data clears Chat evidence and work blocks and attempts to remove all
Chat credentials, cursors, all saved public Chat connection details, and the
hash salt. It first rejects new connector work, invalidates a pending native
loopback callback, and waits any authorization or transfer that already crossed
into provider work. Native Chat provider requests have a 30-second total bound.
A callback, quiescence, or durable cleanup failure is reported as requiring a
retry. No admin or compliance token is supported.

The connector contracts, projection tests, builds, and local UI can be verified
without provider credentials. A live Slack, Google Chat, or Webex authorization
and transfer was not exercised in this development environment. Production
readiness therefore still requires registered provider applications, Google
OAuth verification where applicable, a deployed and rate-limited Webex token
broker, and account-level transfer tests against each provider's current API
and retention limits.

## Team Calendar local evidence layer

The macOS Team workload calendar can align the signed-in user's existing local
Calendar and Chat evidence with approved weekly team summaries. This is a
display-only local projection: per day it contains only a calendar-event count,
unioned non-all-day meeting minutes, normalized observed Chat-episode count,
directed-trigger count, reviewed-block count, and one deterministic pressure
label. Overlapping meetings are unioned rather than double-counted. Calendar
titles, locations, organizers, attendees, Chat content, people, provider ids,
conversation keys, and raw evidence are not copied into the projection.

These daily facts never enter `SharedWorkloadSnapshotV1`, the private Web
replica, Team Briefing, or any Team cloud table. Managers see the local overlay
only for their own Mac evidence; other members remain represented solely by
their approved aggregate summaries. Email is explicitly unavailable because
Weekform has no inbox connector and requests no inbox access. The public demo
uses synthetic Calendar, Chat, roster, and summary data and performs no Team
network request.

## AI and OpenAI/Codex Data

OpenAI is Weekform's default and recommended AI provider. AI is optional and supports two distinct connection boundaries:

- **Provider API key.** A key can be configured in local Settings, or through `OPENAI_API_KEY` in the repository's ignored `.env` file during development. Credentials are never compiled into the Vite bundle. In the native app, each provider key is stored under a binding-addressed macOS Keychain account; only the credential binding plus provider, model, and endpoint preferences remain in the unencrypted Tauri Store. Before a new secret is written, its UUID binding is durably preregistered in a non-secret Store registry. Rotation then writes the new Keychain entry, commits the Store pointer, and retires the old entry; superseded bindings stay registered so Reset can retry a failed retirement. A Store failure removes the proposed entry and preserves the prior working credential, while a cleanup failure leaves the preregistered binding recoverable after relaunch. Reset resolves the durable registry before deleting Store state, deletes and readback-verifies every registered and legacy Weekform API-key account, and keeps the registry for retry if any Keychain operation fails. Legacy Store/singleton keys migrate through the same boundary and are erased from Store. Webview Keychain commands accept only the cloud-session account, legacy migration account, or a canonical Weekform credential-binding account; arbitrary account names are rejected before Security.framework. The desktop React browser preview has no Keychain and does not retain a typed key across reloads. Native classification, review, forecast, narrative, and visual-context requests are sent through the Tauri process. The conversational Agent may use its configured provider directly from the webview so its tools can access current in-memory workload state; in that path, the configured key is available to the running webview for the current process. These OpenAI Responses API requests set `store: false`.
- **ChatGPT/Codex plan.** The native app starts OpenAI's Codex app-server and asks it to perform OpenAI-managed ChatGPT sign-in in the system browser. Weekform does not request a Platform API key and does not read, copy, return, log, export, or place OAuth tokens in React state. It uses a Weekform-owned `CODEX_HOME` and empty working directory rather than the user's normal Codex home or repository. macOS Keychain storage is required; if Codex falls back to a local `auth.json`, Weekform removes that file and rejects the connection. Reset Local Data invokes the isolated Codex disconnect path regardless of the current React provider metadata, because a crash can occur after native Keychain persistence but before that metadata is saved. Connect, generation, and disconnect share one native lifecycle owner: disconnect rejects new work, invalidates polling, and waits an operation that already owns the lifecycle before cleanup. If either Weekform-owned path exists, app-server logout is attempted but remains best effort. Regardless of whether either directory exists, cleanup always derives the Weekform-owned Keychain account from the isolated paths and attempts local credential deletion; that local deletion is the authoritative sign-out boundary. It then removes the isolated home and empty workspace. “Use an API key instead” uses the same cleanup boundary.

The Codex-plan app-server is discovered from `WEEKFORM_CODEX_BINARY`, the ChatGPT desktop app bundle, or a local Codex CLI installation. Weekform disables Codex apps, plugins, hooks, skills, browsing, shell/file tools, computer use, multi-agent features, and workspace dependency discovery. Each generation uses a new read-only, approval-free, ephemeral thread in the empty Weekform working directory, with only the feature prompt, optional in-memory image, and output schema. “Ephemeral” prevents Weekform's Codex thread from being retained in the local Codex session history; OpenAI still processes the request under the signed-in ChatGPT workspace's plan, data controls, retention, and usage limits. This route does not use or claim the Responses API `store: false` option.

When an AI feature runs, Weekform sends the prompt context required by that feature to the selected provider. Classification, review suggestions, and forecasts are user-triggered; weekly narrative generation can run automatically after workload evidence exists.

Native provider HTTP clients use a 10-second connect bound, 50-second response-read bound, and 55-second total request bound, and each native AI feature permits only one in-flight operation per process. The frontend's 60-second deadline is deliberately longer, so the native request releases its feature guard before the UI can offer a retry. Reset invalidates every AI workflow epoch before deletion, preventing a late result from repopulating cleared state. There is not yet a user-addressable cancellation identifier for an individual native request.

Reset also closes the frontend API-key/Codex connection gate before its first
await. Classification, Review Copilot, Forecast, narrative, Acceleration, and
Visual Context reject new entry while that boundary is closed, including
automatic narrative/Visual Context starts. The conversational Agent is aborted;
send, retry, direct action staging, and approval starts remain disabled and are
checked again at function entry until Reset reopens. Provider-side work without
a cooperative cancellation handle may still finish remotely, but its result
cannot repopulate the cleared local workspace.

Depending on the feature, prompt context can include:

- active-window app names and window titles
- grouped session timestamps and evidence
- work-block labels and confidence
- calendar-derived meeting metadata
- user corrections
- capacity snapshots
- manager-summary context

Users should still avoid enabling or invoking AI features when the included work metadata is not permitted to leave their device or organization.

## Visual Context

Visual context is disabled by default and must be enabled in Setup.

When enabled, the app may:

1. Capture the current macOS screen after a sustained activity session.
2. Write the image to a temporary PNG.
3. Read and encode the image for the selected API-key or Codex-plan request.
4. Attempt to delete the temporary local file immediately after a successful read and before the provider request.
5. Store only the derived text insight and audit metadata locally.

Filesystem errors can prevent temporary-file cleanup. The screenshot can also include content outside the active application because the prototype captures the current screen. Do not enable this feature around confidential, regulated, personal, or otherwise sensitive material.

## Weekform Web Sharing (Account & Sharing)

Cloud sharing and the private Web replica are **off by default** and exist only in builds configured with a publishable Supabase URL and anon key (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`). Without that configuration the Account & Sharing tab states that no upload path exists and the app remains fully local. There is no secret or service key in the desktop app; row access is governed entirely by Supabase row-level security under the signed-in user's own session.

Desktop Google and GitHub sign-in opens the provider flow in the system browser and uses PKCE. While sign-in is active, Weekform listens only on `127.0.0.1:49321` for the exact `/cloud-auth/callback` path for up to five minutes; the Supabase project must allow that exact loopback redirect. The callback contains a short-lived, single-use authorization code and a random state value, not workload data or session tokens. The app verifies the state and exchanges the code together with the in-memory PKCE verifier, then keeps the resulting native session in macOS Keychain under the same boundary as password sign-in. Browser/demo mode does not start this native callback flow.

The private Web workspace is a separate contract from team sharing. After the signed-in user explicitly enables it, the Mac registers a device id and uploads idempotent, cursor-receipted batches containing `PersonalWorkloadReplicaV1`. That allowlist contains only week ids, block ids, times, capacity percentage, category, work mode, planned status, confidence, reviewed/blocker flags, deterministic revisions, and derived capacity metrics. It cannot contain raw samples, sessions, app/window titles, evidence, notes, project or stakeholder names, calendar/chat details, screenshots, audit detail, AI outputs, or credentials. Offline batches remain in the local cloud envelope until a later successful sync; queue state and a persisted hybrid logical source clock are durably committed before an upload can begin. Across devices, the server accepts a strictly newer clock, rejects divergent stale/equal payloads and clocks more than five minutes in the future, and treats a byte-equivalent deterministic replica as an idempotent success even when its transient source time is older. Each server batch is capped at 1 MiB and 1,000 blocks before canonical hashing or per-block validation. A retry key belongs to the authenticated user and the exact device, fingerprint, and SHA-256 digest of its canonical JSONB payload; an exact retry returns the original receipt, while a legacy receipt without a digest or any divergent reuse requires a new batch id. The server never accepts an unverifiable legacy `NULL` digest as idempotent. On only that exact legacy-receipt error, the desktop durably replaces the queued batch UUID while leaving the payload, content fingerprint, consent, device, and source clock unchanged, then waits for a later retry; unrelated failures cannot rotate the identity. These additional batch-identity checks are in migration `202607200010`; production does not receive them until that migration is applied. This remains deterministic last-writer-wins behavior, not a field-level merge; users should resolve a real conflict on the Mac that owns the intended current state and sync again.

Web review actions use two isolated queues during the desktop rollout; they do not mutate the replica or desktop state. Released desktops remain on `review_commands` and its original direct completion RPC. Protocol-v2 desktops register their capability and poll both the immutable v1 backlog and `review_commands_v2`; every locally persisted retry item carries its queue protocol so a v1 row can never call a v2 lifecycle RPC. Web routes new work to v2 only when at least one active device exists, every active device advertises v2, and no v1 request remains pending. Otherwise it stays on v1. Registration and compatible routing share a per-user transaction lock, and a v1 re-registration fails visibly while v2 work is pending, preventing a downgrade from stranding an already-routed request. Pending v1 rows are never moved, copied, or rollout-deleted. Web reads both histories, while a private cross-protocol reservation allows at most one pending request for the same user, week, block, and revision.

The Mac shows Approve on Mac and Reject controls for either protocol. Approval applies only a closed set of confirm, exclude, category, mode, planned-status, and blocker changes. Every command carries the block revision it was created against; the Mac performs a current-ledger compare-and-swap so a response delayed across a network await cannot overwrite a newer local edit. V2 approved work moves through a durably persisted two-phase outbox (`apply_pending` then `ack_pending`); local mutation, correction/audit state, and the next phase are flushed before the server acknowledgement begins. An abandoned v2 `apply_pending` claim can be recovered only after its lease expires or its owner is revoked. A v2 `ack_pending` row already contains the server receipt that the original Mac durably recorded the local application; another registered v2 Mac may terminalize that receipt as applied, attributed to the original owner, without claiming or reapplying the mutation, and emits a local recovery audit event. That receipt does not prove the unavailable Mac uploaded a newer Web replica, so recovery must not be described as replica convergence. Deleted server history terminates the local retry with an explicit audit/error state rather than spinning forever. V1 keeps its released direct-completion behavior until its backlog and installed clients are deliberately retired. Identical retries within the selected protocol return the pending request, while contradictory or cross-protocol retries fail visibly.

Today’s **Confirm all** uses the same approval boundary. Web sends one bounded batch of at most 50 block id, week id, and expected-revision triples; it cannot supply the action, patch, identity, status, or timestamps. A security-definer RPC validates the complete batch against the signed-in user’s current unverified replica before writing any request, so stale, malformed, duplicate, or unauthorized targets fail the whole batch without partial requests. Identical confirm retries return the existing request ids. The Mac still decides whether to apply each request and remains the only writer of local correction and audit truth.

To share anything, the user must sign in with the account created on weekform.dev, select exactly one recipient team they belong to, review or narrow the team-capped share level and individual metric toggles (and, at the "projects" level, an explicit project-name allowlist), and choose **Approve and start sharing**. Weekform can construct the exact candidate preview while sharing is still off, but the upload boundary independently requires an enabled policy and the current individual approval. The approval policy is written to durable local cloud state before the first upload starts. That first upload sends one `SharedWorkloadSnapshotV1` row — a versioned, allowlist-built weekly summary produced by `packages/inference/src/sharedSnapshot.ts` — and arms bounded hourly checks while the app runs. The preview and the upload are the same object; a disabled metric is omitted, never sent as zero. Changing the recipient team or the shared fields clears the recorded approval and requires a new review.

The shared payload can contain only: team and ISO week identifiers, timestamps, the share level, the selected capacity metrics, sanitized category/work-mode allocation, allowlisted project-name allocation from user-verified blocks, and review-coverage counts. It never contains raw activity samples, sessions, app names, window titles, evidence, notes, stakeholder names, calendar or chat details, screenshots, Visual Context insights, audit details, or AI keys.

The database independently constrains new or updated aggregate rows rather than
trusting the desktop constructor: category and work-mode entries must use their
canonical taxonomy, each allocation item must contain exactly `label` and
`value`, labels cannot repeat, values stay within `0..100`, and JSON byte/count
limits apply. Project allocation is limited to 50 distinct labels of at most 200
Unicode code points each. The desktop uses the same code-point rule as
PostgreSQL `char_length`, caps without splitting an astral character, and
rejects unpaired UTF-16 surrogates before construction. Context-switch and WIP scores stay within `0..1`; total
allocated capacity intentionally permits overcommitment through `999` rather
than silently clamping an overloaded week to 100. Migration `202607200009`
enforces these rules for future writes without deleting or rewriting legacy
rows and validates each legacy constraint only when existing data is already
clean. The linked production database remains through migration
`202607200008`, so this independent server enforcement is not yet a live claim.

Team-snapshot scheduling remains off until the individual approves sharing. Approval enables hourly checks, but they can run only while the app is open and only after the approval-triggered first sync succeeds. Unchanged fingerprints are skipped and transient retries are capped. The Supabase session (auth tokens) lives in macOS Keychain in native builds, is never written to `PersistedAppState`, and is excluded from every JSON export; the full backup includes only policy and sync bookkeeping. Users can stop sharing, delete previously synced snapshots for the selected team from the cloud, and disconnect; disconnecting or "Reset all local data" clears the session, policy, replica queue, and sync state so no upload path remains. Every connect, policy change, sync success/failure, snapshot deletion, pause, and disconnect emits a local audit event.

Reset closes the cloud-account authorization/session lane, aggregate sharing
lane, personal-replica poll/sync lane, and durable review-command lane before
credential or Store deletion. It invalidates the pending native cloud OAuth
loopback wait, rejects new work, and waits active provider, Keychain, queue, and
cloud-write edges. After cleared state is installed, the account and personal
lanes reopen explicitly; aggregate scheduling can reopen only from the cleared
account/policy state. A late sign-in, refresh, upload, poll, or review result
cannot restore the old session or queue, and a barrier failure prevents a
full-success Reset receipt. Cloud rows already received remain until the user
deletes them through the corresponding cloud control.

Immediately before either a manual or automatic upload, the desktop app
re-fetches the selected membership and current team narrowing policy. A failed
refresh, revoked membership, or changed effective policy stops before the
request body is constructed; a policy change clears prior consent and requires the on-screen preview to
rebuild before another attempt. Unchanged scheduled state is reconciled against
the authenticated snapshot row. If that row was deleted on the website, the
desktop stops automatic recreation and requires an explicit **Retry sync** (or a
fresh individual approval). A native Keychain failure does not fall through to a
Tauri Store or localStorage token copy. Browser localStorage remains a web/demo-only
credential-envelope fallback; native builds may store a credential-free
revocation marker there so a failed Store deletion cannot resurrect an old
session. Only a later successful replacement write clears that marker. Durable
clear failure is surfaced instead of recording a false successful reset. The
general local prototype store remains unencrypted even though raw capture journal entries and session credentials now use the native encrypted boundaries above.

## Weekform.dev browser and persistence boundary

The account/team website uses server-side Supabase API calls under the signed-in
user's row-level-security session. It stores two narrow `localStorage`
preferences: one user-scoped, versioned value recording only whether the Web
workspace intro was completed, and one site-wide value containing only
`light` or `dark` for appearance. Dark is the default when no appearance value
has been saved. Those preferences contain no workload data,
email address, role, team record, credential, or auth token. The website has no `sessionStorage`,
IndexedDB, or application-managed persistent workload cache.
The private Web workspace mounts one ephemeral browser Supabase client solely to
subscribe to the signed-in user's private Broadcast topic; the event requests a
fresh server render and is not a workload cache. Client components otherwise keep only
mounted React state. Standard Supabase auth cookies persist the account session
and are cleared by sign-out. Manager Access uses that same signed-in account
session and adds no portal-specific browser storage or appearance cookie. It
filters active team memberships to owner and manager roles before presenting a
team workspace; authorization for team records still comes from RLS.

Inside an authorized Web team workspace, active owners and managers can see
each roster member's display name and account email address so they can identify
the people they coordinate with. Email remains in Supabase Auth and is returned
only through a security-definer roster RPC that rechecks the caller's active
owner/manager membership for the requested team. Plain members, outsiders, and
anonymous callers cannot execute that identity read. The address is not copied
into a public profile or workload table, persisted in browser storage, included
in the team briefing's AI input, or treated as a member-approved workload
signal.

Desktop Manager Mode uses the same persisted Weekform account session and the
public Supabase configuration already used by Account & Sharing. On entry or a
visible refresh, it reads only active memberships, team names, manager-authorized
member display names and account emails, roles, and the allowlisted fields from each member's latest
approved workload snapshot. The signed-in owner or manager remains in the team
roster and is labeled as the current user; their workload values appear only if
they approved and synced a snapshot under the same contract. RLS reauthorizes
every read. A roster, profile, or snapshot read failure fails closed and clears
the rendered team-data path instead of mixing partial results with cached or
placeholder values. Today, Week, Agent, and History derive their local summary
only from that response; approval-gated briefings, manager actions, and the full
server audit trail remain in the authenticated Web workspace. Minimize, resize,
appearance, and navigation controls do not change this data boundary.

The role-aware **Team** destination is shown only while the signed-in account
has an active team membership or has sharing enabled for a connected team. Its
Workload Gantt reads a bounded maximum of 650 approved snapshot rows, enough for
one 13-week quarter across 50 members. The query allowlists only week, server
sync time, reliable-capacity, reactive, meeting, fragmentation, and review-count
fields. A plain member's RLS session can see only that member's own history;
owners and managers can see only the team history their active role authorizes.
Roster members without a visible snapshot remain explicitly **Not shared**.
Zoom and drill-down state is ephemeral React state and creates no new browser or
desktop persistence, upload, AI request, or raw-evidence path.

The sign-in page also supports passwordless email Magic Links through Supabase
Auth. The submitted email address is processed by Supabase and the configured
email-delivery service solely to deliver the one-time sign-in link; the flow
does not send Mac activity, workload evidence, replicas, snapshots, or team
records to the email service.

Password recovery uses the same Supabase Auth and configured email-delivery
boundary. The request screen sends only the normalized account email and always
shows the same success notice whether or not an account exists. The recovery
link returns through the canonical Weekform callback into a short-lived signed-in
reset session; Weekform validates that session, validates and confirms the new
password, updates it through Supabase Auth, signs the session out, and asks the
user to sign in again. Provider error text is replaced with generic recovery
copy. The local candidate has not yet been deployed or exercised through live
email delivery, so no production recovery-delivery claim is made.

Google and GitHub sign-in use Supabase OAuth. Choosing one sends the account
authorization request to that provider and returns through Supabase Auth; the
provider and Supabase may process the account identity needed to authenticate
the user. Weekform does not include Mac activity, workload evidence, replicas,
snapshots, or team records in the OAuth request.

Magic-link, password-recovery, OAuth, invite, and authentication callbacks do
not construct absolute destinations from an arbitrary request host. Production
uses `https://weekform.dev`; development permits loopback origins; an exact
Vercel preview origin is accepted only for the matching preview environment.
Unrecognized forwarded host/origin values do not become redirect or invite
destinations.

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

In Individual mode, the Today and Week surfaces include a user-initiated
**Start Tracking** control. The browser does not invoke the registered
`weekform://` scheme, so this action never creates a browser-owned “Open
Weekform.app?” confirmation. Instead, an authenticated server action calls the
fixed `request_desktop_start_tracking` RPC. The server selects only a recently
active, unrevoked Mac registered to the signed-in account and either reports
that tracking is already active or creates one short-lived `start_tracking`
command. A running Desktop app acknowledges that command, resumes its existing
native collector, and opens the Desktop-only compact view. A stopped, stale, or
outdated Mac receives no command; Web reports that the user must open Weekform
from Applications or the menu bar. An account with no registered Mac is routed
to the authenticated Download page.

The command channel carries no account token, activity sample, app/window title,
or workload evidence into the browser. Its rows contain only user, device,
random action, fixed action, and creation/expiration identifiers and are removed
after acknowledgement. The tracking heartbeat publishes only an enabled/paused
boolean and server receipt time. Weekform Web cannot launch a quit Mac app,
start collection itself, or render a compact workspace view.

The Web sidebar also includes a separate, explicitly labeled **Open current page
in Weekform Desktop** icon. On macOS, activating that icon invokes the registered
`weekform://` scheme, so the browser may display its own confirmation before it
opens Weekform. The URL carries only the fixed `weekform.dev` source label, the
large-window mode, and one allowlisted Weekform screen identifier; it does not
carry an account token, team identifier, activity, workload evidence, or page
content. Desktop validates the mode and screen against a static allowlist before
showing the window. Individual routes map to their matching native screen, while
Manager and member Team routes map to the native Team workspace. This explicit
navigation handoff is independent of the prompt-free Start Tracking command and
cannot start, resume, or pause native collection.

## Individual Web Ask (weekform.dev, server-side AI)

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

Configured model requests also require distributed request controls before any
provider call: at most one active lease for the user, replay-safe per-submit
idempotency, 12 reserved requests / 40,960 reserved token units per user per UTC
day, and the tighter of that limit or 16 requests / 65,536 units for the
secret-keyed IP subject. Raw IPs, questions, answers, model output, and workload
context are not stored in the control receipt; it retains only hashes, scope,
reserved units, lease timing, and a coarse success/failure outcome. Missing or
invalid control configuration fails closed without sending the prompt.

The Web Ask transcript and draft exist only in mounted React state. Weekform does
not write questions or answers to Supabase, `localStorage`, `sessionStorage`,
IndexedDB, cookies, or an application-managed cache; reloading the page clears
them. The API streams at most 2,048 bytes of request text and cancels an
over-limit body even when it is chunked or understates `Content-Length`.
Success, authentication, validation, provider, and control-error responses all
use `no-store, max-age=0` with `Pragma: no-cache`. Standard infrastructure and provider
processing boundaries still apply, so users should not type sensitive or
regulated information into Web Ask.

## Team Briefing (weekform.dev, server-side AI)

The weekform.dev manager dashboard includes an optional Team Briefing that summarizes already-shared team workload signals. It is a server-side feature of the web app (`apps/web/lib/briefing.ts`); the desktop app is not involved and no new data is collected for it.

The briefing can call OpenAI only when the site operator configures **both** `OPENAI_API_KEY` and `OPENAI_TEAM_BRIEFING_MODEL` as server-only environment variables. Without both, the feature runs in a deterministic fallback mode computed locally on the server from the same shared metrics, and makes no network call to any AI provider. The API key is read only inside that server-only module; it is never sent to the browser, included in a response, or exposed to team members.

When the model path is configured, a manager-triggered briefing sends only an allowlisted input: the team name, member display names (or neutral labels such as "Member 2" — never account identifiers), each member's share level, snapshot freshness, review-coverage percentage, the capacity and allocation percentages that member already chose to share, and the deterministic risk flags derived from them. Metrics a member disabled are omitted, never sent as zero. Raw activity samples, window titles, evidence, notes, calendar or chat details, screenshots, and credentials never enter the briefing input — the briefing sees strictly less than the manager dashboard already displays.

Requests set `store: false`. The model's response is validated against a fixed schema before display; any risk or opportunity that cites evidence outside the allowlisted catalog is stripped rather than trusted. The briefing UI labels its output as AI-generated from shared workload signals, and both the prompt and the fallback are constrained to avoid ranking members, productivity or performance scoring, and burnout/HR/medical/legal language.

Configured briefing requests use the same content-free distributed control
receipts with manager authorization rechecked first: concurrency one, per-submit
idempotency, 6 requests / 40,960 reserved token units per manager per UTC day,
and the tighter of that limit or 8 requests / 65,536 units for the secret-keyed
IP subject. Missing trusted-proxy, secret, database-claim, or migration state
fails closed before OpenAI.

## Manager Actions (weekform.dev)

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
reauthorizes the manager server-side. Static contract tests and the local
four-actor pgTAP suite pin these boundaries.

Weekform may compare the linked metric's team median across later approved weekly
snapshots. It shows no result until two distinct later weeks share that metric,
excludes dropped actions, and labels the readout as “What changed after”: a
correlation, never evidence that the action caused the change or that any person
contributed to it. The Manager Action migrations are within the linked
production ledger through `202607200008`; this audit re-ran the local database
contracts but did not re-exercise the live authenticated four-actor workflow.

## Controls

- **Private mode / Pause Tracking** stops new active-window and visual-context capture.
- **Visual Context** can be enabled or disabled independently.
- **Exclude** removes a work block from the reviewed workload model.
- **Reset Prototype Data** is single-flight. Before its first deletion it closes the React persistence lane and pending debounce; invalidates startup hydration and its Store/Keychain migration plus legacy-journal import; closes the local file import/full-backup fence; rejects new AI/Agent and API/Codex connection starts; closes cloud-account, aggregate sharing, personal sync/review, Calendar, and Chat operation lanes; invalidates pending native OAuth callbacks; and pauses/drains native capture. It aborts active browser file readers and waits any hydration, persistence, import/export, provider, Keychain, queue, network, or capture operation that already crossed a protected edge. Only after those barriers does it clear and verify the general Store state, Agent chat/draft browser storage, every preregistered/legacy provider API-key account, encrypted capture journal and journal key, Calendar/Chat credentials and cursors, the isolated Codex-plan sign-in regardless of current React provider metadata, Keychain cloud session, replica queue/policy, and team-sharing policy. Codex app-server logout is best effort, but path-derived deletion of the Weekform-owned Keychain account is attempted even when its isolated directories are absent. Local, account, personal, Calendar, and Chat lanes reopen only after empty in-memory state is installed; aggregate scheduling reopens from that cleared account/policy state. If any durable deletion, callback cancellation, or quiescence step cannot be verified, the in-memory workspace is cleared but the UI and audit record require a retry instead of reporting complete success; a credential-cleanup failure preserves the non-secret binding registry so a later relaunch can retry. Cloud rows already received remain until the user deletes them through the corresponding cloud control.

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

The simulator schema migrations are within the linked production ledger through
`202607200008`, and their RLS contracts participate in the local pgTAP suite.
This audit did not re-exercise a hosted simulator-admin grant or production
Simulation execution, so schema presence is not a current end-to-end
authorization claim. Local Live simulation is available only in Vite
development mode. Published synthetic demo credentials create a tab-scoped
`sessionStorage` marker and grant no production or cloud access. The production
desktop Manager Mode entry is separate from Simulation: it appears only while
the cloud account is signed in with an active owner or manager membership and
loads the RLS-scoped roster and approved snapshots described above. It never
mixes simulator rows into real team totals. Local workspace-only monochrome
theme, density, and motion preferences are stored separately in browser
`localStorage`; they contain no workload data and can be reset from the
workspace. The authenticated Next.js `/manager-access` route remains the
production web entry for team briefings, approval-gated actions, and full team
administration; legacy `/admin` only redirects there. Browser-development
Generate span runs use a simulator-only IndexedDB database rather than personal
Weekform state; local prototype storage remains unencrypted. Live simulation's
embedded Weekform state is not written to that database.

Current modeling limitations also matter to privacy and interpretation: capacity still uses a fixed 40-hour denominator, PTO does not redefine that denominator, and some time-of-day inference uses the host machine timezone rather than the configured scenario timezone. Simulation results are prototype planning evidence, not observed facts or organizational benchmarks.

## Reporting Privacy Issues

Do not include real credentials, private screenshots, customer data, or confidential work metadata in a public GitHub issue. Report a vulnerability through GitHub's private security reporting feature when it is available for the repository.
