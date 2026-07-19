# AGENTS.md

Repository-wide instructions for Codex and other coding agents working on Weekform. A nearer `AGENTS.md` or `AGENTS.override.md` may add narrower rules. Keep always-relevant context here and move repeatable procedures into `.agents/skills/`. Absoloop is a build accelerator and dogfooding partner, not a Weekform feature unless an integration is explicitly approved and shipped.

## Mission and product north star

Weekform (repo:weekform-dev) is a **local-first macOS Workload Intelligence & Sustainable Performance app for individual analysts**, with a path to other knowledge workers. It turns calendar events, foreground-app activity, and local imports into reviewable work blocks, then explains weekly allocation, delivery risk, focus quality, reactive load, and reliable capacity for new work.

**OpenAI Build Week 2026 track:** Work and productivity  
**Submission deadline:** July 21, 2026  
**Product promise:** **Know what fits before you commit.**

```text
limited evidence → reviewed truth → deterministic workload model
→ evidence-grounded decision → approval-gated action
→ observed outcome → better personal baseline
```

Weekform should answer: **What consumed my week? Why is delivery or focus at risk? What fits next? What should change? Did the change help?**

“Performance” means the user's sustainable delivery predictability, focus continuity, workload quality, recovery, and ability to honor commitments. It never means employee ranking, surveillance, activity maximization, or a universal productivity score.

Weekform is not a task-list clone, generic project-management suite, employee-monitoring system, opaque AI score, or speculative executive dashboard. Do not broaden it in those directions.

## Build to win, then compound

OpenAI judges technical implementation, design/UX, potential impact, and quality of idea. During Build Week, optimize in this order:

1. **Complete product story.** A judge can launch Weekform, understand the problem, use the core loop, and see a trustworthy result without developer narration.
2. **Working, non-trivial implementation.** Prefer real behavior across React, inference, persistence, and Tauri over mockups, prompt-only demos, or decorative AI.
3. **Specific impact.** Demonstrate less overcommitment, clearer reactive load, protected focus, better prioritization, or a more reliable weekly decision.
4. **Coherent craft.** Preserve polished macOS interaction, accessibility, clear hierarchy, fast feedback, and honest empty/error/loading states.
5. **Defensible novelty.** Keep consented evidence, user review, deterministic capacity, forecast calibration, and evidence-grounded Agent assistance visible.

```text
privacy and data integrity
> build/install/demo reliability
> core-loop clarity
> decision usefulness and evidence
> judge-visible polish
> feature breadth
> meta-tooling polish
```

Before implementation, answer: **Which workload decision improves? What evidence powers it and can the user correct it? Where does it close the loop? What can a judge see? Why is it distinctly Weekform? How will we know it helped?**

After submission, prioritize better evidence, personal baselines, calibrated forecasts, scenarios, action effectiveness, and realized savings—not disconnected charts or AI features.

## Workload Intelligence stack

Every major feature should strengthen one or more layers without weakening those below it:

1. **Signals** — limited, consented, source-attributed activity, calendar, chat metadata, git, usage, and user input.
2. **Reviewed truth** — sessions and work blocks the user can confirm, relabel, annotate, or exclude.
3. **Models** — deterministic capacity, fragmentation, reactive load, carryover, WIP, forecasts, and personal baselines with uncertainty.
4. **Guidance** — explanations, scenarios, priorities, and recommendations grounded in reviewed evidence.
5. **Action** — approval-gated classification, forecasting, summaries, planning moves, and acceleration plays.
6. **Learning** — corrections, forecast outcomes, acted-on plays, and realized effects that improve future guidance transparently.

Useful local measures include evidence coverage, correction rate, forecast error, review completion, reactive-load change, focus continuity, realized time reclaimed, and action outcome. Never collapse them into an unreviewable “performance score” or present prototype heuristics as organizational benchmarks.

## Product invariants

