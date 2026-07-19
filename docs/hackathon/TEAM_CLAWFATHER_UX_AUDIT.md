# Team Clawfather — UX State Audit (Prompt 14, Step 1)

**Date:** 2026-07-19
**Scope:** Read-only inventory of every empty state, loading/in-flight state, error state, and destructive-action confirmation across `apps/desktop/src` (all screens/components) and `apps/web/app` + `apps/web/components` (all routes). Per surface it also records sharing-state terminology, provenance microcopy for consent-derived numbers (target shared phrasing: "from N teammates' approved snapshots"), and accessibility gaps tied to the inventoried states. No source files were edited. This document is the audit-first gate required by runbook PT2 Prompt 14; the fix pass executes the "fix" rows below.

**State types:** empty · loading · error · destructive · terminology · provenance.

| # | App | Screen/Route | State type | Current behavior | Verdict (keep/fix) | Fix note |
|---|-----|--------------|------------|------------------|--------------------|----------|
| 1 | Desktop | Ledger (LedgerScreen) | empty | "No work blocks yet." + import/classify CTA via shared `EmptyState` (labeled section) | keep | — |
| 2 | Desktop | Ledger (LedgerScreen) | empty | Search miss: "No blocks match." + "Clear search" action | keep | — |
| 3 | Desktop | Ledger / ActivityCapturePanel | loading | Classify button "Classifying…", `disabled` + `aria-busy`; progress notes ("Sending N ready session(s)…", visual-context deriving) are plain `<p>` with no live region | fix | Wrap classify/visual progress notes in `role="status"` so SR users hear in-flight state |
| 4 | Desktop | Ledger / ActivityCapturePanel | error | capture/classification/visual errors via `InlineError` (`role="alert"`, retry) ; capture pill "Capture error" is tone class + text | keep | — |
| 5 | Desktop | Ledger / BlockCard | error | Invalid time range: sr-only `role="alert"` "End time must be after start time" + error class; inputs lack `aria-invalid` | fix | Add `aria-invalid` to the start/end time inputs while `timeError` is set |
| 6 | Desktop | Ledger / BlockCard, CompactWidget | destructive | Confirm/Exclude fire immediately, no dialog (relabels are audit-logged and revertible via Undo/ledger) | keep | Acceptable: reversible, high-frequency review action |
| 7 | Desktop | Daily Review | empty | "Your review queue is empty." + import CTA; and "Everything is confirmed." celebration state | keep | — |
| 8 | Desktop | Daily Review | loading | "Suggest cleanup" → "Thinking…" `aria-busy`; progress bar `role="progressbar"` + `role="status"` count | keep | — |
| 9 | Desktop | Daily Review / ReviewCopilotPanel | loading | Copilot skeleton (3 items) has no `aria-busy`/live region | fix | Give the skeleton container `role="status"` + visually-hidden "Generating suggestions…" |
| 10 | Desktop | Daily Review / ReviewCopilotPanel | error | `InlineError` with retry (`role="alert"`) | keep | — |
| 11 | Desktop | Week (WeeklyCapacityScreen) | empty | "No weekly capacity model yet." + import CTA; past week: "No work blocks for {range}."; breakdown "No allocated work to break down." | keep | — |
| 12 | Desktop | Forecast (ForecastScreen) | empty | "Nothing to forecast." + import CTA | keep | — |
| 13 | Desktop | Forecast / ForecastAgentPanel | empty | "No AI forecast yet." + deterministic estimate + Generate CTA | keep | — |
| 14 | Desktop | Forecast / ForecastAgentPanel | loading | Button "Forecasting…" `disabled` + `aria-busy`; skeleton block has no live region/`aria-busy` | fix | Add `role="status"` (or `aria-busy` on region) to the generating skeleton |
| 15 | Desktop | Forecast / ForecastAgentPanel | error | `InlineError` with retry (`role="alert"`); accuracy panel `role="status"`, rating text not color-only | keep | — |
| 16 | Desktop | Narrative (NarrativeScreen) | empty | "Narrative generation is waiting." (no evidence) and "Ready to generate." (evidence, no run) — both explain what happens next and what is sent to the provider | keep | — |
| 17 | Desktop | Narrative (NarrativeScreen) | loading | Header "Generating your narrative…", button `aria-busy`; skeleton not announced (no live region) | fix | Add `role="status"` to the generating skeleton |
| 18 | Desktop | Narrative (NarrativeScreen) | error | `InlineError` with retry (`role="alert"`) in both views | keep | — |
| 19 | Desktop | Agent (AgentScreen) | empty | Starter "Common questions" + grounding note; "No tracked work yet — import a calendar or resume tracking…"; signal pill "Waiting for signal · {week}" | keep | — |
| 20 | Desktop | Agent (AgentScreen) | loading | "Reading your tracked context…", progress `role="status"` steps, sr-only polite region announces settled reply, action card `aria-live="polite"` | keep | — |
| 21 | Desktop | Agent (AgentScreen) | error | Errors render as assistant chat bubbles ("Sorry, the Agent hit an error…", stream-interrupt) with Retry, but no `role="alert"`; only polite announcement | fix | Announce agent failures assertively (wrap the error bubble content in `role="alert"`) |
| 22 | Desktop | Agent (AgentScreen) | destructive | Clear conversation → `ConfirmDialog` ("Clear this conversation?… can't be undone", focus-trapped `alertdialog`) | keep | — |
| 23 | Desktop | Accelerate (AccelerationScreen) | empty | "Nothing high-impact to accelerate yet." (two-branch description) and "You've dismissed every play." + Restore action | keep | — |
| 24 | Desktop | Accelerate (AccelerationScreen) | loading | Generate Skills → "Authoring Skills…", `disabled` + `aria-busy`, animated mark | keep | — |
| 25 | Desktop | Accelerate (AccelerationScreen) | error | `InlineError` with retry (`role="alert"`) | keep | — |
| 26 | Desktop | Accelerate (AccelerationScreen) | destructive | Dismiss play: immediate, but restorable via "Restore dismissed plays" | keep | Reversible by design |
| 27 | Desktop | Skills Library (SkillsLibraryScreen) | empty | "Your skills library is empty." + browse-plays CTA | keep | — |
| 28 | Desktop | Skills Library (SkillsLibraryScreen) | destructive | Remove skill: immediate, toast only, no confirm and no undo (saved snapshot is lost; plays may have regenerated) | fix | Add `ConfirmDialog` (or an Undo toast action) for skill removal |
| 29 | Desktop | Usage (UsageScreen) | empty | "Nothing measured yet." (two-branch description) + Open Settings CTA; per-model "No usage recorded in {week} yet." | keep | — |
| 30 | Desktop | Audit Log (AuditLogScreen) | empty | "No audit events yet."; filter miss "No events match." + Clear filters; receipts "No consent receipts yet. Nothing has been shared to Weekform Cloud from this device." | keep | — |
| 31 | Desktop | Audit Log (AuditLogScreen) | terminology | Receipts: "Week {id} shared at the '{level}' level with team {id}", "Automatic sync / Manual sync", "N shared fields" | keep | Matches canonical send-side vocabulary |
| 32 | Desktop | Sensitive Review (SensitiveReviewScreen) | empty | "No flagged captures." | keep | — |
| 33 | Desktop | Sensitive Review (SensitiveReviewScreen) | destructive | Discard capture → `ConfirmDialog` ("permanently removes… recorded in your audit history. It can't be undone.") + exemplary post-discard focus management | keep | — |
| 34 | Desktop | Settings (SetupScreen) | empty | Inline statuses: "Not imported yet", "Nothing imported", "Nothing to export yet" | keep | — |
| 35 | Desktop | Settings (SetupScreen) | loading | Test Connection → "Testing…" spinner, `disabled` + `aria-busy`; Save → "Saved" | keep | — |
| 36 | Desktop | Settings (SetupScreen) | error | Import failures (`captureError`, `importError`, `chatImportError`, `usageImportError`) render as `<small class="import-error">` with **no role/live region** — color+text only, never announced | fix | Route through `InlineError` or add `role="alert"` |
| 37 | Desktop | Settings (SetupScreen) | error | Provider status region is `role="status"` `aria-live="polite"` even for error-tone messages ("API key, base URL, and model are required.") | fix | Error-tone messages should render with `role="alert"`; keep polite for success/info |
| 38 | Desktop | Settings (SetupScreen) | destructive | Reset all local data → `ConfirmDialog` ("Reset all local data?… can't be undone", itemized loss list, "Export my data first" escape hatch) | keep | — |
| 39 | Desktop | App.tsx (native menu) | destructive | Menu event `clear-capacity:reset-local-data` calls `resetLocalData()` **directly, bypassing the ConfirmDialog** used by Settings | fix | Route the menu path through the same confirmation (open Settings confirm state) |
| 40 | Desktop | Settings / CloudAccountPanel | empty | "Weekform Cloud is not configured in this build" / "Local only"; "No team selected"; "No active memberships found"; "Empty list shares no project names" | keep | — |
| 41 | Desktop | Settings / CloudAccountPanel | loading | "Signing in…" / "Syncing…" with spinners and `aria-busy` on sign-in, sync, delete buttons | keep | — |
| 42 | Desktop | Settings / CloudAccountPanel | error | `authError`, `teamsError`, `syncState.lastError` all `role="alert"` | keep | — |
| 43 | Desktop | Settings / CloudAccountPanel | terminology | Sync status: "Syncing…" / "Up to date" / "Last attempt failed" / "Not synced yet"; "Last success {t}", "No successful sync yet". Plain `<strong>`, no live region, and **desktop never surfaces the staleness of the last-shared snapshot** (web calls >7d "Stale") | fix | Add `role="status"` to the sync-status block; surface canonical freshness ("Synced within the last day/week", "Stale — older than 7 days") for the last-shared snapshot so both apps speak the same staleness language |
| 44 | Desktop | Settings / CloudAccountPanel | destructive | Delete My Snapshots → `ConfirmDialog` ("Delete your synced snapshots?… Local data is untouched.", confirm "Delete from cloud") | keep | — |
| 45 | Desktop | Settings / CloudAccountPanel | destructive | First sync → `ConfirmDialog` consent gate ("Share this snapshot with your team?", never-sent list); later syncs skip it | keep | — |
| 46 | Desktop | Settings / CloudAccountPanel | destructive | **Disconnect (sign out) fires immediately** — no confirmation, though it "stops all future syncs" | fix | Add a `ConfirmDialog` consistent with Delete/first-sync |
| 47 | Desktop | Settings / CloudAccountPanel + SharePreview | provenance | Send-side wording: "Consent recorded {time}. Changing the team or the shared fields asks you to review again."; "A metric that is off is omitted from the payload entirely — never sent as zero."; SharePreview shows the exact payload; blocked preview is `role="note"` | keep | Canonical send-side consent language; blocked state is informational, not an error |
| 48 | Desktop | Settings / ModelPricingPanel | empty | "No model prices configured" + catalog CTA; catalog search miss "No catalog models match that search." | keep | — |
| 49 | Desktop | Settings / ModelPricingPanel | error | Per-field errors with `aria-invalid` + `aria-describedby`; footer summary `role="status"` polite ("N field(s) need attention.") | keep | Polite summary acceptable for form validation |
| 50 | Desktop | Settings / ModelPricingPanel | destructive | Remove price row: immediate, no confirm, but focus moved to sibling row; low-stakes config value | keep | — |
| 51 | Desktop | Common / ToastHost | error | Host is `role="status"` `aria-live="polite"` for **all** tones; error toasts announce politely; tone icon `aria-hidden`, so tone itself is icon/color-only | fix | Split an assertive `role="alert"` live region for error-tone toasts; add sr-only tone prefix ("Error:") |
| 52 | Desktop | Compact widget (CompactWidget) | empty | "Waiting for activity" / "Tracking paused"; "Needs signal" capacity; "You're all caught up" review state | keep | — |
| 53 | Desktop | Compact widget (CompactWidget) | error | Proactive alert `role="alert"` with severity class + text + labeled dismiss | keep | — |
| 54 | Desktop | Shell (AppShell / AppToolbar) | empty | Capacity "—" + "Needs signal"; sr-only review-count text; `aria-current` nav | keep | — |
| 55 | Desktop | Onboarding (WalkthroughOverlay / OnboardingCard) | loading | Modal walkthrough: full dialog a11y (focus trap, restore, `aria-modal`); onboarding checklist `role="progressbar"` + sr-only step state | keep | — |
| 56 | Web | / (landing) | terminology | "Approved sharing"; "Sharing is off by default"; omitted metrics "show as 'Not shared,' never as zero"; "each individually consented, each revocable" | keep | Canonical marketing statement of the vocabulary |
| 57 | Web | /login | error | Unconfigured + query errors `role="alert"`; notice `role="status"`; labeled inputs | keep | — |
| 58 | Web | /login, /signup | loading | **No in-flight state on submit** — server-action forms with no `useFormStatus`/pending label; double-submit possible | fix | Add pending submit state ("Signing in…" / "Creating account…") via `useFormStatus` |
| 59 | Web | /signup | error | Unconfigured + query errors `role="alert"`; hints visible but not `aria-describedby`-linked | keep | Hint association optional polish |
| 60 | Web | /auth/error | error | "Something went wrong signing you in" + reason in `role="alert"`; recovery links | keep | — |
| 61 | Web | /not-found | empty | "Page not found" + home link | keep | — |
| 62 | Web | /dashboard (loading.tsx) | loading | Route skeleton with `aria-busy="true"` + `aria-label="Loading dashboard"` | keep | — |
| 63 | Web | /dashboard (error.tsx) | error | `role="alert"` panel, "Your data was not changed", Try again reset | keep | — |
| 64 | Web | /dashboard | empty | "You're not part of a team yet" (teams optional); "You're not sharing anything with anyone…" ; per-team "Not sharing" badge + "Nothing is shared automatically."; orphan "A team you left" card | keep | — |
| 65 | Web | /dashboard | error | teamsError/snapshotsError/team_error all `role="alert"`; notices `role="status"` | keep | — |
| 66 | Web | /dashboard, /download, /teams/[teamId], /briefing | error | "Supabase is not configured" / no-access `error-panel` blocks have **no `role="alert"`** (unlike sibling error panels) | fix | Add `role="alert"` to unconfigured/no-access error panels on all four routes |
| 67 | Web | /dashboard | destructive | **"Delete my cloud history" submits immediately** — no confirmation step for a permanent cloud delete (also on orphan cards) | fix | Add a client confirm step (dialog or two-step button) before submit |
| 68 | Web | /dashboard, /teams/[teamId] | destructive | **"Leave team" submits immediately** — no confirmation; consequences only explained in nearby prose | fix | Add confirm step reusing the same treatment as row 67 |
| 69 | Web | /dashboard, /teams/[teamId] | loading | Destructive/mutating forms (delete history, leave team, save share policy, create team) have no pending state | fix | Add `useFormStatus` pending labels + disabled while submitting |
| 70 | Web | /download | error | `?error=artifact` → `role="alert"` "The download link could not be created" + retry guidance | keep | — |
| 71 | Web | /invite | error | Unconfigured / query error / malformed token all `role="alert"`; token input labeled | keep | — |
| 72 | Web | /invite | destructive | "Sign out and use a different email" signs out immediately, no confirm, no pending state | fix | Add confirm-or-pending treatment (grouped with rows 58/69 fix batch) |
| 73 | Web | /teams/[teamId] (loading.tsx) | loading | Route skeleton `aria-busy` + `aria-label="Loading team"` | keep | — |
| 74 | Web | /teams/[teamId] (error.tsx) | error | `role="alert"` panel + Try again reset | keep | — |
| 75 | Web | /teams/[teamId] | empty | Identical "Team unavailable / You don't have access" for nonexistent and non-member (RLS-honest); member view "You haven't shared a workload snapshot with this team yet. Nothing is shared automatically." | keep | — |
| 76 | Web | /teams/[teamId] (manager) | empty | Workload "No member has shared a workload snapshot yet…"; trend "No week-over-week history yet…"; forecast "no-history" and "Insufficient shared data: only N of M…"; roster "No active members yet."; per-member "No shared snapshot yet… absence of data says nothing about this member's workload."; invites "No invites sent yet." — all state what happens next, none render zeros | keep | — |
| 77 | Web | /teams/[teamId] (manager) | error | Nine section-level load errors, each `role="alert"` with "Reload the page to try again." | keep | — |
| 78 | Web | /teams/[teamId] | terminology | Member states: share level ("Summary metrics/+ categories/+ projects") + `FreshnessBadge` ("Synced within the last day/week", "Stale — older than 7 days", "Sync time unknown"); member badge "Not sharing"; per-metric value "Not shared"; exclusion copy "Stale (N) and unknown (N) members are excluded, never counted as zero."; invites "Pending/Expired/Accepted" | keep | This is the canonical vocabulary (see Fix batch); desktop must converge on it (row 43) |
| 79 | Web | /teams/[teamId] | provenance | Varied phrasings for consent-derived numbers: "Median of {n} of {m} sharing · range …", "N of M members with current shared data", "Each number is a consented, member-reviewed summary from Weekform for Mac", "from consented shared snapshots only", "from the first consented shared week" — the target phrasing "from N teammates' approved snapshots" appears **nowhere verbatim** | fix | Standardize every consent-derived aggregate's provenance line on "from N teammates' approved snapshots" (coverage form: "from N of M teammates' approved snapshots"); keep the never-zero clauses |
| 80 | Web | /teams/[teamId] / InviteForm | loading | Pending "Creating invite…", input disabled; error `role="alert"`; success link box `role="status"` with labeled read-only input and text "Copied" feedback | keep | — |
| 81 | Web | /teams/[teamId]/briefing | empty | Non-manager/no-access explainer; in-result "No risks were raised." / "No coordination opportunities were identified." / "No questions were suggested." | keep | — |
| 82 | Web | /teams/[teamId]/briefing / BriefingPanel | loading | Pending "Generating briefing…" disabled button; result region `aria-live="polite"` | keep | — |
| 83 | Web | /teams/[teamId]/briefing / BriefingPanel | error | Action errors (session expired, not a manager, load failure) `role="alert"` | keep | — |
| 84 | Web | /teams/[teamId]/briefing / BriefingPanel | provenance | `role="status"` notice: AI disclosure + "Generated with {model}" or "**Deterministic fallback:** {reason}"; "Evidence coverage" section; page copy "built only from metrics your team chose to share… nothing raw is ever included" | keep | Align its evidence-coverage sentence with row 79's canonical phrasing during the fix pass |
| 85 | Web | components/WorkloadSnapshot | terminology | `formatPct(null)` → literally "Not shared" (never 0%), muted class but text carries meaning; freshness badge text + tone class (not color-only); review coverage "No reviewable blocks yet" | keep | — |
| 86 | Web | components/SiteHeader | destructive | Sign out submits immediately (standard pattern, session-only, non-destructive to data) | keep | — |

