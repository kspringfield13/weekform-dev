-- Manager-only roster identity projection.
--
-- Account email stays in auth.users. This RPC exposes it only after checking
-- the caller's active owner/manager membership for the requested team, so the
-- Web roster can identify members without duplicating auth data into a public
-- table or widening the profiles RLS contract.

create or replace function public.get_team_roster_identities(target_team_id uuid)
returns table (
  user_id uuid,
  display_name text,
  email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not private.is_team_manager(target_team_id, auth.uid()) then
    raise exception using
      errcode = '42501',
      message = 'An active team manager or owner role is required';
  end if;

  return query
  select
    membership.user_id,
    nullif(btrim(profile.display_name), ''),
    lower(account.email)
  from public.team_memberships membership
  join auth.users account on account.id = membership.user_id
  left join public.profiles profile on profile.id = membership.user_id
  where membership.team_id = target_team_id
    and membership.status = 'active'
  order by membership.joined_at asc, membership.user_id asc;
end;
$$;

revoke all on function public.get_team_roster_identities(uuid) from public;
revoke all on function public.get_team_roster_identities(uuid) from anon;
revoke all on function public.get_team_roster_identities(uuid) from authenticated;
grant execute on function public.get_team_roster_identities(uuid) to authenticated;
