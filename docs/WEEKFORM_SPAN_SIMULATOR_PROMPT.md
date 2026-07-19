# Mission: Build Weekform Span Simulator

Act as the lead product architect and implementation agent for an advanced, admin-only Weekform product called **Weekform Span Simulator**.

## Product objective

Create a working vertical slice that lets an authorized Weekform administrator:

1. Select one or more realistic professional personas representing prospective Weekform users.
2. Configure a simulation span of N weeks, months, or years.
3. Define scenario conditions such as deadlines, meeting load, reactive work, interruptions, PTO, project mix, workload intensity, timezone, working days, and random seed.
4. Generate authentic-looking synthetic activity through Weekform’s real domain and inference pipeline.
5. Optionally execute a Playwright-style **controlled local playback** on the administrator’s Mac.
6. Review the complete generated dataset, timeline, weekly history, capacity results, forecasts, acceleration opportunities, and team-dashboard representation.
7. Replay, clone, compare, export, archive, or permanently delete simulation runs.

This is a synthetic-data and product-testing system. It must never impersonate a real employee, touch real accounts, or make synthetic records indistinguishable from genuine workload data.

## Execution approach

Begin by reading `AGENTS.md`, the current domain models, sessionizer, capacity model, demo-data implementation, persistence layer, team-cloud schema, manager dashboard, and Supabase policies. Map the current paths before editing; do not assume planned files already exist.

Use parallel read-only subagents for:

- domain-model and pipeline mapping;
- persona and realism-system design;
- Admin UI/UX design;
- security, RLS, privacy, and synthetic-data isolation review.

Then coordinate implementation with one writer per file boundary. Do not stop at a plan or leave placeholder screens.

## Required architecture

Prefer a pure, reusable simulator package such as `packages/simulator/`, an admin route such as `/admin/span-simulator`, Supabase migrations for run history, and a local runner under the desktop or scripts area. Adapt paths to the actual repository.

The simulation engine must be deterministic from:

```text
persona version + scenario version + date range + timezone + seed
```

The same inputs must produce the same canonical dataset.

Generate upstream evidence first and run it through existing Weekform logic:

```text
synthetic raw signals
→ active-window samples and imported events
→ sessions
→ work blocks
→ corrections and reviews
→ weekly capacity snapshots
→ forecasts, narratives, acceleration signals, audit events
→ consent-safe team snapshots
```

Do **not** directly invent final capacity percentages or manager-dashboard cards.

## Persona system

Ship a versioned starter catalog including at least:

- Data Analyst
- Software Engineer
- Product Manager
- Product Designer
- Customer Support Lead
- Sales Account Executive
- Marketing Manager
- Finance Analyst
- Operations Manager
- Consultant

Each persona should define realistic responsibility patterns, project types, app/context families, work categories, meeting behavior, deep-work cadence, reactive-load profile, interruption frequency, stakeholder mix, typical workday, and seasonal pressures.

Admins must be able to inspect and clone a persona. Custom persona creation may use GPT-5.6 to convert a natural-language job description into schema-validated simulation constraints.

AI may act as a **Scenario Director**, but it must not directly generate authoritative metrics or unvalidated database rows. The seeded simulator remains the source of truth.

## Simulation controls

Support:

- one or more personas and simulated-member count;
- start date and N weeks/months/years;
- timezone, workweek, holidays, PTO, and working hours;
- normal, quiet, busy, deadline-heavy, incident, launch, and quarter-end scenarios;
- meeting density, reactive load, fragmentation, project count, overtime, and interruption controls;
- optional natural-language scenario direction;
- deterministic seed;
- data-sharing policy used to create the cloud-facing snapshot.

Long spans must use a virtual clock and chunked generation. A multi-year run must complete through fast-forward generation rather than waiting in real time.

## Two execution modes

### 1. Fast Forward — required

Generate the complete historical dataset rapidly in a worker or background job, stream progress by week, persist resumable checkpoints, and calculate all Weekform outputs.

### 2. Controlled Local Playback — advanced

Provide a Playwright-style local runner that opens only sandboxed Weekform-owned demo pages or mock applications representing email, documents, BI, chat, meetings, code, CRM, and project tools.

It may perform visible clicks, typing, navigation, tab switching, and timed context changes for demonstration, but:

