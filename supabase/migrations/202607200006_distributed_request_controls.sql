-- Distributed quotas, token budgets, leases, and replay-safe receipts for
-- server-side provider boundaries. No request content or raw IP is persisted.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create table if not exists private.request_control_receipts (
  receipt_id uuid primary key default extensions.gen_random_uuid(),
  scope text not null,
  user_subject_hash text,
  ip_subject_hash text not null,
  idempotency_key text not null,
  budget_day date not null,
  reserved_token_units integer not null,
  state text not null,
  lease_token uuid,
  lease_expires_at timestamptz,
  outcome_code text,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint request_control_scope_check check (
    scope in ('personal_agent','team_briefing','webex_oauth')
  ),
  constraint request_control_subject_shape_check check (
    (scope in ('personal_agent','team_briefing') and user_subject_hash ~ '^[a-f0-9]{64}$')
    or (scope = 'webex_oauth' and user_subject_hash is null)
  ),
  constraint request_control_ip_hash_check check (ip_subject_hash ~ '^[a-f0-9]{64}$'),
  constraint request_control_idempotency_check check (idempotency_key ~ '^[a-f0-9]{64}$'),
  constraint request_control_token_units_check check (
    reserved_token_units between 0 and 100000
  ),
  constraint request_control_state_check check (
    state in ('leased','succeeded','failed','expired')
  ),
  constraint request_control_outcome_check check (
    outcome_code is null or outcome_code in (
      'ok','provider_timeout','provider_error','validation_error',
      'internal_error','lease_expired'
    )
  ),
  constraint request_control_day_check check (
    budget_day = (created_at at time zone 'UTC')::date
  ),
  constraint request_control_lifecycle_check check (
    (
      state = 'leased'
      and lease_token is not null
      and lease_expires_at is not null
      and lease_expires_at > created_at
      and outcome_code is null
      and completed_at is null
    )
    or (
      state <> 'leased'
      and lease_token is null
      and lease_expires_at is null
      and outcome_code is not null
      and completed_at is not null
    )
  )
);

create unique index if not exists request_control_ai_idempotency_idx
  on private.request_control_receipts(
    scope, user_subject_hash, idempotency_key, budget_day
  )
  where user_subject_hash is not null;

create unique index if not exists request_control_webex_idempotency_idx
  on private.request_control_receipts(
    scope, ip_subject_hash, idempotency_key, budget_day
  )
  where user_subject_hash is null;

create unique index if not exists request_control_one_active_lease_idx
  on private.request_control_receipts(scope, user_subject_hash)
  where state = 'leased' and user_subject_hash is not null;

create unique index if not exists request_control_one_active_webex_ip_lease_idx
  on private.request_control_receipts(scope, ip_subject_hash)
  where state = 'leased' and user_subject_hash is null;

create index if not exists request_control_user_daily_budget_idx
  on private.request_control_receipts(scope, user_subject_hash, budget_day)
  where user_subject_hash is not null;

create index if not exists request_control_ip_daily_budget_idx
  on private.request_control_receipts(scope, ip_subject_hash, budget_day);

revoke all on table private.request_control_receipts from public, anon, authenticated;

create or replace function private.request_control_server_claim_valid(p_server_claim text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expected_hash text := current_setting(
    'app.settings.request_control_server_claim_sha256',
    true
  );
  v_claim_hash text;
begin
  if v_expected_hash is null
    or v_expected_hash !~ '^[a-f0-9]{64}$'
    or p_server_claim is null
    or pg_catalog.octet_length(p_server_claim) < 32
  then
    return false;
  end if;
  v_claim_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_server_claim, 'UTF8'), 'sha256'),
    'hex'
  );
  return v_claim_hash = v_expected_hash;
end;
$$;

