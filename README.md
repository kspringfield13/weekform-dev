# Weekform

Weekform is a local-first macOS workload intelligence prototype for analysts. It turns calendar events and foreground-app activity into reviewable work blocks, then produces an explainable estimate of weekly allocation and reliable capacity for new work.

> [!IMPORTANT]
> Weekform is an early prototype, not a production monitoring or workforce-management system. Capacity estimates are planning aids and should be reviewed by the user before they are shared or used for decisions.

## OpenAI Build Week 2026

Weekform predates the July 13–21 submission period. The public submission distinguishes that inherited baseline from the product work completed during Build Week and records the relevant Codex/GPT-5.6 task evidence. See [Build Week provenance](docs/BUILD_WEEK_2026.md) for the baseline commit, dated change record, and required `/feedback` Codex Session ID.

## How We Built Weekform with Codex

During Build Week, Kyle Springfield worked with Codex powered by GPT-5.6 as a hands-on product, design, and engineering collaborator. Codex accelerated repository research, option generation, implementation, review, debugging, and validation; Kyle set the product constraints, selected the direction, evaluated the results, and made the final calls. The collaboration was iterative rather than one-shot: propose, inspect, build, run, critique, and refine.

The core workload prototype and the first naming exploration existed before July 13. The timeline distinguishes that foundation from selected new work and material refinements during the submission period; it does not claim the inherited product as Build Week output.

| Date | Where Codex and GPT-5.6 accelerated the work | Key product, engineering, and design decisions made by Kyle |
| --- | --- | --- |
| **Before Build Week — July 11** | GPT-5.6 reviewed the product positioning, explored names and marketing angles, recommended **Weekform**, developed the folded-workweek “W” metaphor, and produced image-generation briefs for a compact macOS mark. It also surfaced `weekform.com` when a preliminary WHOIS check returned no match at that time; this was an availability signal, not trademark clearance or proof of registration. | Kyle selected Weekform from the proposed directions, rejected the first logo treatment as not strong enough, and requested clearer toolbar- and iPhone-ready concepts. This ideation is disclosed as prior work, not Build Week output. |
| **July 13** | After the name was locked, Codex productionized the supplied identity across the interface, native shell, packages, documentation, installer, app icons, and menu-bar assets, then built and visually checked the result. | Kyle supplied the chosen concept and black logo artwork, directed the lockup and compact-header refinements, approved the final identity, and locked the message **“Know what fits before you commit.”** He also chose to frame Weekform as a private planning aid—not employee surveillance. |
| **July 13** | Codex moved rapidly through targeted reliability and accessibility fixes, including recurring-calendar handling, forecast boundaries, Review Copilot state, keyboard behavior, and screen-reader semantics. | Kyle kept explainability, reviewability, and local-first behavior as release constraints rather than trading them away for speed. |
| **July 14** | A primary GPT-5.6 Codex task integrated and extended the chosen identity within a coherent product refresh across the React app, Tauri shell, package metadata, icons, documentation, AI-usage experience, and supporting assets. Codex handled the repository-wide impact analysis and implementation loop while keeping the project buildable. | Kyle directed the toolbar and navigation hierarchy, reviewed the visual result in the running app, chose which workload and AI-usage information deserved prominence, and refined measured usage rather than accepting a more speculative chart. |
| **July 15** | Codex audited edge cases across imports, persistence, privacy boundaries, and generated data, then implemented focused fixes for calendar data, sensitive visual context, usage records, and chat exports. | Kyle maintained the rule that sensitive evidence stays constrained, generated output must be defensively parsed, and every important inference remains inspectable by the user. |
| **July 16** | Codex improved the compact menu-bar experience, added Agent-assisted actions for classification, forecasting, and narratives, and implemented focused interaction polish with reduced-motion fallbacks. | Kyle required consequential Agent actions to remain approval-gated and shaped the final compact layout and motion through visual feedback. |
| **July 18** | Codex performed the submission audit, reconstructed the dated evidence trail, prepared a reproducible installer, migrated the current AI SDK integration, removed retired provider paths, and ran the web, dependency, Rust, and desktop-build checks. | Kyle chose an OpenAI-first direction for the hackathon, a separate public repository, and a clean history that clearly separates prior work from submission-period work. |

### What Codex changed about our workflow

- **Faster exploration:** GPT-5.6 could inspect the product and codebase together, turn positioning ideas into concrete UI and identity options, and test those ideas against implementation constraints.
- **Safer cross-cutting changes:** Codex traced a decision across TypeScript, Rust, Tauri configuration, package metadata, assets, privacy documentation, and installer behavior instead of treating each file as an isolated edit.
- **Shorter feedback loops:** Codex repeatedly paired implementation with type-checking, production builds, Rust checks, dependency audits, and review of the running interface.
- **More review capacity:** Focused Codex reviews surfaced accessibility, data-integrity, privacy, and edge-case issues while Kyle concentrated on product judgment and visual critique.

The primary Build Week project task for `/feedback` is **`019f6058-ca64-7510-bcc5-f9416f981036`**. The dated baseline, selected commit evidence, supporting Codex tasks, and current submission notes are maintained in [Build Week provenance](docs/BUILD_WEEK_2026.md).

