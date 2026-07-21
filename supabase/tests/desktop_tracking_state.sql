-- Tracking-enabled heartbeat and atomic Web Start Tracking outcomes.

begin;
set local role postgres;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(37);

select has_column('public', 'weekform_devices', 'tracking_active', 'devices store a recent capture-confirmation boolean');
select has_column('public', 'weekform_devices', 'tracking_state_at', 'devices store the tracking heartbeat receipt time');
select has_column('public', 'weekform_devices', 'tracking_protocol_version', 'devices advertise tracking-state support');
select function_returns('public', 'register_weekform_device_v3', array['uuid','text','boolean'], 'weekform_devices', 'v3 registration publishes tracking state');
select function_returns('public', 'request_desktop_start_tracking', array[]::text[], 'text', 'Web receives an explicit tracking outcome');
select ok((select prosecdef from pg_proc where oid = 'public.register_weekform_device_v3(uuid,text,boolean)'::regprocedure), 'v3 registration owns its write boundary');
select ok((select prosecdef from pg_proc where oid = 'public.request_desktop_start_tracking()'::regprocedure), 'Start Tracking request owns its atomic decision boundary');
select is(has_function_privilege('authenticated', 'public.register_weekform_device_v3(uuid,text,boolean)', 'EXECUTE'), true, 'authenticated clients can publish their state');
select is(has_function_privilege('authenticated', 'public.request_desktop_start_tracking()', 'EXECUTE'), true, 'authenticated Web can request tracking');
select is(has_function_privilege('anon', 'public.register_weekform_device_v3(uuid,text,boolean)', 'EXECUTE'), false, 'anonymous clients cannot publish device state');
select is(has_function_privilege('anon', 'public.request_desktop_start_tracking()', 'EXECUTE'), false, 'anonymous clients cannot request tracking');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('94000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'tracking-state-a@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('94000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'tracking-state-b@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('94000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'tracking-state-no-device@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claim.sub" = '94000000-0000-4000-8000-000000000003';
select is(public.request_desktop_start_tracking(), 'no_device'::text, 'an account without a Mac gets the download outcome');
select is((select count(*)::integer from public.desktop_actions), 0, 'no-device outcome queues nothing');

set local "request.jwt.claim.sub" = '94000000-0000-4000-8000-000000000001';
select lives_ok(
  $$ select public.register_weekform_device_v3(
    '95000000-0000-4000-8000-000000000001', 'Synthetic Tracking Mac', true
  ) $$,
  'current Desktop can publish a confirmed capture state'
);
select is((select tracking_active from public.weekform_devices where id = '95000000-0000-4000-8000-000000000001'), true, 'capture confirmation is recorded');
select is((select tracking_protocol_version from public.weekform_devices where id = '95000000-0000-4000-8000-000000000001'), 2::smallint, 'tracking-state protocol is current');
select is((select review_protocol_version from public.weekform_devices where id = '95000000-0000-4000-8000-000000000001'), 2::smallint, 'v3 preserves review protocol v2');
select ok((select tracking_state_at is not null and tracking_state_at = last_seen_at from public.weekform_devices where id = '95000000-0000-4000-8000-000000000001'), 'tracking and device heartbeat share one server receipt edge');
select is(public.request_desktop_start_tracking(), 'already_tracking'::text, 'fresh confirmed tracking returns the green outcome');
select is((select count(*)::integer from public.desktop_actions), 0, 'already-tracking outcome queues nothing');

select lives_ok(
  $$ select public.register_weekform_device_v3(
    '95000000-0000-4000-8000-000000000001', 'Synthetic Tracking Mac', false
  ) $$,
  'current Desktop can publish tracking not confirmed'
);
select is(public.request_desktop_start_tracking(), 'queued'::text, 'fresh paused tracking queues a resume control');
select is((select count(*)::integer from public.desktop_actions), 1, 'paused outcome queues exactly one control');
select is((select device_id from public.desktop_actions limit 1), '95000000-0000-4000-8000-000000000001'::uuid, 'resume targets the fresh paused Mac');
select is(public.request_desktop_start_tracking(), 'queued'::text, 'an immediate retry remains idempotent');
select is((select count(*)::integer from public.desktop_actions), 1, 'retry replaces rather than duplicates the control');

set local role postgres;
delete from public.desktop_actions where user_id = '94000000-0000-4000-8000-000000000001';
insert into public.weekform_devices(
  id, user_id, device_name, last_seen_at, revoked_at,
  review_protocol_version, tracking_active, tracking_state_at, tracking_protocol_version
) values (
  '95000000-0000-4000-8000-000000000005',
  '94000000-0000-4000-8000-000000000001',
  'Older Active Mac', now() - interval '10 seconds', null,
  2, true, now() - interval '10 seconds', 2
);
set local role authenticated;
set local "request.jwt.claim.sub" = '94000000-0000-4000-8000-000000000001';
select is(public.request_desktop_start_tracking(), 'queued'::text, 'the latest paused Mac is not masked by an older active Mac');
select is((select device_id from public.desktop_actions limit 1), '95000000-0000-4000-8000-000000000001'::uuid, 'the control targets the most recently confirmed Mac');

set local role postgres;
delete from public.desktop_actions where user_id = '94000000-0000-4000-8000-000000000001';
update public.weekform_devices
set last_seen_at = now() - interval '2 minutes', tracking_state_at = now() - interval '2 minutes'
where user_id = '94000000-0000-4000-8000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '94000000-0000-4000-8000-000000000001';
select is(public.request_desktop_start_tracking(), 'offline'::text, 'stale tracking state fails closed as offline');
select is((select count(*)::integer from public.desktop_actions), 0, 'offline outcome queues nothing');

select lives_ok(
  $$ select public.register_weekform_device_v2(
    '95000000-0000-4000-8000-000000000001', 'Legacy Tracking Mac'
  ) $$,
  'legacy registration remains compatible'
);
select is((select tracking_state_at from public.weekform_devices where id = '95000000-0000-4000-8000-000000000001'), null::timestamptz, 'legacy registration clears an untrustworthy prior state');
select is((select tracking_protocol_version from public.weekform_devices where id = '95000000-0000-4000-8000-000000000001'), 1::smallint, 'legacy registration advertises no tracking-state support');
select is(public.request_desktop_start_tracking(), 'offline'::text, 'a fresh legacy app is not mistaken for paused or active');

set local role postgres;
insert into public.weekform_devices(id, user_id, device_name, last_seen_at, revoked_at)
values ('95000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000002', 'Other User Mac', now(), null),
       ('95000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000001', 'Revoked Mac', now(), now());
set local role authenticated;
set local "request.jwt.claim.sub" = '94000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.weekform_devices), 3, 'device state remains RLS-isolated to its owner');
select throws_ok(
  $$ select public.register_weekform_device_v3(
    '95000000-0000-4000-8000-000000000003', 'Revoked Mac', true
  ) $$,
  'P0001', 'device revoked', 'revoked devices cannot reactivate through v3'
);
select throws_ok(
  $$ select public.register_weekform_device_v3(
    '95000000-0000-4000-8000-000000000004', 'Null State Mac', null
  ) $$,
  'P0001', 'tracking state required', 'v3 rejects a missing tracking state'
);

select * from finish();
rollback;
