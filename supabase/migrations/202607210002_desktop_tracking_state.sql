-- Privacy-minimized Desktop tracking state for the authenticated Web handoff.
-- The heartbeat carries only an enabled/paused boolean, never activity evidence.

alter table public.weekform_devices
  add column if not exists tracking_active boolean not null default false,
  add column if not exists tracking_state_at timestamptz null,
  add column if not exists tracking_protocol_version smallint not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.weekform_devices'::regclass
      and conname = 'weekform_devices_tracking_protocol_version_check'
  ) then
    alter table public.weekform_devices
      add constraint weekform_devices_tracking_protocol_version_check
      check (tracking_protocol_version in (1, 2));
  end if;
end;
$$;

-- A legacy registration cannot leave a recent v3 tracking state looking valid.
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
    id, user_id, device_name, last_seen_at, revoked_at,
    review_protocol_version, tracking_active, tracking_state_at, tracking_protocol_version
  ) values (
    p_device_id, actor, left(btrim(p_device_name), 80), now(), null,
    1, false, null, 1
  )
  on conflict (user_id, id) do update
    set device_name = excluded.device_name,
        last_seen_at = now(),
        review_protocol_version = 1,
        tracking_active = false,
        tracking_state_at = null,
        tracking_protocol_version = 1
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
    id, user_id, device_name, last_seen_at, revoked_at,
    review_protocol_version, tracking_active, tracking_state_at, tracking_protocol_version
  ) values (
    p_device_id, actor, left(btrim(p_device_name), 80), now(), null,
    2, false, null, 1
  )
  on conflict (user_id, id) do update
    set device_name = excluded.device_name,
        last_seen_at = now(),
        review_protocol_version = 2,
        tracking_active = false,
        tracking_state_at = null,
        tracking_protocol_version = 1
    where public.weekform_devices.revoked_at is null
  returning * into result;
  if result.id is null then raise exception 'device revoked'; end if;
  return result;
end;
$$;

create or replace function public.register_weekform_device_v3(
  p_device_id uuid,
  p_device_name text,
  p_tracking_active boolean
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
  if p_tracking_active is null then raise exception 'tracking state required'; end if;

  insert into public.weekform_devices(
    id, user_id, device_name, last_seen_at, revoked_at,
    review_protocol_version, tracking_active, tracking_state_at, tracking_protocol_version
  ) values (
    p_device_id, actor, left(btrim(p_device_name), 80), now(), null,
    2, p_tracking_active, now(), 2
  )
  on conflict (user_id, id) do update
    set device_name = excluded.device_name,
        last_seen_at = now(),
        review_protocol_version = 2,
        tracking_active = excluded.tracking_active,
        tracking_state_at = now(),
        tracking_protocol_version = 2
    where public.weekform_devices.revoked_at is null
  returning * into result;
  if result.id is null then raise exception 'device revoked'; end if;
  return result;
end;
$$;

create or replace function public.request_desktop_start_tracking()
returns text
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  target_device uuid;
begin
  if actor is null then raise exception 'authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('weekform:desktop-action:' || actor::text, 0)
  );

  delete from public.desktop_actions
  where user_id = actor and expires_at <= now();

  if not exists (
    select 1 from public.weekform_devices
    where user_id = actor and revoked_at is null
  ) then
    return 'no_device';
  end if;

  if exists (
    select 1 from public.weekform_devices
    where user_id = actor
      and revoked_at is null
      and tracking_protocol_version = 2
      and last_seen_at >= now() - interval '60 seconds'
      and tracking_state_at >= now() - interval '60 seconds'
      and tracking_active
  ) then
    return 'already_tracking';
  end if;

  select id into target_device
  from public.weekform_devices
  where user_id = actor
    and revoked_at is null
    and tracking_protocol_version = 2
    and last_seen_at >= now() - interval '60 seconds'
    and tracking_state_at >= now() - interval '60 seconds'
    and not tracking_active
  order by last_seen_at desc, id
  limit 1;

  if target_device is null then return 'offline'; end if;

  insert into public.desktop_actions(
    user_id, action_id, device_id, action, created_at, expires_at
  ) values (
    actor, gen_random_uuid(), target_device, 'start_tracking', now(), now() + interval '90 seconds'
  )
  on conflict (user_id, device_id, action) do update set
    action_id = excluded.action_id,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at;

  return 'queued';
end;
$$;

revoke all on function public.register_weekform_device_v3(uuid,text,boolean)
  from public, anon, authenticated;
revoke all on function public.request_desktop_start_tracking()
  from public, anon, authenticated;
grant execute on function public.register_weekform_device_v3(uuid,text,boolean)
  to authenticated;
grant execute on function public.request_desktop_start_tracking()
  to authenticated;

comment on column public.weekform_devices.tracking_active is
  'Whether local tracking was enabled at tracking_state_at; no activity evidence is stored.';
comment on column public.weekform_devices.tracking_state_at is
  'Server receipt time for the privacy-minimized tracking enabled/paused heartbeat.';
comment on function public.register_weekform_device_v3(uuid,text,boolean) is
  'Refreshes the caller own device and publishes only its tracking enabled/paused boolean.';
comment on function public.request_desktop_start_tracking() is
  'Atomically reports no device, offline, already tracking, or queues one short-lived start control.';
