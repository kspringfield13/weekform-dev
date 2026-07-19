# Weekform Post-Hackathon Expansion Roadmap (detailed, phased)

**Provenance:** This document expands blueprint §17 ("Post-hackathon expansion
roadmap") of `WEEKFORM_TEAM_CLAWFATHER_HACKATHON_BLUEPRINT.md` into an
executable, phased plan. The blueprint's three horizons are the strategic
frame; this document is the tactical decomposition. Started July 19, 2026.

**Ground rules carried forward from the hackathon build (non-negotiable):**

- Consent-first: sharing defaults off; nothing leaves the device without an
  explicit allowlist builder and user-approved preview.
- Honest aggregation: null (not shared) is never zero; medians and ranges,
  never sums of percentages; no ranks, leaderboards, or composite
  productivity scores; stale data is labeled and excluded, never silently
  counted.
- Pure-core discipline: new logic lands as pure, deterministic,
  dependency-injected modules with `node:test` coverage before any UI or
  network wiring (`workload.ts`, `cloudScheduler.ts`, `download.ts`,
  `briefing.ts` set the pattern).
- Every phase keeps the standing gates green: `npm run verify:wave3`
  (`test:desktop-cloud` + `test:web` + `web:build`), root `npm run build`,
  `npm run audit:check`.
- Environment honesty: work requiring a live Supabase stack, Apple
  notarization credentials, or third-party OAuth apps is marked
  **[env-blocked]** and is specified + test-scaffolded here, never claimed
  as live-verified.

---

## Phase A — Trustworthy team planning (Horizon 1)

Goal: a manager can plan forward, not just observe backward, and every
member's consent and data honesty survives the new capabilities.

### A1. Manager planning scenarios — "What can the team absorb?"

- **Deliverable:** pure `apps/web/lib/scenario.ts` (absorption assessment
  over shared, fresh snapshot data) + `scenario.test.ts` + a
  "Planning scenario" panel on the manager team view.
- **Honesty contract:** the verdict must return *insufficient shared data*
  when too few members share fresh capacity — no numeric absorbability
  claim manufactured from partial data; the shared-count denominator is
  always displayed; per-member details are id-keyed and non-ranked.
- **Acceptance:** new tests cover empty team, nobody-sharing,
  mixed stale/fresh exclusion, null-never-zero, ask-exceeds-headroom, and
  determinism; `test:web` and `web:build` green.
- **Status: DONE (July 19, 2026)** — see §Status log below.

### A2. Weekly history and trend explanations

- **Deliverable:** pure trend module comparing a team's latest snapshots to
  its own prior weeks (per-member week-over-week deltas of *shared* metrics
  only; team-level median drift), plus dashboard rendering with explicit
  "compared to your own history, not a benchmark" labeling.
- **Precondition:** snapshot history retrieval (`snapshots.ts` currently
  fetches latest-per-member; extend with a bounded history query + fixture
  tests).
- **Acceptance:** deltas never computed across a share-level change without
  labeling; missing prior week → "no history" not zero-delta; tests green.
- **Status: DONE (July 19, 2026)** — see §Status log below.

### A3. Consent receipts and cloud retention controls

- **Deliverable (desktop):** a durable, exportable consent receipt written
  at every approved share — timestamp, snapshot id, exact field allowlist,
  share level, destination — building on `createCloudSharingAuditEvent`
  (`apps/desktop/src/lib/audit.ts`) and surfaced in the audit screen with
  export via `dataExport.ts`.
- **Deliverable (web):** retention statement + per-member revocation
  already exist; add a visible retention window statement sourced from one
  config constant, not prose.
- **Acceptance:** receipt content proven byte-exact against the approved
  payload allowlist in tests; backup/export excludes tokens (existing
  invariant re-asserted in tests).
- **Status: DONE (July 19, 2026)** — see §Status log below.

### A4. Secure macOS Keychain session storage **[env-blocked for live proof]**

- **Deliverable:** storage adapter interface extracted from
  `cloudStore.ts` token persistence with a Keychain-backed implementation
  behind a capability check, falling back to the current storage;
  fixture-tested adapter contract now, live Keychain verification when a
  packaged build exists.
- **Status: ADAPTER DONE (July 19, 2026); live Keychain proof
  [env-blocked]** — see §Status log below.

### A5. Deep-link/browser pairing & notarized distribution **[env-blocked]**

- Specification + threat model first (pairing token lifetime, one-shot
  exchange, PKCE-style verifier); implementation deferred until a signing
  identity and hosted callback exist. No code should pretend to pair
  without the live path.
- **Status: SPEC DONE (July 19, 2026)** —
  `docs/WEEKFORM_PAIRING_SPEC.md`: current-state statement (password grant
  in `cloudClient.ts`, no deep link, source-build only), normative PKCE-style
  flow (≥256-bit CSPRNG verifier, SHA-256 challenge, user-code
  display-and-compare, TTL ≤ 5 min, atomic one-shot redeem), a seven-threat
  model (deep-link hijack, pairing-link phishing, replay, brute-force,
  token-at-rest, look-alike builds, init spam) with mitigations mapped to
  the flow, and an explicit implementation-blocked exit checklist (signing
  identity, hosted endpoints, A4 landed). Implementation remains
  deliberately absent per the ground rule above.

### A6. Multiple per-team share policies

- **Deliverable:** policy schema (e.g. `metrics_only`, `metrics+summary`)
  validated in `cloudPolicy.ts`, member-side enforcement in the allowlist
  builder (a policy can only *narrow*, never widen, member consent), web
  team-settings UI. Pure policy-merge function with adversarial tests
  (server-supplied policy attempting to widen scope must be clamped).
- **Status: DONE (July 19, 2026)** — see §Status log below. Live RLS write
  path **[env-blocked]**: the migration is committed, not applied to any
  live stack.

### A7. Team-level forecasting calibrated against outcomes

- Depends on A2 (history). Deliverable: forecast module that states its
  input window and error band, calibrated only against the team's own
  past weeks; explicitly labeled prototype. No delivery until A2's history
  substrate is real.
- **Status (2026-07-19): DONE via PT2 Prompt 13.** Pure module
  `apps/web/lib/forecast.ts` (median + min–max range over a 6-week window
  mirroring desktop `BASELINE_WINDOW_WEEKS`; walk-forward calibration
  replaying the same rule against each past week's actual) with
  `forecast.test.ts` (12 tests, written first: empty history, single week,
  coverage thresholds, calibration hit/miss, widening guard) and a
  cross-check test in `packages/inference/src/capacity.forecastScorer.test.ts`
  pinning the mirrored scorer to `scoreForecastAccuracy` on a shared fixture.
  Forecast panel on the manager team page with explicit coverage
  (n shared / n members) and "insufficient shared data" below threshold —
  nulls never zero, team medians/ranges only, no per-member numbers.
  Gates 2026-07-19: `verify:wave3` exit 0 (97/97 desktop-cloud, 161/161 web),
  `build` exit 0, `audit:check` 0 vulnerabilities.

**Phase A exit criteria:** A1–A3 + A6 shipped and gate-green; A4–A5 specified
with adapter/tests in place and live steps documented as operator-pending;
blueprint §17 and this file updated with evidence.

---

## Phase B — Workload operations (Horizon 2)

Goal: Weekform participates in the team's operating rhythm instead of being
a dashboard someone remembers to check. Each integration stays
metadata-minimal: titles/ids only where consented, never message bodies.

- **B1. Weekly review ritual — SHIPPED July 19, 2026:** a deterministic,
  local-only closing-week checklist over reviewed work blocks, flagged captures,
  forecast-vs-actual evidence, narrative availability, and optional approved-share
  proof. It hands off to existing review surfaces and records one privacy-minimal,
  idempotent completion audit event; no streaks, score, nag, or network path.
- **B2. Manager action follow-through — IMPLEMENTED; REVIEW July 19, 2026:** managers can
  record a clamped action against an allowlisted briefing risk signal, resolve
  or drop it, and revisit a team-level “what changed after” median only after
  two distinct later weeks exist. The result is explicitly correlation, never
  cause or individual attribution. The RLS migration is committed for SQL
  review but remains unapplied/live-unverified in this environment. The
  mandatory fresh audit is registry-DNS-blocked, so B2 is not yet gate-green
  or shipped.
- **B3. Slack/Teams/Jira/Linear connectors [env-blocked]:** contract-first —
  a `ConnectorSignalV1` schema (counts and time-shape only), per-connector
  allowlist preview identical in UX to the share preview, fixture-tested
  mappers before any OAuth app exists.
- **B4. Project/stakeholder demand mapping & capacity reservations:**
  extends A1's scenario engine from a single ask to named demand streams;
  reservation = a labeled claim against median shared headroom, never a
  per-person assignment quota.
- **B5. Role-based client views:** read-only stakeholder view derived from
  the manager view minus member-level detail; enforced by the same RLS
  posture as existing roles (policy tests first).

**Phase B exit criteria:** B1–B2 shipped gate-green on synthetic data; B3
schema + mappers merged with fixtures; B4 shipped atop A1; B5 policy-tested.

---

## Phase C — Workload Intelligence platform (Horizon 3)

Goal: multi-team scale without abandoning the consent model that makes the
data trustworthy in the first place.

- **C1. Multi-team organizations and portfolios:** org → teams → members
  schema; org-level views aggregate *team medians*, never reach through to
  members below the aggregation minimum.
- **C2. Privacy thresholds and aggregation minimums:** org-wide patterns
  render only when ≥ N members share (N a visible constant); below
  threshold the UI says so rather than showing wide-interval guesses.
- **C3. Self-benchmarking only:** trend baselines are the team's own
  history (A2/A7 substrate); no cross-org or global worker rankings, ever.
- **C4. Explainable resource-planning APIs:** the scenario/forecast engines
  exposed as documented, versioned pure endpoints that return their
  evidence and confidence with every answer.
- **C5. Customer-controlled data residency & policy administration
  [env-blocked]:** deployment-profile documentation and config surface;
  admin policies can restrict but never override member consent (same
  clamp rule as A6, org-scoped).
- **C6. Outcome learning:** did meeting reduction / rebalancing /
  automation improve delivery reliability? Requires B2's action-outcome
  records; ships as labeled observational analysis, not causal claims.

**Phase C exit criteria:** C1–C4 shipped gate-green on synthetic multi-team
fixtures; C5 documented; C6 running on ≥ 4 weeks of action-outcome data.

---

## Sequencing and dependency spine

```text
A1 (scenario engine) ──► B4 (demand streams) ──► C4 (planning APIs)
A2 (history)        ──► A7 (forecasting)    ──► C6 (outcome learning)
A3 (consent receipts) ─► B3 (connectors)    ──► C5 (residency/policy)
A6 (share policies) ──► B5 (client views)   ──► C1/C2 (org aggregation)
B1 (ritual) ──► B2 (follow-through) ──► C6
```

Every phase is independently shippable; nothing in B/C is started before its
Phase A dependency is gate-green.

## Status log

- **July 19, 2026 — A1 DONE.** Pure `apps/web/lib/scenario.ts` absorption
  planner: `assessAbsorption(memberCount, snapshots, ask, nowIso)` (roster
  size is the honest coverage denominator; ask is percent-only because
  snapshots carry no hours basis; non-positive/non-finite asks throw
  `RangeError`). Verdicts `absorbable-within-shared-data` / `at-risk` /
  `insufficient-shared-data` — the last returned (with `headroom: null`,
  so no numeric claim exists) below the labeled prototype floors
  `MIN_SCENARIO_SHARED_COUNT = 2` and `MIN_SCENARIO_SHARED_RATIO = 0.5`.
  Per-member id-keyed non-ranked statuses: `fits` / `tight` / `exceeds` /
  `not-shared` / `stale-excluded`. `scenario.test.ts` adds 12 node:test
  tests (empty team, nobody-sharing refusal, stale values provably not
  inflating the median, null ≠ zero via median-differs proof, median
  boundary, coverage-ratio floor, single-sharer refusal, invalid-ask
  `RangeError`, determinism via `deepEqual`, label copy). Server-rendered
  "Planning scenario" panel in `ManagerView` (+10%/+25% presets, always-
  visible shared-count denominator, stale/unknown exclusion counts, and
  insufficient-data refusal text; no new client JS). Gates: `test:web`
  114/114 (102 pre-existing + 12 new), `web:build` exit 0 (12 routes / 11
  static pages), `verify:wave3` exit 0.
- **July 19, 2026 — A2 DONE.** History substrate: `listTeamSnapshotHistory`
  in `apps/web/lib/snapshots.ts` queries the `workload_snapshots` base table
  directly (the `latest_team_snapshots` view is `distinct on` newest-per-
  member, so prior weeks are invisible through it; the base table's
  `snapshots_select_authorized` RLS policy plus
  `workload_snapshots_team_user_observed_idx` make the direct query
  authorized and indexed), explicit `SNAPSHOT_COLUMNS`, ordered
  `observed_at desc`, limit clamped to [1, `HISTORY_ROW_LIMIT` = 400].
  Pure `apps/web/lib/trends.ts`: groups rows by `week_id`, per-member
  week-over-week deltas of shared metrics only, team-level median drift for
  the two most recent informative weeks; verdict `computed` / `no-history`.
  Honesty rules (each tested): missing prior week → `no-history` member
  status, never a zero delta; null metric in either week → null delta with
  `not-shared` reason; share-level change → member flagged
  `shareLevelChanged` and excluded from all metric medians (the stricter
  choice); staleness (reused `classifyFreshness` from `workload.ts`,
  verbatim) gates the anchor week only — history is definitionally old, so
  prior-week baselines are exempt, and this scoping is documented in the
  module docstring; baseline selection skips weeks with no shared metrics;
  fewer than two informative weeks → team verdict `no-history` with no
  fabricated drift; deterministic, id-keyed, non-ranked output. Exported
  `TREND_BASELINE_LABEL` ("Compared to this team's own history, not a
  benchmark.") rendered in a server-only "Weekly trend" panel in the
  manager team view (median drift per metric with direction wording,
  exclusion counts for stale / not-shared / no-history / share-level
  change, explicit no-history state; reuses A1's panel classes, no new
  client JS). Tests: +21 (16 `trends.test.ts` + 5 `snapshots.test.ts`).
  Gates: `test:desktop-cloud` 60/60, `test:web` 135/135, `web:build` exit 0
  (12 routes / 11 static pages), `verify:wave3` exit 0 — evidence in
  `.absoloop/evidence/verify-wave3-a2-trends.log`.
- **July 19, 2026 — A3 DONE.** Consent receipts (desktop): pure
  `apps/desktop/src/services/consentReceipt.ts` — `buildConsentReceipt`
  derives a durable `ConsentReceiptV1` from the exact approved
  `SharedWorkloadSnapshotV1` payload (timestamp, snapshot id, week, share
  level, destination team, and `payloadFieldAllowlist(payload)` — the field
  list is computed from the payload itself, never hand-assembled, so the
  receipt cannot claim a different allowlist than what was sent);
  `verifyConsentReceipt` re-derives and compares byte-exact (order-sensitive,
  not set-equal) in both directions; `parseConsentReceipts` drops malformed
  rows whole on load. Receipts persist in `localStore.ts`
  (`consentReceipts`, defensively parsed at line ~856), are written on every
  approved share, surfaced in the audit screen (`AuditLogScreen.tsx`), and
  export via `serializeConsentReceipts` in `dataExport.ts` (JSON envelope +
  CSV with the exact allowlist serialized). `createCloudSharingAuditEvent`
  (`lib/audit.ts`) records the seven discrete Account & Sharing actions with
  honest privacy levels (`derived_only` only for the three network
  mutations) and hard-coded `auth_tokens: false` / `raw_activity: false`
  detail guards. Web retention: `apps/web/lib/retention.ts` — the visible
  retention statement is derived by `describeCloudRetention()` from the ONE
  config constant `CLOUD_RETENTION_WINDOW_DAYS` (honestly `null`: no
  automatic expiry exists, which is stated as such, never rendered as 0 or
  an invented window), rendered on the member dashboard. New suites:
  `consentReceipt.test.ts` (byte-exact verification both directions,
  order-only allowlist difference fails, envelope divergence named,
  malformed rows dropped whole, backup-includes-receipts-but-never-tokens,
  receipt-never-contains-token/session/raw-activity material) and
  `retention.test.ts` (null-window honesty, positive-integer window
  validation fails loudly).
- **July 19, 2026 — A6 DONE (client + schema; live RLS write env-blocked).**
  Narrowing-only per-team share policy. Schema:
  `supabase/migrations/202607190002_team_share_policy.sql` adds
  `teams.share_policy` jsonb (`{version, maxShareLevel, acceptedMetrics}`;
  NULL = no policy, member consent applies unchanged), readable by members
  and writable only by owners/managers under the existing
  `teams_update_managers` RLS — committed for review, **not applied to any
  live stack**. Enforcement is client-side intersection, so a hostile or
  corrupt server value can never widen anything: desktop
  `parseTeamSharePolicy` (malformed content degrades toward the narrowest
  reading) + `applyTeamSharePolicy` (member consent ∩ team policy, applied
  in `useCloudSync` before any payload is built) in
  `apps/desktop/src/services/cloudPolicy.ts`, with adversarial
  widening-attempt tests in `cloudPolicy.test.ts`; web mirror
  `apps/web/lib/teamPolicy.ts` (same ladder `summary`/`categories`/
  `projects`, no new level names, fixed `TEAM_POLICY_NARROWING_NOTE` copy)
  + `teamPolicy.test.ts`, manager team-settings write path in
  `app/teams/actions.ts` and policy display on the team page. Combined
  A3+A6 gates (re-run after the cut-off iteration, July 19, 2026):
  `test:desktop-cloud` 86/86, `test:web` 150/150, `web:build` exit 0 (12
  routes / 11 static pages), `verify:wave3` exit 0
  (`.absoloop/evidence/verify-wave3-a3-receipts.log`), root `npm run build`
  exit 0 (`.absoloop/evidence/gate-root-build-a3.txt`), `npm run
  audit:check` exit 0 / 0 vulnerabilities
  (`.absoloop/evidence/audit-check-a3a6.txt`).
- **July 19, 2026 — A4 ADAPTER DONE (live Keychain proof env-blocked).**
  `apps/desktop/src/services/sessionStorage.ts`: `SessionStorageAdapter`
  interface (read/write/delete of the raw session envelope only — mirrors
  exactly what `cloudStore.ts` did, no invented capabilities);
  `defaultSessionStorageAdapter` carries the prior Tauri-Store/localStorage
  behavior verbatim; `keychainSessionStorageAdapter` stub behind a
  `keychainAvailable()` probe (honestly returns false — no native bridge
  exists; the documented `KeychainBridge` plug-in point is
  `window.__WEEKFORM_KEYCHAIN__`, and the stub THROWS rather than faking
  success); `resolveSessionStorageAdapter()` selects with DI overrides and
  a throw-safe probe, falling back to the default adapter.
  `cloudStore.ts` public API unchanged and its existing tests pass
  unmodified. 12 new contract tests (`sessionStorage.test.ts`): round-trip
  through a fake adapter, corrupt-envelope degradation through the seam,
  capability-absent → fallback selected, capability-present → keychain
  adapter used exclusively (zero fallback traffic, so tokens provably
  never reach the fallback), delete/disconnect via the active adapter.
  Live Keychain verification remains env-blocked until a packaged build
  ships a bridge. Gates (independently re-run): `test:desktop-cloud`
  97/97, `verify:wave3` exit 0 (97/97 + 150/150, 12 routes / 11 static
  pages) — `.absoloop/evidence/verify-wave3-a4-adapter.log`.
- **July 19, 2026 — A5 SPEC DONE.** `docs/WEEKFORM_PAIRING_SPEC.md` (see
  the A5 section above for contents). Implementation deliberately absent
  per the no-pretend-pairing ground rule.
- **Phase A position: COMPLETE (July 19, 2026).** A1–A3 + A6
  shipped and gate-green; A4–A5 specified with the adapter and its
  contract tests in place and live steps documented as operator-pending;
  A7 forecasting is now shipped atop A2's history substrate via PT2 Prompt
  13. Phase B is unblocked on every dependency except B3's live connectors
  and can start with B1.
- **July 19, 2026 — Part 2 runbook authored.** The remaining roadmap work
  is now prompt-driven: `docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK_PT2.md`
  opens with a full state-vs-blueprint gap analysis (gap matrix G1–G10) and
  maps A7 → Prompt 13, B1/B2/B4 → Prompts 15/16/17, contract-first B3 + B5
  → Prompt 18 [live OAuth env-blocked], C2/C3 → Prompt 19, C1/C4 → Prompt
  20, plus an experience-excellence pass (Prompt 14) and an independent
  Part 2 critic gate (Prompt 21). Baseline gates re-run at authoring:
  `verify:wave3` exit 0 (97/97 desktop-cloud, 150/150 web, 12 routes / 11
  static pages); `audit:check` 0 vulnerabilities. C5 remains [env-blocked];
  C6 remains future. Execution started with Prompt 13 and the Prompt 14
  experience-excellence pass.
- **July 19, 2026 — Part 2 accuracy review.** An independent same-day pass
  verified every file, symbol, and count PT2 cites against the working
  tree (15 cited source paths, `scoreForecastAccuracy`, connector stubs,
  Keychain honesty contract, hashed invite tokens, signed-URL artifact
  route, proactive alerts module, 4 packages, 3 migrations, 19 test
  files). One citation corrected: `listTeamSnapshotHistory` is in
  `apps/web/lib/snapshots.ts`, not `trends.ts`; Prompt 18's B5 premise was
  tightened to name the actual `isManagerRole` branch point. All three
  standing gates re-run during the review: `verify:wave3` exit 0 (97/97,
  150/150, 11/11 static pages), root `build` exit 0, `audit:check` exit 0
  with 0 vulnerabilities in both workspaces.
- **July 19, 2026 — Prompt 14 EXPERIENCE EXCELLENCE DONE.** The audit-first
  `docs/hackathon/TEAM_CLAWFATHER_UX_AUDIT.md` inventories 86 desktop/web
  state rows and maps all 20 `fix` verdicts to their source resolutions.
  Desktop loading/error semantics, destructive confirmations, native-reset
  confirmation routing, and Cloud freshness vocabulary now converge; web
  server-action pending states and destructive confirmations use the shared
  `FormSubmitButton`, and `approvedSnapshotProvenance` is the canonical source
  for team aggregate/scenario/trend/forecast/briefing coverage. The test
  scripts now use the equivalent IPC-free `node --import tsx --test` runner so
  the documented standing command executes in the managed environment.
  Final runnable gates: `verify:wave3` exit 0 (97/97 desktop-cloud, 162/162
  web, 12 routes / 11 static pages) and root `build` exit 0. The
  `audit:check` rerun was registry-DNS-blocked (`ENOTFOUND`); no dependency
  changed, and the last same-day successful audit remains 0 vulnerabilities.
  Prompt 15 (B1) shipped and Prompt 16 (B2) is implemented at REVIEW; Prompt 17
  remains blocked behind Prompt 16's fresh audit gate rather than starting next.
  Phase B slice.
- **July 19, 2026 — Prompt 15 WEEKLY REVIEW RITUAL DONE.** A pure
  `apps/desktop/src/services/weeklyReview.ts` module derives a normalized,
  week-scoped checklist from existing local evidence only. The routed Week review
  links to the ledger, flagged captures, forecast, narrative, and exact share
  preview; disabled sharing removes the share item, while enabled sharing requires
  a matching sync-success audit and consent receipt. Completion emits one
  ids/counts-only local audit event per week. TDD moved from an expected missing-
  module failure to 6/6 focused tests. Final runnable gates: `verify:wave3` exit 0
  (103/103 desktop-cloud, 162/162 web, 12 routes / 11 static pages), root `build`
  exit 0, and diff check exit 0. `audit:check` ran but was DNS-blocked at the npm
  registry; no dependency changed. Browser QA was attempted but the managed
  sandbox could not write agent-browser's socket directory, so no screenshot is
  claimed.
- **July 19, 2026 — Prompt 16 MANAGER ACTION FOLLOW-THROUGH REVIEW.** The new
  `team_actions` migration is explicitly SQL-review-only, forces RLS, and limits
  authenticated access to owners/managers of the scoped team. Pure
  `apps/web/lib/actions.ts` wrappers deny member roles before querying, clamp
  action text to 500 characters, accept only a closed briefing-risk key, and
  compute team medians only after two distinct later weeks; dropped actions are
  excluded. The manager Actions panel reports safe write failures, open/resolve/
  drop state, “Too early to tell,” and correlation-only “What changed after”
  copy. A follow-up security pass removed direct table INSERT, added the narrow
  manager-authorized creation RPC. Loop `loop-20260719-135748-556358` then
  removed direct UPDATE/DELETE too, moved resolution/deletion behind narrow
  manager RPCs, server-derived resolution time, and expanded the four-actor
  pgTAP contract to 76 assertions, including direct member UPDATE/DELETE and
  outsider resolve/delete attempts. Fresh gates: focused boundary tests 17/17;
  `verify:wave3` exit 0 (111/111 desktop-cloud, 179/179 web, 12 routes / 11
  static pages); root `build` exit 0. Seventeen fresh `audit:check` attempts exited
  1 with registry DNS `ENOTFOUND`; the two iteration-9 attempts stopped at the root audit
  before the web audit could run, so Prompt 16 is REVIEW, not DONE. Live migration/RLS execution
  remains environment-blocked.
