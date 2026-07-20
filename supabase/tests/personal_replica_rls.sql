-- pgTAP contract for 202607190007_personal_replica_sync.sql.
-- Live-verified with `supabase test db` against the local stack and the linked
-- Weekform Supabase project on July 20, 2026.

begin;
set local role postgres;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(34);

select has_table('public', 'weekform_devices', 'device registry exists');
select has_table('public', 'personal_replica_batches', 'idempotent batch receipts exist');
select has_table('public', 'personal_workload_replicas', 'personal replicas exist');
select has_table('public', 'review_commands', 'review command queue exists');
select has_function('public', 'register_weekform_device', array['uuid','text'], 'device registration RPC exists');
select has_function('public', 'sync_personal_replica_batch', array['uuid','uuid','text','jsonb'], 'replica sync RPC exists');
select has_function('public', 'queue_review_command', array['text','text','text','text','jsonb'], 'command queue RPC exists');
select has_function('public', 'complete_review_command', array['uuid','uuid','text','text'], 'command completion RPC exists');
select has_function('public', 'delete_personal_replica_history', array[]::text[], 'personal deletion RPC exists');
select is(has_table_privilege('authenticated', 'public.personal_workload_replicas', 'INSERT'), false, 'clients cannot insert replicas directly');
select is(has_table_privilege('authenticated', 'public.personal_workload_replicas', 'UPDATE'), false, 'clients cannot update replicas directly');
select is(has_table_privilege('authenticated', 'public.review_commands', 'INSERT'), false, 'clients cannot insert commands directly');
select is(has_table_privilege('authenticated', 'public.review_commands', 'UPDATE'), false, 'clients cannot update command status directly');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('71000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'personal-a@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('71000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'personal-b@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claim.sub" = '71000000-0000-4000-8000-000000000001';

select lives_ok(
  $$ select public.register_weekform_device('72000000-0000-4000-8000-000000000001', 'Synthetic Mac') $$,
  'A can register their Mac'
);

select lives_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      '0123456789abcdef',
      '{
        "schemaVersion":1,"replicaId":"personal-2026-W29","weekId":"2026-W29",
        "generatedAt":"2026-07-19T20:00:00Z","sourceUpdatedAt":"2026-07-19T19:00:00Z",
        "blocks":[{
          "blockId":"block-1","weekId":"2026-W29","startTime":"2026-07-14T13:00:00Z",
          "endTime":"2026-07-14T14:00:00Z","estimatedCapacityPct":3,
          "category":"Admin / coordination","mode":"Reactive","plannedStatus":"unplanned",
          "confidence":0.8,"userVerified":false,"blockerFlag":false,"revision":"fedcba9876543210"
        }],
        "capacity":{"allocatedPct":70,"deepWorkPct":35,"fragmentedWorkPct":15,"meetingPct":20,"reactivePct":25,"plannedPct":50,"blockedPct":5,"reliableNewWorkCapacityPct":10,"committedUtilizationPct":70,"carryoverRiskPct":12,"wipLoadScore":40,"contextSwitchScore":35,"summaryConfidence":0.8}
      }'::jsonb
    )
  $$,
  'A can sync one review-safe replica through the RPC'
);

select is((select count(*)::integer from public.personal_workload_replicas), 1, 'A reads their own replica');

select throws_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '72000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000002',
      '1123456789abcdef',
      '{"schemaVersion":1,"replicaId":"bad","weekId":"2026-W29","generatedAt":"2026-07-19T20:00:00Z","sourceUpdatedAt":"2026-07-19T19:00:00Z","blocks":[{"blockId":"block-2","weekId":"2026-W29","startTime":"2026-07-14T13:00:00Z","endTime":"2026-07-14T14:00:00Z","estimatedCapacityPct":3,"category":"Admin / coordination","mode":"Reactive","plannedStatus":"unplanned","confidence":0.8,"userVerified":false,"blockerFlag":false,"revision":"fedcba9876543211","evidence":["must not upload"]}],"capacity":{"allocatedPct":70,"deepWorkPct":35,"fragmentedWorkPct":15,"meetingPct":20,"reactivePct":25,"plannedPct":50,"blockedPct":5,"reliableNewWorkCapacityPct":10,"committedUtilizationPct":70,"carryoverRiskPct":12,"wipLoadScore":40,"contextSwitchScore":35,"summaryConfidence":0.8}}'::jsonb
    )
  $$,
  'P0001',
  'invalid personal replica block',
  'server rejects a block that adds raw evidence'
);

select lives_ok(
  $$ select public.queue_review_command('block-1','2026-W29','fedcba9876543210','confirm',null) $$,
  'A can queue a revision-bound command for their own replica'
);
select is((select count(*)::integer from public.review_commands where status = 'pending'), 1, 'A sees one pending command');
select is(
  public.queue_review_command('block-1','2026-W29','fedcba9876543210','confirm',null),
  (select command_id from public.review_commands where block_id = 'block-1' and status = 'pending'),
  'an identical retry returns the existing pending request id'
);
select is((select count(*)::integer from public.review_commands where status = 'pending'), 1, 'an identical retry does not create a duplicate');
select throws_ok(
  $$ select public.queue_review_command('block-1','2026-W29','fedcba9876543210','exclude',null) $$,
  'P0001',
  'another review request is already pending for this block revision',
  'a contradictory request fails loudly while approval is pending'
);

select throws_ok(
  $$ update public.review_commands set status = 'applied' where block_id = 'block-1' $$,
  '42501',
  'permission denied for table review_commands',
  'A cannot bypass the completion RPC'
);

select is(
  public.claim_review_command(
    '72000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands where block_id = 'block-1')
  ),
  'apply_pending',
  'registered Mac claims the command before local mutation'
);
select ok(
  public.mark_review_command_applied_locally(
    '72000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands where block_id = 'block-1')
  ),
  'registered Mac records local application before terminal completion'
);

select lives_ok(
  $$
    select public.complete_review_command(
      '72000000-0000-4000-8000-000000000001',
      (select command_id from public.review_commands where block_id = 'block-1'),
      'applied','Approved in native test'
    )
  $$,
  'registered Mac can complete the command'
);
select is((select count(*)::integer from public.review_commands where status = 'applied'), 1, 'command lifecycle is server-owned');
select lives_ok(
  $$ select public.queue_review_command('block-1','2026-W29','fedcba9876543210','exclude',null) $$,
  'a terminalized request allows a new pending decision'
);
select is((select count(*)::integer from public.review_commands where status = 'pending'), 1, 'only the new decision is pending');

set local "request.jwt.claim.sub" = '71000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.personal_workload_replicas), 0, 'B cannot enumerate A replicas');
select is((select count(*)::integer from public.review_commands), 0, 'B cannot enumerate A commands');

set local "request.jwt.claim.sub" = '71000000-0000-4000-8000-000000000001';
select lives_ok($$ select public.delete_personal_replica_history() $$, 'A can delete their private replica history');
select is((select count(*)::integer from public.personal_workload_replicas), 0, 'personal replicas are deleted');
select is((select count(*)::integer from public.review_commands), 0, 'review commands are deleted');

select * from finish();
rollback;
