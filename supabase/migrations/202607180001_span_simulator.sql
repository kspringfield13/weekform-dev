-- Weekform Span Simulator v1
-- Self-contained Supabase migration. This file is committed for review; repository
-- presence is not evidence that it has been applied to any local or hosted project.

begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Simulator authorization is deliberately independent of team roles and user-editable
-- metadata. Bootstrap rows must be inserted by a trusted database operator/service role.
create table if not exists private.simulator_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  reason text not null default 'Explicit simulator administrator grant',
  constraint simulator_admin_reason_length check (char_length(btrim(reason)) between 1 and 500)
);

revoke all on table private.simulator_admins from public, anon, authenticated;

create or replace function private.is_simulator_admin(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select check_user_id is not null and exists (
    select 1
    from private.simulator_admins administrator
    where administrator.user_id = check_user_id
  );
$$;

revoke all on function private.is_simulator_admin(uuid) from public;
grant execute on function private.is_simulator_admin(uuid) to authenticated;

create table if not exists public.simulation_personas (
  persona_id uuid primary key default gen_random_uuid(),
  slug text not null,
  persona_version integer not null,
  name text not null,
  definition jsonb not null,
  is_builtin boolean not null default false,
  is_synthetic boolean not null default true,
  generator_version text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug, persona_version),
  unique (persona_id, persona_version),
  constraint simulation_personas_slug check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint simulation_personas_version check (persona_version > 0),
  constraint simulation_personas_name check (char_length(btrim(name)) between 1 and 120),
  constraint simulation_personas_definition check (jsonb_typeof(definition) = 'object'),
  constraint simulation_personas_generator check (char_length(btrim(generator_version)) between 1 and 80),
  constraint simulation_personas_synthetic check (is_synthetic is true)
);

