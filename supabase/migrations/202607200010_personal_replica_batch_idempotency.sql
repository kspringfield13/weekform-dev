-- A retry key may acknowledge only the exact request that first claimed it.
-- Previously ON CONFLICT DO NOTHING returned the old cursor even when a caller
-- reused a batch UUID with a different device, fingerprint, or payload.

alter table public.personal_replica_batches
  add column if not exists payload_digest text null
  check (payload_digest is null or payload_digest ~ '^[0-9a-f]{64}$');

-- Preserve the already-hardened payload validation and monotonic replica write
-- implementation as a private primitive, then put a bounded idempotency
-- verifier in front of it. Historic receipts have no payload copy to hash, so
-- they cannot safely acknowledge any retry and require a fresh batch UUID.
alter function public.sync_personal_replica_batch(uuid, uuid, text, jsonb)
  set schema private;
alter function private.sync_personal_replica_batch(uuid, uuid, text, jsonb)
  rename to sync_personal_replica_batch_unchecked;

revoke all on function private.sync_personal_replica_batch_unchecked(uuid, uuid, text, jsonb)
from public, anon, authenticated;

create function public.sync_personal_replica_batch(
  p_device_id uuid,
  p_batch_id uuid,
  p_fingerprint text,
  p_payload jsonb
) returns table(cursor bigint, synced_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  maximum_payload_bytes constant integer := 1048576;
  maximum_blocks constant integer := 1000;
  requested_digest text;
  existing_device_id uuid;
  existing_fingerprint text;
  existing_digest text;
  result_cursor bigint;
  result_synced_at timestamptz;
begin
  if actor is null then
    raise exception 'authentication required';
  end if;

  -- Bound work before materializing canonical JSON text for the digest or
  -- entering the private per-block validation loop. pg_column_size inspects
  -- the JSONB datum without serializing the entire payload to text.
  if p_payload is null or pg_column_size(p_payload) > maximum_payload_bytes then
    raise exception 'personal replica payload exceeds maximum bytes';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'blocks') <> 'array' then
    raise exception 'invalid personal replica';
  end if;
  if jsonb_array_length(p_payload -> 'blocks') > maximum_blocks then
    raise exception 'personal replica exceeds maximum block count';
  end if;

  -- Serialize callers that claim the same retry key. This distinguishes a
  -- genuinely legacy NULL digest from the short interval before a new caller
  -- records its digest and keeps concurrent exact retries idempotent.
  perform pg_advisory_xact_lock(
    hashtextextended(actor::text || ':' || p_batch_id::text, 0)
  );

  requested_digest := encode(
    extensions.digest(pg_catalog.convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select batch.device_id, batch.fingerprint, batch.payload_digest
    into existing_device_id, existing_fingerprint, existing_digest
  from public.personal_replica_batches batch
  where batch.user_id = actor and batch.batch_id = p_batch_id;

  if found and existing_digest is null then
    raise exception 'legacy personal replica batch id requires a new batch id';
  end if;

  if found and (
    existing_device_id is distinct from p_device_id
    or existing_fingerprint is distinct from p_fingerprint
    or existing_digest is distinct from requested_digest
  ) then
    raise exception 'conflicting personal replica batch id';
  end if;

  select result.cursor, result.synced_at
    into result_cursor, result_synced_at
  from private.sync_personal_replica_batch_unchecked(
    p_device_id,
    p_batch_id,
    p_fingerprint,
    p_payload
  ) result;

  -- The advisory lock means a NULL digest here can only belong to the receipt
  -- inserted by this invocation of the private primitive.
  update public.personal_replica_batches batch
  set payload_digest = requested_digest
  where batch.user_id = actor
    and batch.batch_id = p_batch_id
    and batch.payload_digest is null;

  select batch.device_id, batch.fingerprint, batch.payload_digest
    into existing_device_id, existing_fingerprint, existing_digest
  from public.personal_replica_batches batch
  where batch.user_id = actor and batch.batch_id = p_batch_id;

  if existing_device_id is distinct from p_device_id
     or existing_fingerprint is distinct from p_fingerprint
     or existing_digest is distinct from requested_digest then
    raise exception 'conflicting personal replica batch id';
  end if;

  return query select result_cursor, result_synced_at;
end;
$$;

revoke all on function public.sync_personal_replica_batch(uuid, uuid, text, jsonb)
from public, anon;
grant execute on function public.sync_personal_replica_batch(uuid, uuid, text, jsonb)
to authenticated;
