# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project overview

Weekform is a **local-first macOS workload intelligence app** for analysts. It turns calendar events and foreground-app activity into reviewable "work blocks," then produces an explainable estimate of weekly capacity and reliable headroom for new work. Everything is reviewable: every inference cites evidence, every user-visible action is recorded in an audit trail, and AI assistance is optional and opt-in.

It is an **early prototype**, not a production monitoring or workforce-management system. Capacity estimates are planning aids meant to be reviewed by the user before they are shared.

**Stack:** Tauri 2 desktop app — Rust shell (menu-bar/tray app) + React 18 + TypeScript frontend (Vite 8), with shared TypeScript packages in a workspace-style monorepo.

## Monorepo layout

```
apps/desktop/
  src/                      # React UI
    App.tsx                 # Root: owns top-level state, wires hooks → ScreenRouter
    main.tsx                # React entry point
    components/             # UI, grouped by feature area (see "Screens" below)
    hooks/                  # Stateful logic: persistence, capture, AI calls, derivations
    services/               # AI prompts/schemas, provider presets, local store, demo data
    lib/                    # Pure helpers: dates, formatting, audit, blocks, constants, types
    styles.css              # Geist design tokens + theme variables
  src-tauri/
    src/lib.rs              # All Tauri commands (Rust): window mgmt, capture, AI pass-through
    src/main.rs             # Binary entry → calls weekform_lib::run()
    tauri.conf.json         # Window config, bundle settings (port 5173 hardcoded)
    capabilities/default.json  # Tauri permission capabilities
    Cargo.toml

packages/
  domain/src/
    models.ts               # Shared TS types (WorkBlock, ActivitySession, AIConfig, ...)
    taxonomy.ts             # Category/mode/status vocabularies
  inference/src/
    capacity.ts             # Capacity snapshot, forecast accuracy, correction-bias analysis, narrative
    accelerate.ts           # Deterministic Acceleration miner → AccelerationSignal[] (no AI, no titles)
    sessionizer/activeWindow.ts  # Group raw window samples → ActivitySession[]
  integrations/src/
    calendar/outlookIcs.ts       # Outlook .ics parser → OutlookCalendarEvent[] / WorkBlock[]
    calendar/calendarSource.ts   # Provider-agnostic CalendarSource interface (.ics wired; OAuth stubbed)
    chat/chatExport.ts           # Metadata-only chat export parser → reactive WorkBlock[] (interruption load)
    chat/chatSource.ts           # Provider-agnostic ChatSource interface (file export wired; API sync stubbed)
    chat/callDedup.ts            # Drop chat call/huddle blocks that duplicate calendar meetings
    git/gitLog.ts                # git-log export parser → planned-work signal (RawEvent)
    git/fixture.ts               # Sample git log for exercising the parser
    import/rawEvents.ts          # Generic RawEvent import entry point
    internal/normalize.ts        # Shared hashing + capacity-from-span helpers
```

Frontend code imports shared packages via **relative paths** (e.g. `../../../packages/domain/src/models`), not package names. There is no separate build step for the packages — `tsc -b` + Vite compile them in place via the `include` globs in `tsconfig.json`.

## Build & dev commands

```bash
# Web UI only (Vite on 127.0.0.1:5173) — fastest loop, but no native capture/AI
npm run dev

# Full desktop app (Tauri + Vite) — use this for most feature work
npm run desktop:dev

# Production web build (tsc type-check + Vite bundle) — the main validation gate
npm run build

# Demo mode (synthetic data via ?demo=1&screen=weekly; never touches real user state)
npm run demo

# Desktop production build (constrain parallelism with CARGO_BUILD_JOBS=2)
npm run desktop:build
```

## Pre-PR validation checklist

Run all three before opening a PR:

```bash
npm run build                                                   # type errors + bundle (primary gate)
npm audit --audit-level=moderate                                 # dependency vulnerabilities
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # Rust compilation
```

A `Stop` hook in `.codex/hooks.json` runs `npm run build` automatically. `npm run build` is the authoritative gate — if it passes, types and the bundle are clean. The project `/validate` skill runs this whole checklist and reports per-check results.

## Environment setup

