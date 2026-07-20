-- Compatibility-safe review-command rollout.
--
-- Released clients continue to read public.review_commands and call the
-- original complete_review_command v1 RPC. New clients use the isolated
-- public.review_commands_v2 queue and versioned RPC names. A private target
-- reservation prevents concurrent pending v1/v2 commands for the same block
-- revision without making v2 rows selectable by released clients.

create schema if not exists private;

-- Capability describes the protocol advertised by the binary that most
-- recently registered this device id. Recreating the released v1 RPC below is
-- intentional: launching v1 again must downgrade the device so Web routing
-- cannot assume an unavailable v2 consumer.
alter table public.weekform_devices
  add column if not exists review_protocol_version smallint not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.weekform_devices'::regclass
      and conname = 'weekform_devices_review_protocol_version_check'
  ) then
    alter table public.weekform_devices
      add constraint weekform_devices_review_protocol_version_check
      check (review_protocol_version in (1, 2));
  end if;
end;
$$;

create table if not exists public.review_commands_v2 (
  user_id uuid not null references auth.users(id) on delete cascade,
  command_id uuid not null default gen_random_uuid(),
  block_id text not null check (char_length(block_id) between 1 and 160),
  week_id text not null check (week_id ~ '^[0-9]{4}-W[0-9]{2}$'),
  expected_revision text not null check (expected_revision ~ '^[0-9a-f]{16}$'),
  action text not null check (action in ('confirm', 'exclude', 'relabel')),
  patch jsonb null,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'rejected', 'conflict')),
  created_at timestamptz not null default now(),
  decided_at timestamptz null,
  decision_reason text null
    check (decision_reason is null or char_length(decision_reason) <= 200),
  created_by uuid not null,
  decided_by_device uuid null,
  application_phase text null,
  claimed_by_device uuid null,
  claimed_at timestamptz null,
  application_recorded_at timestamptz null,
  primary key (user_id, command_id),
  check (
    (action = 'relabel' and jsonb_typeof(patch) = 'object')
    or (action <> 'relabel' and patch is null)
  ),
  constraint review_commands_v2_application_phase_check check (
    (
      application_phase is null
      and claimed_by_device is null
      and claimed_at is null
      and application_recorded_at is null
    ) or (
      application_phase = 'apply_pending'
      and claimed_by_device is not null
      and claimed_at is not null
      and application_recorded_at is null
    ) or (
      application_phase = 'ack_pending'
      and claimed_by_device is not null
      and claimed_at is not null
      and application_recorded_at is not null
    )
  ),
  foreign key (user_id, decided_by_device)
    references public.weekform_devices(user_id, id),
  constraint review_commands_v2_claimed_device_fkey
    foreign key (user_id, claimed_by_device)
    references public.weekform_devices(user_id, id)
);

create index if not exists review_commands_v2_pending_idx
  on public.review_commands_v2(user_id, created_at asc)
  where status = 'pending';
create unique index if not exists review_commands_v2_one_pending_block_revision_idx
  on public.review_commands_v2(user_id, week_id, block_id, expected_revision)
  where status = 'pending';

alter table public.review_commands_v2 enable row level security;
alter table public.review_commands_v2 force row level security;
drop policy if exists "users read own v2 review commands"
  on public.review_commands_v2;
create policy "users read own v2 review commands"
  on public.review_commands_v2
  for select to authenticated using (user_id = auth.uid());
revoke all on public.review_commands_v2 from anon, authenticated;
grant select on public.review_commands_v2 to authenticated;

create table if not exists private.review_command_pending_targets (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_id text not null,
  block_id text not null,
  expected_revision text not null,
  protocol_version smallint not null check (protocol_version in (1, 2)),
  command_id uuid not null,
  primary key (user_id, week_id, block_id, expected_revision),
  unique (user_id, protocol_version, command_id)
);
revoke all on private.review_command_pending_targets
  from public, anon, authenticated;

