# Weekform production-readiness audit

**Evidence window:** July 20–21, 2026 (EDT)

**Repository baseline:** `main` at `aef4f59`, followed by the uncommitted remediation candidate described below

**Release recommendation:** **Do not ship**

Weekform's deterministic workload model and most local-first product paths have
substantial automated coverage, and this audit closed a meaningful set of race,
data-contract, request-boundary, authentication, accessibility, and release-gate
defects. The full public product is nevertheless not production-ready. The exact
Mac artifact has not completed Apple's trust chain, database migrations
`202607200009` and `202607200010` exist only in the local candidate, the password
recovery candidate is not deployed, live provider/authenticated multi-device
flows remain unproved, account deletion is absent, and the exact notarized,
hosted, clean-installed artifact has not been proved. The exact current source
candidate passed its expanded unified release gate after the lifecycle
follow-through below. That local result does not close the deployment,
external-service, and native-distribution boundaries.

This recommendation covers the combined Mac, Web, Supabase, and connector
release. It does not mean the currently deployed, fail-closed website baseline
was shown to be unavailable. It means the audited candidate cannot truthfully be
promoted as one complete production release yet.

## Scope and method

The audit traced user-controlled input, persisted state, asynchronous work, and
release evidence across:

- the React/Vite desktop workflow, review model, AI surfaces, accessibility, and
  browser demo;
- the Tauri/Rust collector, encrypted journal, Keychain, network calls, reset,
  and native lifecycle;
- the Next.js account, Individual, Team, Manager, invite, download, and API
  routes;
- Supabase schema, RLS/RPC boundaries, snapshot and replica payloads, migration
  rollout, and local pgTAP contracts;
- calendar and content-free Chat connectors;
- universal Mac packaging, Developer ID signing, notarization, stapling,
  Gatekeeper, hosted-byte integrity, and authenticated delivery;
- build, typecheck, package-audit, database, Rust, integration, accessibility,
  and release-script gates.

Methods included static ownership/data-flow review, adversarial input and
authorization review, async interleaving analysis, tests-first reproduction and
remediation, local database rebuild from zero, focused browser inspection at
desktop and 390-pixel widths, and read-only inspection of the live Web and Apple
release evidence. Repository checks, local runtime proof, hosted database state,
deployed Web behavior, packaged native behavior, and store/notarization state
are treated as separate evidence surfaces.

The audit did not use real workplace data. It did not deploy the candidate,
apply production migrations, change protected provider consoles, interrupt the
preserved Apple submission, or claim that local/browser checks prove
native permissions or live third-party behavior.

## Status vocabulary

- **Fixed and reverified** — present before this pass or repaired in the
  candidate, with relevant repository evidence observed.
- **Fixed locally** — repaired in the uncommitted candidate, but not deployed or
  accepted as production proof.
- **Mitigated; needs verification** — the risk is bounded or fails closed, but
  a live, packaged, migration, compatibility, or operator proof remains.
- **Blocked** — a required external or product capability is absent.
- **Accepted follow-up** — non-blocking for a limited internal candidate, but
  still tracked and not represented as complete.

### Completion accounting

The register contains 45 traceable entries. Some later entries materially
extend an earlier root cause, so this is an audit-entry count rather than a
claim of 45 unrelated defects.

| Final disposition | Critical | High | Medium | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fixed/reverified in source or the local candidate | 0 | 17 | 13 | 3 | **33** |
| Mitigated with a live rollout/compatibility dependency | 0 | 1 | 3 | 0 | **4** |
| Externally or product-decision blocked | 2 | 3 | 1 | 0 | **6** |
| Accepted bounded follow-up | 0 | 0 | 0 | 2 | **2** |
| **Total** | **2** | **21** | **17** | **5** | **45** |

The 33 locally fixed entries have one primary category each: security/auth/privacy
**6**; race condition/data integrity/reliability **14**; backend/database/test
coverage/release safety **4**; and accessibility/UX/responsive consistency **9**.
This does not turn a local fix into deployment, migration, provider, packaged,
or notarization proof.

## Capability matrix

### Entry points, roles, and ownership

| Capability | User entry point / roles | Frontend owner | Backend/service owner | Persistence or external dependency |
| --- | --- | --- | --- | --- |
| Capture and encrypted activity history | Mac toolbar, Compact, Activity, Settings / individual Mac user | `App.tsx`, `ActivityCapturePanel`, `useActiveWindow` | Tauri capture/journal commands | Encrypted journal; journal key in Keychain; macOS permissions |
| Review and deterministic capacity | Today and Week / individual | review screens, `useBlocksLedger`, capacity screens | `packages/inference` deterministic model | Local Store plus encrypted raw journal |
| Import, export, retention, Reset | Settings data controls / individual | `App.tsx`, Setup and source panels, `usePersistence` | local-store and Tauri export/journal commands | Store, Keychain, plaintext user-selected backup destination |
| AI connection and Codex plan | Settings and Agent / individual | Setup, Agent, six AI hooks | Tauri OpenAI/Codex commands; Agent provider path | Keychain or isolated Codex home; configured provider |
| Web authentication | `/login`, `/signup`, OAuth/magic callback / anonymous and authenticated users | auth pages and actions | Supabase Auth server/client boundaries | Supabase session and provider configuration |
| Password recovery | `/forgot-password`, `/reset-password` / signed-out account owner | recovery pages/actions | Supabase recovery/update-user flow | Email delivery and redirect allowlist |
| Account deletion | No complete entry point / authenticated owner | Missing | Missing privileged deletion orchestration | Supabase Auth, team ownership, cloud rows, retention policy |
| Private Individual Web replica | Mac Account & Sharing and Web `/app` / authenticated individual | `usePersonalCloudSync`, Personal workspace | replica/review RPCs and RLS | Keychain cloud session; Supabase replica/outbox rows |
| Team sharing and Manager Access | Mac Account/Team; Web `/teams/*` / member, manager, owner | cloud panels, Team and Manager workspaces | snapshot/actions RPCs and RLS | Supabase teams, snapshots, actions, invites |
| Cloud reset lifecycle | Settings Reset / signed-in Mac user | `App.tsx`, cloud account/aggregate/personal hooks | OAuth cancellation and cloud-store commands | Keychain session, local queues/policies, in-flight Supabase work |
| Web Agent, Team Briefing, Webex broker | Web `/app`, team briefing, broker API / authenticated member or manager | Personal Agent and briefing UI | bounded API routes and request-control RPCs | OpenAI/provider config, Supabase request controls, Webex |
| Calendar sources | Settings Data Sources / individual | Calendar panel and hook | native Calendar/Google/Microsoft commands | macOS Calendar or provider OAuth tokens in Keychain |
| Chat sources | Settings Data Sources / individual | Chat panel and hook | native Slack/Google Chat/Webex commands | provider OAuth tokens/cursors in Keychain; Webex broker |
| Simulation | explicit dev/demo query and Manager simulation / developer or synthetic demo user | simulation workspace | `packages/simulator` | Synthetic local fixtures only |
| Web navigation/accessibility | public routes, `/app`, Team / anonymous, member, manager, owner | Next layouts/workspaces and shared accessibility helpers | server route/auth loaders | Browser history, Supabase-rendered state |
| Web deployment | public/authenticated site / all Web roles; release operator | Next application | Vercel deployment and release validation | Vercel aliases/env; Supabase; private artifact storage |
| Universal Mac distribution | authenticated `/download` and installed app / account user; release operator | download UI and Tauri app | fail-closed publisher script | Developer ID, Apple notary, staple/Gatekeeper, private artifact bytes |
| Release gates | maintainer/operator | package scripts and reports | release validator, Supabase CLI, Cargo | npm registry, local DB, linked DB read, Vercel/Apple operator access |

