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

### Supplemental submission-readiness task

The hackathon-readiness and provenance task is supplemental evidence:

- **Codex Session ID:** `019f75f1-73fc-7850-98a4-c23ec0aae893`
- **Task title:** `Prepare Weekform for Build Week`
- **Started:** July 18, 2026 at 11:56:26 AM EDT (15:56:26Z)
- **Model:** `gpt-5.6-sol`

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
