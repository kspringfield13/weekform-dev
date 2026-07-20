-- Functional pgTAP smoke for the complete personal-replica decision loop.
-- This complements the narrower policy contract with a realistic synthetic
-- register -> sync -> request -> complete -> isolate -> delete sequence.

begin;
set local role postgres;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(32);

select has_table('public', 'weekform_devices', 'device registry exists');
select has_table('public', 'personal_replica_batches', 'batch receipt table exists');
select has_table('public', 'personal_workload_replicas', 'personal replica table exists');
select has_table('public', 'review_commands', 'review command table exists');

select ok(
  (select c.relrowsecurity and c.relforcerowsecurity
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'weekform_devices'),
  'device registry forces RLS'
);
select ok(
  (select c.relrowsecurity and c.relforcerowsecurity
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'personal_replica_batches'),
  'batch receipts force RLS'
);
select ok(
  (select c.relrowsecurity and c.relforcerowsecurity
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'personal_workload_replicas'),
  'personal replicas force RLS'
);
select ok(
  (select c.relrowsecurity and c.relforcerowsecurity
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'review_commands'),
  'review commands force RLS'
);

select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'register_weekform_device' and p.prosecdef
), 'device registration is security-definer');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'sync_personal_replica_batch' and p.prosecdef
), 'personal sync is security-definer');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'queue_review_command' and p.prosecdef
), 'review request is security-definer');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'complete_review_command' and p.prosecdef
), 'review completion is security-definer');
select ok(exists(
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'delete_personal_replica_history' and p.prosecdef
), 'personal history deletion is security-definer');

select is(has_table_privilege('authenticated', 'public.personal_workload_replicas', 'INSERT'), false, 'clients cannot insert replicas directly');
select is(has_table_privilege('authenticated', 'public.personal_workload_replicas', 'UPDATE'), false, 'clients cannot update replicas directly');
select is(has_table_privilege('authenticated', 'public.review_commands', 'INSERT'), false, 'clients cannot insert review requests directly');
select is(has_table_privilege('authenticated', 'public.review_commands', 'UPDATE'), false, 'clients cannot complete requests directly');

select ok(exists(
  select 1 from pg_trigger where tgname = 'personal_replica_broadcast' and not tgisinternal
), 'personal replica private-broadcast trigger exists');
select ok(exists(
  select 1 from pg_trigger where tgname = 'review_command_broadcast' and not tgisinternal
), 'review command private-broadcast trigger exists');
select ok(exists(
  select 1 from pg_policies
  where schemaname = 'realtime'
    and tablename = 'messages'
    and policyname = 'users receive own Weekform broadcasts'
    and roles @> array['authenticated'::name]
    and cmd = 'SELECT'
), 'authenticated users have the private Broadcast topic policy');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('74000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'personal-production-a@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('74000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'personal-production-b@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claim.sub" = '74000000-0000-4000-8000-000000000001';

select lives_ok(
  $$ select public.register_weekform_device(
    '75000000-0000-4000-8000-000000000001',
    'Production verification Mac'
  ) $$,
  'actor A can register a device'
);

select lives_ok(
  $$ select * from public.sync_personal_replica_batch(
    '75000000-0000-4000-8000-000000000001',
    '76000000-0000-4000-8000-000000000001',
    '0123456789abcdef',
    '{
      "schemaVersion":1,"replicaId":"personal-2026-W29","weekId":"2026-W29",
      "generatedAt":"2026-07-19T20:00:00Z","sourceUpdatedAt":"2026-07-19T19:00:00Z",
      "blocks":[{
        "blockId":"production-block-1","weekId":"2026-W29",
        "startTime":"2026-07-14T13:00:00Z","endTime":"2026-07-14T14:00:00Z",
        "estimatedCapacityPct":3,"category":"Admin / coordination","mode":"Reactive",
        "plannedStatus":"unplanned","confidence":0.8,"userVerified":false,
        "blockerFlag":false,"revision":"fedcba9876543210"
      }],
      "capacity":{"allocatedPct":70,"deepWorkPct":35,"fragmentedWorkPct":15,"meetingPct":20,"reactivePct":25,"plannedPct":50,"blockedPct":5,"reliableNewWorkCapacityPct":10,"committedUtilizationPct":70,"carryoverRiskPct":12,"wipLoadScore":40,"contextSwitchScore":35,"summaryConfidence":0.8}
    }'::jsonb
  ) $$,
  'registered device can sync an allowlisted personal replica'
);

select is(
  (select count(*)::integer from public.personal_workload_replicas),
  1,
  'actor A reads exactly one own replica'
);

select throws_ok(
  $$ select * from public.sync_personal_replica_batch(
    '75000000-0000-4000-8000-000000000001',
    '76000000-0000-4000-8000-000000000002',
    '1123456789abcdef',
    '{"schemaVersion":1,"replicaId":"bad","weekId":"2026-W29","generatedAt":"2026-07-19T20:00:00Z","sourceUpdatedAt":"2026-07-19T19:00:00Z","blocks":[{"blockId":"production-block-2","weekId":"2026-W29","startTime":"2026-07-14T13:00:00Z","endTime":"2026-07-14T14:00:00Z","estimatedCapacityPct":3,"category":"Admin / coordination","mode":"Reactive","plannedStatus":"unplanned","confidence":0.8,"userVerified":false,"blockerFlag":false,"revision":"fedcba9876543211","evidence":["must not upload"]}],"capacity":{"allocatedPct":70,"deepWorkPct":35,"fragmentedWorkPct":15,"meetingPct":20,"reactivePct":25,"plannedPct":50,"blockedPct":5,"reliableNewWorkCapacityPct":10,"committedUtilizationPct":70,"carryoverRiskPct":12,"wipLoadScore":40,"contextSwitchScore":35,"summaryConfidence":0.8}}'::jsonb
  ) $$,
  'P0001',
  'invalid personal replica block',
  'server rejects non-allowlisted evidence fields'
);

select lives_ok(
  $$ select public.queue_review_command(
    'production-block-1', '2026-W29', 'fedcba9876543210', 'confirm', null
  ) $$,
  'actor A can queue a review request for the current revision'
);

select throws_ok(
  $$ update public.review_commands set status = 'applied'
     where block_id = 'production-block-1' $$,
  '42501',
  'permission denied for table review_commands',
  'authenticated actor cannot bypass the completion RPC'
);

select is(
  public.complete_review_command(
    '75000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands where block_id = 'production-block-1'),
    'applied',
    'Approved in production verification'
  ),
  true,
  'registered actor A device can complete its pending request'
);

set local "request.jwt.claim.sub" = '74000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.personal_workload_replicas), 0, 'actor B cannot enumerate actor A replicas');
select is((select count(*)::integer from public.review_commands), 0, 'actor B cannot enumerate actor A review requests');

set local "request.jwt.claim.sub" = '74000000-0000-4000-8000-000000000001';
select lives_ok(
  $$ select public.delete_personal_replica_history() $$,
  'actor A can delete personal replica history'
);
select is((select count(*)::integer from public.personal_workload_replicas), 0, 'personal replicas are deleted');
select is((select count(*)::integer from public.review_commands), 0, 'review requests are deleted');

select * from finish();
rollback;