## Fix batch

### (a) Desktop fixes (rows 3, 5, 9, 14, 17, 21, 28, 36, 37, 39, 43, 46, 51 — 13 rows)
- **Assertive errors:** SetupScreen import errors (36) and provider error tone (37), Agent error bubbles (21), and error-tone toasts (51) must reach `role="alert"`; success/info stays polite. `InlineError` remains the shared primitive.
- **Announced loading:** every skeleton/progress note gets `role="status"` — ActivityCapturePanel notes (3), ReviewCopilotPanel (9), ForecastAgentPanel (14), NarrativeScreen (17). Buttons keep `aria-busy` + label swap.
- **Confirmed destruction:** ConfirmDialog for Cloud Disconnect (46), Skills-library Remove (28) (or an Undo toast), and the native-menu reset path (39). ConfirmDialog stays the single confirm primitive.
- **State a11y:** `aria-invalid` on BlockCard time inputs during error (5).
- **Terminology convergence (43):** desktop adopts the web freshness vocabulary for shared snapshots ("Synced within the last day", "Synced within the last week", "Stale — older than 7 days", "Sync time unknown") and announces sync status via `role="status"`.

### (b) Web fixes (rows 58, 66, 67, 68, 69, 72, 79 — 7 rows)
- **In-flight states everywhere (58, 69, 72):** `useFormStatus` pending labels + disabled submit on login, signup, create team, leave team, delete cloud history, save share policy, invite switch-account.
- **Confirmed destruction (67, 68, 72):** confirmation step before "Delete my cloud history", "Leave team", and invite-page sign-out — mirroring desktop's ConfirmDialog copy pattern ("what happens, what is untouched, can/can't be undone").
- **Assertive errors (66):** `role="alert"` on unconfigured/no-access error panels (dashboard, download, team, briefing).
- **Provenance standardization (79, touches 84):** one shared phrasing for every consent-derived aggregate.