create or replace function private.acquire_request_control(
  p_scope text,
  p_user_subject_hash text,
  p_ip_subject_hash text,
  p_idempotency_key text,
  p_reserved_token_units integer,
  p_user_request_limit integer,
  p_user_token_limit integer,
  p_ip_request_limit integer,
  p_ip_token_limit integer,
  p_lease_seconds integer
) returns table (
  decision text,
  receipt_id uuid,
  lease_token uuid,
  retry_after_seconds integer,
  daily_remaining integer,
  token_budget_remaining integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_day date := (v_now at time zone 'UTC')::date;
  v_existing private.request_control_receipts%rowtype;
  v_user_requests integer := 0;
  v_user_tokens integer := 0;
  v_ip_requests integer := 0;
  v_ip_tokens integer := 0;
  v_request_remaining integer := 0;
  v_token_remaining integer := 0;
  v_retry integer := 0;
  v_receipt_id uuid;
  v_lease_token uuid;
begin
  if p_scope not in ('personal_agent','team_briefing','webex_oauth')
    or p_ip_subject_hash is null
    or p_ip_subject_hash !~ '^[a-f0-9]{64}$'
    or p_idempotency_key is null
    or p_idempotency_key !~ '^[a-f0-9]{64}$'
    or p_reserved_token_units not between 0 and 100000
    or p_ip_request_limit not between 1 and 1000
    or p_ip_token_limit not between 0 and 10000000
    or p_lease_seconds not between 5 and 300
    or (
      p_user_subject_hash is not null
      and (
        p_user_subject_hash !~ '^[a-f0-9]{64}$'
        or p_user_request_limit not between 1 and 1000
        or p_user_token_limit not between 1 and 10000000
      )
    )
    or (
      p_user_subject_hash is null
      and (p_user_request_limit <> 0 or p_user_token_limit <> 0)
    )
  then
    raise exception 'invalid request-control input';
  end if;

  -- Every caller takes locks in user-then-IP order. Webex has no user lock.
  if p_user_subject_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_scope || ':user:' || p_user_subject_hash, 0)
    );
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_scope || ':ip:' || p_ip_subject_hash, 0)
  );

  select receipt.*
  into v_existing
  from private.request_control_receipts as receipt
  where receipt.scope = p_scope
    and receipt.idempotency_key = p_idempotency_key
    and receipt.budget_day = v_day
    and (
      (p_user_subject_hash is not null and receipt.user_subject_hash = p_user_subject_hash)
      or (
        p_user_subject_hash is null
        and receipt.user_subject_hash is null
        and receipt.ip_subject_hash = p_ip_subject_hash
      )
    )
  for update;

  if p_user_subject_hash is not null then
    select count(*)::integer, coalesce(sum(receipt.reserved_token_units), 0)::integer
    into v_user_requests, v_user_tokens
    from private.request_control_receipts as receipt
    where receipt.scope = p_scope
      and receipt.user_subject_hash = p_user_subject_hash
      and receipt.budget_day = v_day;
  end if;
  select count(*)::integer, coalesce(sum(receipt.reserved_token_units), 0)::integer
  into v_ip_requests, v_ip_tokens
  from private.request_control_receipts as receipt
  where receipt.scope = p_scope
    and receipt.ip_subject_hash = p_ip_subject_hash
    and receipt.budget_day = v_day;

  if p_user_subject_hash is null then
    v_request_remaining := greatest(0, p_ip_request_limit - v_ip_requests);
    v_token_remaining := greatest(0, p_ip_token_limit - v_ip_tokens);
  else
    v_request_remaining := greatest(
      0,
      least(
        p_user_request_limit - v_user_requests,
        p_ip_request_limit - v_ip_requests
      )
    );
    v_token_remaining := greatest(
      0,
      least(
        p_user_token_limit - v_user_tokens,
        p_ip_token_limit - v_ip_tokens
      )
    );
  end if;

  if v_existing.receipt_id is not null then
    if v_existing.state = 'leased' and v_existing.lease_expires_at <= v_now then
      update private.request_control_receipts as receipt
      set
        state = 'expired',
        lease_token = null,
        lease_expires_at = null,
        outcome_code = 'lease_expired',
        completed_at = v_now
      where receipt.receipt_id = v_existing.receipt_id;
      return query select
        'replay_expired'::text, v_existing.receipt_id, null::uuid,
        0, v_request_remaining, v_token_remaining;
      return;
    elsif v_existing.state = 'leased' then
      v_retry := greatest(
        1,
        pg_catalog.ceil(extract(
          epoch from (v_existing.lease_expires_at - v_now)
        ))::integer
      );
      return query select
        'in_progress'::text, v_existing.receipt_id, null::uuid,
        v_retry, v_request_remaining, v_token_remaining;
      return;
    else
      return query select
        case v_existing.state
          when 'succeeded' then 'replay_succeeded'
          when 'failed' then 'replay_failed'
          else 'replay_expired'
        end::text,
        v_existing.receipt_id,
        null::uuid,
        0,
        v_request_remaining,
        v_token_remaining;
      return;
    end if;
  end if;

  update private.request_control_receipts as receipt
  set
    state = 'expired',
    lease_token = null,
    lease_expires_at = null,
    outcome_code = 'lease_expired',
    completed_at = v_now
  where receipt.scope = p_scope
    and receipt.state = 'leased'
    and receipt.lease_expires_at <= v_now
    and (
      (p_user_subject_hash is not null and receipt.user_subject_hash = p_user_subject_hash)
      or (
        p_user_subject_hash is null
        and receipt.user_subject_hash is null
        and receipt.ip_subject_hash = p_ip_subject_hash
      )
    );

  select greatest(
    1,
    pg_catalog.ceil(extract(epoch from (receipt.lease_expires_at - v_now)))::integer
  )
  into v_retry
  from private.request_control_receipts as receipt
  where receipt.scope = p_scope
    and receipt.state = 'leased'
    and (
      (p_user_subject_hash is not null and receipt.user_subject_hash = p_user_subject_hash)
      or (
        p_user_subject_hash is null
        and receipt.user_subject_hash is null
        and receipt.ip_subject_hash = p_ip_subject_hash
      )
    );

  if found then
    return query select
      'busy'::text, null::uuid, null::uuid,
      v_retry, v_request_remaining, v_token_remaining;
    return;
  end if;

  if v_ip_requests >= p_ip_request_limit
    or v_ip_tokens + p_reserved_token_units > p_ip_token_limit
    or (
      p_user_subject_hash is not null
      and (
        v_user_requests >= p_user_request_limit
        or v_user_tokens + p_reserved_token_units > p_user_token_limit
      )
    )
  then
    v_retry := greatest(
      1,
      pg_catalog.ceil(extract(
        epoch from (((v_day + 1)::timestamp at time zone 'UTC') - v_now)
      ))::integer
    );
    return query select
      'budget_exhausted'::text, null::uuid, null::uuid,
      v_retry, v_request_remaining, v_token_remaining;
    return;
  end if;

  v_receipt_id := extensions.gen_random_uuid();
  v_lease_token := extensions.gen_random_uuid();
  insert into private.request_control_receipts(
    receipt_id,
    scope,
    user_subject_hash,
    ip_subject_hash,
    idempotency_key,
    budget_day,
    reserved_token_units,
    state,
    lease_token,
    lease_expires_at,
    created_at
  ) values (
    v_receipt_id,
    p_scope,
    p_user_subject_hash,
    p_ip_subject_hash,
    p_idempotency_key,
    v_day,
    p_reserved_token_units,
    'leased',
    v_lease_token,
    v_now + pg_catalog.make_interval(secs => p_lease_seconds),
    v_now
  );

  return query select
    'acquired'::text,
    v_receipt_id,
    v_lease_token,
    0,
    greatest(0, v_request_remaining - 1),
    greatest(0, v_token_remaining - p_reserved_token_units);
