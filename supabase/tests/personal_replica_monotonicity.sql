-- Multi-device freshness contract for personal replica synchronization.
-- A delayed batch must never roll a user's private Web workspace backward.

begin;
set local role postgres;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(23);

create or replace function pg_temp.synthetic_personal_replica(
  p_source_updated_at text,
  p_generated_at text,
  p_block_revision text,
  p_allocated_pct integer default 70
) returns jsonb
language sql immutable
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'replicaId', 'personal-2026-W30',
    'weekId', '2026-W30',
    'generatedAt', p_generated_at,
    'sourceUpdatedAt', p_source_updated_at,
    'blocks', jsonb_build_array(jsonb_build_object(
      'blockId', 'monotonic-block',
      'weekId', '2026-W30',
      'startTime', '2026-07-20T13:00:00Z',
      'endTime', '2026-07-20T14:00:00Z',
      'estimatedCapacityPct', 3,
      'category', 'Admin / coordination',
      'mode', 'Reactive',
      'plannedStatus', 'unplanned',
      'confidence', 0.8,
      'userVerified', false,
      'blockerFlag', false,
      'revision', p_block_revision
    )),
    'capacity', jsonb_build_object(
      'allocatedPct', p_allocated_pct,
      'deepWorkPct', 35,
      'fragmentedWorkPct', 15,
      'meetingPct', 20,
      'reactivePct', 25,
      'plannedPct', 50,
      'blockedPct', 5,
      'reliableNewWorkCapacityPct', 10,
      'committedUtilizationPct', 70,
      'carryoverRiskPct', 12,
      'wipLoadScore', 40,
      'contextSwitchScore', 35,
      'summaryConfidence', 0.8
    )
  );
$$;

select has_trigger(
  'public',
  'personal_workload_replicas',
  'personal_replica_monotonic_update',
  'replica writes have a database-enforced monotonic freshness boundary'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '7a000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'replica-monotonic@example.test', null, now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
) on conflict (id) do nothing;

set local role authenticated;
set local "request.jwt.claim.sub" = '7a000000-0000-4000-8000-000000000001';

select lives_ok(
  $$ select public.register_weekform_device('7b000000-0000-4000-8000-000000000001', 'Synthetic Mac A') $$,
  'the first Mac can register'
);
select lives_ok(
  $$ select public.register_weekform_device('7b000000-0000-4000-8000-000000000002', 'Synthetic Mac B') $$,
  'the second Mac can register'
);

select throws_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000001',
      '7c000000-0000-4000-8000-000000000009',
      '9999999999999999',
      jsonb_set(
        pg_temp.synthetic_personal_replica(
          '2026-07-20T14:00:00Z', '2026-07-20T14:00:01Z', '9999999999999999'
        ),
        '{blocks,0,blockId}',
        to_jsonb(repeat('x', 1048576))
      )
    )
  $$,
  'P0001', 'personal replica payload exceeds maximum bytes',
  'the authenticated RPC rejects an oversized payload before hashing or iterating blocks'
);

set local role postgres;
delete from public.personal_workload_replicas
where user_id = '7a000000-0000-4000-8000-000000000001';
delete from public.personal_replica_batches
where user_id = '7a000000-0000-4000-8000-000000000001';
set local role authenticated;
set local "request.jwt.claim.sub" = '7a000000-0000-4000-8000-000000000001';

select throws_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000001',
      '7c000000-0000-4000-8000-000000000010',
      '1010101010101010',
      (
        select jsonb_set(
          source.payload,
          '{blocks}',
          (
            select jsonb_agg(source.payload -> 'blocks' -> 0 order by block_number)
            from generate_series(1, 1001) block_number
          )
        )
        from (
          select pg_temp.synthetic_personal_replica(
            '2026-07-20T14:00:00Z', '2026-07-20T14:00:01Z', '1010101010101010'
          ) as payload
        ) source
      )
    )
  $$,
  'P0001', 'personal replica exceeds maximum block count',
  'the authenticated RPC rejects too many blocks before hashing or iterating them'
);

set local role postgres;
delete from public.personal_workload_replicas
where user_id = '7a000000-0000-4000-8000-000000000001';
delete from public.personal_replica_batches
where user_id = '7a000000-0000-4000-8000-000000000001';
insert into public.personal_replica_batches(
  user_id, batch_id, device_id, fingerprint, payload_digest
) values (
  '7a000000-0000-4000-8000-000000000001',
  '7c000000-0000-4000-8000-000000000011',
  '7b000000-0000-4000-8000-000000000001',
  '1111111111111111',
  null
);
set local role authenticated;
set local "request.jwt.claim.sub" = '7a000000-0000-4000-8000-000000000001';

select throws_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000001',
      '7c000000-0000-4000-8000-000000000011',
      '1111111111111111',
      pg_temp.synthetic_personal_replica(
        '2026-07-20T14:00:00Z', '2026-07-20T14:00:01Z', '1111111111111111'
      )
    )
  $$,
  'P0001', 'legacy personal replica batch id requires a new batch id',
  'a legacy receipt without a digest fails closed instead of acknowledging unverifiable content'
);

set local role postgres;
delete from public.personal_replica_batches
where user_id = '7a000000-0000-4000-8000-000000000001'
  and batch_id = '7c000000-0000-4000-8000-000000000011';
set local role authenticated;
set local "request.jwt.claim.sub" = '7a000000-0000-4000-8000-000000000001';