### Readiness evidence

“Original status” records the state when the corresponding audit finding was
first established; it is not inferred from the final candidate.

| Capability | Original status | Repository/local evidence | Production/native evidence | Final status |
| --- | --- | --- | --- | --- |
| Local foreground capture and encrypted journal | **Partial / race-prone** | Serialized encrypted journal, bounded startup/retention, and pause/commit lifecycle tests exist. The candidate drops a sampled event if pause wins and drains an active commit before pause returns. Every renderer pause/resume entry uses one reset-aware boundary; Reset rejects resume, and a resume-time cutoff permanently rejects native events queued before the boundary. | No final packaged permission-denied/recovery soak or long capture→pause→retention→reset soak was recorded for this candidate. | **Mitigated; needs verification** |
| Reviewed truth and deterministic capacity | **Complete in source; needed revalidation** | Work blocks remain correctable/excludable; deterministic inference and review flows are covered by repository suites. | Synthetic/browser evidence exists; no new real-user outcome study is claimed. | **Fixed and reverified** |
| Local persistence, import/export, retention, and Reset | **Broken under concurrent work** | Reset now closes the React persistence lane, startup hydration/migration, local import/full-backup readers, and their commit epochs before its first deletion. It aborts active file readers, waits work that already crossed a durable edge, pauses capture, verifies deletion, and reopens the local lanes only after cleared state is installed. Full backup remains plaintext by design and is disclosed. | Final native fault injection, relaunch, concurrent import/export, and large-journal soak are outstanding. | **Mitigated; needs verification** |
| Native AI credentials and Codex-plan isolation | **Partial / credential-risking** | API-key bindings are preregistered in a durable non-secret registry before Keychain write; Reset enumerates and readback-verifies owned bindings. Codex connect/generate/disconnect share one native lifecycle owner; Reset rejects new work, waits the prior owner, treats app-server logout as best effort, and always attempts path-derived Keychain account deletion even when both Weekform-owned Codex directories are absent. The frontend separately fences delayed API-key and Codex connection results. | Real Keychain save→rotate→crash/relaunch→reset and fresh Codex sign-in/reset remain manual acceptance checks. | **Mitigated; needs verification** |
| Individual Web authentication | **Partial / unsafe absolute-origin and error handling** | Password, magic-link, Google, and GitHub paths exist. Callback/redirect origins are pinned to the canonical site, exact Vercel preview, or loopback development origins; provider error detail is not reflected to users. | Current live baseline was inspected separately, but this candidate has not been deployed or run through provider end to end. | **Fixed locally** |
| Password recovery | **Missing** | Local `/forgot-password` and `/reset-password` paths use Supabase recovery, non-enumerating request confirmation, authenticated reset-session validation, replacement-password validation, sign-out, and generic errors. | Email delivery, redirect allowlist, expired-link behavior, and the final live session were not exercised; candidate is not deployed. | **Fixed locally** |
| Account deletion | **Missing** | No complete self-service account/team/personal-replica deletion workflow was found. Reset Local Data does not delete already-received cloud rows. | No production deletion proof. | **Blocked** |
| Private Individual replica and review commands | **Partial / stale-write and retry-identity risk** | Monotonic source clocks, two-phase review handling, bounded batch writes, first-render valid UUID reservation, and exact retry-digest enforcement exist in the candidate/local schema. A legacy receipt whose digest is `NULL` fails closed; the desktop rotates only that exact error to a durably saved new UUID for the unchanged queued payload before a later retry. | Linked production is through migration `202607200008`; migration `202607200010` and current authenticated two-device/mixed-client proof are absent. | **Blocked for promotion** |
| Team sharing and Manager Access | **Partial / client-trusted aggregate contract** | Positive-allowlist snapshot construction, consent preview, RLS-scoped reads, team actions, coverage-aware metrics, and a local database contract exist. Migration `202607200009` adds independent server validation of category/mode/project aggregate payloads. Client length/capping now uses Unicode code points, rejects unpaired UTF-16 surrogates, and matches PostgreSQL `char_length` at the 200-codepoint project-label boundary. | Migration `202607200009` is not linked/deployed; current authenticated roster/invite/snapshot/action end-to-end proof is absent. | **Blocked for promotion** |
| Cloud account, aggregate sharing, and personal-replica reset lifecycle | **Broken under concurrent Reset** | Reset synchronously closes account/auth, aggregate upload/delete, personal sync/poll, and review-command lanes, then waits active network and durable-write edges before deleting the session, policy, queues, or Store state. Personal/account lanes reopen explicitly after Reset; aggregate scheduling reopens only from the cleared account/policy state. | Packaged relaunch plus live delayed-auth, two-device, and provider-failure interleavings remain unproved. Cloud rows already received are not deleted by local Reset. | **Mitigated; needs verification** |
| Web Agent, Team Briefing, and Webex broker | **Partial / abuse controls unproved** | Provider paths use bounded bodies, timeouts, `no-store` responses, distributed request controls, minimized inputs, and fail-closed configuration. | Request-control/provider configuration and redacted operations monitoring are not live-attested. Webex correctly remains unavailable (`503`) rather than bypassing its security gate. | **Blocked until configured and verified** |
| Calendar sources | **Needs verification / unbounded waits** | Local `.ics` and native connector boundaries are implemented with bounded date/page contracts and Keychain-held refresh tokens. Native calendar token, refresh, and event requests have 10-second connect and 45-second total bounds. | Google/Microsoft provider registration and account sync, plus packaged Apple Calendar permission behavior, remain unproved. | **Mitigated; needs verification** |
| Chat sources | **Needs verification / launch claims unproved** | Content-free bounded Slack, Google Chat, and Webex projections and receipt semantics have repository coverage; native provider requests retain a 30-second total bound. | No live authorization/transfer proof; Google scope verification and the deployed Webex broker are outstanding. | **Blocked for connector launch claims** |
| Calendar, Chat, and cloud-account authorization reset lifecycle | **Broken under pending OAuth** | One native reset command invalidates pending calendar, Chat, and cloud-account loopback OAuth waits. Renderer operation barriers reject new work, suppress late completion, and wait any authorization that already advanced into token exchange before credential deletion. Cancellation/quiescence failures prevent a full-success Reset receipt. | Live provider cancellation during packaged authorization and token exchange remains a manual acceptance check. | **Mitigated; needs verification** |
| AI and Agent reset lifecycle | **Broken under Reset start races** | Reset closes delayed API/Codex connection commits, advances every AI workflow epoch, rejects six hook entry points and narrative/Visual Context auto-starts, aborts the conversational Agent, and disables/rejects send, retry, direct action staging, and approval starts until Reset reopens. | Provider-side work without a cooperative cancellation handle may finish remotely; only its local completion is rejected. Packaged provider/Codex interruption remains unproved. | **Mitigated; needs verification** |
| Simulation | **Complete for synthetic dev/demo scope** | Synthetic/dev-only generation and playback are separated from personal data and production team truth. | It is not a production workplace-automation capability and must not be presented as one. | **Ready only for the documented dev/demo scope** |
| Web UX and accessibility | **Partial / material a11y and responsive defects** | Narrow Settings overflow, AI-unavailable affordances, field descriptions, and range grouping were repaired and browser-inspected. Browser history waits for persisted-screen hydration and replaces the initial URL before later pushes, preventing a phantom Back entry. The Web Personal Agent's settled-answer live region is request-keyed, so identical new text is announced once while a failed follow-up cannot reannounce an old answer. | Authenticated deployed keyboard/VoiceOver checks remain outstanding. | **Fixed locally; manual acceptance pending** |
| Web deployment | **Existing baseline; candidate absent** | The previously deployed site returned expected security headers and authenticated download routes failed closed when signed out. | The local auth, API, accessibility, and database-contract candidate has not been deployed. | **Existing baseline only; candidate pending** |
| Universal Mac distribution | **Broken / Gatekeeper rejected** | The preserved submitted DMG still has SHA-256 `898b0947a559917278b6133df7298f50cccec4d73206df82111f14395f88ecee`. Separately, the exact current source built in an isolated target as a hardened-runtime `x86_64 arm64` app and Developer ID-signed universal DMG; strict app/DMG signature checks and `hdiutil verify` passed. That unsubmitted candidate's pre-staple SHA-256 is `8683d6c0123a6fa2cd533463c365f995e8a49c97eeaad47e0ec6ec585aa309c5`. | Apple submission `acae5cd9-8668-48fa-a411-01b626cd79ea` was **In Progress** at the last readable Apple checkpoint. The final recheck could not authenticate the local notarization profile. Both the preserved and newly isolated DMGs have no staple and Gatekeeper rejects them as `Unnotarized Developer ID`. No accepted ticket, clean-Mac install/reopen, immutable private upload, or matching production proof exists. | **Blocked** |
| Release automation | **Partial / false-green and promotion-race risk** | The candidate adds canonical Desktop UI, integration, Rust, release-script, Web typecheck, database, build, and audit gates. The Mac release path captures and revalidates the current canonical deployment, creates an unaliased candidate, validates authenticated download/checksum before promotion, compares the canonical id immediately before the swap, and conditionally rolls back only when the candidate still owns production. The final aggregate gate passed with every expected suite present. | No repository CI workflow enforces the gate, no candidate was deployed/promoted/rolled back, and the separate isolated current-source package did not overwrite or disturb the artifact tied to the preserved Apple submission. | **Locally verified; release still externally blocked** |