- it must never automate arbitrary real applications;
- it must never send real email, chat, purchases, commits, or external mutations;
- it must use a dedicated browser profile and synthetic credentials;
- it must be cancelable immediately;
- it must feed the same simulator adapter and canonical event schema as Fast Forward;
- it must be behind an explicit “Local playback” confirmation and feature flag.

## Admin experience

Build a polished workflow:

```text
Persona & Team
→ Span
→ Scenario
→ Sharing Policy
→ Preflight Preview
→ Run
→ Results & History
```

Show:

- estimated record volume and execution mode before launch;
- live progress, virtual date, current persona, generation phase, and cancel control;
- synthetic member profiles with permanent **SIMULATED** badges;
- daily and weekly timelines;
- workload, capacity, meetings, reactive load, fragmentation, WIP, blockers, and acceleration trends;
- generated corrections, audit history, forecasts, narratives, and shared snapshots;
- realism-quality report and any constraint violations;
- side-by-side run comparison;
- JSON/CSV export;
- clone, rerun, archive, and cascade-delete controls.

Simulated data must be excluded from real team metrics by default. Managers may explicitly toggle “Include simulations” in an isolated demo or planning view.

## Storage and security

Add versioned records such as:

- `simulation_personas`
- `simulation_runs`
- `simulation_members`
- `simulation_artifacts`
- `simulation_week_snapshots`

Every generated row must carry:

```text
is_synthetic = true
simulation_run_id
persona_version
generator_version
seed
```

Require Admin authorization and RLS. A normal manager or member must not create, mutate, or enumerate simulation runs unless explicitly granted a simulator-admin role.

Never use real PII, credentials, window titles, screenshots, calendars, or customer data. Audit run creation, execution, cancellation, export, archive, and deletion.

## Realism requirements

Model correlated behavior rather than random noise:

- deep-work blocks broken by realistic interruptions;
- recurring meetings and occasional double-booking;
- deadline ramps and post-launch recovery;
- role-appropriate project and stakeholder patterns;
- weekday and time-of-day variation;
- PTO, holidays, onboarding, quiet weeks, incidents, and seasonal cycles;
- plausible corrections and confidence levels;
- longitudinal changes in capacity and work habits.

Add a validator that checks date boundaries, impossible overlaps, weekend behavior, distribution plausibility, metric consistency, missing evidence, and privacy violations.

## Golden acceptance scenario

An Admin selects:

```text
Persona: Senior Data Analyst
Span: 26 weeks
Scenario: Quarter-end reporting plus an urgent dashboard migration
Timezone: America/New_York
Seed: 20260718
Sharing: summary + categories
```

Expected result:

- the run produces a complete deterministic dataset;
- actual Weekform sessionization and capacity logic derive the results;
- the simulated member appears in an isolated manager simulation view;
- weekly history shows realistic deadline ramps, reactive spikes, recovery, and capacity changes;
- the Admin can inspect raw synthetic evidence, derived work blocks, corrections, audits, forecasts, narratives, and acceleration plays;
- replaying the seed reproduces the same canonical records;
- a non-admin is denied;
- deleting the run removes all related synthetic data;
- no real user state is altered.

## Validation

Add focused automated tests for:

- deterministic generation;
- persona and scenario schema validation;
- span and timezone correctness;
- chunked resume behavior;
- no forbidden fields or real PII;
- reuse of the real inference pipeline;
- synthetic/real data isolation;
- RLS positive and negative cases;
- cancellation and deletion;
- export integrity;
- manager-dashboard inclusion toggle;
- local-playback sandbox restrictions.

Run the repository’s full build, dependency audit, Rust check when native code changes, web tests, Supabase policy tests, and a production build of every changed application.

## Deliverables

Return:

1. working implementation;
2. migrations and RLS policies;
3. seeded persona catalog;
4. Fast Forward engine;
5. controlled local-playback proof of concept;
6. Admin UI;
7. tests and validation evidence;
8. demo scenario and screenshots;
9. concise architecture and privacy documentation;
10. exact changed files, commands run, results, limitations, and next highest-leverage upgrade.

Prioritize the complete Fast Forward vertical slice before optional playback polish. The finished product must feel like an advanced workload laboratory, not a generic fake-data generator.