- **Local-first by default.** Raw activity and imports remain local unless the user explicitly enables or invokes a documented network feature.
- **User control.** Inferred work stays reviewable, correctable, confirmable, annotatable, and excludable.
- **Explainability.** Metrics and recommendations retain inspectable evidence and uncertainty. Never present model output as observed fact.
- **Deterministic core.** Capacity and workload calculations live in deterministic inference code. AI may classify, forecast, explain, recommend, or draft; it must not silently redefine the model.
- **Approval before consequence.** Agent-proposed classification, forecast, narrative, deletion, reset, or other state change remains visibly approval-gated. Never claim an action ran before confirmation and success.
- **Auditable behavior.** Consequential user-visible actions should emit an `AuditEvent` with truthful source, privacy level, and summary.
- **No surveillance framing.** Weekform is a private planning aid, never a system to rank, monitor, or discipline employees.
- **Honest prototype claims.** Capacity weights are heuristics, local storage is unencrypted, Outlook import is manual, and Visual Context can capture the whole screen.
- **Compatibility over cosmetic renaming.** Legacy `clear-capacity.*` storage keys and `com.clearcapacity.desktop` may protect state or installs. Rename only with migration, compatibility tests, and rollback.
- **Synthetic public evidence.** Screenshots, videos, fixtures, examples, and public reports use synthetic data only.

Read `docs/PRIVACY.md` before changing capture, persistence, exports, prompts, providers, screenshots, telemetry, retention, or audit behavior.

## Judge-facing golden path

Protect and smoke-test this synthetic-data story:

1. Launch the weekly-capacity experience and understand planned, reactive, fragmented, and carryover load.
2. Inspect why the capacity result exists; review or correct inferred work and see the model respond.
3. Ask the Agent a grounded question and receive evidence-aware guidance rather than generic coaching.
4. Propose a useful action, require approval, execute it, and show the resulting state and audit evidence.
5. Demonstrate user control through pause, export, retention, privacy settings, flagged-capture review, or the audit trail.
6. Show a forward-looking payoff: a realistic commitment, a risk avoided, a forecast, or a measurable acceleration play.

The browser demo does **not** prove native capture, menu-bar behavior, macOS permissions, Tauri persistence, notifications, or native AI commands. Validate native claims in the desktop app.

## Architecture and repository map

**Stack:** Tauri 2 with a Rust menu-bar shell, React 18 + TypeScript, Vite 8, and shared TypeScript packages compiled in place.

- `apps/desktop/src/App.tsx` — top-level state and workflow composition.
- `apps/desktop/src/components/` — feature UI, shell, compact view, onboarding, and common components.
- `apps/desktop/src/hooks/` — capture, persistence, classification, review, forecast, narrative, alerts, and derived workflows.
- `apps/desktop/src/services/` — prompts/schemas, provider presets, local store, demo data, Agent tools, and persistence migrations.
- `apps/desktop/src/lib/` — pure helpers, audit, dates, formatting, motion, constants, and shared UI types.
- `apps/desktop/src/styles.css` — Geist tokens, themes, component styling, and motion vocabulary.
- `apps/desktop/src-tauri/src/lib.rs` — Tauri commands, macOS capture, AI/network boundary, and window behavior.
- `apps/desktop/src-tauri/tauri.conf.json` and `capabilities/default.json` — desktop config and permissions.
- `packages/domain/src/` — models and taxonomy.
- `packages/inference/src/` — sessionization, capacity, forecasts/calibration, AI usage, acceleration, and realized savings.
- `packages/integrations/src/` — Outlook `.ics`, chat metadata/call dedup, git-log, usage CSV/pricing, and generic imports.
- `docs/PRIVACY.md` — data-flow truth. `docs/BUILD_WEEK_2026.md` — provenance truth.

Shared packages use relative imports; TypeScript/Vite compile them through root include globs. There is no separate package build.

### State ownership and data flow

`App.tsx` is the frontend source of truth. It composes hooks and passes state/actions through `ScreenRouter`. `services/localStore.ts` persists through Tauri Store, with browser storage in web/demo mode. Trace ownership before adding parallel state, duplicate persistence, or competing derivations.

```text
capture → sessionize → classify → review → model → summarize/act → learn
```

- Native samples and local imports become source-attributed sessions and `WorkBlock[]`.
- User confirmations, relabels, annotations, and exclusions become durable `UserCorrection` records.
- Deterministic inference produces capacity, risk, trends, forecasts, usage insights, and acceleration signals.
- Narratives, Agent answers, forecasts, and plays turn reviewed evidence into decisions; actions stay approval-gated.
- Forecast accuracy, corrections, acted-on plays, and realized savings support future personal baselines.