-- Seed reservations for requests that were already pending when the additive
-- v2 migration began. No v1 row is moved or reshaped.
insert into private.review_command_pending_targets(
  user_id, week_id, block_id, expected_revision, protocol_version, command_id
)
select user_id, week_id, block_id, expected_revision, 1, command_id
from public.review_commands
where status = 'pending'
on conflict (user_id, week_id, block_id, expected_revision) do nothing;

create or replace function private.reserve_review_command_pending_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_protocol smallint := tg_argv[0]::smallint;
  existing_protocol smallint;
  existing_command uuid;
  existing_is_pending boolean := false;
begin
  if new.status <> 'pending' then return new; end if;
  if requested_protocol not in (1, 2) then
    raise exception 'invalid review protocol reservation';
  end if;

  insert into private.review_command_pending_targets(
    user_id, week_id, block_id, expected_revision, protocol_version, command_id
  ) values (
    new.user_id, new.week_id, new.block_id, new.expected_revision,
    requested_protocol, new.command_id
  )
  on conflict (user_id, week_id, block_id, expected_revision) do nothing;

  select protocol_version, command_id
    into existing_protocol, existing_command
  from private.review_command_pending_targets
  where user_id = new.user_id
    and week_id = new.week_id
    and block_id = new.block_id
    and expected_revision = new.expected_revision
  for update;

  if existing_protocol is distinct from requested_protocol then
    raise exception 'another review protocol already has a pending request for this block revision';
  end if;

  if existing_command is distinct from new.command_id then
    if requested_protocol = 1 then
      select exists (
        select 1 from public.review_commands
        where user_id = new.user_id and command_id = existing_command
          and status = 'pending'
      ) into existing_is_pending;
    else
      select exists (
        select 1 from public.review_commands_v2
        where user_id = new.user_id and command_id = existing_command
          and status = 'pending'
      ) into existing_is_pending;
    end if;
    if not existing_is_pending then
      update private.review_command_pending_targets
      set command_id = new.command_id
      where user_id = new.user_id
        and week_id = new.week_id
        and block_id = new.block_id
        and expected_revision = new.expected_revision
        and protocol_version = requested_protocol;
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.release_review_command_pending_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare requested_protocol smallint := tg_argv[0]::smallint;
begin
  if old.status = 'pending' and (tg_op = 'DELETE' or new.status <> 'pending') then
    delete from private.review_command_pending_targets
    where user_id = old.user_id
      and week_id = old.week_id
      and block_id = old.block_id
      and expected_revision = old.expected_revision
      and protocol_version = requested_protocol
      and command_id = old.command_id;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists review_commands_v1_reserve_pending_target
  on public.review_commands;
create trigger review_commands_v1_reserve_pending_target
before insert on public.review_commands
for each row execute function private.reserve_review_command_pending_target('1');
drop trigger if exists review_commands_v1_release_pending_target
  on public.review_commands;
create trigger review_commands_v1_release_pending_target
after update of status or delete on public.review_commands
for each row execute function private.release_review_command_pending_target('1');

drop trigger if exists review_commands_v2_reserve_pending_target
  on public.review_commands_v2;
create trigger review_commands_v2_reserve_pending_target
before insert on public.review_commands_v2
for each row execute function private.reserve_review_command_pending_target('2');
drop trigger if exists review_commands_v2_release_pending_target
  on public.review_commands_v2;
create trigger review_commands_v2_release_pending_target
after update of status or delete on public.review_commands_v2
for each row execute function private.release_review_command_pending_target('2');

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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('weekform:review-protocol:' || actor::text, 0)
  );
  if exists (
    select 1 from public.review_commands_v2
    where user_id = actor and status = 'pending'
  ) then
    raise exception 'upgrade required: v2 review requests are still pending';
  end if;
  if p_device_name is null or char_length(btrim(p_device_name)) not between 1 and 80 then
    raise exception 'invalid device name';
  end if;
  insert into public.weekform_devices(
    id, user_id, device_name, last_seen_at, revoked_at, review_protocol_version
  ) values (
    p_device_id, actor, left(btrim(p_device_name), 80), now(), null, 1
  )
  on conflict (user_id, id) do update
    set device_name = excluded.device_name,
        last_seen_at = now(),
        review_protocol_version = 1
    where public.weekform_devices.revoked_at is null
  returning * into result;
  if result.id is null then raise exception 'device revoked'; end if;
  return result;
