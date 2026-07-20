-- pgTAP contract for compatibility-safe v1/v2 review-command coexistence.

begin;
set local role postgres;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(52);

select has_table('public', 'review_commands', 'released v1 queue remains available');
select has_table('public', 'review_commands_v2', 'isolated v2 queue exists');
select has_table('private', 'review_command_pending_targets', 'cross-protocol pending reservations exist');
select hasnt_column('public', 'review_commands', 'application_phase', 'v1 table contract has no v2 phase');
select hasnt_column('public', 'review_commands', 'claimed_by_device', 'v1 table contract has no v2 claim owner');
select hasnt_column('public', 'review_commands', 'claimed_at', 'v1 table contract has no v2 claim time');
select hasnt_column('public', 'review_commands', 'application_recorded_at', 'v1 table contract has no v2 receipt time');
select has_column('public', 'review_commands_v2', 'application_phase', 'v2 commands expose an application phase');
select has_column('public', 'review_commands_v2', 'claimed_by_device', 'v2 commands record the claiming device');
select has_column('public', 'review_commands_v2', 'claimed_at', 'v2 commands record claim time');
select has_column('public', 'review_commands_v2', 'application_recorded_at', 'v2 commands record local application time');
select has_function('public', 'complete_review_command', array['uuid','uuid','text','text'], 'released v1 completion RPC remains available');
select has_function('public', 'queue_review_command_v2', array['text','text','text','text','jsonb'], 'v2 queue RPC exists');
select has_function('public', 'claim_review_command_v2', array['uuid','uuid'], 'v2 claim RPC exists');
select has_function('public', 'mark_review_command_applied_locally_v2', array['uuid','uuid'], 'v2 local application receipt RPC exists');
select has_function('public', 'complete_review_command_v2', array['uuid','uuid','text','text'], 'v2 completion RPC exists');
select ok(has_function_privilege('authenticated', 'public.complete_review_command(uuid,uuid,text,text)', 'EXECUTE'), 'released clients retain v1 completion access');
select is(has_function_privilege('anon', 'public.complete_review_command(uuid,uuid,text,text)', 'EXECUTE'), false, 'anonymous callers cannot use v1 completion');
select ok(has_function_privilege('authenticated', 'public.claim_review_command_v2(uuid,uuid)', 'EXECUTE'), 'authenticated v2 devices can claim');
select is(has_function_privilege('anon', 'public.claim_review_command_v2(uuid,uuid)', 'EXECUTE'), false, 'anonymous callers cannot claim through v2');
select is(has_table_privilege('authenticated', 'public.review_commands_v2', 'INSERT'), false, 'clients cannot bypass the v2 queue RPC');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('83000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'two-phase@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('83000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'two-phase-outsider@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claim.sub" = '83000000-0000-4000-8000-000000000001';

select lives_ok(
  $$ select public.register_weekform_device('84000000-0000-4000-8000-000000000001', 'Primary Synthetic Mac') $$,
  'primary Mac is registered'
);
select lives_ok(
  $$ select public.register_weekform_device('84000000-0000-4000-8000-000000000002', 'Secondary Synthetic Mac') $$,
  'secondary Mac is registered'
);
select lives_ok(
  $sql$
    select * from public.sync_personal_replica_batch(
      '84000000-0000-4000-8000-000000000001',
      '85000000-0000-4000-8000-000000000001',
      '0123456789abcdef',
      '{
        "schemaVersion":1,"replicaId":"personal-2026-W29","weekId":"2026-W29",
        "generatedAt":"2026-07-20T12:00:00Z","sourceUpdatedAt":"2026-07-20T12:00:00Z",
        "blocks":[{
          "blockId":"block-two-phase","weekId":"2026-W29","startTime":"2026-07-14T13:00:00Z",
          "endTime":"2026-07-14T14:00:00Z","estimatedCapacityPct":3,
          "category":"Admin / coordination","mode":"Reactive","plannedStatus":"unplanned",
          "confidence":0.8,"userVerified":false,"blockerFlag":false,"revision":"fedcba9876543210"
        }],
        "capacity":{"allocatedPct":70,"deepWorkPct":35,"fragmentedWorkPct":15,"meetingPct":20,"reactivePct":25,"plannedPct":50,"blockedPct":5,"reliableNewWorkCapacityPct":10,"committedUtilizationPct":70,"carryoverRiskPct":12,"wipLoadScore":40,"contextSwitchScore":35,"summaryConfidence":0.8}
      }'::jsonb
    )
  $sql$,
  'review-safe replica exists'
);

select lives_ok(
  $$ select public.queue_review_command('block-two-phase','2026-W29','fedcba9876543210','confirm',null) $$,
  'a released-client review command is queued'
);
select is(
  (select count(*)::integer from public.review_commands where block_id = 'block-two-phase' and status = 'pending'),
  1,
  'released clients see the v1 pending request'
);
select is(
  (select count(*)::integer from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending'),
  0,
  'v2 clients cannot enumerate a v1 pending request'
);
select throws_ok(
  $$ select public.queue_review_command_v2('block-two-phase','2026-W29','fedcba9876543210','confirm',null) $$,
  'P0001', 'another review protocol already has a pending request for this block revision',
  'v2 cannot race an existing v1 request for the same revision'
);
select ok(
  public.complete_review_command(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands where block_id = 'block-two-phase' and status = 'pending'),
    'applied','Applied by a released v1 client.'
  ),
  'released v1 clients can still complete directly'
);
select is(
  public.complete_review_command(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands where block_id = 'block-two-phase' and status = 'applied'),
    'applied','Released v1 retry.'
  ),
  false,
  'released v1 completion keeps its original non-idempotent terminal retry result'
);