## Issue register

### Historical findings reverified in this audit

The first eighteen findings originated in the July 20 remediation ledger. This
pass re-traced their relevant ownership seams instead of assuming the earlier
status was current.

| ID | Severity / priority | Root cause and impact | Disposition and evidence | Residual / closure condition |
| --- | --- | --- | --- | --- |
| **WF-001** | Critical / P0 | The public Mac artifact did not have a complete publisher trust chain, making a normal Gatekeeper-safe install impossible. | Download publication now fails closed unless signature, notarization, staple, checksum, verification time, and private-host proof are all present. | **Blocked.** See WF-033; no DMG may be published until the exact artifact passes the full chain. |
| **WF-002** | High / P1 | Provider API keys could enter unencrypted application state. | **Fixed and reverified.** Persisted AI config strips the key; native keys use binding-addressed Keychain entries, Store rollback, allowlisted native accounts, migration, and reset readback. | Packaged Keychain rotation/relaunch/reset remains acceptance evidence; WF-026 closes an additional orphan-binding crash seam. |
| **WF-003** | High / P1 | Reset could report success while durable data or asynchronous writers remained. | **Fixed and reverified.** Single-flight verified reset, producer invalidation, capture pause, cloud quiescence, deletion readback, and retry-required failure are present. | WF-019 closes the remaining React debounce/in-flight write window; native fault injection remains. |
| **WF-004** | High / P1 | Capture append, prune, and clear used competing journal operations. | **Fixed and reverified.** One native journal owner, durable append/compaction, and serialized clear exist. | WF-020 closes the sample-before-pause/commit-after-pause lifecycle gap; native soak remains. |
| **WF-005** | High / P1 | Delayed personal-replica batches could overwrite newer Web truth. | **Mitigated.** Migration `202607200004` enforces monotonic freshness and future-clock bounds and is within the linked ledger through `008`. | Current authenticated two-device stale/equal/newer proof is required; WF-025 closes divergent reuse of one batch id only after migration `010` deploys. |
| **WF-006** | Medium / P2 | Independent full-state saves could reorder, duplicate work, and churn storage. | **Fixed and reverified.** The single-writer latest-snapshot coordinator coalesces writes and establishes clear generations. | Observe disk cadence during the packaged native soak. |
| **WF-007** | Medium / P2 | A review approval could mutate local truth before durable server lifecycle acknowledgement. | **Mitigated.** Two-phase local outbox, protocol separation, reservation, and recovery contracts exist; migration `202607200005` is within the linked ledger. | Old-v1/new-v2/mixed-client and disconnected-device recovery require current production-safe proof. |
| **WF-008** | Medium / P2 | The UI could time out while paid native HTTP remained unbounded or overlapped. | **Fixed and reverified.** Native connect/read/total deadlines end before the UI deadline; feature guards and reset epochs reject overlap/late results. | Tauri still has no per-request cooperative cancellation handle; bounded completion is the current guarantee. |
| **WF-009** | Medium / P2 | Journal startup and retention materialized excessive history. | **Fixed and reverified.** Bounded tail/session reads, streaming retention, and streaming full backup are present. | Large synthetic journal performance/file-size soak remains. |
| **WF-010** | Medium / P1 | Web AI routes lacked distributed quota and concurrency control. | **Mitigated.** Migration `202607200006`, scoped leases, token reservations, idempotency, redacted receipts, and fail-closed behavior exist. | Live trusted-proxy/IP hashing, budgets, provider variables, and operational evidence are not verified. |
| **WF-011** | Medium / P1 | The Webex token broker depended on an unverifiable security-attestation flag. | **Mitigated, feature blocked.** It now requires implemented request controls, bounded input/upstream time, credential-safe output, `no-store`, and redacted completion. | Keep it unavailable until live broker controls and monitoring are attested. |
| **WF-012** | Medium / P2 | Web and Tauri lacked explicit content-security baselines. | **Fixed and reverified.** Nonce CSP/security headers and production/development Tauri CSP/capabilities exist. | Recheck the deployed candidate and packaged auth/provider/IPC/external-link paths. |
| **WF-013** | Medium / P2 | The mobile Web drawer lacked modal focus containment and restoration. | **Fixed and reverified.** Dialog labeling, focus entry/trap/return, Escape/navigation close, inert background, and scroll lock are covered. | Authenticated mobile VoiceOver/keyboard acceptance remains. |
| **WF-014** | Medium / P2 | The work-mode chart duplicated every keyboard stop. | **Fixed and reverified.** The SVG is presentation-only and one semantic legend owns values/descriptions. | Recheck the final packaged/browser accessibility trees. |
| **WF-015** | Medium / P2 | The aggregate Supabase gate was falsely red because a smoke file lacked a valid pgTAP contract. | **Fixed and reverified.** The smoke has a plan/finish and database/static/build surfaces have distinct scripts. | The expanded aggregate release gate and local pgTAP now pass; linked production migration/authenticated smoke remains separate. |
| **WF-016** | Low / P3 | Screens without contextual tabs received an uncontrolled `tabpanel`. | **Fixed and reverified.** The role/label are conditional on a matching active tab. | Recheck authenticated tabbed and untabbed routes after deployment. |
| **WF-017** | Low / P3 | The browser demo clipped below the native 1024-pixel minimum. | **Fixed and reverified.** Responsive browser-only shell rules and narrow geometry checks exist; current 390-pixel browser inspection found no horizontal overflow. | Browser proof does not validate the native minimum or compact menu-bar view. |
| **WF-018** | Low / P3 | Current product links drifted between `.com` and `.dev`. | **Fixed and reverified.** `https://weekform.dev` is canonical and legacy hosts redirect. | Recheck deployed host aliases and provider callback allowlists. |