end;
$$;

create or replace function public.register_weekform_device_v2(
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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('weekform:review-protocol:' || actor::text, 0)
  );
  if p_device_name is null or char_length(btrim(p_device_name)) not between 1 and 80 then
    raise exception 'invalid device name';
  end if;
  insert into public.weekform_devices(
    id, user_id, device_name, last_seen_at, revoked_at, review_protocol_version
  ) values (
    p_device_id, actor, left(btrim(p_device_name), 80), now(), null, 2
  )
  on conflict (user_id, id) do update
    set device_name = excluded.device_name,
        last_seen_at = now(),
        review_protocol_version = 2
    where public.weekform_devices.revoked_at is null
  returning * into result;
  if result.id is null then raise exception 'device revoked'; end if;

  return result;
end;
$$;

create or replace function public.queue_review_command_v2(
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
  existing_action text;
  existing_patch jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if p_block_id is null or btrim(p_block_id) <> p_block_id
    or char_length(p_block_id) not between 1 and 160
  then raise exception 'invalid block id'; end if;
  if p_week_id is null or p_week_id !~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$'
  then raise exception 'invalid week id'; end if;
  if p_expected_revision is null or p_expected_revision !~ '^[0-9a-f]{16}$'
  then raise exception 'invalid expected revision'; end if;
  if p_action not in ('confirm','exclude','relabel')
  then raise exception 'invalid review action'; end if;
  if (p_action = 'relabel') <> coalesce(jsonb_typeof(p_patch) = 'object', false)
  then raise exception 'invalid review patch'; end if;
  if p_action = 'relabel' and (
    (select bool_or(key not in ('category','mode','plannedStatus','blockerFlag'))
      from jsonb_object_keys(p_patch) key)
    or p_patch = '{}'::jsonb
    or (p_patch ? 'category' and not coalesce(p_patch ->> 'category' in (
      'Planned analysis / project work','Ad hoc stakeholder requests','Recurring reporting',
      'Dashboard development / edits','SQL / data modeling / query work','QA / data validation',
      'Debugging / issue investigation','Documentation / requirement clarification',
      'Meetings / stakeholder syncs','Admin / coordination','Blocked / waiting / dependency delay'
    ), false))
    or (p_patch ? 'mode' and not coalesce(
      p_patch ->> 'mode' in ('Deep work','Reactive','Collaborative','Fragmented','Blocked'), false))
    or (p_patch ? 'plannedStatus' and not coalesce(
      p_patch ->> 'plannedStatus' in ('planned','unplanned','fixed','blocked'), false))
    or (p_patch ? 'blockerFlag' and not coalesce(
      jsonb_typeof(p_patch -> 'blockerFlag') = 'boolean', false))
  ) then raise exception 'invalid review patch'; end if;
  if not exists (
    select 1 from public.personal_workload_replicas replica,
      lateral jsonb_array_elements(replica.payload -> 'blocks') block
    where replica.user_id = actor and replica.week_id = p_week_id
      and block ->> 'blockId' = p_block_id
      and block ->> 'revision' = p_expected_revision
  ) then raise exception 'replica revision conflict'; end if;

  loop
    insert into public.review_commands_v2(
      user_id, block_id, week_id, expected_revision, action, patch, created_by
    ) values (
      actor, p_block_id, p_week_id, p_expected_revision, p_action, p_patch, actor
    )
    on conflict (user_id, week_id, block_id, expected_revision)
      where status = 'pending' do nothing
    returning command_id into result;
    if result is not null then return result; end if;

    select command_id, action, patch
      into result, existing_action, existing_patch
    from public.review_commands_v2
    where user_id = actor and week_id = p_week_id and block_id = p_block_id
      and expected_revision = p_expected_revision and status = 'pending'
    for update;
    if result is null then continue; end if;
    if existing_action = p_action and existing_patch is not distinct from p_patch then
      return result;
    end if;
    raise exception 'another review request is already pending for this block revision';
  end loop;
end;
$$;

create or replace function public.queue_review_confirm_batch_v2(
  p_targets jsonb
) returns uuid[]
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  item jsonb;
  target_block_id text;
  target_week_id text;
  target_revision text;
  target_key text;
  seen_targets text[] := array[]::text[];
  command_ids uuid[] := array[]::uuid[];
  result uuid;
  existing_action text;
  existing_patch jsonb;
  replica_conflict boolean;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if p_targets is null or jsonb_typeof(p_targets) <> 'array'
    or jsonb_array_length(p_targets) not between 1 and 50
  then raise exception 'invalid confirm batch'; end if;

  for item in select value from jsonb_array_elements(p_targets)
  loop
    if jsonb_typeof(item) <> 'object' then raise exception 'invalid confirm target'; end if;
    if (select count(*) from jsonb_object_keys(item)) <> 3
      or not (item ?& array['blockId','weekId','expectedRevision'])
    then raise exception 'invalid confirm target'; end if;
    target_block_id := item ->> 'blockId';
    target_week_id := item ->> 'weekId';
    target_revision := item ->> 'expectedRevision';
    if target_block_id is null or btrim(target_block_id) <> target_block_id
      or char_length(target_block_id) not between 1 and 160
      or target_week_id is null
      or target_week_id !~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$'
      or target_revision is null or target_revision !~ '^[0-9a-f]{16}$'
    then raise exception 'invalid confirm target'; end if;
    target_key := target_block_id || chr(31) || target_week_id || chr(31) || target_revision;
    if target_key = any(seen_targets) then raise exception 'duplicate confirm target'; end if;
    seen_targets := array_append(seen_targets, target_key);
  end loop;

  select count(target.value) <> jsonb_array_length(p_targets)
    into replica_conflict
  from jsonb_array_elements(p_targets) as target(value)
  join public.personal_workload_replicas replica
    on replica.user_id = actor and replica.week_id = target.value ->> 'weekId'
  cross join lateral jsonb_array_elements(replica.payload -> 'blocks') block
  where replica.payload ->> 'weekId' = target.value ->> 'weekId'
    and block ->> 'blockId' = target.value ->> 'blockId'
    and block ->> 'weekId' = target.value ->> 'weekId'
    and block ->> 'revision' = target.value ->> 'expectedRevision'
    and coalesce((block ->> 'userVerified')::boolean, false) = false;
  if replica_conflict then raise exception 'replica revision conflict'; end if;

  for item in select value from jsonb_array_elements(p_targets)
  loop
    target_block_id := item ->> 'blockId';
    target_week_id := item ->> 'weekId';
    target_revision := item ->> 'expectedRevision';
    perform pg_advisory_xact_lock(hashtextextended(
      actor::text || chr(31) || target_week_id || chr(31)
        || target_block_id || chr(31) || target_revision,
      0
    ));

    result := null;
    existing_action := null;
    existing_patch := null;
    select command.command_id, command.action, command.patch
      into result, existing_action, existing_patch
    from public.review_commands_v2 as command
    where command.user_id = actor and command.week_id = target_week_id
      and command.block_id = target_block_id
      and command.expected_revision = target_revision
      and command.status <> 'rejected'
    order by command.created_at desc, command.command_id desc
    limit 1
    for update;

    if result is not null then
      if existing_action = 'confirm' and existing_patch is null then
        command_ids := array_append(command_ids, result);
        continue;
      end if;
      raise exception 'another review request is already pending for this block revision';
    end if;

    insert into public.review_commands_v2(
      user_id, block_id, week_id, expected_revision, action, patch,
      status, created_by, created_at, decided_at, decision_reason
    ) values (
      actor, target_block_id, target_week_id, target_revision, 'confirm', null,
      'pending', actor, now(), null, null
    )
    on conflict (user_id, week_id, block_id, expected_revision)
      where status = 'pending' do nothing
    returning command_id into result;

    if result is null then
      select command.command_id, command.action, command.patch
        into result, existing_action, existing_patch
      from public.review_commands_v2 as command
      where command.user_id = actor and command.week_id = target_week_id
        and command.block_id = target_block_id
        and command.expected_revision = target_revision
        and command.status = 'pending'
      for update;
      if result is null or existing_action <> 'confirm' or existing_patch is not null then
        raise exception 'another review request is already pending for this block revision';
      end if;
    end if;
    command_ids := array_append(command_ids, result);
  end loop;
  return command_ids;
end;
$$;

-- Web advances only when every active desktop advertises v2 and the immutable
-- v1 backlog is empty. A pending v1 row is never moved, copied, or deleted by
-- rollout code; v2 desktops drain it through the released v1 lifecycle.
create or replace function public.queue_review_command_compatible(
  p_block_id text,
  p_week_id text,
  p_expected_revision text,
  p_action text,
  p_patch jsonb default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('weekform:review-protocol:' || actor::text, 0)
  );
  if exists (
    select 1
    from public.weekform_devices
    where user_id = actor
      and revoked_at is null
  ) and not exists (
    select 1
    from public.weekform_devices
    where user_id = actor
      and revoked_at is null
      and review_protocol_version <> 2
  ) and not exists (
    select 1
    from public.review_commands
    where user_id = actor
      and status = 'pending'
  ) then
    return public.queue_review_command_v2(
      p_block_id, p_week_id, p_expected_revision, p_action, p_patch
    );
  end if;
  return public.queue_review_command(
    p_block_id, p_week_id, p_expected_revision, p_action, p_patch
  );
end;
$$;

create or replace function public.queue_review_confirm_batch_compatible(
  p_targets jsonb
) returns uuid[]
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('weekform:review-protocol:' || actor::text, 0)
  );
  if exists (
    select 1
    from public.weekform_devices
    where user_id = actor
      and revoked_at is null
  ) and not exists (
    select 1
    from public.weekform_devices
    where user_id = actor
      and revoked_at is null
      and review_protocol_version <> 2
  ) and not exists (
    select 1
    from public.review_commands
    where user_id = actor
      and status = 'pending'
  ) then
    return public.queue_review_confirm_batch_v2(p_targets);
  end if;
  return public.queue_review_confirm_batch(p_targets);
