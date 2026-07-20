-- Functional pgTAP contract for 202607200002_review_confirm_batch.sql.
-- Run with `supabase test db`; every batch must be atomic, idempotent, and review-safe.
-- Live-verified against the local stack and the linked Weekform Supabase project
-- on July 20, 2026.

begin;
set local role postgres;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(23);

select has_function('public', 'queue_review_confirm_batch', array['jsonb'], 'confirm-all RPC exists');
select is(has_function_privilege('authenticated', 'public.queue_review_confirm_batch(jsonb)', 'EXECUTE'), true, 'authenticated callers can queue a batch');
select is(has_function_privilege('anon', 'public.queue_review_confirm_batch(jsonb)', 'EXECUTE'), false, 'anonymous callers cannot queue a batch');
select is(has_table_privilege('authenticated', 'public.review_commands', 'INSERT'), false, 'callers cannot bypass the RPC');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('76000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','batch-owner@example.test',null,now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('76000000-0000-4000-8000-000000000002','00000000-0000-0000-8000-000000000000','authenticated','authenticated','batch-outsider@example.test',null,now(),'{"provider":"email","providers":["email"]}','{}',now(),now())
on conflict (id) do nothing;

insert into public.weekform_devices(id, user_id, device_name) values
  ('77000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001','Synthetic batch owner Mac'),
  ('77000000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000002','Synthetic outsider Mac');

insert into public.personal_workload_replicas(user_id, replica_id, week_id, revision, payload, device_id, source_updated_at) values
  ('76000000-0000-4000-8000-000000000001','personal-2026-W30','2026-W30','0123456789abcdef',
   '{"schemaVersion":1,"weekId":"2026-W30","blocks":[{"blockId":"batch-one","weekId":"2026-W30","revision":"0000000000000001","userVerified":false},{"blockId":"batch-two","weekId":"2026-W30","revision":"0000000000000002","userVerified":false},{"blockId":"already-verified","weekId":"2026-W30","revision":"0000000000000003","userVerified":true}]}'::jsonb,
   '77000000-0000-4000-8000-000000000001',now()),
  ('76000000-0000-4000-8000-000000000002','personal-2026-W30','2026-W30','fedcba9876543210',
   '{"schemaVersion":1,"weekId":"2026-W30","blocks":[{"blockId":"outsider-block","weekId":"2026-W30","revision":"0000000000000004","userVerified":false}]}'::jsonb,
   '77000000-0000-4000-8000-000000000002',now());

set local role authenticated;
set local "request.jwt.claim.sub" = '76000000-0000-4000-8000-000000000001';

select throws_ok($$ select public.queue_review_confirm_batch('[]'::jsonb) $$, 'P0001', 'invalid confirm batch', 'empty batches fail');
select throws_ok($$ select public.queue_review_confirm_batch('{}'::jsonb) $$, 'P0001', 'invalid confirm batch', 'non-array batches fail');
select throws_ok(
  $$ select public.queue_review_confirm_batch((select jsonb_agg(jsonb_build_object('blockId','over-' || value,'weekId','2026-W30','expectedRevision','0000000000000001')) from generate_series(1,51) value)) $$,
  'P0001', 'invalid confirm batch', 'more than fifty targets fail'
);
select throws_ok(
  $$ select public.queue_review_confirm_batch('[{"blockId":"batch-one","weekId":"2026-W30","expectedRevision":"0000000000000001","action":"exclude"}]'::jsonb) $$,
  'P0001', 'invalid confirm target', 'extra client-controlled behavior fails'
);
select throws_ok(
  $$ select public.queue_review_confirm_batch('[{"blockId":"batch-one","weekId":"2026-W30","expectedRevision":"0000000000000001"},{"blockId":"batch-one","weekId":"2026-W30","expectedRevision":"0000000000000001"}]'::jsonb) $$,
  'P0001', 'duplicate confirm target', 'duplicate targets fail'
);
select throws_ok(
  $$ select public.queue_review_confirm_batch('[{"blockId":"already-verified","weekId":"2026-W30","expectedRevision":"0000000000000003"}]'::jsonb) $$,
  'P0001', 'replica revision conflict', 'verified blocks cannot be queued again'
);
select throws_ok(
  $$ select public.queue_review_confirm_batch('[{"blockId":"batch-one","weekId":"2026-W30","expectedRevision":"0000000000000001"},{"blockId":"missing","weekId":"2026-W30","expectedRevision":"0000000000000009"}]'::jsonb) $$,
  'P0001', 'replica revision conflict', 'one stale target aborts the whole batch'
);
select is((select count(*)::integer from public.review_commands where user_id = '76000000-0000-4000-8000-000000000001'), 0, 'failed mixed batch leaves no partial rows');
select throws_ok(
  $$ select public.queue_review_confirm_batch('[{"blockId":"outsider-block","weekId":"2026-W30","expectedRevision":"0000000000000004"}]'::jsonb) $$,
  'P0001', 'replica revision conflict', 'a caller cannot queue another user replica target'
);

create temporary table first_batch_ids as
select unnest(public.queue_review_confirm_batch('[{"blockId":"batch-one","weekId":"2026-W30","expectedRevision":"0000000000000001"},{"blockId":"batch-two","weekId":"2026-W30","expectedRevision":"0000000000000002"}]'::jsonb)) command_id;

select is((select count(*)::integer from first_batch_ids), 2, 'valid batch returns one id per target');
select is((select count(*)::integer from public.review_commands where user_id = '76000000-0000-4000-8000-000000000001'), 2, 'valid batch queues every target');
select is((select count(*)::integer from public.review_commands where user_id = '76000000-0000-4000-8000-000000000001' and action = 'confirm' and patch is null), 2, 'server derives confirm with null patch');
select is((select count(*)::integer from public.review_commands where user_id = created_by and status = 'pending' and created_at is not null and decided_at is null and decision_reason is null and decided_by_device is null), 2, 'identity and lifecycle fields are server-owned');

create temporary table retry_batch_ids as
select unnest(public.queue_review_confirm_batch('[{"blockId":"batch-one","weekId":"2026-W30","expectedRevision":"0000000000000001"},{"blockId":"batch-two","weekId":"2026-W30","expectedRevision":"0000000000000002"}]'::jsonb)) command_id;

select is((select count(*)::integer from retry_batch_ids), 2, 'identical retry returns one id per target');
select is((select count(*)::integer from retry_batch_ids r join first_batch_ids f using (command_id)), 2, 'identical retry returns the existing ids');
select is((select count(*)::integer from public.review_commands where user_id = '76000000-0000-4000-8000-000000000001'), 2, 'identical retry creates no duplicate rows');

select throws_ok(
  $$ select public.queue_review_command('batch-one','2026-W30','0000000000000001','exclude',null) $$,
  'P0001', 'another review request is already pending for this block revision', 'contradictory single request still fails loudly'
);
select is((select count(*)::integer from public.review_commands where action <> 'confirm' or patch is not null), 0, 'batch boundary never accepts a client-selected action or patch');
select is((select count(*)::integer from public.review_commands where user_id = '76000000-0000-4000-8000-000000000002'), 0, 'outsider identity owns no rows from the owner call');

select * from finish();
rollback;
