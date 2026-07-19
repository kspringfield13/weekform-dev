-- Weekform manager action follow-through (Part 2 Prompt 16).
-- SQL review artifact only: repository presence is not evidence that this
-- migration has been applied to a local or hosted Supabase project.
--
-- The table stores only a clamped action sentence and an optional allowlisted
-- risk flag key. It does not store briefing prose, member evidence, or outcomes;
-- follow-through is derived from existing team-aggregate shared snapshots.

begin;

create table if not exists public.team_actions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  action_text text not null,
  risk_flag_key text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint team_actions_text_length check (
    char_length(btrim(action_text, E' \t\n\r\f\013')) between 1 and 500
  ),
  constraint team_actions_risk_flag_key_check check (
    risk_flag_key is null or risk_flag_key in (
      'low-headroom',
      'high-reactive',
      'high-meetings',
      'high-fragmentation',
      'low-review-coverage',
      'stale-data'
    )
  ),
  constraint team_actions_status_check check (
    status in ('open', 'done', 'dropped')
  ),
  constraint team_actions_resolution_check check (
    (status = 'open' and resolved_at is null)
    or (status in ('done', 'dropped') and resolved_at is not null)
  ),
  constraint team_actions_resolution_order check (
    resolved_at is null or resolved_at >= created_at
  )
);

create index if not exists team_actions_team_status_created_idx
  on public.team_actions (team_id, status, created_at desc);

alter table public.team_actions enable row level security;
alter table public.team_actions force row level security;

-- Team actions are a manager operating surface. Plain members and outsiders
-- receive no rows and have no write path. Authorization reuses the reviewed
-- team_memberships helper from the Team Cloud v1 migration.
create policy team_actions_select_managers
on public.team_actions
for select
to authenticated
using ((select private.is_team_manager(team_id, auth.uid())));

-- Creation is RPC-only. The caller supplies the team scope plus the two
-- product inputs; actor identity and lifecycle fields are always authoritative
-- server values. Explicit authorization is required because SECURITY DEFINER
-- functions must never rely on caller metadata or an easily-regressed RLS
-- policy for their privilege boundary.
create or replace function public.create_team_action(
  p_team_id uuid,
  p_action_text text,
  p_risk_flag_key text default null
)
returns public.team_actions
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalized_action_text text;
  created_action public.team_actions%rowtype;
begin
  if caller is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if p_team_id is null
     or not private.is_team_manager(p_team_id, caller) then
    raise exception using
      errcode = '42501',
      message = 'An active team manager or owner role is required';
  end if;

  normalized_action_text := btrim(p_action_text, E' \t\n\r\f\013');

  if normalized_action_text is null or char_length(normalized_action_text) = 0 then
    raise exception using
      errcode = '22023',
      message = 'Action text is required';
  end if;

  normalized_action_text := left(normalized_action_text, 500);

  if p_risk_flag_key is not null and p_risk_flag_key not in (
    'low-headroom',
    'high-reactive',
    'high-meetings',
    'high-fragmentation',
    'low-review-coverage',
    'stale-data'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Risk flag key is not allowlisted';
  end if;

  insert into public.team_actions (
    team_id,
    created_by,
    action_text,
    risk_flag_key,
    status,
    created_at,
    resolved_at
  ) values (
    p_team_id,
    caller,
    normalized_action_text,
    p_risk_flag_key,
    'open',
    now(),
    null
  )
  returning * into created_action;

  return created_action;
end;
$$;

-- Resolution is also RPC-only so the caller cannot forge the resolution time
-- or mutate immutable action evidence through a direct table update.
create or replace function public.resolve_team_action(
  p_team_id uuid,
  p_action_id uuid,
  p_status text
)
returns public.team_actions
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  resolved_action public.team_actions%rowtype;
begin
  if caller is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if p_team_id is null
     or not private.is_team_manager(p_team_id, caller) then
    raise exception using
      errcode = '42501',
      message = 'An active team manager or owner role is required';
  end if;

  if p_status is null or p_status not in ('done', 'dropped') then
    raise exception using
      errcode = '22023',
      message = 'Action status must be done or dropped';
  end if;

  update public.team_actions
  set status = p_status,
      resolved_at = now()
  where team_id = p_team_id
    and id = p_action_id
  returning * into resolved_action;

  if resolved_action.id is null then
    raise exception using
      errcode = '22023',
      message = 'Team action not found';
  end if;

  return resolved_action;
end;
$$;

-- Deletion remains supported by the existing product contract, but only
-- through the same explicit team-manager authorization boundary.
create or replace function public.delete_team_action(
  p_team_id uuid,
  p_action_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required';
  end if;

  if p_team_id is null
     or not private.is_team_manager(p_team_id, caller) then
    raise exception using
      errcode = '42501',
      message = 'An active team manager or owner role is required';
  end if;

  delete from public.team_actions
  where team_id = p_team_id
    and id = p_action_id;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Team action not found';
  end if;
end;
$$;

comment on function public.create_team_action(uuid, text, text) is
  'Creates one manager action in the authorized team. Trims/clamps text to 500 characters, validates the optional risk key, and server-sets actor and lifecycle fields.';

revoke all on function public.create_team_action(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_team_action(uuid, text, text)
  to authenticated;

revoke all on function public.resolve_team_action(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_team_action(uuid, uuid, text)
  to authenticated;

revoke all on function public.delete_team_action(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_team_action(uuid, uuid)
  to authenticated;

revoke all on table public.team_actions from public, anon, authenticated;
grant select on table public.team_actions to authenticated;

commit;