```bash
npm install
cp .env.example .env   # add OPENAI_API_KEY to enable AI features at startup
```

Optional env vars (in `.env`, loaded by Tauri via `dotenvy` at startup — never exposed to the Vite bundle):
- `OPENAI_API_KEY` — seeds AI features at startup
- `OPENAI_MODEL` / `OPENAI_VISION_MODEL` — override default model names

AI credentials can also be entered at runtime in the Settings screen (per provider); they flow through Tauri IPC to Rust. See "AI integration."

## Architecture & data flow

The pipeline is **capture → sessionize → classify → review → model → summarize**, with the user able to correct at every step:

1. **Capture** — `src-tauri/src/lib.rs` samples the macOS foreground window (`sample_active_window`) on a timer; the React `useActiveWindow` hook collects `ActiveWindowSample[]`. Outlook `.ics` files are imported and parsed locally (`packages/integrations/calendar/outlookIcs.ts`); metadata-only chat exports and git-log exports are likewise parsed on-device (`packages/integrations/chat/`, `git/`).
2. **Sessionize** — `packages/inference/sessionizer/activeWindow.ts` groups contiguous samples into `ActivitySession[]`.
3. **Classify** — sessions + calendar events become `WorkBlock[]` (category, work mode, planned status, project, stakeholder, confidence, evidence). Optional AI classification refines labels (`useClassification` → `classify_active_window_sessions_with_openai`).
4. **Review** — the user confirms / relabels / excludes blocks. Every edit is a `UserCorrection`; the optional Review Copilot proposes cleanup actions the user approves before they apply.
5. **Model** — `packages/inference/capacity.ts` computes the `WeeklyCapacitySnapshot` (allocated %, deep-work %, reliable-new-work capacity, WIP/context-switch scores, etc.), plus forecast-accuracy scoring and correction-bias analysis.
6. **Summarize** — weekly narrative + AI forecast for next week.

**State ownership:** `App.tsx` is the single source of truth. It composes feature hooks and passes everything down through `ScreenRouter`. Persistence is via `services/localStore.ts` (Tauri Store plugin / webview storage), hydrated on load by `usePersistence`.

### Screens (`lib/types.ts` `Screen`, routed in `components/shell/ScreenRouter.tsx`)

Organized into primary sections (see `lib/ui.ts`):
- **Today** — `daily` (DailyReviewScreen): review queue + Review Copilot.
- **Week** — `weekly` (WeeklyCapacityScreen), `forecast` (ForecastScreen + capacity trend chart + accuracy track record), `narrative` (NarrativeScreen / weekly summary).
- **Agent** — `agent` (AgentScreen: conversational Q&A over your workload), `accelerate` (AccelerationScreen: mined time-saving plays + embedded saved-skills library).
- **History** — `ledger` (Activity ledger + heatmap), `audit` (AuditLogScreen; corrections appear under its Correction filter), `sensitive` (Flagged Captures review queue — tab hidden until visual context is on or a flagged capture exists).
- **Other** — `setup` (Settings: data sources, AI assistance, notifications, data control incl. reset), plus a `compact` window mode (`CompactWidget`) for the menu-bar quick view.

## AI integration

Multi-provider, OpenAI-compatible abstraction. Presets live in `services/aiProviders.ts`; the union is `AIProvider = "openai" | "grok" | "deepseek" | "custom"` (`packages/domain/models.ts`). Provider, `apiKey`, `baseUrl`, `model`, and `visionModel` (`AIConfig`) flow from the Settings UI through Tauri IPC to Rust — **credentials never touch the frontend bundle**; the Rust layer makes the actual HTTP call (`reqwest`).

AI-backed Tauri commands (all in `lib.rs`, all optional features):
- `classify_active_window_sessions_with_openai` — refine work-block labels
- `generate_review_copilot_suggestions_with_openai` — Today review suggestions
- `generate_forecast_agent_with_openai` — next-week capacity forecast
- `generate_weekly_narrative_with_openai` — manager-ready summary
- `capture_visual_context_with_openai` — screenshot-derived context (opt-in only)
- `chat_with_agent` — conversational agent
- `ai_complete` / `test_ai_connection` — generic completion + connectivity check