### Product surfaces

- **Today** (`daily`): review queue and optional Review Copilot.
- **Week** (`weekly`, `forecast`, `usage`, `narrative`): Capacity, Forecast, AI Usage, and Summary.
- **Agent** (`agent`, `accelerate`, `skills`): Ask, Accelerate, and Skills Library.
- **History** (`ledger`, `audit`, `sensitive`): Activity, Audit, and conditional Flagged Captures.
- **Settings** (`setup`): sources, data control, AI assistance/usage, notifications, retention, export/reset, and walkthrough.
- **Compact:** menu-bar quick view, pause/control state, and proactive alerts.

### Cross-cutting change map

| Change | Inspect together |
| --- | --- |
| Domain/persisted shape | models, local-store parsing/migration, hooks, exports, demo data, audit, UI, privacy |
| Capacity/acceleration logic | inference, evidence labels, UI explanation, history/trends, fixtures, claims |
| Prompt/schema | prompt + schema, hook, native/generic path, provider capability, parsing, audit/usage |
| Screen/navigation | `lib/types.ts`, `lib/ui.ts`, router, shell, deep links/demo query, onboarding |
| Native command/permission | Rust, invoke boundary, capabilities/config, privacy, error UX, Cargo check |
| Model/provider default | official docs, presets, `.env.example`, migrations, pricing, settings copy, docs |
| Storage key/bundle ID | migration, rollback, install/state compatibility, installer/docs |
| Dev-server port | `vite.config.ts` and Tauri config together |

## Working method

1. **Orient.** Read relevant source, nearby types, UI path, and docs. Search consumers before changing models, persistence, audit sources, prompts, commands, screen IDs, or identifiers.
2. **Define the outcome.** State user/judge-visible behavior and falsifiable acceptance evidence before coding.
3. **Plan cross-cutting work.** Use Plan mode or an explicit Absoloop mission contract for privacy, migrations, architecture, TypeScript/Rust boundaries, or submission claims.
4. **Build the smallest coherent slice.** Include loading, empty, error, persistence, audit, accessibility, and documentation implications.
5. **Prefer reversible assumptions.** Escalate only when a choice may expose data, destroy state, change the thesis, or create a material public claim.
6. **Inspect the real experience.** Run the relevant web/desktop path and review hierarchy, copy, interaction, failure, accessibility, and data truth—not only the diff.
7. **Report evidence.** Summarize behavior, value, privacy impact, exact checks/statuses, remaining limitations, and separated follow-up.

Do not leave TODO-only judge paths, fake success states, placeholder integrations, dead controls, or claims unsupported by running behavior.

## AI and OpenAI boundaries

Use current official OpenAI documentation for model IDs, Codex, the Responses API, structured outputs, image input, data controls, and skills.

- Material Build Week work should use Codex with GPT-5.6 when selectable and retain public-safe task/session evidence required by `docs/BUILD_WEEK_2026.md`.
- Build provenance and Weekform's runtime model are separate decisions. Do not change the runtime default for hackathon optics.
- Provider presets live in `services/aiProviders.ts`; OpenAI, Grok, DeepSeek, and custom endpoints do not have capability parity.
- Native commands include `classify_active_window_sessions_with_openai`, `generate_review_copilot_suggestions_with_openai`, `generate_forecast_agent_with_openai`, `generate_weekly_narrative_with_openai`, `capture_visual_context_with_openai`, `chat_with_agent`, `ai_complete`, and `test_ai_connection`. Update matching prompts, schemas, hooks, audit/usage behavior, and Rust boundaries together; acceleration synthesis uses the generic completion path.
- Native classification, review, forecast, narrative, acceleration synthesis, and Visual Context use Tauri/Rust-mediated paths. The conversational Agent can use the Vercel AI SDK directly in the webview so tools can close over live state, with a Rust fallback. Never claim credentials categorically cannot reach frontend runtime code.
- Respect checks such as `providerSupportsGeneration`; `/models` success does not prove Responses or structured-output support.
- Minimize prompts and sensitive context. Validate schemas, enums, bounds, IDs, dates, evidence references, and missing fields before state changes.
- Preserve `store: false` for OpenAI requests where supported and document provider-processing or retention changes.
- Startup overrides are `OPENAI_API_KEY`, `OPENAI_MODEL`, and `OPENAI_VISION_MODEL`, loaded by Tauri/`dotenvy`; runtime Settings can expose the configured key to the running Agent webview. Describe this boundary exactly.
- For runtime default changes, verify official IDs and update presets, `.env.example`, pricing, UI copy, migrations, and docs. Copied `.env.example` values are overrides, not necessarily the in-app default.
- `FIRECRAWL_API_KEY` is maintainer-only for `npm run pricing:refresh`; never bundle or commit it.