### Findings opened or materially extended in this pass

| ID | Severity / priority | Root cause and impact | Remediation / evidence | Status and residual |
| --- | --- | --- | --- | --- |
| **WF-019** | High / P1 | A debounced or already-running React persistence write could cross Reset's early awaits and recreate cleared state. | Reset now synchronously suspends the UI write lane, cancels its timer, advances the generation, drains any writer that crossed the boundary, and resumes only after empty state is installed. Focused coordinator/reset contracts were added. | **Fixed locally.** Final native fault injection/relaunch proof pending. |
| **WF-020** | High / P1 | Native sampling occurred outside the journal lock, and renderer pause/resume paths could reopen capture during Reset or admit an event queued before pause after a later resume. | Commit and event emission now share the journal lifecycle lock; pause changes state under that lock, drains an active commit, and causes a late sample to be dropped. All renderer pause/resume paths share a synchronous reset-aware guard; resume is rejected during Reset, and a timestamp cutoff rejects events queued before the latest resume. Deterministic tests cover native ordering, resume-during-reset, and queued delivery. | **Fixed locally.** Packaged capture/pause/reset soak pending. |
| **WF-021** | High / P1 | Web API routes trusted declared length or materialized an unbounded request body; some early/error responses could be cacheable. | A streaming bounded reader cancels bodies beyond 2,048 bytes for Personal Agent and 16,384 bytes for Webex, including chunked/lying-length requests. Every response uses `no-store`/`no-cache`. | **Fixed locally.** Deploy and verify CDN/runtime behavior. |
| **WF-022** | High / P1 | Invite and authentication callbacks could derive absolute destinations from attacker-controlled request host/origin values. | Absolute URLs now resolve only to canonical production, exact Vercel preview, or loopback development origins; authentication errors are generic. | **Fixed locally.** Provider-console redirect allowlists and deployed callback behavior need verification. |
| **WF-023** | High / P1 | The database did not independently enforce the positive-allowlist aggregate contract used by Manager surfaces; numeric constraints also diverged from the client model. | Migration `202607200009` validates exact `{label,value}` objects, category/mode taxonomy, duplicates, values, byte/count limits, at most 50 project labels of at most 200 characters, context/WIP scores in `0..1`, and intentional allocation overcommit up to `999`. Existing rows are not rewritten; constraints validate when legacy data is clean and still govern new writes. | **Fixed locally; not deployed.** Linked production remains through `008`; inspect legacy rows, apply `009`, and verify constraint validation before promotion. |
| **WF-024** | High / P1 | Initial cloud rendering could build a snapshot before the effect that reserved its UUID, producing an invalid transient id. | Synchronous reservation now creates a valid UUID before preview/upload construction; focused first-render contracts cover it. | **Fixed locally.** Authenticated first-sync acceptance pending. |
| **WF-025** | Medium / P1 | `ON CONFLICT DO NOTHING` could return an existing receipt when the same batch UUID was reused with another device, fingerprint, or payload; a pre-digest receipt could not prove that a retry was identical. | Migration `202607200010` adds an exact SHA-256 payload digest, per-user/batch transaction lock, 1 MiB/1,000-block pre-bounds, and rejects legacy/contradictory retries while preserving exact idempotency. The server fails closed on a legacy `NULL` digest. Only that exact failure lets the desktop durably replace the queued batch UUID while leaving its payload, content fingerprint, consent, device, and source clock unchanged; other errors do not rekey. | **Fixed locally; not deployed.** Apply `010` after `009`, then prove legacy recovery, exact/concurrent retry, and divergent replay under authenticated sessions. |
| **WF-026** | High / P1 | A crash or cleanup failure between Keychain write and Store pointer commit could orphan a credential that Reset could no longer enumerate; Codex connect/generation could also overlap cleanup. | Every proposed API-key binding is durably preregistered before secret write; Reset resolves the registry before deletion, readback-verifies all owned/legacy entries, and preserves it on failure. Codex connect/generate/disconnect share an epoch and lifecycle owner. Disconnect waits the prior owner, rejects new work, treats remote logout as best effort, and always performs path-derived Keychain account deletion even when `CODEX_HOME` and the isolated workspace are absent. Frontend API/Codex connection results are separately epoch-fenced. | **Fixed locally.** Real Keychain crash/relaunch/rotation/reset and Codex sign-in/generation/disconnect interleavings remain. |
| **WF-027** | High / P1 | AI actions could appear actionable without a connection, lose their accessible name while busy, or strand users away from configuration. | Shared unavailable-state notice preserves action names, explains the boundary, and links to Settings; classification/busy semantics were repaired. | **Fixed locally.** Browser inspection and focused contracts passed; native screen-reader acceptance pending. |
| **WF-028** | Medium / P2 | Settings controls overflowed at a 390-pixel viewport. | Existing design tokens/layout were adjusted; date ranges were grouped semantically. Browser inspection showed no horizontal overflow or focus-induced scroll. | **Fixed locally.** Recheck both themes in the deployed candidate. |
| **WF-029** | Medium / P2 | Browser-demo navigation did not own stable URLs or respond correctly to Back/Forward; the initial URL could also race persisted-screen hydration and leave a phantom history entry. | Non-Tauri navigation waits for hydration, replaces the initial URL with the hydrated active screen, pushes later user navigation, and restores on `popstate`; Tauri navigation remains independent. | **Fixed locally.** Focused hydration/history contracts passed; deployed refresh/back/forward acceptance remains. |
| **WF-030** | Medium / P2 | Overbroad live regions could repeatedly announce old Agent messages or fail to announce a distinct answer with identical text, and some form hints were not programmatically owned. | Desktop live status is scoped to the latest settled response. The Web Personal Agent keeps the last settled answer visible without reannouncing it on a failed follow-up and keys a new settled announcement by request id, including when its text is identical. Field hints use `aria-describedby`; invite success and range controls have bounded semantic ownership. | **Fixed locally.** Authenticated screen-reader acceptance pending. |
| **WF-031** | High / P1 | Password recovery was absent; auth redirects trusted request origin and raw provider errors could leak implementation/account detail. | Local recovery routes/actions, trusted origin resolution, generic errors, non-enumerating reset-request copy, reset-session validation, password confirmation, and post-update sign-out were added. | **Fixed locally; not deployed.** Verify Supabase email templates/allowlists, delivery, valid/expired link behavior, and new-password sign-in. |
| **WF-032** | Medium / P1 | Canonical release scripts omitted Desktop UI, integration, Rust, release-script, and Web typecheck coverage, allowing a false-green candidate. | New test scripts and `verify:release` compose the omitted surfaces; Absoloop's required gate points to the expanded application suite. The final current-tree gate passed with all expected suites present. | **Fixed locally.** No hosted CI enforces it, and the passed source gate is not signed-package or deployment proof. |
| **WF-033** | Critical / P0 | No exact current-source universal DMG has completed Apple notarization/staple/Gatekeeper proof or immutable hosted-byte proof. | The preserved submitted artifact and the separate current-source candidate are Developer ID signed, and the publisher remains fail-closed. Submission `acae5cd9-8668-48fa-a411-01b626cd79ea` was **In Progress** at the last readable checkpoint and was deliberately not interrupted. At final recheck the local profile was unavailable; neither DMG had a staple, and Gatekeeper rejected both as unnotarized. Their checksums differ, so a ticket for the preserved artifact cannot establish trust for the current-source candidate. | **Blocked.** Resolve and preserve the older submission, then submit the exact approved current-source DMG; after acceptance, staple, validate, run Gatekeeper/clean-Mac install and reopen, upload those exact bytes privately, verify SHA-256, and test authenticated delivery. |
| **WF-034** | High / P1 | Live Slack, Google Chat, Webex, calendar, provider-AI, and full authenticated cloud flows have not been exercised together under production credentials and controls. | Repository contracts minimize data and fail closed; Webex remains unavailable without attestation. | **Blocked.** Complete provider registration/review and synthetic account-level tests without recording sensitive payloads. |
| **WF-035** | High / P1 | The account system lacks self-service account deletion and a proved cloud-data deletion lifecycle. | No destructive implementation was inferred during an audit. Existing local Reset accurately states that received cloud rows persist until their cloud control deletes them. | **Blocked.** Define ownership/team transfer semantics, implement a privileged approval/reauthenticated deletion path, audit it, and verify retention/deletion outcomes. |
| **WF-036** | Low / P3 | Dev-only Simulation dialog/tab semantics and Forecast legend presentation retain lower-priority accessibility debt. | Core product accessibility defects were prioritized; Simulation remains labeled synthetic/dev-only. | **Accepted follow-up.** Fix before treating Simulation as a polished judge-facing path; run keyboard/screen-reader checks. |
| **WF-037** | Low / P3 | Production builds warn about large JavaScript chunks, increasing startup/regression risk without measured impact data. | No speculative split was made during security remediation. | **Accepted follow-up.** Profile cold start and interaction latency, then split only measured boundaries. |
| **WF-038** | High / P0 | The local schema has security/data-integrity migrations `009` and `010`, while the linked production ledger is only through `008`. | A machine-readable linked-migration equality assertion was added to fail release on drift. Local reset and pgTAP include both new migrations. | **Blocked.** Review backups/legacy rows, apply migrations in order, rerun linked equality and authenticated smoke tests; do not publish mixed schema/code. |
| **WF-039** | Medium / P1 | No repository CI workflow enforces the canonical gate, and provider/request-control/download observability has not been operationally attested. | One local gate now names the expected surfaces; logging guidance remains privacy-minimized. | **Blocked for unattended release.** Add CI and approved redacted operational checks without hidden telemetry or payload logging. |
| **WF-040** | Medium / P2 | The new database contract initially exposed a synthetic seed row whose shortened category label no longer matched the canonical taxonomy, breaking a clean rebuild. | The seed now uses the canonical label and a clean local reset succeeds before the full pgTAP suite. | **Fixed locally.** Keep zero-state rebuild in the release gate. |
| **WF-041** | High / P1 | JavaScript string length counted UTF-16 code units while PostgreSQL `char_length` counts Unicode code points, so astral labels could be truncated differently or a malformed surrogate could cross the client boundary. | Shared project-label validation and capping now use Unicode code-point iteration, reject unpaired surrogates, preserve astral characters, and align the 200-codepoint client boundary with migration `009` and its worst-case JSON byte contract. | **Fixed locally; migration not deployed.** Reprove with the linked schema and authenticated snapshot writes after `009` is applied. |
| **WF-042** | High / P1 | Startup hydration/migration, local file import/full-backup, account authorization, aggregate upload/delete, personal replica polling/sync, and durable review work could cross Reset and repopulate cleared state or credentials. | Reset now closes every named lane synchronously, invalidates startup and operation epochs, aborts active `FileReader`s, waits work already beyond a network or durable-write edge, clears only after all barriers settle, and reopens personal/account/connector/local lanes after the cleared state is installed. Aggregate scheduling reopens from cleared account/policy state. Failures remain audit-visible and prevent a full-success receipt. | **Fixed locally.** Packaged fault injection, relaunch, delayed provider/auth, and concurrent import/export acceptance remain; this does not replace the native capture/reset soak. |
| **WF-043** | High / P1 | Calendar, Chat, or cloud-account loopback OAuth could remain pending for up to five minutes during Reset, while unbounded calendar provider HTTP could delay connector quiescence and credential deletion. | A native generation cancellation invalidates all three pending callback waits before Reset awaits connector/account barriers. Late renderer results are rejected, operations already in token exchange are awaited, calendar provider HTTP has 10-second connect/45-second total bounds, and Chat provider requests retain their 30-second total bound. Cancellation/quiescence failures prevent a full-success Reset receipt. | **Fixed locally.** Live provider cancellation during callback, exchange, refresh, and transfer needs packaged account-level proof. |
| **WF-044** | High / P1 | A release could promote an unvalidated deployment or automatically roll back over a concurrent operator's newer production deployment. | The release script now captures and validates the canonical production deployment, deploys an unaliased candidate, proves authenticated artifact download/checksum before promotion, rechecks that the canonical id is unchanged immediately before the swap, and rolls back only when production still points at the failed candidate. | **Fixed locally; not executed.** No candidate deploy, promotion, rollback, notarization completion, or hosted-byte proof is claimed. |
| **WF-045** | High / P1 | Reset invalidated in-flight AI output, but a new classifier, review, forecast, narrative, acceleration, Visual Context, Agent turn, retry, action staging, or approval could start during the deletion window. | Shared reset-state guards now reject the six AI hook entries and automatic narrative/Visual Context starts. Agent controls and function-entry checks reject send, run, retry, direct action staging, and approval until Reset reopens; delayed API/Codex connection results are fenced separately. | **Fixed locally.** Non-cooperatively cancellable provider work can still finish remotely, but it cannot commit locally; packaged provider/Codex interruption remains. |

