-- pgTAP authorization contract for the production Admin Portal.
-- Intended for `supabase test db` after all migrations are applied.

begin;
create extension if not exists pgtap;
create extension if not exists pgcrypto;
select plan(10);

select has_function(
  'public',
  'has_simulator_admin_access',
  array[]::text[],
  'zero-argument current-user simulator access RPC exists'
);
select hasnt_function(
  'public',
  'has_simulator_admin_access',
  array['uuid'],
  'RPC has no arbitrary-user UUID overload'
);
select is(
  has_function_privilege('anon', 'public.has_simulator_admin_access()', 'EXECUTE'),
  false,
  'anonymous users cannot execute the simulator access RPC'
);
select is(
  has_function_privilege('authenticated', 'public.has_simulator_admin_access()', 'EXECUTE'),
  true,
  'authenticated users can execute the current-user access RPC'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'portal-admin@example.test', crypt('not-a-real-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('11000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'portal-member@example.test', crypt('not-a-real-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('11000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'portal-manager@example.test', crypt('not-a-real-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"team_role":"manager"}', now(), now())
on conflict (id) do nothing;

insert into private.simulator_admins (user_id, reason)
values ('11000000-0000-0000-0000-000000000001', 'Production Admin Portal policy test')
on conflict (user_id) do nothing;

set local role authenticated;
set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000002';
select is(
  public.has_simulator_admin_access(),
  false,
  'ordinary member is not a simulator admin'
);

set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000003';
select is(
  public.has_simulator_admin_access(),
  false,
  'team manager metadata does not grant simulator access'
);

set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000001';
select is(
  public.has_simulator_admin_access(),
  true,
  'explicit simulator administrator is recognized'
);

select throws_ok(
  $$ select * from private.simulator_admins $$,
  '42501',
  'permission denied for table simulator_admins',
  'authenticated users cannot read the simulator admin registry'
);

select throws_ok(
  $$
    insert into private.simulator_admins (user_id, reason)
    values ('11000000-0000-0000-0000-000000000002', 'self grant')
  $$,
  '42501',
  'permission denied for table simulator_admins',
  'authenticated users cannot grant themselves simulator access'
);

reset role;
delete from private.simulator_admins
where user_id = '11000000-0000-0000-0000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '11000000-0000-0000-0000-000000000001';
select is(
  public.has_simulator_admin_access(),
  false,
  'revoking the trusted grant takes effect immediately'
);

select * from finish();
rollback;
