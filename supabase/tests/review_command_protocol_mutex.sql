-- pgTAP regression contract for the persistent cross-protocol target mutex.
-- The command tables, not cached mutex metadata, remain authoritative.

begin;
set local role postgres;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(14);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '8a000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'protocol-mutex@example.test', null, now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
) on conflict (id) do nothing;

insert into public.weekform_devices(id, user_id, device_name)
values (
  '8b000000-0000-4000-8000-000000000001',
  '8a000000-0000-4000-8000-000000000001',
  'Protocol mutex synthetic Mac'
);

insert into public.personal_workload_replicas(
  user_id, replica_id, week_id, revision, payload, device_id, source_updated_at
) values (
  '8a000000-0000-4000-8000-000000000001',
  'personal-2026-W30', '2026-W30', '0123456789abcdef',
  '{
    "schemaVersion":1,
    "blocks":[
      {"blockId":"mutex-missing-v1","revision":"1111111111111111"},
      {"blockId":"mutex-missing-v2","revision":"2222222222222222"},
      {"blockId":"mutex-stale-v1","revision":"3333333333333333"},
      {"blockId":"mutex-wrong-live-v1","revision":"4444444444444444"}
    ]
  }'::jsonb,
  '8b000000-0000-4000-8000-000000000001',
  now()
);

set local role authenticated;
set local "request.jwt.claim.sub" = '8a000000-0000-4000-8000-000000000001';
select public.queue_review_command(
  'mutex-missing-v1','2026-W30','1111111111111111','confirm',null
);
set local role postgres;
delete from private.review_command_pending_targets
where user_id = '8a000000-0000-4000-8000-000000000001'
  and block_id = 'mutex-missing-v1';
select throws_ok(
  $$ select public.queue_review_command_v2(
    'mutex-missing-v1','2026-W30','1111111111111111','confirm',null
  ) $$,
  'P0001',
  'another review protocol already has a pending request for this block revision',
  'a missing mutex row cannot hide a live v1 request from v2'
);
select is(
  (select count(*)::integer from public.review_commands
    where block_id = 'mutex-missing-v1' and status = 'pending'),
  1,
  'the live v1 request remains pending after the rejected v2 insert'
);
select is(
  (select count(*)::integer from public.review_commands_v2
    where block_id = 'mutex-missing-v1' and status = 'pending'),
  0,
  'no v2 request is created when the v1 table is authoritative'
);

select public.queue_review_command_v2(
  'mutex-missing-v2','2026-W30','2222222222222222','confirm',null
);
delete from private.review_command_pending_targets
where user_id = '8a000000-0000-4000-8000-000000000001'
  and block_id = 'mutex-missing-v2';
set local role authenticated;
select throws_ok(
  $$ select public.queue_review_command(
    'mutex-missing-v2','2026-W30','2222222222222222','confirm',null
  ) $$,
  'P0001',
  'another review protocol already has a pending request for this block revision',
  'a missing mutex row cannot hide a live v2 request from v1'
);
set local role postgres;
select is(
  (select count(*)::integer from public.review_commands_v2
    where block_id = 'mutex-missing-v2' and status = 'pending'),
  1,
  'the live v2 request remains pending after the rejected v1 insert'
);
select is(
  (select count(*)::integer from public.review_commands
    where block_id = 'mutex-missing-v2' and status = 'pending'),
  0,
  'no v1 request is created when the v2 table is authoritative'
);

set local role authenticated;
select public.queue_review_command(
  'mutex-stale-v1','2026-W30','3333333333333333','confirm',null
);
set local role postgres;
update public.review_commands
set status = 'applied', decided_at = now()
where user_id = '8a000000-0000-4000-8000-000000000001'
  and block_id = 'mutex-stale-v1' and status = 'pending';
insert into private.review_command_pending_targets(
  user_id, week_id, block_id, expected_revision, protocol_version, command_id
)
select user_id, week_id, block_id, expected_revision, 1, command_id
from public.review_commands
where user_id = '8a000000-0000-4000-8000-000000000001'
  and block_id = 'mutex-stale-v1' and status = 'applied'
on conflict (user_id, week_id, block_id, expected_revision) do update
set protocol_version = excluded.protocol_version,
    command_id = excluded.command_id;
select lives_ok(
  $$ select public.queue_review_command_v2(
    'mutex-stale-v1','2026-W30','3333333333333333','exclude',null
  ) $$,
  'stale mutex metadata cannot block a safe v1-to-v2 transition'
);
select is(
  (select protocol_version from private.review_command_pending_targets
    where user_id = '8a000000-0000-4000-8000-000000000001'
      and block_id = 'mutex-stale-v1'),
  2::smallint,
  'the mutex records the protocol that most recently passed authoritative checks'
);
select is(
  (select count(*)::integer from public.review_commands_v2
    where block_id = 'mutex-stale-v1' and status = 'pending'),
  1,
  'v2 receives the request after the v1 row is terminal'
);

set local role authenticated;
select public.queue_review_command(
  'mutex-wrong-live-v1','2026-W30','4444444444444444','confirm',null
);
set local role postgres;
update private.review_command_pending_targets
set protocol_version = 2,
    command_id = '8c000000-0000-4000-8000-000000000001'
where user_id = '8a000000-0000-4000-8000-000000000001'
  and block_id = 'mutex-wrong-live-v1';
select throws_ok(
  $$ select public.queue_review_command_v2(
    'mutex-wrong-live-v1','2026-W30','4444444444444444','exclude',null
  ) $$,
  'P0001',
  'another review protocol already has a pending request for this block revision',
  'wrong mutex metadata cannot hide a live request in the opposite table'
);
select is(
  (select count(*)::integer from public.review_commands
    where block_id = 'mutex-wrong-live-v1' and status = 'pending'),
  1,
  'the authoritative v1 request survives corrupted mutex metadata'
);
select is(
  (select count(*)::integer from public.review_commands_v2
    where block_id = 'mutex-wrong-live-v1' and status = 'pending'),
  0,
  'corrupted mutex metadata cannot create a cross-protocol duplicate'
);

select hasnt_trigger(
  'public', 'review_commands', 'review_commands_v1_release_pending_target',
  'v1 terminalization never takes the protocol mutex'
);
select hasnt_trigger(
  'public', 'review_commands_v2', 'review_commands_v2_release_pending_target',
  'v2 terminalization never takes the protocol mutex'
);

select * from finish();
rollback;
