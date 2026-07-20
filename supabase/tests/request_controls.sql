-- Functional pgTAP contract for 202607200006_distributed_request_controls.sql.
-- Quotas and leases are server-owned; persisted receipts contain metadata only.

begin;
set local role postgres;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(48);

select has_table(
  'private',
  'request_control_receipts',
  'distributed request receipts live outside the exposed public schema'
);
select has_index(
  'private',
  'request_control_receipts',
  'request_control_one_active_lease_idx',
  'the database enforces one active lease per scope and subject'
);
select has_function(
  'public', 'acquire_ai_request_control', array['text','text','text','integer','text'],
  'authenticated AI acquisition RPC exists'
);
select has_function(
  'public', 'complete_ai_request_control', array['uuid','uuid','text','text'],
  'authenticated AI completion RPC exists'
);
select has_function(
  'public', 'acquire_webex_request_control', array['text','text','text'],
  'protected anonymous Webex acquisition RPC exists'
);
select has_function(
  'public', 'complete_webex_request_control', array['uuid','uuid','text','text','text'],
  'protected anonymous Webex completion RPC exists'
);

select is(
  has_function_privilege('authenticated', 'public.acquire_ai_request_control(text,text,text,integer,text)', 'EXECUTE'),
  true,
  'authenticated users can acquire their own AI lease'
);
select is(
  has_function_privilege('anon', 'public.acquire_ai_request_control(text,text,text,integer,text)', 'EXECUTE'),
  false,
  'anonymous callers cannot acquire AI leases'
);
select is(
  has_function_privilege('authenticated', 'public.complete_ai_request_control(uuid,uuid,text,text)', 'EXECUTE'),
  true,
  'authenticated users can complete their own AI receipt'
);
select is(
  has_function_privilege('anon', 'public.complete_ai_request_control(uuid,uuid,text,text)', 'EXECUTE'),
  false,
  'anonymous callers cannot complete AI receipts'
);
select is(
  has_function_privilege('anon', 'public.acquire_webex_request_control(text,text,text)', 'EXECUTE'),
  true,
  'the broker can use the protected anonymous acquisition RPC'
);
select is(
  has_function_privilege('authenticated', 'public.acquire_webex_request_control(text,text,text)', 'EXECUTE'),
  false,
  'signed-in browser sessions cannot invoke the broker RPC'
);
select is(
  has_function_privilege('anon', 'public.complete_webex_request_control(uuid,uuid,text,text,text)', 'EXECUTE'),
  true,
  'the broker can complete its protected receipt'
);
select is(
  has_function_privilege('authenticated', 'public.complete_webex_request_control(uuid,uuid,text,text,text)', 'EXECUTE'),
  false,
  'signed-in browser sessions cannot complete broker receipts'
);
select is(
  has_table_privilege('public', 'private.request_control_receipts', 'SELECT'),
  false,
  'public has no receipt-table access'
);
select is(
  has_table_privilege('anon', 'private.request_control_receipts', 'SELECT'),
  false,
  'anonymous callers cannot inspect keyed subjects or receipts'
);
select is(
  has_table_privilege('authenticated', 'private.request_control_receipts', 'SELECT'),
  false,
  'authenticated callers cannot inspect receipt metadata directly'
);
select columns_are(
  'private',
  'request_control_receipts',
  array[
    'receipt_id','scope','user_subject_hash','ip_subject_hash','idempotency_key',
    'budget_day','reserved_token_units','state','lease_token','lease_expires_at',
    'outcome_code','created_at','completed_at'
  ],
  'receipts contain only generic control and monitoring metadata'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '83000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'control-a@example.test', null, now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '83000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'control-b@example.test', null, now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '83000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'control-budget@example.test', null, now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '83000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'control-ip-a@example.test', null, now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '83000000-0000-4000-8000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'control-ip-b@example.test', null, now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  )
on conflict (id) do nothing;

select set_config(
  'app.settings.request_control_server_claim_sha256',
  encode(extensions.digest(convert_to('synthetic-server-claim-that-is-long-enough','UTF8'),'sha256'),'hex'),
  true
);

set local role authenticated;
set local "request.jwt.claim.sub" = '83000000-0000-4000-8000-000000000001';

select throws_ok(
  $$ select * from public.acquire_ai_request_control(
       'personal_agent', repeat('9',64), repeat('a',64), 4096,
       'wrong-server-claim-that-is-long-enough'
     ) $$,
  'P0001', 'request controls unavailable',
  'an authenticated browser session is insufficient without the server claim'
);
select throws_ok(
  $$ select * from public.acquire_ai_request_control(
       'invented_scope', repeat('9',64), repeat('a',64), 4096,
       'synthetic-server-claim-that-is-long-enough'
     ) $$,
  'P0001', 'invalid request-control scope',
  'callers cannot invent a larger-budget scope'
);
select throws_ok(
  $$ select * from public.acquire_ai_request_control(
       'personal_agent', repeat('9',64), 'raw-question-as-key', 4096,
       'synthetic-server-claim-that-is-long-enough'
     ) $$,
  'P0001', 'invalid idempotency key',
  'only one-way digest idempotency keys cross the RPC boundary'
);

create temporary table first_ai_control as
select * from public.acquire_ai_request_control(
  'personal_agent', repeat('9',64), repeat('a',64), 4096,
  'synthetic-server-claim-that-is-long-enough'
);
select is(
  (select decision from first_ai_control), 'acquired',
  'the first valid request acquires a lease'
);
select is(
  (select daily_remaining from first_ai_control), 11,
  'the personal Agent reports the stricter remaining user request budget'
);
select is(
  (select token_budget_remaining from first_ai_control), 36864,
  'the first reservation is atomically removed from the user token budget'
);
select is(
  (select decision from public.acquire_ai_request_control(
    'personal_agent', repeat('9',64), repeat('a',64), 4096,
    'synthetic-server-claim-that-is-long-enough'
  )),
  'in_progress',
  'the same idempotency key cannot start a concurrent provider call'
);
select is(
  (select decision from public.acquire_ai_request_control(
    'personal_agent', repeat('9',64), repeat('b',64), 4096,
    'synthetic-server-claim-that-is-long-enough'
  )),
  'busy',
  'a different key cannot evade concurrency one while a lease is live'
);
select is(
  public.complete_ai_request_control(
    (select receipt_id from first_ai_control),
    '84000000-0000-4000-8000-000000000099',
    'ok',
    'synthetic-server-claim-that-is-long-enough'
  ),
  false,
  'a forged lease token cannot complete a receipt'
);
select is(
  public.complete_ai_request_control(
    (select receipt_id from first_ai_control),
    (select lease_token from first_ai_control),
    'ok',
    'synthetic-server-claim-that-is-long-enough'
  ),
  true,
  'the exact owner and lease can complete a receipt'
);
select is(
  (select decision from public.acquire_ai_request_control(
    'personal_agent', repeat('9',64), repeat('a',64), 4096,
    'synthetic-server-claim-that-is-long-enough'
  )),
  'replay_succeeded',
  'a completed idempotency key returns a replay receipt without new work'
);

set local role postgres;
select is(
  (select count(*)::integer from private.request_control_receipts
   where scope = 'personal_agent'
     and idempotency_key = repeat('a',64)),
  1,
  'idempotent replay keeps exactly one durable receipt'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '83000000-0000-4000-8000-000000000001';
create temporary table expiring_ai_control as
select * from public.acquire_ai_request_control(
  'personal_agent', repeat('9',64), repeat('c',64), 4096,
  'synthetic-server-claim-that-is-long-enough'
);
select is(
  (select decision from expiring_ai_control), 'acquired',
  'a terminalized request releases concurrency for the next key'
);

set local role postgres;
update private.request_control_receipts
set
  created_at = clock_timestamp() - interval '2 minutes',
  lease_expires_at = clock_timestamp() - interval '1 second'
where receipt_id = (select receipt_id from expiring_ai_control);

set local role authenticated;
set local "request.jwt.claim.sub" = '83000000-0000-4000-8000-000000000001';
select is(
  (select decision from public.acquire_ai_request_control(
    'personal_agent', repeat('9',64), repeat('d',64), 4096,
    'synthetic-server-claim-that-is-long-enough'
  )),
  'acquired',
  'an expired lease is recovered before a new request acquires concurrency'
);

set local role postgres;
select is(
  (select state from private.request_control_receipts
   where receipt_id = (select receipt_id from expiring_ai_control)),
  'expired',
  'lease recovery leaves an auditable generic expired outcome'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '83000000-0000-4000-8000-000000000002';
select is(
  (select decision from public.acquire_ai_request_control(
    'personal_agent', repeat('8',64), repeat('e',64), 4096,
    'synthetic-server-claim-that-is-long-enough'
  )),
  'acquired',
  'one user cannot consume another user concurrency slot'
);

set local "request.jwt.claim.sub" = '83000000-0000-4000-8000-000000000003';
select lives_ok(
  $daily_budget$
  do $block$
  declare
    acquired record;
    index integer;
  begin
    for index in 1..5 loop
      select * into acquired
      from public.acquire_ai_request_control(
        'team_briefing', lpad(to_hex(index + 32), 64, '0'),
        lpad(to_hex(index), 64, '0'), 8192,
        'synthetic-server-claim-that-is-long-enough'
      );
      if acquired.decision <> 'acquired' then
        raise exception 'unexpected budget setup decision: %', acquired.decision;
      end if;
      if not public.complete_ai_request_control(
        acquired.receipt_id, acquired.lease_token, 'ok',
        'synthetic-server-claim-that-is-long-enough'
      ) then
        raise exception 'budget setup completion failed';
      end if;
    end loop;
  end
  $block$
  $daily_budget$,
  'one user can reserve its full Team Briefing token budget across distinct IPs'
);
select is(
  (select decision from public.acquire_ai_request_control(
    'team_briefing', repeat('7',64), repeat('f',64), 8192,
    'synthetic-server-claim-that-is-long-enough'
  )),
  'budget_exhausted',
  'the next request fails at the per-user token budget even from a new IP'
);
select throws_ok(
  $$ select public.complete_ai_request_control(
       '84000000-0000-4000-8000-000000000001',
       '84000000-0000-4000-8000-000000000002',
       'raw_provider_body',
       'synthetic-server-claim-that-is-long-enough'
     ) $$,
  'P0001', 'invalid request-control outcome',
  'completion accepts only generic monitoring outcome codes'
);

set local "request.jwt.claim.sub" = '83000000-0000-4000-8000-000000000004';
select lives_ok(
  $shared_ip_a$
  do $block$
  declare
    acquired record;
    index integer;
  begin
    for index in 1..4 loop
      select * into acquired
      from public.acquire_ai_request_control(
        'team_briefing', repeat('6',64), lpad(to_hex(100 + index),64,'0'), 8192,
        'synthetic-server-claim-that-is-long-enough'
      );
      if acquired.decision <> 'acquired' or not public.complete_ai_request_control(
        acquired.receipt_id, acquired.lease_token, 'ok',
        'synthetic-server-claim-that-is-long-enough'
      ) then raise exception 'shared IP setup failed'; end if;
    end loop;
  end
  $block$
  $shared_ip_a$,
  'the first user can consume half of a shared keyed-IP Team Briefing budget'
);

set local "request.jwt.claim.sub" = '83000000-0000-4000-8000-000000000005';
select lives_ok(
  $shared_ip_b$
  do $block$
  declare
    acquired record;
    index integer;
  begin
    for index in 1..4 loop
      select * into acquired
      from public.acquire_ai_request_control(
        'team_briefing', repeat('6',64), lpad(to_hex(200 + index),64,'0'), 8192,
        'synthetic-server-claim-that-is-long-enough'
      );
      if acquired.decision <> 'acquired' or not public.complete_ai_request_control(
        acquired.receipt_id, acquired.lease_token, 'ok',
        'synthetic-server-claim-that-is-long-enough'
      ) then raise exception 'shared IP setup failed'; end if;
    end loop;
  end
  $block$
  $shared_ip_b$,
  'a second user can consume the rest without inheriting the first user quota'
);
select is(
  (select decision from public.acquire_ai_request_control(
    'team_briefing', repeat('6',64), repeat('7',64), 8192,
    'synthetic-server-claim-that-is-long-enough'
  )),
  'budget_exhausted',
  'two users on one keyed IP atomically share the stricter IP token budget'
);

set local role anon;
select throws_ok(
  $$ select * from public.acquire_webex_request_control(
       repeat('1',64), repeat('2',64), 'wrong-server-claim-that-is-long-enough'
     ) $$,
  'P0001', 'request controls unavailable',
  'the public anon key is insufficient without the protected server claim'
);
select throws_ok(
  $$ select * from public.acquire_webex_request_control(
       '203.0.113.9', repeat('2',64), 'synthetic-server-claim-that-is-long-enough'
     ) $$,
  'P0001', 'invalid keyed subject',
  'the broker cannot send or persist a raw client IP'
);

create temporary table first_webex_control as
select * from public.acquire_webex_request_control(
  repeat('1',64), repeat('2',64), 'synthetic-server-claim-that-is-long-enough'
);
select is(
  (select decision from first_webex_control), 'acquired',
  'a valid protected broker request acquires its per-IP lease'
);
select is(
  (select decision from public.acquire_webex_request_control(
    repeat('1',64), repeat('3',64), 'synthetic-server-claim-that-is-long-enough'
  )),
  'busy',
  'a keyed IP subject receives only one concurrent Webex exchange'
);
select is(
  public.complete_webex_request_control(
    (select receipt_id from first_webex_control),
    (select lease_token from first_webex_control),
    repeat('1',64),
    'synthetic-server-claim-that-is-long-enough',
    'ok'
  ),
  true,
  'the protected broker can terminalize a redacted receipt'
);
select is(
  (select decision from public.acquire_webex_request_control(
    repeat('1',64), repeat('2',64), 'synthetic-server-claim-that-is-long-enough'
  )),
  'replay_succeeded',
  'a replayed OAuth credential digest cannot repeat the provider exchange'
);
select is(
  public.complete_webex_request_control(
    (select receipt_id from first_webex_control),
    (select lease_token from first_webex_control),
    repeat('4',64),
    'synthetic-server-claim-that-is-long-enough',
    'ok'
  ),
  false,
  'a different keyed IP subject cannot complete another subject receipt'
);
select throws_ok(
  $$ insert into private.request_control_receipts(
       scope, user_subject_hash, ip_subject_hash, idempotency_key, budget_day,
       reserved_token_units, state, lease_token, lease_expires_at
     ) values (
       'webex_oauth',null,repeat('1',64),repeat('5',64),current_date,
       0,'leased',gen_random_uuid(),now() + interval '30 seconds'
     ) $$,
  '42501', 'permission denied for schema private',
  'anonymous callers cannot bypass the RPC with direct receipt writes'
);

select * from finish();
rollback;