## Completed remediation index

The historical WF-001–WF-018 per-file reproduction and remediation evidence is
retained in [`AUDIT_REMEDIATION_2026-07-20.md`](AUDIT_REMEDIATION_2026-07-20.md).
The materially extended/current fixes are grouped below. “Passed” means the
final source gate; it does not imply deployment or packaged acceptance.

| Issues / category | Before → after | Primary implementation surfaces | Regression evidence | Final status / regression risk |
| --- | --- | --- | --- | --- |
| WF-019, WF-042, WF-045 / race, persistence, AI actions | Reset could clear while local/cloud/provider work started or completed. Reset now synchronously closes all owned lanes, waits crossed edges, rejects new AI/Agent work, installs cleared state, then reopens. | `App.tsx`; `usePersistence.ts`; `persistenceCoordinator.ts`; `connectorResetBoundary.ts`; cloud/connector/AI hooks; `AgentScreen.tsx` | `resetOperationBoundary.test.ts`; `persistenceCoordinator.test.ts`; `personalReviewCommandLifecycle.test.ts`; AI accessibility contracts | **Fixed locally.** Highest residual risk is packaged fault injection or a future write lane that bypasses the shared boundary. |
| WF-020 / native and renderer capture lifecycle | Pause/Reset could lose the native race, resume during deletion, or admit a queued old event. Journal commit is serialized with pause; all renderer transitions use one reset guard and resume cutoff. | `src-tauri/src/lib.rs`; `App.tsx`; `useActiveWindow.ts`; `captureDeliveryGuard.ts` | native pause/commit tests plus behavioral reset/resume/queued-delivery tests | **Fixed locally.** Requires packaged permission and long-running capture soak. |
| WF-021, WF-022, WF-031 / Web request and auth security | Chunked/lying bodies, request-derived absolute origins, raw provider errors, and missing recovery created abuse/leak/account risks. Bodies are streamed with hard caps, responses are no-store, origins are pinned, errors generic, and recovery is non-enumerating. | `boundedRequestText.ts`; Personal Agent/Webex routes; `teamInviteOrigin.ts`; auth actions/callback; forgot/reset pages | bounded-body, invite-origin, auth, password-recovery, Webex, static accessibility tests | **Fixed locally; not deployed.** CDN/provider email and callback acceptance remain. |
| WF-023, WF-041 / manager payload and Unicode contract | Client-only aggregate validation and UTF-16/code-point drift could produce divergent writes. Migration `009` independently validates the exact JSON contract; client capping matches PostgreSQL and rejects malformed surrogates. | `packages/domain/src/cloud.ts`; migration `009`; `workload_snapshot_payload_contract.sql` | inference/domain tests and local pgTAP boundary cases | **Fixed locally; blocked on migration `009`.** Legacy compatibility and authenticated writes remain. |
| WF-024, WF-025 / snapshot and replica idempotency | First render could expose an invalid id; a reused or legacy batch id could return an unverifiable receipt. UUID reservation is durable before upload; migration `010` binds exact digest/device/fingerprint and legacy rekey is narrow and durable. | `sharedSnapshot.ts`; `sharedSnapshotReservation.ts`; `useCloudSync.ts`; `personalSync.ts`; `usePersonalCloudSync.ts`; migration `010` | reservation tests, personal-sync lifecycle tests, replica monotonicity pgTAP | **Fixed locally; blocked on migration `010`.** Two-device/mixed-client proof remains. |
| WF-026, WF-043 / credentials and authorization lifecycle | Crash windows could orphan API/Codex credentials; OAuth callback and connector HTTP waits could outlive Reset. Bindings are preregistered; Codex has one lifecycle owner; all callbacks can be invalidated; calendar HTTP is bounded. | `localStore.ts`; `src-tauri/src/lib.rs`; calendar/chat Rust modules; calendar/chat/cloud hooks | Keychain transaction contracts, Codex lifecycle tests, three callback cancellation tests, connector reset races | **Fixed locally.** Real Keychain and provider-account interruption remains. |
| WF-027–WF-030 / accessibility, UX, responsive navigation | AI actions could be nameless/dead-ended; Settings overflowed; browser history produced phantom entries; live regions overannounced stale text. Shared notices preserve action names and Settings routes, controls reflow at 390 px, hydration owns initial history, and settled announcements are request-keyed. | `AIConnectionNotice.tsx`; Setup/source panels; `styles.css`; browser navigation helper; Agent/Web Personal Agent announcement helper | focused static/behavioral accessibility, responsive, history, and announcement tests plus synthetic browser inspection | **Fixed locally.** Deployed keyboard/VoiceOver and both-theme acceptance remain. |
| WF-032, WF-038, WF-040, WF-044 / release and migration safety | The gate omitted surfaces, schema drift was not machine-enforced, seed rebuild failed, and deployment could promote/rollback unsafely. The canonical gate is expanded; linked drift fails closed; seed rebuilds; candidate validation precedes compare-and-swap promotion with conditional rollback. | `package.json`; `absoloop.toml`; release script and validators; migration assertion; `seed.sql` | release-script 17/17, zero-state DB reset, pgTAP 432/432, final unified gate | **Fixed locally except linked drift.** CI, migration apply, candidate execution, and distribution proof remain blocked. |