end;
$$;

create or replace function private.complete_request_control(
  p_scope text,
  p_user_subject_hash text,
  p_ip_subject_hash text,
  p_receipt_id uuid,
  p_lease_token uuid,
  p_outcome_code text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_outcome_code not in (
    'ok','provider_timeout','provider_error','validation_error','internal_error'
  ) then
    raise exception 'invalid request-control outcome';
  end if;

  update private.request_control_receipts as receipt
  set
    state = case when p_outcome_code = 'ok' then 'succeeded' else 'failed' end,
    lease_token = null,
    lease_expires_at = null,
    outcome_code = p_outcome_code,
    completed_at = v_now
  where receipt.receipt_id = p_receipt_id
    and receipt.scope = p_scope
    and receipt.state = 'leased'
    and receipt.lease_token = p_lease_token
    and receipt.lease_expires_at > v_now
    and (
      (p_user_subject_hash is not null and receipt.user_subject_hash = p_user_subject_hash)
      or (
        p_user_subject_hash is null
        and receipt.user_subject_hash is null
        and receipt.ip_subject_hash = p_ip_subject_hash
      )
    );
  return found;
end;
$$;

create or replace function public.acquire_ai_request_control(
  p_scope text,
  p_ip_subject_hash text,
  p_idempotency_key text,
  p_reserved_token_units integer,
  p_server_claim text
) returns table (
  decision text,
  receipt_id uuid,
  lease_token uuid,
  retry_after_seconds integer,
  daily_remaining integer,
  token_budget_remaining integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_user_subject_hash text;
  v_user_request_limit integer;
  v_user_token_limit integer;
  v_ip_request_limit integer;
  v_ip_token_limit integer;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not private.request_control_server_claim_valid(p_server_claim) then
    raise exception 'request controls unavailable';
  end if;
  if p_scope = 'personal_agent' and p_reserved_token_units = 4096 then
    v_user_request_limit := 12;
    v_user_token_limit := 40960;
    v_ip_request_limit := 16;
    v_ip_token_limit := 65536;
  elsif p_scope = 'team_briefing' and p_reserved_token_units = 8192 then
    v_user_request_limit := 6;
    v_user_token_limit := 40960;
    v_ip_request_limit := 8;
    v_ip_token_limit := 65536;
  elsif p_scope not in ('personal_agent','team_briefing') then
    raise exception 'invalid request-control scope';
  else
    raise exception 'invalid token reservation';
  end if;
  if p_ip_subject_hash is null or p_ip_subject_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid keyed subject';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid idempotency key';
  end if;
  v_user_subject_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_actor::text, 'UTF8'), 'sha256'),
    'hex'
  );
  return query
  select * from private.acquire_request_control(
    p_scope,
    v_user_subject_hash,
    p_ip_subject_hash,
    p_idempotency_key,
    p_reserved_token_units,
    v_user_request_limit,
    v_user_token_limit,
    v_ip_request_limit,
    v_ip_token_limit,
    45
  );
