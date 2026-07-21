-- Prompt-free, authenticated Web -> running Mac actions.

begin;
set local role postgres;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(22);

select has_table('public', 'desktop_actions', 'desktop action queue exists');
select ok(
  (select c.relrowsecurity and c.relforcerowsecurity
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'desktop_actions'),
  'desktop actions force RLS'
);
select is(has_table_privilege('authenticated', 'public.desktop_actions', 'SELECT'), true, 'clients can read only their RLS-scoped actions');
select is(has_table_privilege('authenticated', 'public.desktop_actions', 'INSERT'), false, 'clients cannot insert desktop actions directly');
select is(has_table_privilege('authenticated', 'public.desktop_actions', 'DELETE'), false, 'clients cannot acknowledge desktop actions directly');
select function_returns('public', 'queue_start_tracking_action', array[]::text[], 'uuid', 'Web can queue one start-tracking action');
select function_returns('public', 'acknowledge_desktop_action', array['uuid','uuid'], 'boolean', 'Mac can acknowledge its action');
select ok((select prosecdef from pg_proc where oid = 'public.queue_start_tracking_action()'::regprocedure), 'queue RPC owns its write boundary');
select ok((select prosecdef from pg_proc where oid = 'public.acknowledge_desktop_action(uuid,uuid)'::regprocedure), 'acknowledgement RPC owns its delete boundary');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'desktop-action-a@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('91000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'desktop-action-b@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.weekform_devices(id, user_id, device_name, last_seen_at, revoked_at)
values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Active Mac', now(), null),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', 'Stale Mac', now() - interval '2 minutes', null),
  ('92000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', 'Revoked Mac', now(), now()),
  ('92000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000002', 'Other Mac', now(), null)
on conflict (user_id, id) do update set
  last_seen_at = excluded.last_seen_at,
  revoked_at = excluded.revoked_at;

set local role authenticated;
set local "request.jwt.claim.sub" = '91000000-0000-4000-8000-000000000001';

select lives_ok(
  $$ select public.queue_start_tracking_action() $$,
  'owner can queue for a recently active Mac'
);
select is((select count(*)::integer from public.desktop_actions), 1, 'one action is visible to its owner');
select is((select device_id from public.desktop_actions limit 1), '92000000-0000-4000-8000-000000000001'::uuid, 'action targets the active unrevoked Mac');
select is((select action from public.desktop_actions limit 1), 'start_tracking', 'action allowlist is fixed');
select ok((select expires_at <= created_at + interval '2 minutes' from public.desktop_actions limit 1), 'action expires quickly');

select lives_ok(
  $$ select public.queue_start_tracking_action() $$,
  'an immediate retry is idempotent'
);
select is((select count(*)::integer from public.desktop_actions), 1, 'retry does not duplicate the pending action');

select is(
  public.acknowledge_desktop_action(
    '92000000-0000-4000-8000-000000000002',
    (select action_id from public.desktop_actions limit 1)
  ),
  false,
  'a different Mac cannot acknowledge the action'
);
select is((select count(*)::integer from public.desktop_actions), 1, 'failed acknowledgement leaves the action pending');
select is(
  public.acknowledge_desktop_action(
    '92000000-0000-4000-8000-000000000001',
    (select action_id from public.desktop_actions limit 1)
  ),
  true,
  'target Mac acknowledges and removes the action'
);
select is((select count(*)::integer from public.desktop_actions), 0, 'acknowledged action retains no cloud history');

set local "request.jwt.claim.sub" = '91000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.desktop_actions), 0, 'another user cannot enumerate actions');

set local role postgres;
update public.weekform_devices
set last_seen_at = now() - interval '2 minutes'
where user_id = '91000000-0000-4000-8000-000000000002';
set local role authenticated;
set local "request.jwt.claim.sub" = '91000000-0000-4000-8000-000000000002';
select throws_ok(
  $$ select public.queue_start_tracking_action() $$,
  'P0001',
  'desktop unavailable',
  'queue fails closed when no recently active Mac exists'
);

select * from finish();
rollback;
