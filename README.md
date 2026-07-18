# ClearCapacity

ClearCapacity is a local-first macOS workload intelligence prototype for analysts. It turns calendar events and foreground-app activity into reviewable work blocks, then produces an explainable estimate of weekly allocation and reliable capacity for new work.

> [!IMPORTANT]
> ClearCapacity is an early prototype, not a production monitoring or workforce-management system. Capacity estimates are planning aids and should be reviewed by the user before they are shared or used for decisions.

## Install on a Mac (easiest path)

Sharing this with a friend? Hand them the project folder (or the repository
link) and point them at the guided installer. It checks for and installs the
prerequisites it can't find (Xcode Command Line Tools, Homebrew, Node.js, and
Rust), builds the app, and drops **ClearCapacity.app** into `/Applications` —
with a friendly, step-by-step terminal walkthrough the whole way.

**Option A — double-click (no terminal needed):**

1. Open the project folder in Finder, go into the `scripts` folder.
2. Double-click **`install.command`**. Terminal opens and runs the installer.
3. Answer the prompts (it asks before installing anything or using your password).

> The first time, macOS may say `install.command` "cannot be opened because it
> is from an unidentified developer." Right-click it → **Open** → **Open**, or
> allow it once under System Settings → Privacy & Security.

**Option B — one line in Terminal:**

```bash
bash scripts/install.command
```

Either way, the installer ends by explaining the first launch: ClearCapacity
lives in the **menu bar** (not the Dock), macOS will ask for **Accessibility**
permission (so the app can see which app is in the foreground — never your
keystrokes or screen), and a short **in-app walkthrough** points out where
everything is.

> [!NOTE]
> This build is compiled from source on the friend's own Mac, so it doesn't need
> an Apple Developer signature. Nothing is sent anywhere during install, and AI
> features stay optional and opt-in. Re-running `install.command` updates an
> existing install to a newer build.