end;
$$;

create or replace function public.complete_ai_request_control(
  p_receipt_id uuid,
  p_lease_token uuid,
  p_outcome_code text,
  p_server_claim text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_user_subject_hash text;
  v_scope text;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not private.request_control_server_claim_valid(p_server_claim) then
    raise exception 'request controls unavailable';
  end if;
  if p_outcome_code not in (
    'ok','provider_timeout','provider_error','validation_error','internal_error'
  ) then
    raise exception 'invalid request-control outcome';
  end if;
  v_user_subject_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_actor::text, 'UTF8'), 'sha256'),
    'hex'
  );
  select receipt.scope
  into v_scope
  from private.request_control_receipts as receipt
  where receipt.receipt_id = p_receipt_id
    and receipt.user_subject_hash = v_user_subject_hash
    and receipt.scope in ('personal_agent','team_briefing');
  if v_scope is null then return false; end if;
  return private.complete_request_control(
    v_scope,
    v_user_subject_hash,
    null,
    p_receipt_id,
    p_lease_token,
    p_outcome_code
  );
end;
$$;

create or replace function public.acquire_webex_request_control(
  p_subject_hash text,
  p_idempotency_key text,
  p_server_claim text
) returns table (
  decision text,
  receipt_id uuid,
  lease_token uuid,
  retry_after_seconds integer,
  daily_remaining integer,
  token_budget_remaining integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.request_control_server_claim_valid(p_server_claim) then
    raise exception 'request controls unavailable';
  end if;
  if p_subject_hash is null or p_subject_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid keyed subject';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid idempotency key';
  end if;
  return query
  select * from private.acquire_request_control(
    'webex_oauth',
    null,
    p_subject_hash,
    p_idempotency_key,
    0,
    0,
    0,
    20,
    0,
    30
  );
end;
$$;

create or replace function public.complete_webex_request_control(
  p_receipt_id uuid,
  p_lease_token uuid,
  p_subject_hash text,
  p_server_claim text,
  p_outcome_code text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.request_control_server_claim_valid(p_server_claim) then
    raise exception 'request controls unavailable';
  end if;
  if p_subject_hash is null or p_subject_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid keyed subject';
  end if;
  return private.complete_request_control(
    'webex_oauth',
    null,
    p_subject_hash,
    p_receipt_id,
    p_lease_token,
    p_outcome_code
  );
end;
$$;

revoke all on function private.request_control_server_claim_valid(text)
  from public, anon, authenticated;
revoke all on function private.acquire_request_control(
  text,text,text,text,integer,integer,integer,integer,integer,integer
) from public, anon, authenticated;
revoke all on function private.complete_request_control(text,text,text,uuid,uuid,text)
  from public, anon, authenticated;

revoke all on function public.acquire_ai_request_control(text,text,text,integer,text)
  from public, anon, authenticated;
revoke all on function public.complete_ai_request_control(uuid,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.acquire_webex_request_control(text,text,text)
  from public, anon, authenticated;
revoke all on function public.complete_webex_request_control(uuid,uuid,text,text,text)
  from public, anon, authenticated;

grant execute on function public.acquire_ai_request_control(text,text,text,integer,text)
  to authenticated;
grant execute on function public.complete_ai_request_control(uuid,uuid,text,text)
  to authenticated;
grant execute on function public.acquire_webex_request_control(text,text,text)
  to anon;
grant execute on function public.complete_webex_request_control(uuid,uuid,text,text,text)
  to anon;

commit;