end;
$$;

create or replace function public.claim_review_command_v2(
  p_device_id uuid,
  p_command_id uuid
) returns text
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  current_status text;
  current_phase text;
  current_claim uuid;
  current_claimed_at timestamptz;
  current_application_recorded_at timestamptz;
  current_decider uuid;
  claim_owner_revoked boolean;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not exists (
    select 1 from public.weekform_devices
    where user_id = actor and id = p_device_id and revoked_at is null
  ) then raise exception 'device not registered'; end if;

  select status, application_phase, claimed_by_device, claimed_at,
      application_recorded_at, decided_by_device
    into current_status, current_phase, current_claim, current_claimed_at,
      current_application_recorded_at, current_decider
  from public.review_commands_v2
  where user_id = actor and command_id = p_command_id
  for update;
  if not found then raise exception 'review command not found'; end if;

  if current_status <> 'pending' then
    if current_decider = p_device_id
      and current_status in ('applied', 'rejected', 'conflict')
    then return current_status; end if;
    if current_status = 'applied'
      and current_phase = 'ack_pending'
      and current_application_recorded_at is not null
    then return current_status; end if;
    raise exception 'review command no longer pending';
  end if;
  if current_phase is null then
    update public.review_commands_v2
    set application_phase = 'apply_pending',
        claimed_by_device = p_device_id,
        claimed_at = now()
    where user_id = actor and command_id = p_command_id;
    return 'apply_pending';
  end if;
  if current_claim = p_device_id then
    if current_phase = 'apply_pending' then
      update public.review_commands_v2
      set claimed_at = now()
      where user_id = actor and command_id = p_command_id;
    end if;
    return current_phase;
  end if;
  -- ack_pending is a durable server receipt that the original owner already
  -- persisted the local result. Another active v2 desktop may finalize that
  -- receipt without claiming or reapplying the local mutation. Attribution
  -- remains with the device that actually recorded the application.
  if current_phase = 'ack_pending'
    and current_application_recorded_at is not null
    and current_claim is not null
  then
    update public.review_commands_v2
    set status = 'applied',
        decided_at = now(),
        decision_reason = 'Recovered from a durable local application receipt.',
        decided_by_device = current_claim
    where user_id = actor and command_id = p_command_id;
    return 'applied';
  end if;
  select exists (
    select 1 from public.weekform_devices
    where user_id = actor and id = current_claim and revoked_at is not null
  ) into claim_owner_revoked;
  if current_phase = 'apply_pending' and (
    claim_owner_revoked or current_claimed_at <= now() - interval '24 hours'
  ) then
    update public.review_commands_v2
    set claimed_by_device = p_device_id,
        claimed_at = now()
    where user_id = actor and command_id = p_command_id;
    return 'apply_pending';
  end if;
  raise exception 'review command claimed by another device';