Prefer to set things up by hand, or developing on the app? See
[Quick Start](#quick-start) and [Run the Desktop App](#run-the-desktop-app)
below.

## Why ClearCapacity

Analyst workload is often split across planned projects, recurring reporting, meetings, reactive requests, debugging, and coordination. Conventional task lists capture only part of that work. ClearCapacity explores a more complete workflow:

1. Collect limited activity metadata locally.
2. Group signals into candidate work sessions.
3. Let the user review, relabel, confirm, or exclude inferred work.
4. Convert reviewed work into an explainable weekly capacity model.
5. Generate an editable analyst or manager summary.

## Current Features

- macOS menu-bar app built with Tauri
- foreground app and window-title sampling
- local session grouping and audit history
- Outlook `.ics` calendar import
- workplace chat metadata import (Slack export today; Teams/Webex connectors planned) as a reactive-work signal
- Today review queue to confirm, relabel, or exclude inferred work blocks
- reviewable work ledger with confidence and evidence
- category, work-mode, planned-status, and project labels
- explainable weekly capacity model with a dedicated next-week forecast view and a multi-week capacity trends chart
- a searchable, filterable audit trail that includes every correction
- conversational agent for asking questions about your workload and capacity
- acceleration engine that mines reviewed work, calendar meetings, and reactive-chat load for repetitive workflows, tool-able time-sinks, context-switch hotspots, recurring meetings, and interruption batching into locally-computed, evidence-cited "plays", with a realized-savings track record for plays you act on (and optional AI-authored skill recipes and tool picks)
- optional AI-assisted classification, review suggestions, forecasts, and narratives (OpenAI works end-to-end today; other OpenAI-compatible providers can be configured in Settings and currently power the conversational agent)
- optional screenshot-derived visual context with an explicit opt-in toggle
- local data export (JSON or CSV) and a user-controlled retention window
- browser-local persistence for prototype data

## App Navigation

The app is organized into four primary sections, each with focused sub-views:

- **Today** — the daily review queue. Confirm, relabel, or exclude inferred work blocks, with an opt-in Review Copilot that suggests cleanup actions you approve before they apply.
- **Week** — `Capacity` (the explainable weekly allocation model and risk modifiers), `Forecast` (an AI projection of next week's reliable capacity with scenarios, constraints, and recommendations, plus the multi-week capacity trend chart and forecast track record), and `Summary` (an editable analyst or manager narrative).
- **Agent** — `Ask` (a conversational view to ask questions about your workload, plan, and understand the capacity model), `Accelerate` (locally-mined, evidence-cited "plays" — repetitive workflows, tool time-sinks, context-switch hotspots, recurring meetings, and reactive-chat batching — that estimate reclaimable time each week and track realized savings for plays you act on, with optional AI-authored skill recipes and tool picks), and `Skills` (a durable, exportable library of the skill recipes you've saved from Accelerate plays).
- **History** — `Activity` (the live work ledger and capture timeline), `Audit` (the filterable trail of all local signals, inferences, corrections, and privacy events — label edits live under its `Correction` filter), and `Flagged` (a review queue for visual captures flagged as potentially sensitive, with a per-item discard control; shown only when visual context is in use).

## Privacy Model

ClearCapacity is designed to keep raw activity data under the user's control:

- Active-window capture records app name, front-window title, and timestamp.
- Outlook exports are parsed locally.
- Workplace chat is read as metadata only (timestamps, channels, message counts) — never message text.
- Review history, audit events, and derived work blocks are stored in local webview storage.
- Tracking can be paused immediately from the app or menu bar.
- Visual context is disabled by default.
- When visual context is enabled, a screenshot can be sent to your configured AI provider (OpenAI by default) for analysis. The temporary image is deleted locally after it is read, the API request uses `store: false`, and only the derived insight is retained by the app.
- Other AI features send structured prompt context to your configured AI provider when triggered. Classification, review suggestions, and forecasts are manual; weekly narrative generation can run automatically after the app has workload evidence.

Read [Privacy and Data Flow](docs/PRIVACY.md) before enabling activity capture or AI features.

## Requirements

- macOS
- Node.js 20 or newer
- npm
- Rust toolchain for the desktop app
- an AI provider API key (OpenAI by default; configurable in Settings) for optional AI features

## Quick Start

Install JavaScript dependencies:

```bash
npm install
```

Create your local environment file:

```bash
cp .env.example .env
```

Add an OpenAI API key to `.env` if you want to use the optional AI features:

```dotenv
OPENAI_API_KEY=your-api-key
```

Run the web interface:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`. Native activity capture, menu-bar behavior, and OpenAI commands require the Tauri desktop app.

## Run the Desktop App

Install Rust if needed:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Optional AI features read credentials from the repository's `.env` file when the desktop app starts:

```dotenv
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=
OPENAI_VISION_MODEL=
```

Then run:

```bash
npm run desktop:dev
```

The desktop scripts use Apple’s standalone Command Line Tools when
`DEVELOPER_DIR` is not already set. This avoids coupling local Tauri builds to
a full Xcode installation whose license has not been accepted. Set
`DEVELOPER_DIR` explicitly to build with a specific Xcode version.

`OPENAI_MODEL` and `OPENAI_VISION_MODEL` are optional overrides. Exported shell variables still work and take precedence over `.env`. The real `.env` file is ignored by Git; only `.env.example` should be committed.

The app launches in the macOS menu bar with the main window hidden. macOS may request Accessibility or Automation permission for foreground-window metadata and Screen Recording permission if visual context is explicitly enabled.

## Available Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run demo` | Open the web interface with synthetic demo data |
| `npm run build` | Type-check and build the web interface |
| `npm run preview` | Preview the production web build |
| `npm run desktop:dev` | Run the Tauri desktop app in development |
| `npm run desktop:build` | Create a desktop release build |

If a native release build is constrained by available memory, reduce Cargo parallelism:

```bash
CARGO_BUILD_JOBS=2 npm run desktop:build
```

## How Capacity Is Calculated

The deterministic model sums the week's already-committed load — the share of capacity that carries into next week:

- recurring commitments
- carryover risk from unverified, low-confidence work
- weighted reactive load
- a fragmentation penalty
- a work-in-progress penalty

Reliable new-work capacity is then the headroom that brings total utilization up to an ~80% target (the queueing "knee" past which delays grow sharply), clamped to 0-40%:

```text
Committed Utilization =
  recurring commitments
  + carryover risk
  + weighted reactive load
  + fragmentation penalty
  + WIP penalty

Reliable New Work Capacity = clamp(80 - Committed Utilization, 0, 40)
```

This metric is not intended to represent free time. It estimates how much new planned work the following week can absorb without likely slippage. The 40% cap guards against over-promising on a near-empty week.

## Project Structure

```text
apps/desktop/
  src/                       React interface and prompt builders
  src-tauri/                 Tauri shell and native macOS commands
packages/
  domain/src/                Shared workload and audit models
  inference/src/             Capacity calculation and session grouping
  integrations/src/          Outlook .ics, git-log, workplace-chat, and generic raw-event import parsers
```

## Validation

Run the current project checks before opening a pull request:

```bash
npm run build
npm audit --audit-level=moderate
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

There is not yet an automated test suite. Adding focused tests for calendar parsing, session grouping, capacity calculations, and native command boundaries is a project priority.

## Known Limitations

- macOS is the only native platform currently supported.
- Data is stored in local webview storage rather than an encrypted application database.
- Outlook integration requires a manual `.ics` export.
- Window titles can contain sensitive information and should be reviewed or excluded.
- AI features require network access and may incur API usage costs.
- Visual context captures the current screen, not only the active app window.
- Capacity weights and thresholds are prototype heuristics, not validated organizational benchmarks.
- The main React and Rust modules are still large and need further decomposition.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull-request guidance. Please use GitHub issues for reproducible bugs, privacy concerns, and narrowly scoped feature proposals.

## License

No open-source license has been selected yet. Until a license is added, the source is publicly viewable but standard copyright restrictions still apply.