## Install on a Mac (easiest path)

For hackathon judges and first-time users, the guided
[Weekform installer](scripts/install.command) is the recommended path. It
checks for required build tools, asks before installing anything missing,
builds the app locally, and places **Weekform.app** in `/Applications`.

### Download and double-click

1. [Download the Weekform source](https://github.com/kspringfield13/weekform-dev/archive/refs/heads/main.zip) and unzip it.
2. In Finder, open `weekform-dev-main`, then `scripts`.
3. Double-click **`install.command`** and follow the prompts.

> The first time, macOS may say `install.command` "cannot be opened because it
> is from an unidentified developer." Right-click it → **Open** → **Open**, or
> allow it once under System Settings → Privacy & Security.

### Clone and run from Terminal

```bash
git clone https://github.com/kspringfield13/weekform-dev.git
cd weekform-dev
bash scripts/install.command
```

Already have the repository? Run only `bash scripts/install.command` from its
root. If the installer is downloaded on its own, it can also offer to clone the
public repository into `~/weekform-dev`.

Either way, the installer ends by explaining the first launch: Weekform
lives in the **menu bar** (not the Dock), macOS will ask for **Accessibility**
permission (so the app can see which app is in the foreground — never your
keystrokes or screen), and a short **in-app walkthrough** points out where
everything is.

> [!NOTE]
> This build is compiled from source on the user's Mac, so it does not require
> an Apple Developer signature. The installer downloads source dependencies and
> any approved prerequisites, but it does not upload Weekform activity data. AI
> features remain optional and opt-in. Re-running `install.command` rebuilds and
> reinstalls the current checkout.

Prefer to set things up by hand, or developing on the app? See
[Quick Start](#quick-start) and [Run the Desktop App](#run-the-desktop-app)
below.

## Why Weekform

Analyst workload is often split across planned projects, recurring reporting, meetings, reactive requests, debugging, and coordination. Conventional task lists capture only part of that work. Weekform explores a more complete workflow:

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
- optional OpenAI-assisted classification, review suggestions, forecasts, narratives, and conversational workload analysis
- a weekly AI-usage view tracking imported token counts, locally observed usage estimates, and a computed cost overlay (with CSV import and editable model prices)
- optional screenshot-derived visual context with an explicit opt-in toggle
- local data export (JSON or CSV) and a user-controlled retention window
- browser-local persistence for prototype data

## App Navigation

The app is organized into four primary sections, each with focused sub-views:

- **Today** — the daily review queue. Confirm, relabel, or exclude inferred work blocks, with an opt-in Review Copilot that suggests cleanup actions you approve before they apply.
- **Week** — `Capacity` (the explainable weekly allocation model and risk modifiers), `Forecast` (an AI projection of next week's reliable capacity with scenarios, constraints, and recommendations, plus the multi-week capacity trend chart and forecast track record), `AI Usage` (a weekly view of imported token counts, locally observed usage estimates, and a computed cost overlay), and `Summary` (an editable analyst or manager narrative).
- **Agent** — `Ask` (a conversational view to ask questions about your workload, plan, and understand the capacity model), `Accelerate` (locally-mined, evidence-cited "plays" — repetitive workflows, tool time-sinks, context-switch hotspots, recurring meetings, and reactive-chat batching — that estimate reclaimable time each week and track realized savings for plays you act on, with optional AI-authored skill recipes and tool picks), and `Skills` (a durable, exportable library of the skill recipes you've saved from Accelerate plays).
- **History** — `Activity` (the live work ledger and capture timeline), `Audit` (the filterable trail of all local signals, inferences, corrections, and privacy events — label edits live under its `Correction` filter), and `Flagged` (a review queue for visual captures flagged as potentially sensitive, with a per-item discard control; shown only when visual context is in use).

## Privacy Model

Weekform is designed to keep raw activity data under the user's control:

- Active-window capture records app name, front-window title, and timestamp.
- Outlook exports are parsed locally.
- Workplace chat is read as metadata only (timestamps, channels, message counts) — never message text.
- Review history, audit events, and derived work blocks are stored in local webview storage.
- Tracking can be paused immediately from the app or menu bar.
- Visual context is disabled by default.
- When visual context is enabled, a screenshot can be sent to the selected supported AI provider for analysis; OpenAI is the default and recommended path. The temporary image is deleted locally after it is read, OpenAI requests use `store: false`, and only the derived insight is retained by the app.
- Other AI features send structured prompt context to the selected provider when triggered. OpenAI is the default and full-feature path; compatible provider options remain available for selected workflows. Classification, review suggestions, and forecasts are manual; weekly narrative generation can run automatically after the app has workload evidence.

Read [Privacy and Data Flow](docs/PRIVACY.md) before enabling activity capture or AI features.

## Requirements

- macOS
- Node.js 20.19+ or 22.12+
- npm
- Rust toolchain for the desktop app
- an API key for optional AI features; OpenAI is recommended and has the fullest feature support

## Quick Start

Install JavaScript dependencies:

```bash
npm ci
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

Open `http://127.0.0.1:5173`. Native activity capture, menu-bar behavior, and native AI commands require the Tauri desktop app.

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