end;
$$;

create or replace function public.mark_review_command_applied_locally_v2(
  p_device_id uuid,
  p_command_id uuid
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  current_status text;
  current_phase text;
  current_claim uuid;
  current_decider uuid;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not exists (
    select 1 from public.weekform_devices
    where user_id = actor and id = p_device_id and revoked_at is null
  ) then raise exception 'device not registered'; end if;

  select status, application_phase, claimed_by_device, decided_by_device
    into current_status, current_phase, current_claim, current_decider
  from public.review_commands_v2
  where user_id = actor and command_id = p_command_id
  for update;
  if not found then return false; end if;
  if current_status = 'applied' and current_decider = p_device_id then return true; end if;
  if current_status <> 'pending' then return false; end if;
  if current_claim is distinct from p_device_id then
    raise exception 'review command claimed by another device';
  end if;
  if current_phase = 'ack_pending' then return true; end if;
  if current_phase <> 'apply_pending' then return false; end if;

  update public.review_commands_v2
  set application_phase = 'ack_pending', application_recorded_at = now()
  where user_id = actor and command_id = p_command_id;
  return true;
end;
$$;

-- Preserve the released v1 behavior: direct pending-to-terminal completion and
-- false on a retry after terminalization. Do not tighten this RPC in place.
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
  if p_status not in ('applied','rejected','conflict')
    then raise exception 'invalid command status'; end if;
  if not exists (
    select 1 from public.weekform_devices
    where user_id = actor and id = p_device_id and revoked_at is null
  ) then raise exception 'device not registered'; end if;
  update public.review_commands set
    status = p_status,
    decided_at = now(),
    decision_reason = left(nullif(btrim(p_reason), ''), 200),
    decided_by_device = p_device_id
  where user_id = actor and command_id = p_command_id and status = 'pending';
  return found;
end;
$$;

create or replace function public.complete_review_command_v2(
  p_device_id uuid,
  p_command_id uuid,
  p_status text,
  p_reason text default null
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  current_status text;
  current_phase text;
  current_claim uuid;
  current_decider uuid;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if p_status not in ('applied','rejected','conflict')
    then raise exception 'invalid command status'; end if;
  if not exists (
    select 1 from public.weekform_devices
    where user_id = actor and id = p_device_id and revoked_at is null
  ) then raise exception 'device not registered'; end if;

  select status, application_phase, claimed_by_device, decided_by_device
    into current_status, current_phase, current_claim, current_decider
  from public.review_commands_v2
  where user_id = actor and command_id = p_command_id
  for update;
  if not found then return false; end if;
  if current_status <> 'pending' then
    return current_status = p_status and current_decider = p_device_id;
  end if;

  if p_status = 'applied' then
    if current_claim is distinct from p_device_id then
      raise exception 'review command claimed by another device';
    end if;
    if current_phase <> 'ack_pending' then
      raise exception 'local application acknowledgement required';
    end if;
  elsif current_claim is not null and current_claim is distinct from p_device_id then
    raise exception 'review command claimed by another device';
  end if;

  update public.review_commands_v2
  set status = p_status,
      decided_at = now(),
      decision_reason = left(nullif(btrim(p_reason), ''), 200),
      decided_by_device = p_device_id
  where user_id = actor and command_id = p_command_id;
  return true;
end;
$$;

create or replace function public.delete_personal_replica_history()
returns integer language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare actor uuid := auth.uid(); removed integer;
begin
  if actor is null then raise exception 'authentication required'; end if;
  delete from public.review_commands_v2 where user_id = actor;
  delete from public.review_commands where user_id = actor;
  delete from private.review_command_pending_targets where user_id = actor;
  delete from public.personal_workload_replicas where user_id = actor;
  get diagnostics removed = row_count;
  delete from public.personal_replica_batches where user_id = actor;
  return removed;
end;
$$;

drop trigger if exists review_command_v2_broadcast
  on public.review_commands_v2;
create trigger review_command_v2_broadcast
after insert or update or delete on public.review_commands_v2
for each row execute function public.broadcast_personal_sync_change();

comment on table public.review_commands_v2 is
  'Isolated v2 review queue. Released clients remain on review_commands and cannot select these rows.';
comment on column public.weekform_devices.review_protocol_version is
  'Review-command protocol advertised by the binary that most recently registered this device id; defaults to released protocol v1.';
comment on column public.review_commands_v2.application_phase is
  'Server-owned v2 phase: apply_pending after claim, ack_pending after local application is durably recorded.';
comment on function public.complete_review_command(uuid,uuid,text,text) is
  'Released v1 compatibility RPC. Retire only after pending v1 rows are drained and installed v1 clients are unsupported.';
comment on function public.complete_review_command_v2(uuid,uuid,text,text) is
  'Versioned two-phase completion RPC. Applied requires a matching ack_pending claim.';

revoke all on function private.reserve_review_command_pending_target()
  from public, anon, authenticated;
revoke all on function private.release_review_command_pending_target()
  from public, anon, authenticated;
revoke all on function public.register_weekform_device(uuid,text)
  from public, anon, authenticated;
revoke all on function public.register_weekform_device_v2(uuid,text)
  from public, anon, authenticated;
revoke all on function public.queue_review_command_v2(text,text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.queue_review_confirm_batch_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.queue_review_command_compatible(text,text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.queue_review_confirm_batch_compatible(jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_review_command_v2(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.mark_review_command_applied_locally_v2(uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.complete_review_command(uuid,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.complete_review_command_v2(uuid,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.delete_personal_replica_history()
  from public, anon, authenticated;

grant execute on function public.register_weekform_device(uuid,text)
  to authenticated;
grant execute on function public.register_weekform_device_v2(uuid,text)
  to authenticated;
grant execute on function public.queue_review_command_compatible(text,text,text,text,jsonb)
  to authenticated;
grant execute on function public.queue_review_confirm_batch_compatible(jsonb)
  to authenticated;
grant execute on function public.claim_review_command_v2(uuid,uuid)
  to authenticated;
grant execute on function public.mark_review_command_applied_locally_v2(uuid,uuid)
  to authenticated;
grant execute on function public.complete_review_command(uuid,uuid,text,text)
  to authenticated;
grant execute on function public.complete_review_command_v2(uuid,uuid,text,text)
  to authenticated;
grant execute on function public.delete_personal_replica_history()
  to authenticated;