select lives_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000001',
      '7c000000-0000-4000-8000-000000000001',
      '1111111111111111',
      pg_temp.synthetic_personal_replica(
        '2026-07-20T15:00:00Z', '2026-07-20T15:00:01Z', 'aaaaaaaaaaaaaaaa'
      )
    )
  $$,
  'the first device can create a replica'
);

select lives_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000001',
      '7c000000-0000-4000-8000-000000000001',
      '1111111111111111',
      pg_temp.synthetic_personal_replica(
        '2026-07-20T15:00:00Z', '2026-07-20T15:00:01Z', 'aaaaaaaaaaaaaaaa'
      )
    )
  $$,
  'an exact same-batch replay is idempotent'
);

select throws_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000001',
      '7c000000-0000-4000-8000-000000000001',
      '9999999999999999',
      pg_temp.synthetic_personal_replica(
        '2026-07-20T15:00:00Z', '2026-07-20T15:00:01Z', 'aaaaaaaaaaaaaaaa'
      )
    )
  $$,
  'P0001', 'conflicting personal replica batch id',
  'a batch id cannot acknowledge a different fingerprint'
);

select throws_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000001',
      '7c000000-0000-4000-8000-000000000001',
      '1111111111111111',
      pg_temp.synthetic_personal_replica(
        '2026-07-20T15:00:00Z', '2026-07-20T15:00:01Z', 'aaaaaaaaaaaaaaaa', 71
      )
    )
  $$,
  'P0001', 'conflicting personal replica batch id',
  'a batch id cannot acknowledge divergent payload content under the same fingerprint'
);

select lives_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000002',
      '7c000000-0000-4000-8000-000000000002',
      '2222222222222222',
      pg_temp.synthetic_personal_replica(
        '2026-07-20T16:00:00Z', '2026-07-20T16:00:01Z', 'bbbbbbbbbbbbbbbb', 72
      )
    )
  $$,
  'a strictly newer second-device replica wins'
);

select is(
  (select revision from public.personal_workload_replicas where replica_id = 'personal-2026-W30'),
  '2222222222222222',
  'the newest revision is retained'
);
select is(
  (select device_id from public.personal_workload_replicas where replica_id = 'personal-2026-W30'),
  '7b000000-0000-4000-8000-000000000002'::uuid,
  'the winning device remains attributable'
);

select lives_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000001',
      '7c000000-0000-4000-8000-000000000008',
      '2222222222222222',
      pg_temp.synthetic_personal_replica(
        '2026-07-20T14:00:00Z', '2026-07-20T19:00:00Z', 'bbbbbbbbbbbbbbbb', 72
      )
    )
  $$,
  'a stale-clock retry of identical deterministic content is an idempotent no-op'
);

select throws_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000001',
      '7c000000-0000-4000-8000-000000000003',
      '3333333333333333',
      pg_temp.synthetic_personal_replica(
        '2026-07-20T14:00:00Z', '2026-07-20T17:00:00Z', 'cccccccccccccccc', 65
      )
    )
  $$,
  'P0001', 'stale personal replica batch',
  'a delayed older batch is rejected instead of rolling the replica backward'
);
select is(
  (select revision from public.personal_workload_replicas where replica_id = 'personal-2026-W30'),
  '2222222222222222',
  'a rejected stale batch cannot change the winning revision'
);

select throws_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000001',
      '7c000000-0000-4000-8000-000000000004',
      '4444444444444444',
      pg_temp.synthetic_personal_replica(
        '2026-07-20T16:00:00Z', '2026-07-20T17:00:00Z', 'dddddddddddddddd', 74
      )
    )
  $$,
  'P0001', 'conflicting personal replica batch',
  'equal timestamps with different revisions fail visibly rather than choosing arbitrarily'
);

select throws_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000001',
      '7c000000-0000-4000-8000-000000000005',
      '2222222222222222',
      pg_temp.synthetic_personal_replica(
        '2026-07-20T16:00:00Z', '2026-07-20T18:00:00Z', 'bbbbbbbbbbbbbbbb', 99
      )
    )
  $$,
  'P0001', 'conflicting personal replica batch',
  'a caller cannot reuse a revision for divergent equal-time payload content'
);

select throws_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000001',
      '7c000000-0000-4000-8000-000000000007',
      '7777777777777777',
      pg_temp.synthetic_personal_replica(
        '2099-07-20T16:00:00Z', '2099-07-20T16:00:01Z', 'eeeeeeeeeeeeeeee', 100
      )
    )
  $$,
  'P0001', 'future-dated personal replica batch',
  'clock skew cannot pin a replica ahead of every legitimate future update'
);

select lives_ok(
  $$
    select * from public.sync_personal_replica_batch(
      '7b000000-0000-4000-8000-000000000002',
      '7c000000-0000-4000-8000-000000000006',
      '2222222222222222',
      pg_temp.synthetic_personal_replica(
        '2026-07-20T16:00:00Z', '2026-07-20T16:00:01Z', 'bbbbbbbbbbbbbbbb', 72
      )
    )
  $$,
  'an exact-content retry with a distinct batch id is idempotent'
);

select is(
  (select count(*)::integer from public.personal_replica_batches),
  4,
  'only accepted batches receive durable cursors'
);
select is(
  (select source_updated_at from public.personal_workload_replicas where replica_id = 'personal-2026-W30'),
  '2026-07-20 16:00:00+00'::timestamptz,
  'the accepted freshness timestamp remains monotonic'
);
select is(
  (select (payload -> 'capacity' ->> 'allocatedPct')::integer
   from public.personal_workload_replicas where replica_id = 'personal-2026-W30'),
  72,
  'the latest accepted payload remains intact after stale and conflicting attempts'
);

select * from finish();
rollback;