Never log or commit API keys, real window titles, calendar details, screenshots, raw private prompts, sensitive local paths, or company/customer data.

## Privacy and trust constraints

- **Window titles are sensitive.** Do not log them or send them over the network without an explicit, documented workflow and user consent.
- **Visual Context is opt-in and rate-limited.** It may capture the full current screen; flagged insights belong in the review queue. Temporary-file deletion is best effort, not a guarantee.
- **Chat imports are metadata-only.** Do not expand into message-body ingestion without explicit product/privacy approval.
- **Persistence is local but unencrypted.** Do not describe it as encrypted, zero-risk, or suitable for regulated data.
- **Retention is user-controlled.** New raw/derived data must participate in retention, export, and reset behavior as appropriate.
- **Audit the meaningful edge.** Collection, sharing, correction, generation, policy, and consequential action events need truthful audit semantics.
- **No hidden telemetry.** Do not add analytics, crash uploads, remote logs, or background network behavior without explicit approval and documentation.

## UX and design bar

- Use existing Geist tokens, typography, motion vocabulary, and `lucide-react`; do not create a parallel design system.
- A first-time user should understand the value before learning the architecture.
- Prefer progressive disclosure: lead with the decision, then expose evidence, confidence, assumptions, and audit detail.
- Motion must clarify feedback, state, or spatial continuity—not decorate charts or slow frequent actions.
- Preserve keyboard access, visible focus, semantic labels, screen-reader announcements, contrast, zoom/resizing, and reduced-motion behavior.
- When affected, test light/dark themes, minimum window size `1024×720`, normal desktop mode, and compact menu-bar mode.
- Make empty, loading, offline/provider, permission-denied, parse-error, partial-data, and destructive states deliberate.
- Keep terminology consistent across Capacity, Forecast, Agent, Summary, and Audit. Do not use “free time” for reliable new-work capacity.
- Use synthetic data for screenshots, recordings, fixtures, and public examples.

For motion work, use `$find-animation-opportunities`, `$improve-animations`, or `$review-animations`. Do not refer to nonexistent `/validate` or `/verify` skills.

## Absoloop acceleration and reciprocal dogfooding

**Absoloop** (CLI `absoloop`; upstream `BLERBZ/absoloop`) is preferred for material bounded missions when its setup cost is justified. It adds isolated worktrees, deterministic gates, provider-native Codex sessions, criticism, resume/reporting, and human apply/approval. Use it to shorten Weekform's evidence loop—not create a second hackathon project.

### Guardrails and mode selection

- Through submission, keep at least **80% of execution capacity** on judge-visible Weekform value and release reliability.
- Upgrade Absoloop during the hackathon only for safety/correctness, to unblock Weekform, or for a measured payoff greater than its cost before the deadline. Log the rest.
- Never mix Weekform and Absoloop edits in one mission, worktree, branch, patch, commit, or PR.
- Never patch the live orchestrator from a recoverable Weekform run. Finish/recover, record the run ID and symptom, then reproduce in a separate checkout.
- A known-good Absoloop may orchestrate a separate Absoloop source checkout. Never nest loops or replace the live orchestrator with candidate code.

| Work shape | Path |
| --- | --- |
| Tiny mechanical or one-file edit | Direct Codex; avoid orchestration overhead. |
| Material coherent Weekform slice | `absoloop run --provider codex` with `edit`. |
| Privacy, persistence, migration, security, native, or release-critical | `absoloop review --implementer codex --reviewer <different-provider>`; otherwise use a separate read-only review and describe it accurately. |
| Multiple plausible implementations with identical evidence | `absoloop build --strategy race`. |
| High-ambiguity architecture | `absoloop build --strategy council`, sparingly. |
| Long repair needing checkpoint/reject/resume/UI dogfood | Review Mission Briefing, then `absoloop "…" --zcomb`. |

