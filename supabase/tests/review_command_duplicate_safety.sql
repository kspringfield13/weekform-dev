-- Functional pgTAP contract for 202607200001_review_command_duplicate_safety.sql.
-- Run with `supabase test db`; static source checks are not a substitute for this boundary proof.

begin;
set local role postgres;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(25);

select has_index(
  'public',
  'review_commands',
  'review_commands_one_pending_block_revision_idx',
  'pending review requests have a concurrent duplicate-safety index'
);

select matches(
  pg_get_indexdef('public.review_commands_one_pending_block_revision_idx'::regclass),
  'WHERE \(status = ''pending''::text\)',
  'duplicate safety applies only while a request awaits approval'
);

select has_function(
  'public',
  'queue_review_command',
  array['text','text','text','text','jsonb'],
  'the duplicate-safe queue RPC exists'
);
select is(
  has_function_privilege('authenticated', 'public.queue_review_command(text,text,text,text,jsonb)', 'EXECUTE'),
  true,
  'authenticated callers can use the queue RPC'
);
select is(
  has_function_privilege('anon', 'public.queue_review_command(text,text,text,text,jsonb)', 'EXECUTE'),
  false,
  'anonymous callers cannot use the queue RPC'
);
select is(
  has_table_privilege('authenticated', 'public.review_commands', 'INSERT'),
  false,
  'authenticated callers cannot bypass the RPC with a direct insert'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '74000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'duplicate-safety@example.test', null, now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
) on conflict (id) do nothing;

insert into public.weekform_devices(id, user_id, device_name)
values (
  '75000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'Synthetic duplicate-safety Mac'
);

insert into public.personal_workload_replicas(
  user_id, replica_id, week_id, revision, payload, device_id, source_updated_at
) values (
  '74000000-0000-4000-8000-000000000001',
  'personal-2026-W30', '2026-W30', '0123456789abcdef',
  '{
    "schemaVersion": 1,
    "blocks": [{"blockId":"block-duplicate-safe","revision":"fedcba9876543210"}]
  }'::jsonb,
  '75000000-0000-4000-8000-000000000001',
  now()
);

set local role authenticated;
set local "request.jwt.claim.sub" = '74000000-0000-4000-8000-000000000001';

select throws_ok(
  $$ select public.queue_review_command(' block-duplicate-safe','2026-W30','fedcba9876543210','confirm',null) $$,
  'P0001', 'invalid block id',
  'the server rejects non-canonical block ids even if a client parser is bypassed'
);
select throws_ok(
  $$ select public.queue_review_command('block-duplicate-safe','2026-W54','fedcba9876543210','confirm',null) $$,
  'P0001', 'invalid week id',
  'the server rejects an impossible week before replica lookup'
);
select throws_ok(
  $$ select public.queue_review_command('block-duplicate-safe','2026-W30','NOT-A-REVISION','confirm',null) $$,
  'P0001', 'invalid expected revision',
  'the server rejects a malformed revision before replica lookup'
);
select throws_ok(
  $$ select public.queue_review_command('block-duplicate-safe','2026-W30','fedcba9876543210','relabel',null) $$,
  'P0001', 'invalid review patch',
  'SQL NULL cannot exploit three-valued logic to create a patchless relabel'
);
select throws_ok(
  $$ select public.queue_review_command('block-duplicate-safe','2026-W30','fedcba9876543210','relabel','{}'::jsonb) $$,
  'P0001', 'invalid review patch',
  'the server rejects an empty relabel patch'
);
select throws_ok(
  $$ select public.queue_review_command('block-duplicate-safe','2026-W30','fedcba9876543210','relabel','{"notes":"private"}'::jsonb) $$,
  'P0001', 'invalid review patch',
  'the server rejects non-allowlisted relabel fields'
);
select throws_ok(
  $$ select public.queue_review_command('block-duplicate-safe','2026-W30','fedcba9876543210','relabel','{"category":null}'::jsonb) $$,
  'P0001', 'invalid review patch',
  'JSON null cannot exploit three-valued logic in an allowlisted relabel field'
);
select throws_ok(
  $$ select public.queue_review_command('block-duplicate-safe','2026-W30','fedcba9876543210','relabel','{"blockerFlag":null}'::jsonb) $$,
  'P0001', 'invalid review patch',
  'JSON null cannot exploit three-valued logic in the boolean relabel field'
);

select lives_ok(
  $$ select public.queue_review_command('block-duplicate-safe','2026-W30','fedcba9876543210','confirm',null) $$,
  'the first valid request is queued'
);
select ok(
  exists (
    select 1 from public.review_commands
    where user_id = '74000000-0000-4000-8000-000000000001'
      and created_by = '74000000-0000-4000-8000-000000000001'
      and block_id = 'block-duplicate-safe' and week_id = '2026-W30'
      and expected_revision = 'fedcba9876543210' and action = 'confirm'
      and patch is null and status = 'pending' and created_at is not null
      and decided_at is null and decision_reason is null and decided_by_device is null
  ),
  'identity, chronology, and pending lifecycle fields are server-owned'
);
select is(
  public.queue_review_command('block-duplicate-safe','2026-W30','fedcba9876543210','confirm',null),
  (select command_id from public.review_commands where block_id = 'block-duplicate-safe' and status = 'pending'),
  'an identical retry returns the existing request id'
);
select is(
  (select count(*)::integer from public.review_commands where block_id = 'block-duplicate-safe' and status = 'pending'),
  1,
  'an identical retry cannot create a second pending row'
);
select throws_ok(
  $$ select public.queue_review_command('block-duplicate-safe','2026-W30','fedcba9876543210','exclude',null) $$,
  'P0001', 'another review request is already pending for this block revision',
  'a contradictory request fails loudly while approval is pending'
);
select throws_ok(
  $$ insert into public.review_commands(user_id, block_id, week_id, expected_revision, action, patch, created_by)
     values ('74000000-0000-4000-8000-000000000001','block-duplicate-safe','2026-W30',
       'fedcba9876543210','confirm',null,'74000000-0000-4000-8000-000000000001') $$,
  '42501', 'permission denied for table review_commands',
  'the caller cannot evade duplicate safety with a direct table insert'
);

select lives_ok(
  $$ select public.complete_review_command(
    '75000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands where block_id = 'block-duplicate-safe' and status = 'pending'),
    'applied', 'Synthetic approval'
  ) $$,
  'the registered Mac can terminalize the pending request'
);
select is(
  (select count(*)::integer from public.review_commands where block_id = 'block-duplicate-safe' and status = 'applied'),
  1,
  'the completed request retains its applied lifecycle state'
);
select lives_ok(
  $$ select public.queue_review_command('block-duplicate-safe','2026-W30','fedcba9876543210','exclude',null) $$,
  'a terminalized request permits one new decision'
);
select is(
  (select count(*)::integer from public.review_commands where block_id = 'block-duplicate-safe' and status = 'pending'),
  1,
  'exactly one new request is pending after terminalization'
);
select is(
  (select count(*)::integer from public.review_commands where block_id = 'block-duplicate-safe'),
  2,
  'terminal history is preserved without weakening pending uniqueness'
);

select * from finish();
rollback;
