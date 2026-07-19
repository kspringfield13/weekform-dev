-- Additive upgrade for databases that applied team_cloud_v1 before the
-- server-owned snapshot receipt clock was introduced.

alter table public.workload_snapshots
  add column if not exists synced_at timestamptz;

update public.workload_snapshots
set synced_at = coalesce(synced_at, created_at, statement_timestamp())
where synced_at is null;

alter table public.workload_snapshots
  alter column synced_at set default now();

alter table public.workload_snapshots
  alter column synced_at set not null;

create or replace function private.stamp_snapshot_sync_time()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.synced_at := statement_timestamp();
  return new;
end;
$$;

drop trigger if exists workload_snapshots_stamp_sync_time on public.workload_snapshots;
create trigger workload_snapshots_stamp_sync_time
before insert or update on public.workload_snapshots
for each row execute function private.stamp_snapshot_sync_time();

revoke all on function private.stamp_snapshot_sync_time() from public, anon, authenticated;

drop index if exists public.workload_snapshots_team_user_observed_idx;
drop index if exists public.workload_snapshots_user_team_observed_idx;

create index if not exists workload_snapshots_team_user_synced_idx
  on public.workload_snapshots (team_id, user_id, synced_at desc);

create index if not exists workload_snapshots_user_team_synced_idx
  on public.workload_snapshots (user_id, team_id, synced_at desc);

drop index if exists public.workload_snapshots_team_week_idx;
create index if not exists workload_snapshots_team_week_idx
  on public.workload_snapshots (team_id, week_id, synced_at desc);

create or replace view public.latest_team_snapshots
with (security_invoker = true)
as
select distinct on (snapshot.team_id, snapshot.user_id)
  snapshot.*
from public.workload_snapshots snapshot
order by snapshot.team_id, snapshot.user_id, snapshot.synced_at desc, snapshot.created_at desc;

revoke all on table public.latest_team_snapshots from anon;
grant select on table public.latest_team_snapshots to authenticated;
