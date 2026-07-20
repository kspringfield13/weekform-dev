-- Manager-only roster identity projection. Synthetic fixtures only.

begin;

select '1..6';

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'roster-manager@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('91000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'roster-member@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('91000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'roster-outsider@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

update public.profiles
set display_name = case id
  when '91000000-0000-4000-8000-000000000001' then 'Roster Manager'
  when '91000000-0000-4000-8000-000000000002' then 'Roster Member'
  else 'Roster Outsider'
end
where id in (
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000003'
);

insert into public.teams (id, name, created_by) values
  ('92000000-0000-4000-8000-000000000001', 'Roster Test Team', '91000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000002', 'Other Test Team', '91000000-0000-4000-8000-000000000003');

insert into public.team_memberships (team_id, user_id, role, status) values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000003', 'owner', 'active');

do $$
begin
  if to_regprocedure('public.get_team_roster_identities(uuid)') is null then
    raise exception 'manager roster identity RPC is missing';
  end if;
end;
$$;
select 'ok 1 - manager roster identity RPC exists';

set local role authenticated;
set local "request.jwt.claim.sub" = '91000000-0000-4000-8000-000000000001';

do $$
begin
  if (select count(*) from public.get_team_roster_identities('92000000-0000-4000-8000-000000000001')) <> 2 then
    raise exception 'owner did not receive the complete active roster';
  end if;
end;
$$;
select 'ok 2 - owner receives every active member, including their own account';

do $$
begin
  if (select email from public.get_team_roster_identities('92000000-0000-4000-8000-000000000001')
      where user_id = '91000000-0000-4000-8000-000000000001') is distinct from 'roster-manager@example.test' then
    raise exception 'signed-in owner email is missing from the roster projection';
  end if;
end;
$$;
select 'ok 3 - owner identity includes the signed-in account email';

do $$
begin
  if (select display_name from public.get_team_roster_identities('92000000-0000-4000-8000-000000000001')
      where user_id = '91000000-0000-4000-8000-000000000002') is distinct from 'Roster Member' then
    raise exception 'member display name is missing from the manager projection';
  end if;
end;
$$;
select 'ok 4 - manager-authorized projection returns the member display name';

set local "request.jwt.claim.sub" = '91000000-0000-4000-8000-000000000002';

do $$
begin
  begin
    perform * from public.get_team_roster_identities('92000000-0000-4000-8000-000000000001');
    raise exception 'plain member unexpectedly read roster identities';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select 'ok 5 - plain members cannot read roster identities';

set local "request.jwt.claim.sub" = '91000000-0000-4000-8000-000000000003';

do $$
begin
  begin
    perform * from public.get_team_roster_identities('92000000-0000-4000-8000-000000000001');
    raise exception 'outsider unexpectedly read roster identities';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
select 'ok 6 - outsiders cannot probe another team roster';

rollback;
