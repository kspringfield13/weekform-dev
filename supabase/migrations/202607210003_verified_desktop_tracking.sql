-- Make Web tracking claims evidence-based and deterministic across multiple Macs.
-- `tracking_active` is true only after a recent successful native sample was
-- durably journaled; the Web action considers only the most recently reporting Mac.

create or replace function public.request_desktop_start_tracking()
returns text
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  target_device uuid;
  target_tracking_confirmed boolean;
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

  select id, tracking_active
  into target_device, target_tracking_confirmed
  from public.weekform_devices
  where user_id = actor
    and revoked_at is null
    and tracking_protocol_version = 2
    and last_seen_at >= now() - interval '35 seconds'
    and tracking_state_at >= now() - interval '35 seconds'
  order by last_seen_at desc, id
  limit 1;

  if target_device is null then return 'offline'; end if;
  if target_tracking_confirmed then return 'already_tracking'; end if;

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

comment on column public.weekform_devices.tracking_active is
  'Whether the Desktop recently completed and journaled a native capture sample; no activity evidence is stored.';
comment on function public.request_desktop_start_tracking() is
  'Reports the latest fresh Mac confirmed, offline, or queues one short-lived start control.';