## UX, visual, and accessibility changes

- AI-unavailable surfaces keep their actual action names, expose one concise
  explanation, and route users to the existing AI Settings section. During
  Reset, visible triggers, retries, toggles, composer controls, and approvals
  are disabled as well as guarded at function entry.
- Settings keeps the established Geist/tokens/component vocabulary while date
  ranges, file controls, and Account & Sharing reflow without horizontal page
  overflow at 390 pixels. The Account surface uses a semantic disabled
  `fieldset` during Reset instead of a cosmetic-only disabled state.
- Browser navigation now waits for persisted-screen hydration, replaces the
  initial URL exactly once, pushes later user navigation, and restores on
  Back/Forward without changing the Tauri ownership boundary.
- Personal Agent live announcements are scoped to the latest settled request:
  an identical new answer is announced once, a failed follow-up does not
  reannounce the prior answer, and clearing the conversation clears the live
  region. Form descriptions and range groups have programmatic ownership.
- The synthetic golden path retained the existing hierarchy and showed a
  deterministic 24%→28% capacity response after review. No decorative redesign
  or parallel design system was introduced.

## Architectural changes and technical debt

Implemented architecture:

- one reusable close/quiesce/reopen operation boundary now owns reset-sensitive
  renderer work; the persistence coordinator remains the only general Store
  writer, and native journal/Codex owners serialize their respective edges;
- database migrations `009` and `010` move aggregate validation and replica
  retry identity from client assumptions to server-enforced contracts;