### Canonical terminology (both apps MUST use exactly these terms)
- **"Not shared"** — a metric omitted by consent. Rendered literally; never 0, never blank-as-zero.
- **"Not sharing"** — a member who currently shares no snapshot with the team.
- **Freshness of a shared snapshot:** "Synced within the last day" (fresh) · "Synced within the last week" (aging) · "Stale — older than 7 days" (stale) · "Sync time unknown" (unknown). "Stale" is the only word for >7-day data; stale/unknown are always *excluded, never counted as zero*.
- **Device sync status (desktop send side):** "Syncing…" · "Up to date" · "Not synced yet" · "Last attempt failed"; timestamps as "Last success {t}" / "last synced {t}".
- **Consent:** "Consent recorded {time}" (desktop record); consent-gated uploads are **"approved snapshots"** — retire "consented shared snapshots" / "consented, member-reviewed summary" variants in body copy where they name the data source of a number.
- **Provenance line (canonical):** "from N teammates' approved snapshots"; with coverage: "from N of M teammates' approved snapshots". Used verbatim wherever a rendered number derives from consented shares (team medians, ranges, trends, forecasts, scenarios, briefing evidence coverage).
- **Invite states:** "Pending" · "Expired" · "Accepted {date}".

## Fix-pass resolution (July 19, 2026)

