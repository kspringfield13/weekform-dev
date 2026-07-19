-- Weekform user-private native <-> Web replica sync.
-- This is deliberately separate from workload_snapshots (team sharing). The payload
-- is a positive allowlist of derived review fields and contains no raw capture data.

create table if not exists public.weekform_devices (
  id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text not null check (char_length(device_name) between 1 and 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null,
  primary key (user_id, id)
);

create table if not exists public.personal_replica_batches (
  cursor bigint generated always as identity unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null,
  device_id uuid not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16}$'),
  received_at timestamptz not null default now(),
  primary key (user_id, batch_id),
  foreign key (user_id, device_id) references public.weekform_devices(user_id, id)
);

create table if not exists public.personal_workload_replicas (
  user_id uuid not null references auth.users(id) on delete cascade,
  replica_id text not null check (char_length(replica_id) between 1 and 120),
  week_id text not null check (week_id ~ '^[0-9]{4}-W[0-9]{2}$'),
  revision text not null check (revision ~ '^[0-9a-f]{16}$'),
  payload jsonb not null,
  device_id uuid not null,
  source_updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (user_id, replica_id),
  foreign key (user_id, device_id) references public.weekform_devices(user_id, id),
  check (jsonb_typeof(payload) = 'object' and payload ->> 'schemaVersion' = '1')
);

create index if not exists personal_workload_replicas_user_week_idx
  on public.personal_workload_replicas(user_id, week_id desc);

create table if not exists public.review_commands (
  user_id uuid not null references auth.users(id) on delete cascade,
  command_id uuid not null default gen_random_uuid(),
  block_id text not null check (char_length(block_id) between 1 and 160),
  week_id text not null check (week_id ~ '^[0-9]{4}-W[0-9]{2}$'),
  expected_revision text not null check (expected_revision ~ '^[0-9a-f]{16}$'),
  action text not null check (action in ('confirm', 'exclude', 'relabel')),
  patch jsonb null,
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected', 'conflict')),
  created_at timestamptz not null default now(),
  decided_at timestamptz null,
  decision_reason text null check (decision_reason is null or char_length(decision_reason) <= 200),
  created_by uuid not null,
  decided_by_device uuid null,
  primary key (user_id, command_id),
  check ((action = 'relabel' and jsonb_typeof(patch) = 'object') or (action <> 'relabel' and patch is null)),
  foreign key (user_id, decided_by_device) references public.weekform_devices(user_id, id)
);

create index if not exists review_commands_pending_idx
  on public.review_commands(user_id, created_at asc) where status = 'pending';

alter table public.weekform_devices enable row level security;
alter table public.personal_replica_batches enable row level security;
alter table public.personal_workload_replicas enable row level security;
alter table public.review_commands enable row level security;
alter table public.weekform_devices force row level security;
alter table public.personal_replica_batches force row level security;
alter table public.personal_workload_replicas force row level security;
alter table public.review_commands force row level security;

drop policy if exists "users read own devices" on public.weekform_devices;
create policy "users read own devices" on public.weekform_devices
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "users read own batch receipts" on public.personal_replica_batches;
create policy "users read own batch receipts" on public.personal_replica_batches
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "users read own personal replicas" on public.personal_workload_replicas;
create policy "users read own personal replicas" on public.personal_workload_replicas
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "users read own review commands" on public.review_commands;
create policy "users read own review commands" on public.review_commands
  for select to authenticated using (user_id = auth.uid());

revoke all on public.weekform_devices, public.personal_replica_batches,
  public.personal_workload_replicas, public.review_commands from anon, authenticated;
grant select on public.weekform_devices, public.personal_replica_batches,
  public.personal_workload_replicas, public.review_commands to authenticated;

create or replace function public.register_weekform_device(
  p_device_id uuid,
  p_device_name text
) returns public.weekform_devices
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  result public.weekform_devices;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if p_device_name is null or char_length(btrim(p_device_name)) not between 1 and 80 then
    raise exception 'invalid device name';
  end if;
  insert into public.weekform_devices(id, user_id, device_name, last_seen_at, revoked_at)
  values (p_device_id, actor, left(btrim(p_device_name), 80), now(), null)
  on conflict (user_id, id) do update
    set device_name = excluded.device_name, last_seen_at = now()
    where public.weekform_devices.revoked_at is null
  returning * into result;
  if result.id is null then raise exception 'device revoked'; end if;
  return result;
end;
$$;