- Web request readers, origin resolution, announcements, browser history, and
  release-deployment validation are extracted into testable shared helpers;
- the release sequence is now candidate-build → candidate validation →
  canonical compare-and-swap → canonical smoke → ownership-checked rollback.

Remaining debt and staged work:

- legacy `clear-capacity.*` keys and `com.clearcapacity.desktop` remain for
  compatibility and require a migration/rollback plan before renaming;
- provider calls do not all expose cooperative transport cancellation; bounded
  completion and local epoch rejection are the current guarantee;
- account/cloud deletion semantics need a product decision and privileged,
  reauthenticated implementation rather than a local audit patch;
- migrations `009`/`010`, the Web candidate, connector configuration, CI, and
  the exact packaged/notarized artifact require controlled operator rollout;
- two desktop chunks exceed the 500 kB warning threshold; profile cold start
  before choosing a code-split boundary.

## Validation evidence and limits

The numeric results below are the final current-tree checkpoint observed on
July 21 after the lifecycle remediation rows WF-041–WF-045 and the capture
resume boundary follow-through.

| Surface | Observed status | What it proves / does not prove |
| --- | --- | --- |
| `supabase db reset --local` | **Passed from zero** after the seed-contract fix. | Proves migrations `001`–`010` and synthetic seed compose locally; not production migration safety by itself. |
| `npm run test:supabase:rls` | **432/432 passed.** | Proves the local pgTAP/RLS/RPC contract, including snapshot validation and replica retry identity; not a linked authenticated smoke. |
| `npm run test:desktop-cloud` | **329/329 passed.** | Proves the desktop service contracts on the final local candidate; not packaged native behavior. |
| `npm run verify:release` | **Passed.** It included inference **35/35**, desktop services **329/329**, desktop UI **40/40**, integrations **38/38**, simulator **22/22**, Web **602/602**, release scripts **17/17**, pgTAP **432/432**, and Rust **82/82**. | Proves every named local source/database suite ran and passed; not a linked migration, provider, deployment, notarization, or clean-install proof. |
| Root/Web build and Web typecheck | **Passed** in the unified gate. The desktop build retained its existing `>500 kB` chunk warning. | Proves compile and optimized bundle consistency for the final source candidate; it does not prove packaged runtime behavior or eliminate the bundle-performance risk. |
| Isolated universal Mac package build | `APPLE_SIGNING_IDENTITY=Developer ID Application: Blerbz LLC (PC8SXU67D3) CARGO_TARGET_DIR=<isolated /tmp target> CARGO_BUILD_JOBS=2 npm run desktop:release:mac` **passed**. `codesign --verify --deep --strict`, DMG signature verification, `hdiutil verify`, bundle id `com.clearcapacity.desktop`, hardened runtime, Team ID `PC8SXU67D3`, and `x86_64 arm64` slices were confirmed. | Proves the exact source can produce a structurally valid signed universal package without touching the preserved submission. It is unsubmitted, unstapled, Gatekeeper-rejected, not clean-installed, and not a production artifact. |
| Direct native/static checks | `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, `git diff --check`, and release-script Zsh syntax checks **passed**. | Complements rather than replaces the isolated package build and packaged runtime acceptance; the preserved submitted artifact was deliberately left untouched. |
| Browser inspection | Responsive/focus/history checks passed. A synthetic golden-path smoke reviewed two blocks, changed one mode from Blocked to Deep work, observed reliable capacity move from 24% to 28%, and found correction plus verification audit evidence with no browser errors. The unavailable Agent state was honest. | No actual AI answer/action ran. Browser proof does not validate Tauri, macOS permissions, Keychain, signed packaging, or native approval execution. |
| Dependency audits | Root and Web audits both **passed with zero vulnerabilities** inside the unified gate. | Registry results can drift; rerun from the exact release commit immediately before promotion. |
| Lint | No lint script exists. | No lint result is claimed; TypeScript builds/typecheck and focused static contracts are the available repository gates. |
| Linked Supabase ledger | Production currently ends at `202607200008`; local ends at `202607200010`. | This is confirmed release-blocking drift, not a passed migration check. |
| Live Web at 2026-07-21 05:03Z | `/` returned `200` with the expected security headers. Signed-out `/download/artifact` returned `401` with `no-store`. `/forgot-password` returned `404`. | Confirms the existing baseline and fail-closed download, and positively confirms that the local password-recovery candidate is not deployed. It cannot prove new body bounds, UI fixes, or migrations. |
| Mac artifacts | The preserved submission checksum and the separate current-source candidate checksum are recorded above. The current-source app/DMG pass strict signature, hardened-runtime, architecture, bundle-id, and disk-image checks. The final local Apple-history check could not authenticate the configured profile; staple validation failed and Gatekeeper reported `Unnotarized Developer ID` for both DMGs. | The last readable preserved-submission status was **In Progress**. Signature and successful packaging are not notarization, stapling, Gatekeeper acceptance, hosted-byte identity, or clean-Mac proof. |

## Privacy and security assessment

The candidate strengthens Weekform's intended privacy model:

- raw native samples remain in the encrypted journal and do not enter team
  snapshots or the private Web replica;
- reset now fences the persistence and capture writers before deletion and
  retains a recoverable non-secret registry until owned Keychain entries are
  verified absent;
- shared aggregate JSON is constrained independently at the database boundary;
- private replica retries are bound to the authenticated user, device,
  fingerprint, exact payload digest, size, and block count;
- provider-facing Web bodies are bounded while streaming and all response paths
  are non-cacheable;
- absolute invite/auth destinations no longer trust arbitrary request hosts;
- recovery copy avoids account enumeration and raw provider-error reflection;
- Web AI inputs remain server-reloaded, minimized, controlled, and use
  `store: false` where supported.

Material limits remain. Most non-journal local prototype state is unencrypted.
Window titles, screenshots, exported backup files, typed Agent questions,
calendar metadata, chat metadata, account identity, manager-visible approved
snapshots, and user-authored manager actions can still be sensitive within their
documented paths. Password recovery and third-party providers add normal
Supabase/provider processing. Account deletion is incomplete. Migrations `009`
and `010` do not protect production until applied. Operators must not add raw
questions, model output, tokens, IP addresses, emails, window titles, or
workload payloads to logs while closing the observability gap.

## Release blockers

1. **Complete the Mac trust chain for the exact release bytes.** Re-establish
   read-only status access and resolve the preserved submission
   `acae5cd9-8668-48fa-a411-01b626cd79ea` without replacing its artifact. After
   source approval, submit the separate current-source DMG because its checksum
   differs; then staple and validate its accepted ticket, pass Gatekeeper and
   clean-Mac install/reopen, upload those exact immutable bytes, and verify
   production serves the recorded checksum and proof.
   **Owner:** macOS release engineering / Apple account holder. **Release block:** yes.
2. **Remove database drift.** Back up and inspect linked data, apply migrations
   `202607200009` and `202607200010` in order, prove local/remote ledger equality,
   and run authenticated snapshot/retry/multi-device/mixed-client smoke tests.
   **Owner:** database/platform engineering. **Release block:** yes.
3. **Deploy and verify the Web candidate.** Include trusted auth/invite origins,
   bounded/no-store APIs, password recovery, accessibility fixes, and generic
   errors. Verify security headers, sign-in/out, recovery, invite, role, Manager,
   review, and authenticated download routes with synthetic accounts.
   **Owner:** Web/release engineering. **Release block:** yes for this candidate.
4. **Close account lifecycle.** Define and implement self-service account/cloud
   deletion with reauthentication, team ownership handling, audit, and verified
   retention/deletion semantics. **Owner:** product, security, and backend.
   **Release block:** yes for a production account claim.
5. **Convert the signed package into runtime proof.** Preserve the passed
   `npm run verify:release`, direct Cargo, diff, shell, signature, architecture,
   and disk-image evidence. After the exact approved source is packaged and its
   own trust chain completes, run clean install/reopen and exercise the synthetic
   native golden path. Do not disturb or overwrite the artifact participating
   in the older submission while its status is unknown.
   **Owner:** macOS QA/release engineering. **Release block:** yes.
6. **Prove enabled integrations.** Keep unavailable connectors fail-closed;
   launch only provider paths whose console registration, scopes, request
   controls, credential-safe operations, and synthetic account transfers have
   been verified. **Owner:** integrations/security. **Release block:** yes only
   for connectors represented as launched; unavailable connectors may stay fail-closed.
7. **Enforce and observe.** Add CI for the canonical gate and approved,
   content-free operational checks before unattended promotion. **Owner:** DevEx
   and operations. **Release block:** yes for unattended promotion.

## Rollback and recovery posture

- The remediations described as local are not deployed; abandoning this
  candidate requires no production rollback. Preserve the audit patch and do
  not publish a partially reverted security boundary.
- Before migrations `009`/`010`, take a production backup and inspect legacy
  constraint compatibility. These are additive hardening migrations; if a live
  incompatibility appears, stop snapshot/replica writers and roll forward with
  a reviewed compatibility migration. Do not drop checks, digest identity, or
  user isolation merely to restore traffic.
- Deploy database compatibility before Web/native callers that rely on it. A
  Web rollback may use the prior known deployment only while its schema remains
  compatible and the security fixes it lacks are explicitly understood.
- Keep official Mac download publication fail-closed. Reject an untrusted
  artifact rather than asking users to bypass quarantine or Gatekeeper.
- Reset and credential cleanup failures must remain retryable and visible. Do
  not clear their registry/audit evidence until deletion is verified.

## Monitoring and post-deploy checks

Monitoring must honor Weekform's no-hidden-telemetry rule. Prefer explicit
operator health checks and aggregate, redacted counters:

- auth callback/recovery success and generic failure class, never email,
  tokens, callback secrets, or provider text;
- request-control acquisition, rate/concurrency denials, timeouts, and coarse
  completion outcome, never IP, question, answer, prompt, or model output;
- constraint rejection and replica retry-conflict counts, never snapshot or
  block payloads;
- stale/future-clock, mixed-protocol, and outbox recovery outcomes by anonymous
  code only;
- local reset retry, journal error, and capture-pause evidence in the user's
  local audit trail;
- notary status, staple/Gatekeeper results, hosted checksum, proof timestamp,
  and authenticated artifact response;
- Web security headers, error rate, route availability, and password-recovery
  delivery using synthetic operator accounts.

## Repeatable regression plan

1. From the exact candidate commit, run `npm ci`, `npm run verify:release`,
   `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`,
   `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`,
   `zsh -n scripts/release-mac.command`, and `git diff --check`. Confirm every
   expected suite appears; do not accept a skipped/blank gate.
2. Reset the local database from zero, run all pgTAP, then compare linked/local
   ledgers. After an approved backup and migration rollout, exercise owner,
   manager, member, outsider, duplicate batch, divergent retry, stale/newer
   device, and mixed review-protocol actors with synthetic accounts.
3. In Web staging, test sign-up/in/out, magic/OAuth callback, recovery
   request/valid/expired link, invite acceptance, role revocation, Team/Manager
   authorization, Personal Agent limits/timeouts, and authenticated artifact
   download. Repeat requests, cancel connections, and inspect generic/no-store
   failures plus browser history.
4. At 390, 800, 1024, and wide viewports in both themes, run keyboard-only and
   screen-reader-oriented checks for navigation, dialogs, fields, live regions,
   focus restoration, 200% zoom/reflow, reduced motion, loading/empty/error/
   disabled states, and long Unicode labels.
5. In the packaged Mac, exercise first launch, permission denial/grant, capture,
   pause/resume, queued native delivery, retention, import/export, relaunch, and
   Reset while deliberately delaying file, cloud, OAuth, AI, and Codex work.
   Reset must stay paused, reject new actions, leave exactly its truthful audit
   receipt, and require retry on any unverified deletion.
6. Exercise API-key Keychain save/rotate/relaunch/reset and Codex sign-in,
   generation, disconnect, crash recovery, and Reset. Verify no provider key or
   sensitive window/chat content enters Store, logs, exports, replica payloads,
   or Manager snapshots.
7. For each enabled Calendar/Chat provider, test callback cancellation, token
   exchange, pagination, rate limit, timeout, offline retry, disconnect, cursor
   recovery, and content-free projection with synthetic provider accounts.
8. Preserve the exact DMG bytes through notarization, staple/validate, Gatekeeper
   assessment, and clean-Mac install/reopen. Upload privately, compare SHA-256,
   validate an unaliased Web candidate, promote only after the canonical identity
   recheck, then repeat the production smoke. Roll back only if the candidate
   still owns production.

## Ordered path to reconsideration

1. Re-establish read-only Apple status access for the preserved submission. If
   it is still in progress, wait; if accepted, staple the exact artifact and
   collect its trust-chain evidence. Preserve the DMG either way; because its
   checksum differs, do not treat that result as notarization of the separate
   current-source candidate.
2. Preserve the passed unified repository evidence and rerun it from the exact
   release commit after any migration/deployment follow-up; fix failures without
   weakening a check.
3. Back up, apply, and verify migrations `009` and `010`; run linked and
   authenticated cloud smoke tests.
4. Implement and verify account deletion semantics.
5. Deploy the Web candidate to a non-production environment, run synthetic
   auth/recovery/invite/role/Agent/Manager/download acceptance, then promote.
6. Freeze the exact approved source, rebuild or retain its isolated signed
   universal DMG, submit those exact bytes to Apple, staple/validate after
   acceptance, then run packaged native Keychain, capture/reset,
   retention/export, permission, deep-link, offline/retry, clean-install, and
   golden-path acceptance.
7. Enable only the provider integrations with completed console, security, and
   account-transfer evidence; retain fail-closed behavior for the rest.
8. Add CI and privacy-safe operational checks, then repeat the release review
   from the exact commit, schema ledger, Web deployment, and DMG checksum.

The earlier implementation-specific evidence remains available in
[`AUDIT_REMEDIATION_2026-07-20.md`](AUDIT_REMEDIATION_2026-07-20.md). This report
supersedes that ledger only for the release recommendation and the later
findings; it does not rewrite its historical evidence.
