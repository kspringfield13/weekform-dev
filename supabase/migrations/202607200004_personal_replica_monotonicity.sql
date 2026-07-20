-- Keep private Desktop -> Web replicas monotonic across delayed/offline and
-- multi-device delivery. source_updated_at is the conflict clock:
--   * a strictly newer source timestamp wins;
--   * an identical deterministic revision is an idempotent no-op regardless of
--     transient generated/source timestamps;
--   * otherwise an older timestamp is stale and equal-time content conflicts.
-- Equal-time divergent content is deliberately surfaced as a conflict instead
-- of inventing a device priority or silently choosing an arbitrary winner.

create or replace function public.enforce_personal_replica_monotonic_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.revision = old.revision then
    if (new.payload - 'generatedAt' - 'sourceUpdatedAt')
        is distinct from (old.payload - 'generatedAt' - 'sourceUpdatedAt')
      or new.week_id is distinct from old.week_id
    then
      raise exception 'conflicting personal replica batch';
    end if;

    -- The deterministic semantic fingerprint wins over transient clocks. A
    -- delayed second Mac carrying identical reviewed truth is a successful
    -- no-op, even when its generated/source timestamps are older or newer.
    new.payload := old.payload;
    new.source_updated_at := old.source_updated_at;
    new.device_id := old.device_id;
    new.synced_at := old.synced_at;
    return new;
  end if;

  if new.source_updated_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'future-dated personal replica batch';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.source_updated_at < old.source_updated_at then
    raise exception 'stale personal replica batch';
  end if;

  if new.source_updated_at = old.source_updated_at then
    raise exception 'conflicting personal replica batch';
  end if;

  return new;
end;
$$;

drop trigger if exists personal_replica_monotonic_update
  on public.personal_workload_replicas;
create trigger personal_replica_monotonic_update
before insert or update on public.personal_workload_replicas
for each row execute function public.enforce_personal_replica_monotonic_update();

revoke all on function public.enforce_personal_replica_monotonic_update()
  from public, anon, authenticated;