create table if not exists public.simulation_runs (
  simulation_run_id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  status text not null default 'queued',
  execution_mode text not null default 'fast_forward',
  config jsonb not null,
  sharing_policy jsonb not null,
  persona_version text not null,
  scenario_version text not null,
  generator_version text not null,
  seed bigint not null,
  canonical_fingerprint text,
  is_synthetic boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint simulation_runs_schema_version check (schema_version = 1),
  constraint simulation_runs_status check (
    status in ('queued', 'running', 'completed', 'failed', 'cancelled', 'archived')
  ),
  constraint simulation_runs_execution_mode check (
    execution_mode in ('fast_forward', 'local_playback')
  ),
  constraint simulation_runs_config check (jsonb_typeof(config) = 'object'),
  constraint simulation_runs_sharing check (jsonb_typeof(sharing_policy) = 'object'),
  constraint simulation_runs_persona_version check (char_length(btrim(persona_version)) between 1 and 500),
  constraint simulation_runs_scenario_version check (char_length(btrim(scenario_version)) between 1 and 80),
  constraint simulation_runs_generator_version check (char_length(btrim(generator_version)) between 1 and 80),
  constraint simulation_runs_fingerprint check (
    canonical_fingerprint is null or canonical_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint simulation_runs_synthetic check (is_synthetic is true),
  constraint simulation_runs_lifecycle check (
    (status <> 'completed' or completed_at is not null)
    and (status <> 'cancelled' or cancelled_at is not null)
    and (status <> 'archived' or archived_at is not null)
  )
);

create table if not exists public.simulation_members (
  simulation_member_id uuid primary key default gen_random_uuid(),
  simulation_run_id uuid not null references public.simulation_runs(simulation_run_id) on delete cascade,
  persona_id uuid not null,
  persona_version integer not null,
  member_key text not null,
  display_name text not null,
  simulated_badge text not null default 'SIMULATED',
  generator_version text not null,
  seed bigint not null,
  is_synthetic boolean not null default true,
  created_at timestamptz not null default now(),
  unique (simulation_run_id, simulation_member_id),
  unique (simulation_run_id, member_key),
  foreign key (persona_id, persona_version)
    references public.simulation_personas(persona_id, persona_version) on delete restrict,
  constraint simulation_members_key check (member_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint simulation_members_display_name check (
    char_length(btrim(display_name)) between 1 and 120
    and position('SIMULATED' in upper(display_name)) > 0
  ),
  constraint simulation_members_badge check (simulated_badge = 'SIMULATED'),
  constraint simulation_members_persona_version check (persona_version > 0),
  constraint simulation_members_generator check (char_length(btrim(generator_version)) between 1 and 80),
  constraint simulation_members_synthetic check (is_synthetic is true)
);

create table if not exists public.simulation_artifacts (
  simulation_artifact_id uuid primary key default gen_random_uuid(),
  simulation_run_id uuid not null,
  simulation_member_id uuid not null,
  artifact_kind text not null,
  week_id text,
  payload jsonb not null,
  content_hash text not null,
  persona_version integer not null,
  generator_version text not null,
  seed bigint not null,
  is_synthetic boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (simulation_run_id, simulation_member_id)
    references public.simulation_members(simulation_run_id, simulation_member_id) on delete cascade,
  constraint simulation_artifacts_kind check (
    artifact_kind in (
      'raw_event', 'active_window_sample', 'activity_session', 'calendar_event',
      'work_block', 'correction', 'weekly_snapshot', 'narrative',
      'acceleration_signal', 'forecast', 'shared_snapshot', 'audit_event',
      'checkpoint', 'export_manifest'
    )
  ),
  constraint simulation_artifacts_week_id check (
    week_id is null or week_id ~ '^[0-9]{4}-W[0-9]{2}$'
  ),
  constraint simulation_artifacts_payload check (jsonb_typeof(payload) = 'object'),
  constraint simulation_artifacts_hash check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint simulation_artifacts_persona_version check (persona_version > 0),
  constraint simulation_artifacts_generator check (char_length(btrim(generator_version)) between 1 and 80),
  constraint simulation_artifacts_synthetic check (is_synthetic is true)
);

create table if not exists public.simulation_week_snapshots (
  simulation_week_snapshot_id uuid primary key default gen_random_uuid(),
  simulation_run_id uuid not null,
  simulation_member_id uuid not null,
  week_id text not null,
  snapshot jsonb not null,
  reliable_new_work_capacity_pct numeric not null,
  allocated_pct numeric not null,
  reactive_pct numeric not null,
  meeting_pct numeric not null,
  fragmented_work_pct numeric not null,
  blocked_pct numeric not null,
  context_switch_score numeric not null,
  wip_load_score numeric not null,
  summary_confidence numeric not null,
  category_allocation jsonb,
  work_mode_allocation jsonb,
  sharing_level text not null,
  persona_version integer not null,
  generator_version text not null,
  seed bigint not null,
  is_synthetic boolean not null default true,
  computed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (simulation_run_id, simulation_member_id, week_id),
  foreign key (simulation_run_id, simulation_member_id)
    references public.simulation_members(simulation_run_id, simulation_member_id) on delete cascade,
  constraint simulation_week_snapshots_week check (week_id ~ '^[0-9]{4}-W[0-9]{2}$'),
  constraint simulation_week_snapshots_payload check (jsonb_typeof(snapshot) = 'object'),
  constraint simulation_week_snapshots_pct check (
    reliable_new_work_capacity_pct between 0 and 100
    and allocated_pct between 0 and 1000
    and reactive_pct between 0 and 1000
    and meeting_pct between 0 and 1000
    and fragmented_work_pct between 0 and 1000
    and blocked_pct between 0 and 1000
    and context_switch_score between 0 and 1
    and wip_load_score between 0 and 1
    and summary_confidence between 0 and 1
  ),
  constraint simulation_week_snapshots_allocations check (
    (category_allocation is null or jsonb_typeof(category_allocation) = 'array')
    and (work_mode_allocation is null or jsonb_typeof(work_mode_allocation) = 'array')
  ),
  constraint simulation_week_snapshots_sharing check (
    sharing_level in ('summary', 'categories', 'projects')
  ),
  constraint simulation_week_snapshots_persona_version check (persona_version > 0),
  constraint simulation_week_snapshots_generator check (char_length(btrim(generator_version)) between 1 and 80),
  constraint simulation_week_snapshots_synthetic check (is_synthetic is true)
);

-- Durable administrative receipts are deliberately outside the run cascade. A deletion
-- removes all generated data while preserving a minimal record that an admin performed it.
create table if not exists public.simulation_audit_events (
  simulation_audit_event_id uuid primary key default gen_random_uuid(),
  simulation_run_id uuid,
  action text not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  persona_version text not null,
  generator_version text not null,
  seed bigint not null,
  is_synthetic boolean not null default true,
  created_at timestamptz not null default now(),
  constraint simulation_audit_action check (
    action in ('created', 'started', 'completed', 'failed', 'cancelled', 'export_prepared', 'archived', 'deleted', 'updated')
  ),
  constraint simulation_audit_summary check (char_length(btrim(summary)) between 1 and 500),
  constraint simulation_audit_details check (jsonb_typeof(details) = 'object'),
  constraint simulation_audit_persona_version check (char_length(btrim(persona_version)) between 1 and 500),
  constraint simulation_audit_generator check (char_length(btrim(generator_version)) between 1 and 80),
  constraint simulation_audit_synthetic check (is_synthetic is true)
);

create index if not exists simulation_runs_creator_created_idx
  on public.simulation_runs (created_by, created_at desc);
create index if not exists simulation_members_run_idx
  on public.simulation_members (simulation_run_id, member_key);
create index if not exists simulation_artifacts_run_member_week_idx
  on public.simulation_artifacts (simulation_run_id, simulation_member_id, week_id, artifact_kind);
create index if not exists simulation_week_snapshots_run_week_idx
  on public.simulation_week_snapshots (simulation_run_id, week_id, simulation_member_id);
create index if not exists simulation_audit_run_created_idx
  on public.simulation_audit_events (simulation_run_id, created_at desc);

-- Versioned definitions and canonical run inputs are append-only. Lifecycle fields,
-- completion fingerprints, and timestamps can change without rewriting provenance.
create or replace function private.protect_simulation_persona_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug
     or new.persona_version is distinct from old.persona_version
     or new.name is distinct from old.name
     or new.definition is distinct from old.definition
     or new.is_builtin is distinct from old.is_builtin
     or new.generator_version is distinct from old.generator_version
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.is_synthetic is distinct from old.is_synthetic then
    raise exception 'Create a new persona version instead of rewriting simulation provenance';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.protect_simulation_run_inputs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.schema_version is distinct from old.schema_version
     or new.execution_mode is distinct from old.execution_mode
     or new.config is distinct from old.config
     or new.sharing_policy is distinct from old.sharing_policy
     or new.persona_version is distinct from old.persona_version
     or new.scenario_version is distinct from old.scenario_version
     or new.generator_version is distinct from old.generator_version
     or new.seed is distinct from old.seed
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.is_synthetic is distinct from old.is_synthetic then
    raise exception 'Canonical simulation run inputs and provenance are immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists simulation_personas_protect_version on public.simulation_personas;
create trigger simulation_personas_protect_version
before update on public.simulation_personas
for each row execute function private.protect_simulation_persona_version();

drop trigger if exists simulation_runs_protect_inputs on public.simulation_runs;
create trigger simulation_runs_protect_inputs
before update on public.simulation_runs
for each row execute function private.protect_simulation_run_inputs();

create or replace function private.validate_simulation_member_markers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_generator text;
  expected_seed bigint;
begin
  select run.generator_version, run.seed
    into expected_generator, expected_seed
  from public.simulation_runs run
  where run.simulation_run_id = new.simulation_run_id;

  if not found then
    raise exception 'Simulation run does not exist';
  end if;
  if new.generator_version <> expected_generator or new.seed <> expected_seed then
    raise exception 'Simulation member provenance does not match its run';
  end if;
  return new;
end;
$$;

create or replace function private.validate_simulation_artifact_markers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_persona integer;
  expected_generator text;
  expected_seed bigint;
begin
  select member.persona_version, member.generator_version, member.seed
    into expected_persona, expected_generator, expected_seed
  from public.simulation_members member
  where member.simulation_run_id = new.simulation_run_id
    and member.simulation_member_id = new.simulation_member_id;

  if not found then
    raise exception 'Simulation member does not exist in that run';
  end if;
  if new.persona_version <> expected_persona
     or new.generator_version <> expected_generator
     or new.seed <> expected_seed then
    raise exception 'Simulation artifact provenance does not match its member';
  end if;
  return new;
end;
$$;

drop trigger if exists simulation_members_validate_markers on public.simulation_members;
create trigger simulation_members_validate_markers
before insert or update on public.simulation_members
for each row execute function private.validate_simulation_member_markers();

drop trigger if exists simulation_artifacts_validate_markers on public.simulation_artifacts;
create trigger simulation_artifacts_validate_markers
before insert or update on public.simulation_artifacts
for each row execute function private.validate_simulation_artifact_markers();

drop trigger if exists simulation_week_snapshots_validate_markers on public.simulation_week_snapshots;
create trigger simulation_week_snapshots_validate_markers
before insert or update on public.simulation_week_snapshots
for each row execute function private.validate_simulation_artifact_markers();

create or replace function private.audit_simulation_run_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_action text;
  target public.simulation_runs%rowtype;
begin
  target := case when tg_op = 'DELETE' then old else new end;
  changed_action := case
    when tg_op = 'INSERT' then 'created'
    when tg_op = 'DELETE' then 'deleted'
    when new.status is distinct from old.status and new.status = 'running' then 'started'
    when new.status is distinct from old.status and new.status = 'completed' then 'completed'
    when new.status is distinct from old.status and new.status = 'failed' then 'failed'
    when new.status is distinct from old.status and new.status = 'cancelled' then 'cancelled'
    when new.status is distinct from old.status and new.status = 'archived' then 'archived'
    else 'updated'
  end;

  insert into public.simulation_audit_events (
    simulation_run_id, action, actor_user_id, summary, details,
    persona_version, generator_version, seed, is_synthetic
  ) values (
    target.simulation_run_id,
    changed_action,
    auth.uid(),
    format('Simulation run %s', changed_action),
    jsonb_build_object('status', target.status, 'execution_mode', target.execution_mode),
    target.persona_version,
    target.generator_version,
    target.seed,
    true
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists simulation_runs_audit_change on public.simulation_runs;
create trigger simulation_runs_audit_change
after insert or update or delete on public.simulation_runs
for each row execute function private.audit_simulation_run_change();

create or replace function public.record_simulation_export_prepared(
  target_run_id uuid,
  export_format text,
  artifact_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.simulation_runs%rowtype;
begin
  if not private.is_simulator_admin(auth.uid()) then
    raise exception 'Simulator administrator access required' using errcode = '42501';
  end if;
  if export_format not in ('json', 'csv') or artifact_count < 0 then
    raise exception 'Invalid simulation export receipt';
  end if;

  select * into target
  from public.simulation_runs
  where simulation_run_id = target_run_id;
  if not found then
    raise exception 'Simulation run not found';
  end if;

  insert into public.simulation_audit_events (
    simulation_run_id, action, actor_user_id, summary, details,
    persona_version, generator_version, seed, is_synthetic
  ) values (
    target.simulation_run_id,
    'export_prepared',
    auth.uid(),
    'Simulation export prepared locally',
    jsonb_build_object('format', export_format, 'artifact_count', artifact_count, 'saved_to_disk_confirmed', false),
    target.persona_version,
    target.generator_version,
    target.seed,
    true
  );
end;
$$;

revoke all on function public.record_simulation_export_prepared(uuid, text, integer) from public;
grant execute on function public.record_simulation_export_prepared(uuid, text, integer) to authenticated;

alter table public.simulation_personas enable row level security;
alter table public.simulation_runs enable row level security;
alter table public.simulation_members enable row level security;
alter table public.simulation_artifacts enable row level security;
alter table public.simulation_week_snapshots enable row level security;
alter table public.simulation_audit_events enable row level security;

alter table public.simulation_personas force row level security;
alter table public.simulation_runs force row level security;
alter table public.simulation_members force row level security;
alter table public.simulation_artifacts force row level security;
alter table public.simulation_week_snapshots force row level security;
alter table public.simulation_audit_events force row level security;

create policy simulation_personas_admin_select
on public.simulation_personas for select to authenticated
using ((select private.is_simulator_admin(auth.uid())));

create policy simulation_personas_admin_insert
on public.simulation_personas for insert to authenticated
with check (
  (select private.is_simulator_admin(auth.uid()))
  and created_by = (select auth.uid())
  and is_synthetic is true
);

create policy simulation_personas_admin_delete
on public.simulation_personas for delete to authenticated
using ((select private.is_simulator_admin(auth.uid())));

create policy simulation_runs_admin_select
on public.simulation_runs for select to authenticated
using ((select private.is_simulator_admin(auth.uid())));

create policy simulation_runs_admin_insert
on public.simulation_runs for insert to authenticated
with check (
  (select private.is_simulator_admin(auth.uid()))
  and created_by = (select auth.uid())
  and is_synthetic is true
);

create policy simulation_runs_admin_update
on public.simulation_runs for update to authenticated
using ((select private.is_simulator_admin(auth.uid())))
with check ((select private.is_simulator_admin(auth.uid())) and is_synthetic is true);

create policy simulation_runs_admin_delete
on public.simulation_runs for delete to authenticated
using ((select private.is_simulator_admin(auth.uid())));

create policy simulation_members_admin_select
on public.simulation_members for select to authenticated
using ((select private.is_simulator_admin(auth.uid())));

create policy simulation_members_admin_insert
on public.simulation_members for insert to authenticated
with check ((select private.is_simulator_admin(auth.uid())) and is_synthetic is true);

create policy simulation_members_admin_delete
on public.simulation_members for delete to authenticated
using ((select private.is_simulator_admin(auth.uid())));

create policy simulation_artifacts_admin_select
on public.simulation_artifacts for select to authenticated
using ((select private.is_simulator_admin(auth.uid())));

create policy simulation_artifacts_admin_insert
on public.simulation_artifacts for insert to authenticated
with check ((select private.is_simulator_admin(auth.uid())) and is_synthetic is true);

create policy simulation_artifacts_admin_delete
on public.simulation_artifacts for delete to authenticated
using ((select private.is_simulator_admin(auth.uid())));

create policy simulation_week_snapshots_admin_select
on public.simulation_week_snapshots for select to authenticated
using ((select private.is_simulator_admin(auth.uid())));

create policy simulation_week_snapshots_admin_insert
on public.simulation_week_snapshots for insert to authenticated
with check ((select private.is_simulator_admin(auth.uid())) and is_synthetic is true);

create policy simulation_week_snapshots_admin_delete
on public.simulation_week_snapshots for delete to authenticated
using ((select private.is_simulator_admin(auth.uid())));

create policy simulation_audit_admin_select
on public.simulation_audit_events for select to authenticated
using ((select private.is_simulator_admin(auth.uid())));

-- Isolated planning view. It is never unioned with workload_snapshots, so the UI must
-- explicitly query it after an authorized admin turns on Include simulations.
create or replace view public.simulation_manager_snapshots
with (security_invoker = true)
as
select
  snapshot.simulation_week_snapshot_id,
  snapshot.simulation_run_id,
  snapshot.simulation_member_id,
  member.display_name,
  member.simulated_badge,
  snapshot.week_id,
  snapshot.reliable_new_work_capacity_pct,
  snapshot.allocated_pct,
  snapshot.reactive_pct,
  snapshot.meeting_pct,
  snapshot.fragmented_work_pct,
  snapshot.blocked_pct,
  snapshot.context_switch_score,
  snapshot.wip_load_score,
  snapshot.summary_confidence,
  snapshot.category_allocation,
  snapshot.work_mode_allocation,
  snapshot.sharing_level,
  snapshot.persona_version,
  snapshot.generator_version,
  snapshot.seed,
  snapshot.is_synthetic,
  snapshot.computed_at
from public.simulation_week_snapshots snapshot
join public.simulation_members member
  on member.simulation_run_id = snapshot.simulation_run_id
 and member.simulation_member_id = snapshot.simulation_member_id
join public.simulation_runs run
  on run.simulation_run_id = snapshot.simulation_run_id
where run.status = 'completed'
  and run.archived_at is null
  and snapshot.is_synthetic is true;

revoke all on table public.simulation_personas from anon;
revoke all on table public.simulation_runs from anon;
revoke all on table public.simulation_members from anon;
revoke all on table public.simulation_artifacts from anon;
revoke all on table public.simulation_week_snapshots from anon;
revoke all on table public.simulation_audit_events from anon;
revoke all on table public.simulation_manager_snapshots from anon;

grant select, insert, delete on table public.simulation_personas to authenticated;
grant select, insert, update, delete on table public.simulation_runs to authenticated;
grant select, insert, delete on table public.simulation_members to authenticated;
grant select, insert, delete on table public.simulation_artifacts to authenticated;
grant select, insert, delete on table public.simulation_week_snapshots to authenticated;
grant select on table public.simulation_audit_events to authenticated;
grant select on table public.simulation_manager_snapshots to authenticated;

commit;
