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

The proposed cloud authorization boundary is an authenticated user explicitly granted in `private.simulator_admins`. Team membership, a manager role, user metadata, a URL parameter, or a local feature flag does not grant cloud simulator access. All public simulation tables use admin-only RLS. The isolated simulation manager view is not unioned with real workload data. “Include simulations” defaults off, requires simulator-admin access, and renders simulated rows separately rather than changing real team totals.

Fast Forward performs no workplace-app automation. The optional Controlled Local Playback proof of concept validates an action plan against exact Weekform-owned loopback `/simulator-sandbox/` pages and rejects arbitrary localhost routes, real sites, files, query strings, and fragments. Its UI requires a separate local feature flag and an explicit confirmation. It currently previews mock pages rather than launching a dedicated browser profile or enforcing host-level network isolation; those controls are required before automated playback may be described as operational. It must never use OS-wide input automation or perform a real message, email, purchase, commit, or other external mutation.

Simulation JSON/CSV exports are prepared locally and repeat the synthetic provenance markers. An audit receipt records that an export was prepared; it does not claim the operating system completed the save. Archiving hides a run from the active simulation view without deleting it. Permanent run deletion cascades through generated members, artifacts, and week snapshots; a minimal deletion receipt remains without preserving the deleted payload. Personal backup/reset and simulation export/delete are separate controls and do not imply one another.

The simulator migration and RLS tests in this repository are review artifacts. They have not been applied to or verified against a live Supabase project here, and the Team Cloud application is not deployed from this checkout. Any local admin gate remains development-only until authenticated database authorization is connected. Browser-development runs use a simulator-only IndexedDB database rather than personal Weekform state; local prototype storage remains unencrypted.

Current modeling limitations also matter to privacy and interpretation: capacity still uses a fixed 40-hour denominator, PTO does not redefine that denominator, and some time-of-day inference uses the host machine timezone rather than the configured scenario timezone. Simulation results are prototype planning evidence, not observed facts or organizational benchmarks.

## Reporting Privacy Issues

Do not include real credentials, private screenshots, customer data, or confidential work metadata in a public GitHub issue. Report a vulnerability through GitHub's private security reporting feature when it is available for the repository.
