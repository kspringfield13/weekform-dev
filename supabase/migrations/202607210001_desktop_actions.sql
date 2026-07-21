-- Prompt-free, authenticated Web -> running Mac actions. This queue contains
-- no activity evidence and retains no history after the target Mac acknowledges.

create table if not exists public.desktop_actions (
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid not null default gen_random_uuid(),
  device_id uuid not null,
  action text not null check (action = 'start_tracking'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, action_id),
  foreign key (user_id, device_id) references public.weekform_devices(user_id, id),
  check (expires_at > created_at and expires_at <= created_at + interval '2 minutes')
);

create unique index if not exists desktop_actions_one_pending_device_action_idx
  on public.desktop_actions(user_id, device_id, action);

alter table public.desktop_actions enable row level security;
alter table public.desktop_actions force row level security;

drop policy if exists "users read own desktop actions" on public.desktop_actions;
create policy "users read own desktop actions" on public.desktop_actions
  for select to authenticated using (user_id = auth.uid());

revoke all on public.desktop_actions from anon, authenticated;
grant select on public.desktop_actions to authenticated;

create or replace function public.queue_start_tracking_action()
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  target_device uuid;
  result uuid;
begin
  if actor is null then raise exception 'authentication required'; end if;

  delete from public.desktop_actions
  where user_id = actor and expires_at <= now();

  select id into target_device
  from public.weekform_devices
  where user_id = actor
    and revoked_at is null
    and last_seen_at >= now() - interval '60 seconds'
  order by last_seen_at desc, id
  limit 1;

  if target_device is null then raise exception 'desktop unavailable'; end if;

  insert into public.desktop_actions(
    user_id, action_id, device_id, action, created_at, expires_at
  ) values (
    actor, gen_random_uuid(), target_device, 'start_tracking', now(), now() + interval '90 seconds'
  )
  on conflict (user_id, device_id, action) do update set
    action_id = excluded.action_id,
    created_at = excluded.created_at,
    expires_at = excluded.expires_at
  returning action_id into result;

  return result;
end;
$$;

create or replace function public.acknowledge_desktop_action(
  p_device_id uuid,
  p_action_id uuid
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  was_current boolean;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not exists (
    select 1 from public.weekform_devices
    where user_id = actor and id = p_device_id and revoked_at is null
  ) then return false; end if;

  delete from public.desktop_actions
  where user_id = actor
    and action_id = p_action_id
    and device_id = p_device_id
  returning expires_at > now() into was_current;

  update public.weekform_devices
  set last_seen_at = now()
  where user_id = actor and id = p_device_id and revoked_at is null;

  return coalesce(was_current, false);
end;
$$;

revoke all on function public.queue_start_tracking_action() from public, anon;
revoke all on function public.acknowledge_desktop_action(uuid, uuid) from public, anon;
grant execute on function public.queue_start_tracking_action() to authenticated;
grant execute on function public.acknowledge_desktop_action(uuid, uuid) to authenticated;

comment on table public.desktop_actions is
  'Short-lived, user-private controls for an already-running Weekform Mac; acknowledged rows are deleted.';
comment on function public.queue_start_tracking_action() is
  'Queues an expiring start-tracking control for the caller own most recently active Mac.';