The audit above was completed before source edits. The subsequent bounded fix pass
resolved every row marked `fix`; it added no product capability, dependency, layout
rewrite, or color-system change.

| Audit rows | Resolution evidence |
|---|---|
| 3, 9, 14, 17 | `ActivityCapturePanel.tsx`, `ReviewCopilotPanel.tsx`, `ForecastAgentPanel.tsx`, and `NarrativeScreen.tsx` now announce in-flight content with `role="status"`. |
| 5 | `BlockCard.tsx` exposes `aria-invalid` on both time inputs while the range is invalid. |
| 21, 36, 37, 51 | `AgentScreen.tsx`, `SetupScreen.tsx`, and `ToastHost.tsx` use assertive alert semantics for failures while success/info feedback remains polite. |
| 28, 39, 46 | `SkillsLibraryScreen.tsx` and `CloudAccountPanel.tsx` use `ConfirmDialog`; the native reset event now routes to Settings → Data Control and opens the existing reset confirmation. |
| 43 | `CloudAccountPanel.tsx` announces sync status and uses the canonical fresh/aging/stale/unknown wording. |
| 58, 69 | `FormSubmitButton.tsx` centralizes `useFormStatus`, disabled/`aria-busy`, and visible pending labels across login, signup, create-team, policy, invite, leave, and delete actions. |
| 66 | Dashboard, download, team, and briefing unconfigured/no-access panels now use `role="alert"`. |
| 67, 68, 72 | Cloud-history deletion, team leaving, and invite account-switch actions require confirmation before their server action runs. |
| 79, 84 | `approvedSnapshotProvenance` in `apps/web/lib/workload.ts` is the single canonical source for team aggregates, scenarios, trends, forecasts, and briefing evidence coverage; fixture tests pin its singular and coverage forms. |

Independent critic verdict: **PASS — 20/20 FIX rows resolved, no blocking issue.**
Final runnable gates: `npm run verify:wave3` exit 0 (97/97 desktop-cloud,
162/162 web; 12 routes / 11 static pages) and `npm run build` exit 0.
`npm run audit:check` was attempted but the registry lookup was environment-
blocked (`ENOTFOUND registry.npmjs.org`); Prompt 14 changed no dependency, and
the last same-day successful audit remains 0 vulnerabilities in both
workspaces. The test scripts retain the same test globs and assertions but use
`node --import tsx --test`, avoiding the `tsx` CLI IPC socket that is forbidden
in the managed execution environment.
