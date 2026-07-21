-- Enforce the manager-visible aggregate snapshot allowlist at the database
-- boundary. Desktop construction remains positive-allowlist, but authenticated
-- members can write their own rows directly through PostgREST, so the server
-- must independently reject unknown labels, extra JSON fields, and unbounded
-- arrays. Existing rows are never deleted or rewritten by this migration.

create or replace function private.is_valid_shared_allocation(
  candidate jsonb,
  allowed_labels text[],
  maximum_entries integer,
  maximum_bytes integer
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  entry jsonb;
  entry_label text;
  entry_value numeric;
  entry_key_count integer;
  seen_labels text[] := array[]::text[];
begin
  if candidate is null then
    return true;
  end if;
  if jsonb_typeof(candidate) <> 'array'
     or maximum_entries < 0
     or maximum_bytes < 2
     or jsonb_array_length(candidate) > maximum_entries
     or octet_length(candidate::text) > maximum_bytes then
    return false;
  end if;

  for entry in select value from jsonb_array_elements(candidate)
  loop
    if jsonb_typeof(entry) <> 'object' then
      return false;
    end if;
    select count(*)::integer into entry_key_count from jsonb_object_keys(entry);
    if entry_key_count <> 2
       or not (entry ? 'label')
       or not (entry ? 'value')
       or jsonb_typeof(entry -> 'label') <> 'string'
       or jsonb_typeof(entry -> 'value') <> 'number' then
      return false;
    end if;

    entry_label := entry ->> 'label';
    entry_value := (entry ->> 'value')::numeric;
    if entry_label <> btrim(entry_label)
       or char_length(entry_label) < 1
       or char_length(entry_label) > 200
       or entry_value < 0
       or entry_value > 100
       or array_position(seen_labels, entry_label) is not null
       or (allowed_labels is not null and not (entry_label = any (allowed_labels))) then
      return false;
    end if;
    seen_labels := array_append(seen_labels, entry_label);
  end loop;

  return true;
exception
  when others then
    -- Malformed/adversarial JSON must fail the check rather than escape through
    -- a cast or helper error.
    return false;
end;
$$;

revoke all on function private.is_valid_shared_allocation(jsonb, text[], integer, integer)
from public, anon;
grant execute on function private.is_valid_shared_allocation(jsonb, text[], integer, integer)
to authenticated, service_role;

alter table public.workload_snapshots
  drop constraint workload_snapshots_allocated_pct,
  add constraint workload_snapshots_allocated_pct check (
    allocated_pct is null or allocated_pct between 0 and 999
  ),
  drop constraint workload_snapshots_context_switch_score,
  add constraint workload_snapshots_context_switch_score check (
    context_switch_score is null or context_switch_score between 0 and 1
  ) not valid,
  drop constraint workload_snapshots_wip_score,
  add constraint workload_snapshots_wip_score check (
    wip_load_score is null or wip_load_score between 0 and 1
  ) not valid,
  add constraint workload_snapshots_category_payload check (
    private.is_valid_shared_allocation(
      category_allocation,
      array[
        'Planned analysis / project work',
        'Ad hoc stakeholder requests',
        'Recurring reporting',
        'Dashboard development / edits',
        'SQL / data modeling / query work',
        'QA / data validation',
        'Debugging / issue investigation',
        'Documentation / requirement clarification',
        'Meetings / stakeholder syncs',
        'Admin / coordination',
        'Blocked / waiting / dependency delay'
      ]::text[],
      11,
      4096
    )
  ) not valid,
  add constraint workload_snapshots_mode_payload check (
    private.is_valid_shared_allocation(
      work_mode_allocation,
      array['Deep work', 'Reactive', 'Collaborative', 'Fragmented', 'Blocked']::text[],
      5,
      2048
    )
  ) not valid,
  add constraint workload_snapshots_project_payload check (
    -- A project name can contain 200 Unicode code points. In JSON text the
    -- worst case is a six-byte escape per code point; fifty such entries plus
    -- their fixed object structure remain below this 64 KiB ceiling.
    private.is_valid_shared_allocation(project_allocation, null, 50, 65536)
  ) not valid;

-- NOT VALID keeps the additive migration safe if a legacy row predates this
-- server contract; PostgreSQL still enforces each constraint for every new or
-- updated row. Validate immediately wherever the existing data is already clean.
do $$
begin
  if not exists (
    select 1 from public.workload_snapshots
    where context_switch_score is not null and context_switch_score not between 0 and 1
  ) then
    alter table public.workload_snapshots
      validate constraint workload_snapshots_context_switch_score;
  end if;
  if not exists (
    select 1 from public.workload_snapshots
    where wip_load_score is not null and wip_load_score not between 0 and 1
  ) then
    alter table public.workload_snapshots
      validate constraint workload_snapshots_wip_score;
  end if;
  if not exists (
    select 1 from public.workload_snapshots
    where not private.is_valid_shared_allocation(
      category_allocation,
      array[
        'Planned analysis / project work',
        'Ad hoc stakeholder requests',
        'Recurring reporting',
        'Dashboard development / edits',
        'SQL / data modeling / query work',
        'QA / data validation',
        'Debugging / issue investigation',
        'Documentation / requirement clarification',
        'Meetings / stakeholder syncs',
        'Admin / coordination',
        'Blocked / waiting / dependency delay'
      ]::text[],
      11,
      4096
    )
  ) then
    alter table public.workload_snapshots
      validate constraint workload_snapshots_category_payload;
  end if;
  if not exists (
    select 1 from public.workload_snapshots
    where not private.is_valid_shared_allocation(
      work_mode_allocation,
      array['Deep work', 'Reactive', 'Collaborative', 'Fragmented', 'Blocked']::text[],
      5,
      2048
    )
  ) then
    alter table public.workload_snapshots
      validate constraint workload_snapshots_mode_payload;
  end if;
  if not exists (
    select 1 from public.workload_snapshots
    where not private.is_valid_shared_allocation(project_allocation, null, 50, 65536)
  ) then
    alter table public.workload_snapshots
      validate constraint workload_snapshots_project_payload;
  end if;
end;
$$;
