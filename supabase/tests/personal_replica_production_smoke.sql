-- Fail-fast production smoke for 202607190007_personal_replica_sync.sql.
-- Runs entirely inside a transaction and rolls back both synthetic auth users
-- and workload rows. Any broken contract raises and aborts the query.

begin;

do $verify$
declare
  relation_name text;
  function_name text;
begin
  foreach relation_name in array array[
    'weekform_devices',
    'personal_replica_batches',
    'personal_workload_replicas',
    'review_commands'
  ] loop
    if to_regclass('public.' || relation_name) is null then
      raise exception 'missing relation: %', relation_name;
    end if;
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = relation_name
        and c.relrowsecurity
        and c.relforcerowsecurity
    ) then
      raise exception 'RLS is not forced for: %', relation_name;
    end if;
  end loop;

  foreach function_name in array array[
    'register_weekform_device',
    'sync_personal_replica_batch',
    'queue_review_command',
    'complete_review_command',
    'delete_personal_replica_history'
  ] loop
    if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = function_name
        and p.prosecdef
    ) then
      raise exception 'missing security-definer function: %', function_name;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.personal_workload_replicas', 'INSERT')
    or has_table_privilege('authenticated', 'public.personal_workload_replicas', 'UPDATE')
    or has_table_privilege('authenticated', 'public.review_commands', 'INSERT')
    or has_table_privilege('authenticated', 'public.review_commands', 'UPDATE')
  then
    raise exception 'authenticated received a forbidden direct write privilege';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'personal_replica_broadcast' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'review_command_broadcast' and not tgisinternal
  ) then
    raise exception 'private Broadcast triggers are missing';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'users receive own Weekform broadcasts'
      and roles @> array['authenticated'::name]
      and cmd = 'SELECT'
  ) then
    raise exception 'private Broadcast topic policy is missing';
  end if;
end
$verify$;

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

select public.register_weekform_device(
  '75000000-0000-4000-8000-000000000001',
  'Production verification Mac'
);

select * from public.sync_personal_replica_batch(
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
);

do $verify$
begin
  if (select count(*) from public.personal_workload_replicas) <> 1 then
    raise exception 'actor A cannot read exactly one own replica';
  end if;
end
$verify$;

do $verify$
declare rejected boolean := false;
begin
  begin
    perform public.sync_personal_replica_batch(
      '75000000-0000-4000-8000-000000000001',
      '76000000-0000-4000-8000-000000000002',
      '1123456789abcdef',
      '{"schemaVersion":1,"replicaId":"bad","weekId":"2026-W29","generatedAt":"2026-07-19T20:00:00Z","sourceUpdatedAt":"2026-07-19T19:00:00Z","blocks":[{"blockId":"production-block-2","weekId":"2026-W29","startTime":"2026-07-14T13:00:00Z","endTime":"2026-07-14T14:00:00Z","estimatedCapacityPct":3,"category":"Admin / coordination","mode":"Reactive","plannedStatus":"unplanned","confidence":0.8,"userVerified":false,"blockerFlag":false,"revision":"fedcba9876543211","evidence":["must not upload"]}],"capacity":{"allocatedPct":70,"deepWorkPct":35,"fragmentedWorkPct":15,"meetingPct":20,"reactivePct":25,"plannedPct":50,"blockedPct":5,"reliableNewWorkCapacityPct":10,"committedUtilizationPct":70,"carryoverRiskPct":12,"wipLoadScore":40,"contextSwitchScore":35,"summaryConfidence":0.8}}'::jsonb
    );
  exception when others then
    if sqlerrm = 'invalid personal replica block' then
      rejected := true;
    else
      raise;
    end if;
  end;
  if not rejected then
    raise exception 'server accepted a non-allowlisted evidence field';
  end if;
end
$verify$;

select public.queue_review_command(
  'production-block-1', '2026-W29', 'fedcba9876543210', 'confirm', null
);

do $verify$
declare rejected boolean := false;
begin
  begin
    update public.review_commands set status = 'applied'
    where block_id = 'production-block-1';
  exception when insufficient_privilege then
    rejected := true;
  end;
  if not rejected then
    raise exception 'authenticated bypassed the command completion RPC';
  end if;
end
$verify$;

do $verify$
begin
  if not public.complete_review_command(
    '75000000-0000-4000-8000-000000000001',
    (select command_id from public.review_commands where block_id = 'production-block-1'),
    'applied',
    'Approved in production verification'
  ) then
    raise exception 'registered Mac could not complete its command';
  end if;
end
$verify$;

set local "request.jwt.claim.sub" = '74000000-0000-4000-8000-000000000002';

do $verify$
begin
  if exists (select 1 from public.personal_workload_replicas)
    or exists (select 1 from public.review_commands)
  then
    raise exception 'actor B can enumerate actor A private rows';
  end if;
end
$verify$;

set local "request.jwt.claim.sub" = '74000000-0000-4000-8000-000000000001';
select public.delete_personal_replica_history();

do $verify$
begin
  if exists (select 1 from public.personal_workload_replicas)
    or exists (select 1 from public.review_commands)
  then
    raise exception 'personal history deletion left private rows behind';
  end if;
end
$verify$;

rollback;

select 'production verification passed' as result;