Each command has a matching `services/*Prompt.ts` (and a `*Schema.ts` for structured output) on the frontend, invoked through a dedicated hook (`useForecastAgent`, `useNarrativeGeneration`, `useReviewCopilot`, `useVisualContext`, `useClassification`; `useAcceleration` goes through the generic `ai_complete` instead of a bespoke command). `aiProviders.ts` also auto-upgrades retired default model IDs (`upgradeRetiredAppDefault`). When changing model defaults, update the presets there.

**Exception — Agent screen:** `AgentScreen.tsx` runs the Vercel AI SDK (`ai` and `@ai-sdk/openai`, dynamically imported) directly in the webview so its tools (`services/agentTools.ts`, zod-schema'd, Eve-style `defineTool`) can close over live app state (blocks, snapshot, corrections); the API key is used in the frontend for this path, with the `chat_with_agent` Rust command as fallback. Keep this in mind before repeating the "credentials never touch the frontend" claim for agent work.

## Privacy constraints

This is a core product value — treat it as a hard constraint:
- **Window titles are sensitive.** Don't log them or include them in any network call without explicit user review. Raw activity data (window titles, app names) stays local.
- **Visual context (screenshots) is opt-in only** and rate-limited via `lib/constants.ts` (`MAX_VISUAL_CONTEXT_CAPTURES_PER_DAY`, `MIN_VISUAL_CONTEXT_SESSION_MINUTES`, `MIN_VISUAL_CONTEXT_GAP_MS`); flagged/sensitive captures land in the `sensitive` review queue.
- **Audit everything user-visible.** `AuditEvent` (`packages/domain/models.ts`, helpers in `lib/audit.ts`) records actions for explainability. New user-facing actions should emit an audit event.
- **Retention** is user-controlled (`retentionDays`); `lib/dataExport.ts` backs export/retention controls.
- See `docs/PRIVACY.md` for the full model.

## Design system

Vercel **Geist** design tokens (colors, spacing, typography) with light/dark themes via CSS variables. Token reference is in `design.md`; full definitions in `apps/desktop/src/styles.css`. Use existing tokens/variables rather than hardcoded values. Icons come from `lucide-react`.

## Gotchas

- **No automated test suite.** Testing is manual — use `npm run dev` / `npm run desktop:dev` to validate, and the `/verify` skill to drive the running app. `npm run build` is the type/bundle gate.
- **Port 5173** is hardcoded in both `vite.config.ts` and `tauri.conf.json`. Change both or neither.
- **`DEVELOPER_DIR`** — desktop scripts default it to `/Library/Developer/CommandLineTools` to avoid requiring full Xcode. Override by exporting it first.
- **Demo mode** — `?demo=1` (or `npm run demo`) uses synthetic data only; "Reset Prototype Data" is safe there.
- **LocalStorage / webview storage** — prototype data is stored unencrypted. Users reset via the UI button.
- **Outlook calendar** — manual `.ics` export only; parsed locally, no network call. The `CalendarSource` OAuth path (`calendar/calendarSource.ts`) is a disabled stub.
- **Shared-package edits** — changes in `packages/` are picked up directly (relative imports, no rebuild), but they must satisfy `tsc -b`.

## Repository conventions & docs

- **`design.md`** — design-token reference. **`README.md`** — user-facing overview and Build Week collaboration record. **`CONTRIBUTING.md`** — contribution notes. **`docs/PRIVACY.md`** — privacy model. **`docs/BUILD_WEEK_2026.md`** — submission provenance and evidence.
- **Build Week collaboration record:** Treat `README.md` → **How We Built Weekform with Codex** as a living submission artifact through July 21, 2026. Whenever a material Build Week product, engineering, or design change lands, update that section in the same change with the date, the outcome, what Codex/GPT-5.6 accelerated, and the key direction or approval retained by Kyle. Add concrete public evidence to `docs/BUILD_WEEK_2026.md` (commit, pull request, or Codex task ID) and link it from the narrative where useful. Keep inherited work clearly separate from submission-period work, use only claims supported by dated evidence, and never include secrets, raw private prompts, or sensitive local paths.
- Commit messages in history follow short imperative summaries (often `improve: …` for loop commits); match the surrounding style.
