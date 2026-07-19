-- Upgrade-safe repair for databases that applied the original Prompt 16
-- migration before its manager-action write boundary was hardened.

begin;

-- Remove the original direct mutation policies and privileges. PostgreSQL
-- tracks column-level UPDATE grants separately from table privileges, so both
-- revocations are required for an already-migrated database.
drop policy if exists team_actions_insert_managers on public.team_actions;
drop policy if exists team_actions_update_managers on public.team_actions;
drop policy if exists team_actions_delete_managers on public.team_actions;

revoke all on table public.team_actions from public, anon, authenticated;
revoke update (status, resolved_at) on table public.team_actions
  from public, anon, authenticated;
grant select on table public.team_actions to authenticated;

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

commit;