select lives_ok(
  $$ select public.queue_review_command_v2('block-two-phase','2026-W29','fedcba9876543210','confirm',null) $$,
  'a v2 command can be queued after the v1 request terminalizes'
);
select is(
  (select count(*)::integer from public.review_commands where block_id = 'block-two-phase' and status = 'pending'),
  0,
  'released clients cannot enumerate a v2 pending request'
);
select is(
  (select count(*)::integer from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending'),
  1,
  'v2 clients see exactly one v2 pending request'
);
select throws_ok(
  $$ select public.queue_review_command('block-two-phase','2026-W29','fedcba9876543210','exclude',null) $$,
  'P0001', 'another review protocol already has a pending request for this block revision',
  'v1 cannot race an existing v2 request for the same revision'
);
select is(
  public.claim_review_command_v2(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending')
  ),
  'apply_pending',
  'server acknowledges the primary v2 claim before local mutation'
);
select throws_ok(
  $$ select public.claim_review_command_v2(
    '84000000-0000-4000-8000-000000000002',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending')
  ) $$,
  'P0001', 'review command claimed by another device',
  'another Mac cannot steal an active v2 claim'
);
select throws_ok(
  $$ select public.complete_review_command_v2(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending'),
    'applied','too early'
  ) $$,
  'P0001', 'local application acknowledgement required',
  'v2 applied is impossible before the local receipt'
);
select ok(
  public.mark_review_command_applied_locally_v2(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending')
  ),
  'primary Mac records local application'
);
select ok(
  public.mark_review_command_applied_locally_v2(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending')
  ),
  'lost v2 local-receipt response is safe to retry'
);
select ok(
  public.complete_review_command_v2(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending'),
    'applied','Approved on this Mac.'
  ),
  'acknowledged v2 application terminalizes the request'
);
select ok(
  public.complete_review_command_v2(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'applied'),
    'applied','Approved on this Mac.'
  ),
  'lost v2 terminal response is safe to retry'
);
select is(
  public.claim_review_command_v2(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'applied')
  ),
  'applied',
  'v2 claim retry returns the deciding device terminal state'
);

select lives_ok(
  $$ select public.queue_review_command_v2('block-two-phase','2026-W29','fedcba9876543210','exclude',null) $$,
  'an expired-lease v2 request is queued'
);
select is(
  public.claim_review_command_v2(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending')
  ),
  'apply_pending',
  'primary owns the expiring v2 lease'
);
set local role postgres;
update public.review_commands_v2
set claimed_at = now() - interval '25 hours'
where block_id = 'block-two-phase' and status = 'pending';
set local role authenticated;
select is(
  public.claim_review_command_v2(
    '84000000-0000-4000-8000-000000000002',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending')
  ),
  'apply_pending',
  'a second Mac can reclaim an expired apply_pending lease'
);
select ok(
  public.complete_review_command_v2(
    '84000000-0000-4000-8000-000000000002',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending'),
    'conflict','Synthetic lease recovery complete.'
  ),
  'recovered expired v2 claim can terminate safely'
);

select lives_ok(
  $$ select public.queue_review_command_v2(
    'block-two-phase','2026-W29','fedcba9876543210','relabel',
    '{"category":"QA / data validation"}'::jsonb
  ) $$,
  'an ack_pending non-steal v2 request is queued'
);
select is(
  public.claim_review_command_v2(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending')
  ),
  'apply_pending',
  'primary claims the non-steal v2 request'
);
select ok(
  public.mark_review_command_applied_locally_v2(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending')
  ),
  'primary records the local application before becoming unavailable'
);
set local role postgres;
update public.review_commands_v2
set claimed_at = now() - interval '30 days'
where block_id = 'block-two-phase' and status = 'pending';
update public.weekform_devices
set revoked_at = now()
where user_id = '83000000-0000-4000-8000-000000000001'
  and id = '84000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok(
  $$ select public.claim_review_command_v2(
    '84000000-0000-4000-8000-000000000002',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending')
  ) $$,
  'P0001', 'review command claimed by another device',
  'ack_pending is never stolen even when old and owner-revoked'
);
set local role postgres;
update public.weekform_devices
set revoked_at = null
where user_id = '83000000-0000-4000-8000-000000000001'
  and id = '84000000-0000-4000-8000-000000000001';
set local role authenticated;
select ok(
  public.complete_review_command_v2(
    '84000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands_v2 where block_id = 'block-two-phase' and status = 'pending'),
    'applied','Original owner retains the ack receipt.'
  ),
  'original v2 owner can finish ack_pending after recovery'
);

set local "request.jwt.claim.sub" = '83000000-0000-4000-8000-000000000002';
select is((select count(*)::integer from public.review_commands_v2), 0, 'another user cannot enumerate v2 commands');
set local "request.jwt.claim.sub" = '83000000-0000-4000-8000-000000000001';
select lives_ok($$ select public.delete_personal_replica_history() $$, 'history deletion clears both protocol queues');
select is((select count(*)::integer from public.review_commands), 0, 'v1 review-command history is deleted');
select is((select count(*)::integer from public.review_commands_v2), 0, 'v2 review-command history is deleted');

select * from finish();
rollback;
