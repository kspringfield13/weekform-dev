-- Current-user-only authorization seam for the production Admin Portal.
-- The private grant table remains unavailable through the Data API.

begin;

grant usage on schema private to authenticated;

create or replace function public.has_simulator_admin_access()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_simulator_admin(auth.uid());
$$;

revoke all on function public.has_simulator_admin_access() from public, anon, authenticated;
grant execute on function public.has_simulator_admin_access() to authenticated;

commit;