create or replace function public.sync_personal_replica_batch(
  p_device_id uuid,
  p_batch_id uuid,
  p_fingerprint text,
  p_payload jsonb
) returns table(cursor bigint, synced_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  inserted_cursor bigint;
  block jsonb;
  top_keys text[] := array['schemaVersion','replicaId','weekId','generatedAt','sourceUpdatedAt','blocks','capacity'];
  block_keys text[] := array['blockId','weekId','startTime','endTime','estimatedCapacityPct','category','mode','plannedStatus','confidence','userVerified','blockerFlag','revision'];
  capacity_keys text[] := array['allocatedPct','deepWorkPct','fragmentedWorkPct','meetingPct','reactivePct','plannedPct','blockedPct','reliableNewWorkCapacityPct','committedUtilizationPct','carryoverRiskPct','wipLoadScore','contextSwitchScore','summaryConfidence'];
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not exists (
    select 1 from public.weekform_devices d
    where d.user_id = actor and d.id = p_device_id and d.revoked_at is null
  ) then raise exception 'device not registered'; end if;
  if p_fingerprint !~ '^[0-9a-f]{16}$' then raise exception 'invalid fingerprint'; end if;
  if jsonb_typeof(p_payload) <> 'object' or p_payload ->> 'schemaVersion' <> '1'
    or not (p_payload ?& top_keys)
    or (select bool_or(key <> all(top_keys)) from jsonb_object_keys(p_payload) key)
    or jsonb_typeof(p_payload -> 'blocks') <> 'array'
    or jsonb_typeof(p_payload -> 'capacity') <> 'object'
    or coalesce(p_payload ->> 'weekId', '') !~ '^[0-9]{4}-W[0-9]{2}$'
    or char_length(coalesce(p_payload ->> 'replicaId', '')) not between 1 and 120
    or not ((p_payload -> 'capacity') ?& capacity_keys)
    or (select bool_or(key <> all(capacity_keys)) from jsonb_object_keys(p_payload -> 'capacity') key)
    or (select bool_or(jsonb_typeof(value) <> 'number') from jsonb_each(p_payload -> 'capacity'))
  then raise exception 'invalid personal replica'; end if;

  for block in select value from jsonb_array_elements(p_payload -> 'blocks') loop
    if jsonb_typeof(block) <> 'object'
      or not (block ?& block_keys)
      or (select bool_or(key <> all(block_keys)) from jsonb_object_keys(block) key)
      or block ->> 'weekId' <> p_payload ->> 'weekId'
      or coalesce(block ->> 'revision', '') !~ '^[0-9a-f]{16}$'
      or jsonb_typeof(block -> 'estimatedCapacityPct') <> 'number'
      or jsonb_typeof(block -> 'confidence') <> 'number'
      or jsonb_typeof(block -> 'userVerified') <> 'boolean'
      or jsonb_typeof(block -> 'blockerFlag') <> 'boolean'
      or block ->> 'category' not in (
        'Planned analysis / project work','Ad hoc stakeholder requests','Recurring reporting',
        'Dashboard development / edits','SQL / data modeling / query work','QA / data validation',
        'Debugging / issue investigation','Documentation / requirement clarification',
        'Meetings / stakeholder syncs','Admin / coordination','Blocked / waiting / dependency delay'
      )
      or block ->> 'mode' not in ('Deep work','Reactive','Collaborative','Fragmented','Blocked')
      or block ->> 'plannedStatus' not in ('planned','unplanned','fixed','blocked')
    then raise exception 'invalid personal replica block'; end if;
  end loop;

  insert into public.personal_replica_batches(user_id, batch_id, device_id, fingerprint)
  values (actor, p_batch_id, p_device_id, p_fingerprint)
  on conflict (user_id, batch_id) do nothing
  returning personal_replica_batches.cursor into inserted_cursor;

  if inserted_cursor is not null then
    insert into public.personal_workload_replicas(
      user_id, replica_id, week_id, revision, payload, device_id, source_updated_at, synced_at
    ) values (
      actor, p_payload ->> 'replicaId', p_payload ->> 'weekId', p_fingerprint,
      p_payload, p_device_id, (p_payload ->> 'sourceUpdatedAt')::timestamptz, now()
    )
    on conflict (user_id, replica_id) do update set
      week_id = excluded.week_id,
      revision = excluded.revision,
      payload = excluded.payload,
      device_id = excluded.device_id,
      source_updated_at = excluded.source_updated_at,
      synced_at = now();
  else
    select b.cursor into inserted_cursor from public.personal_replica_batches b
      where b.user_id = actor and b.batch_id = p_batch_id;
  end if;
  update public.weekform_devices set last_seen_at = now()
    where user_id = actor and id = p_device_id;
  return query select inserted_cursor, now();
end;
$$;

create or replace function public.queue_review_command(
  p_block_id text,
  p_week_id text,
  p_expected_revision text,
  p_action text,
  p_patch jsonb default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  result uuid;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if p_action not in ('confirm','exclude','relabel') then raise exception 'invalid review action'; end if;
  if (p_action = 'relabel') <> (jsonb_typeof(p_patch) = 'object') then raise exception 'invalid review patch'; end if;
  if p_action = 'relabel' and (
    (select bool_or(key not in ('category','mode','plannedStatus','blockerFlag')) from jsonb_object_keys(p_patch) key)
    or p_patch = '{}'::jsonb
    or (p_patch ? 'category' and p_patch ->> 'category' not in (
      'Planned analysis / project work','Ad hoc stakeholder requests','Recurring reporting',
      'Dashboard development / edits','SQL / data modeling / query work','QA / data validation',
      'Debugging / issue investigation','Documentation / requirement clarification',
      'Meetings / stakeholder syncs','Admin / coordination','Blocked / waiting / dependency delay'
    ))
    or (p_patch ? 'mode' and p_patch ->> 'mode' not in ('Deep work','Reactive','Collaborative','Fragmented','Blocked'))
    or (p_patch ? 'plannedStatus' and p_patch ->> 'plannedStatus' not in ('planned','unplanned','fixed','blocked'))
    or (p_patch ? 'blockerFlag' and jsonb_typeof(p_patch -> 'blockerFlag') <> 'boolean')
  ) then raise exception 'invalid review patch'; end if;
  if not exists (
    select 1 from public.personal_workload_replicas r,
      lateral jsonb_array_elements(r.payload -> 'blocks') block
    where r.user_id = actor and r.week_id = p_week_id
      and block ->> 'blockId' = p_block_id and block ->> 'revision' = p_expected_revision
  ) then raise exception 'replica revision conflict'; end if;
  insert into public.review_commands(
    user_id, block_id, week_id, expected_revision, action, patch, created_by
  ) values (actor, p_block_id, p_week_id, p_expected_revision, p_action, p_patch, actor)
  returning command_id into result;
  return result;
end;
$$;

create or replace function public.complete_review_command(
  p_device_id uuid,
  p_command_id uuid,
  p_status text,
  p_reason text default null
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'authentication required'; end if;
  if p_status not in ('applied','rejected','conflict') then raise exception 'invalid command status'; end if;
  if not exists (select 1 from public.weekform_devices where user_id = actor and id = p_device_id and revoked_at is null)
    then raise exception 'device not registered'; end if;
  update public.review_commands set
    status = p_status, decided_at = now(), decision_reason = left(nullif(btrim(p_reason), ''), 200),
    decided_by_device = p_device_id
  where user_id = actor and command_id = p_command_id and status = 'pending';
  return found;
end;
$$;

create or replace function public.delete_personal_replica_history()
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare actor uuid := auth.uid(); removed integer;
begin
  if actor is null then raise exception 'authentication required'; end if;
  delete from public.review_commands where user_id = actor;
  delete from public.personal_workload_replicas where user_id = actor;
  get diagnostics removed = row_count;
  delete from public.personal_replica_batches where user_id = actor;
  return removed;
end;
$$;

revoke all on function public.register_weekform_device(uuid,text) from public, anon;
revoke all on function public.sync_personal_replica_batch(uuid,uuid,text,jsonb) from public, anon;
revoke all on function public.queue_review_command(text,text,text,text,jsonb) from public, anon;
revoke all on function public.complete_review_command(uuid,uuid,text,text) from public, anon;
revoke all on function public.delete_personal_replica_history() from public, anon;
grant execute on function public.register_weekform_device(uuid,text) to authenticated;
grant execute on function public.sync_personal_replica_batch(uuid,uuid,text,jsonb) to authenticated;
grant execute on function public.queue_review_command(text,text,text,text,jsonb) to authenticated;
grant execute on function public.complete_review_command(uuid,uuid,text,text) to authenticated;
grant execute on function public.delete_personal_replica_history() to authenticated;

create or replace function public.broadcast_personal_sync_change()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, realtime
as $$
begin
  -- NEW is not assigned on DELETE, so choose the owner explicitly by operation.
  perform realtime.broadcast_changes(
    'weekform:user:' || (case when tg_op = 'DELETE' then old.user_id else new.user_id end)::text,
    tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists personal_replica_broadcast on public.personal_workload_replicas;
create trigger personal_replica_broadcast after insert or update or delete
  on public.personal_workload_replicas for each row execute function public.broadcast_personal_sync_change();
drop trigger if exists review_command_broadcast on public.review_commands;
create trigger review_command_broadcast after insert or update or delete
  on public.review_commands for each row execute function public.broadcast_personal_sync_change();

drop policy if exists "users receive own Weekform broadcasts" on realtime.messages;
create policy "users receive own Weekform broadcasts" on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'weekform:user:' || auth.uid()::text);