Codex remains the implementer for material Build Week work when GPT-5.6 is selectable. Other providers may review but do not replace Codex provenance. Inspect installed model selection and official docs rather than freezing an Absoloop model ID here.

### Preflight and Weekform gates

```bash
command -v absoloop
absoloop doctor
absoloop providers
absoloop config
git status --short
```

Run these before first use and after upgrades. Inspect current Absoloop HEAD rather than remembered behavior. Worktrees start from committed state and omit unrelated uncommitted edits. Prove one candidate resolves dependencies before race/council. Never copy `.env`, credentials, or real user data into worktrees. Default to `edit`; `full` requires explicit approval. Keep raw `.absoloop/` artifacts out of public commits.

Absoloop's stock Python test gate is invalid for Weekform. Create or verify project `absoloop.toml`:

```toml
[permissions]
default_profile = "edit"

[gates]
required = ["build"]

[gates.commands]
build = "npm run build"
rust = "cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml"
audit = "npm audit --audit-level=moderate"
```

Use `build` for UI/TypeScript; add `rust` for native boundaries and `audit` for dependencies, installer, release, or submission. Blank/missing required commands are skipped, so inspect the manifest and gate log. Green means every expected gate appears with exit code `0`. Never weaken a gate to pick a candidate. After apply, rerun direct Weekform validation and the affected golden path.

### Mission contract and reciprocal learning

One mission produces one reviewable outcome:

```text
Objective: <single user-visible or reliability outcome>
Decision/user value: <what becomes clearer, safer, faster, or more reliable>
Judge-visible proof: <what a first-time judge can observe>
In scope / out of scope: <precise boundaries>
Non-negotiables: privacy, approval, audit, compatibility, synthetic data only
Acceptance evidence:
1. <deterministic command and expected result>
2. <manual UI/native path and observable result>
3. <migration/privacy/accessibility evidence if applicable>
Delivery: minimal patch; no secrets, raw logs, unrelated refactors, or unsupported claims
```

Builder prose is not evidence. Close by inspecting `absoloop inspect <run-id>`, the selected diff, gates, reviewer findings, and failures; apply only the intended candidate; rerun direct checks/manual UX; retain run/strategy/session IDs and a public-safe outcome. Never publish raw prompts, events, paths, or private cost details.

After substantial runs, record time to first useful diff/green, wall time, resumes, available usage/cost, gate/reviewer failures, interventions, outcome, and recovery friction. Do not fabricate missing data.

```text
leverage = frequency × time_lost × failure_or_decision_risk × cross_project_reuse
           / implementation_cost
```

Require two observations for ordinary friction; one for data loss, secret exposure, false-green gates, unsafe apply/approval, or unrecoverable cancellation. Compare three similar missions before changing defaults or claiming speedup.

Recheck upstream before pursuing: delivery readiness distinct from task progress; clearer Briefing acceptance/gates/risk/budgets; evidence-based run comparison; ZComb accessibility/responsiveness/action feedback; and streaming only when measured polling staleness justifies it.

Absoloop upgrades go to a separate clone/fork and PR. Preserve gates → critic → human gate, one writer per worktree, auth isolation, fail-closed permissions, shell/prompt separation, redaction, stdlib-only core/runner, and compatibility coverage. Add regression tests and run:

```bash
python3 -m unittest discover -s tests -v
```

For ZComb also run `npm ci && npm run build` in `zcomb/monitor`. State sanitized dogfood evidence, root cause, before/after measure, compatibility impact, and exact checks. Never generalize from one run.

## Development and validation

Clean setup:

```bash
npm ci
cp .env.example .env
```

Common loops:

```bash
npm run dev          # web UI at 127.0.0.1:5173; no native capture/menu-bar commands
npm run demo         # synthetic weekly-capacity demo
npm run desktop:dev  # full Tauri app; preferred for native feature work
```

Every code change:

```bash
npm run build
```

`npm run build` is the authoritative TypeScript/bundle gate and includes `npm run pricing:check`.

Rust, Tauri, native permission, or Cargo changes:

```bash
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Dependency/lockfile changes and every pre-PR/submission check:

```bash
npm audit --audit-level=moderate
```

Before release or final submission:

```bash
CARGO_BUILD_JOBS=2 npm run desktop:build
```

Run `npm run demo`, smoke-test the golden path, stop the server, and validate native behavior touched. Weekform has no automated test or lint script; never invent `npm test`, `npm run lint`, `/validate`, or `/verify` results. Add focused tests only with a reliable harness.

`.codex/hooks.json` runs `npm run build 2>/dev/null || true` on stop. It suppresses failure, so it is advisory—not validation evidence. Run the command directly and inspect its exit status.

Known operational gotchas:

- Port `5173` is coupled between `vite.config.ts` and `apps/desktop/src-tauri/tauri.conf.json`; change both or neither.
- Desktop scripts default `DEVELOPER_DIR` to `/Library/Developer/CommandLineTools` unless explicitly overridden.
- Demo mode uses synthetic state and cannot validate native functionality.
- Prototype state is local but unencrypted; reset/export/retention behavior must remain coherent.
- Outlook is manual `.ics` import; provider OAuth paths are stubs unless explicitly completed.
- Shared-package edits compile in place and must satisfy the root TypeScript build.
- Large React/Rust modules need decomposition, but avoid broad refactors without user-visible or reliability payoff and regression evidence.

## Build Week evidence and public claims

`docs/BUILD_WEEK_2026.md` is the provenance source of truth. Weekform predates Build Week; never imply the inherited core was created during July 13–21.

For each material in-period change:

- record the date, user-visible outcome, and concrete public evidence;
- distinguish Codex/GPT-5.6 acceleration from the human product/design decision;
- identify Absoloop as build-process orchestration, not a Weekform feature, unless a separately approved user-facing integration actually ships;
- keep Weekform product work and Absoloop tool contributions distinct in claims, commits, screenshots, and evidence;
- update the README collaboration narrative only when the change materially strengthens the submission;
- keep the primary `/feedback` session value stable unless the maintainer explicitly changes it;
- use synthetic/public-safe screenshots and examples;
- never publish raw Codex/Absoloop logs, private prompts, secrets, sensitive paths, or unverifiable superlatives.

Prefer precise claims such as “reduced a three-step review flow to one approval-gated action” or “three comparable runs reached the build gate with two fewer human interventions” over “revolutionary,” “fully private,” or an unsupported speed multiplier.

## Repository conventions and instruction hygiene

- `README.md` is the public product story and Build Week collaboration record.
- `docs/PRIVACY.md` is the data-flow truth.
- `docs/BUILD_WEEK_2026.md` is the provenance/evidence truth.
- `design.md` and `styles.css` define the design vocabulary.
- `CONTRIBUTING.md` defines contribution and disclosure expectations.
- Match the surrounding short, imperative commit-message style. Keep one coherent outcome per commit when practical.

Codex discovers skills under `.agents/skills/` and loads full `SKILL.md` instructions only when relevant. Use `$skill-name` or the skill picker. Add skills only for repeatable conditional workflows with narrow names, trigger-rich descriptions, clear inputs/outputs, and safety boundaries.

After the Absoloop workflow has succeeded twice without material correction, move its detailed command recipe and templates into `.agents/skills/absoloop-hackathon/SKILL.md`; retain only strategy, safety, and evidence rules here. Do not duplicate upstream manuals in root context.

Keep this root file below Codex's project-instruction budget. Move layer-specific procedures into nested instructions, a skill, or a focused doc; remove stale guidance instead of accumulating exceptions.

## Definition of done

A Weekform change is done only when:

- the real user path works and improves a defined workload decision or reliability outcome;
- privacy, consent, approval, audit, persistence, retention, export, and compatibility implications are handled;
- relevant direct checks pass with inspected exit statuses;
- judge-visible UI and affected native behavior are manually reviewed;
- evidence, uncertainty, empty/error states, accessibility, and copy are coherent;
- docs and Build Week provenance are current where material;
- no unrelated scope, sensitive data, dead code, fake success, or unsupported claim was introduced.

When Absoloop was used, “done” additionally requires that the intended candidate—not merely the top-ranked one—was inspected and deliberately applied; every expected gate actually ran; direct Weekform validation passed after apply; the human acceptance boundary was preserved; the run ID and public-safe outcome were retained; and any discovered Absoloop issue was either logged with evidence or implemented separately with its own tests and review.
