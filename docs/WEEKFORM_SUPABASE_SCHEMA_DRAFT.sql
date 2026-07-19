-- Weekform Team Cloud v1 — Supabase schema and RLS draft
-- Prepared for OpenAI Build Week, July 18, 2026.
-- REVIEW BEFORE APPLYING. This is a blueprint migration, not evidence that it
-- has been executed against a Supabase project.
--
-- Design goals:
--   * team authorization lives in team_memberships, never user-editable metadata
--   * members write/read their own snapshots
--   * owners/managers read shared snapshots only inside teams they manage
--   * regular members cannot read peer workload snapshots
--   * invitation tokens are stored hashed and accepted atomically
--   * every exposed table has RLS from the first migration

begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) <= 120)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_name_length check (char_length(btrim(name)) between 1 and 120)
);

create table if not exists public.team_memberships (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'active',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id),
  constraint team_memberships_role_check check (role in ('owner', 'manager', 'member')),
  constraint team_memberships_status_check check (status in ('active', 'removed'))
);

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email citext not null,
  role text not null default 'member',
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint team_invites_role_check check (role in ('manager', 'member')),
  constraint team_invites_email_length check (char_length(email::text) between 3 and 320),
  constraint team_invites_token_hash_length check (char_length(token_hash) = 64),
  constraint team_invites_expiration_check check (expires_at > created_at),
  constraint team_invites_acceptance_check check (
    (accepted_at is null and accepted_by is null)
    or (accepted_at is not null and accepted_by is not null)
  )
);

create table if not exists public.workload_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_snapshot_id uuid not null unique,
  schema_version integer not null default 1,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_id text not null,
  observed_at timestamptz not null,
  source_updated_at timestamptz not null,
  share_level text not null,

  reliable_new_work_capacity_pct numeric,
  allocated_pct numeric,
  reactive_pct numeric,
  meeting_pct numeric,
  fragmented_work_pct numeric,
  blocked_pct numeric,
  carryover_risk_pct numeric,
  context_switch_score numeric,
  wip_load_score numeric,
  summary_confidence numeric,

  category_allocation jsonb,
  work_mode_allocation jsonb,
  project_allocation jsonb,
  reviewed_blocks integer not null default 0,
  eligible_blocks integer not null default 0,
  content_fingerprint text not null,
  created_at timestamptz not null default now(),

  constraint workload_snapshots_schema_check check (schema_version = 1),
  constraint workload_snapshots_share_level_check check (
    share_level in ('summary', 'categories', 'projects')
  ),
  constraint workload_snapshots_week_id_length check (char_length(week_id) between 4 and 32),
  constraint workload_snapshots_review_counts check (
    reviewed_blocks >= 0 and eligible_blocks >= 0 and reviewed_blocks <= eligible_blocks
  ),
  constraint workload_snapshots_fingerprint_length check (
    char_length(content_fingerprint) between 16 and 128
  ),
  constraint workload_snapshots_reliable_pct check (
    reliable_new_work_capacity_pct is null
    or reliable_new_work_capacity_pct between 0 and 100
  ),
  constraint workload_snapshots_allocated_pct check (
    allocated_pct is null or allocated_pct between 0 and 100
  ),
  constraint workload_snapshots_reactive_pct check (
    reactive_pct is null or reactive_pct between 0 and 100
  ),
  constraint workload_snapshots_meeting_pct check (
    meeting_pct is null or meeting_pct between 0 and 100
  ),
  constraint workload_snapshots_fragmented_pct check (
    fragmented_work_pct is null or fragmented_work_pct between 0 and 100
  ),
  constraint workload_snapshots_blocked_pct check (
    blocked_pct is null or blocked_pct between 0 and 100
  ),
  constraint workload_snapshots_carryover_pct check (
    carryover_risk_pct is null or carryover_risk_pct between 0 and 100
  ),
  constraint workload_snapshots_context_switch_score check (
    context_switch_score is null or context_switch_score between 0 and 100
  ),
  constraint workload_snapshots_wip_score check (
    wip_load_score is null or wip_load_score between 0 and 100
  ),
  constraint workload_snapshots_confidence check (
    summary_confidence is null or summary_confidence between 0 and 1
  ),
  constraint workload_snapshots_category_json check (
    category_allocation is null or jsonb_typeof(category_allocation) = 'array'
  ),
  constraint workload_snapshots_mode_json check (
    work_mode_allocation is null or jsonb_typeof(work_mode_allocation) = 'array'
  ),
  constraint workload_snapshots_project_json check (
    project_allocation is null or jsonb_typeof(project_allocation) = 'array'
  ),
  constraint workload_snapshots_level_shape check (
    (share_level = 'summary'
      and category_allocation is null
      and work_mode_allocation is null
      and project_allocation is null)
    or
    (share_level = 'categories'
      and project_allocation is null)
    or
    (share_level = 'projects')
  )
);

-- ---------------------------------------------------------------------------
-- Indexes used by RLS and dashboard queries
-- ---------------------------------------------------------------------------

create index if not exists team_memberships_user_active_idx
  on public.team_memberships (user_id, status, team_id);

create index if not exists team_memberships_team_role_active_idx
  on public.team_memberships (team_id, status, role, user_id);

create index if not exists team_invites_team_created_idx
  on public.team_invites (team_id, created_at desc);

create index if not exists team_invites_email_open_idx
  on public.team_invites (email, expires_at)
  where accepted_at is null;

create index if not exists workload_snapshots_team_user_observed_idx
  on public.workload_snapshots (team_id, user_id, observed_at desc);

create index if not exists workload_snapshots_user_team_observed_idx
  on public.workload_snapshots (user_id, team_id, observed_at desc);

create index if not exists workload_snapshots_team_week_idx
  on public.workload_snapshots (team_id, week_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- Internal authorization helpers. SECURITY DEFINER avoids RLS recursion.
-- ---------------------------------------------------------------------------

create or replace function private.is_active_team_member(check_team_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_memberships membership
    where membership.team_id = check_team_id
      and membership.user_id = check_user_id
      and membership.status = 'active'
  );
$$;

create or replace function private.is_team_manager(check_team_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_memberships membership
    where membership.team_id = check_team_id
      and membership.user_id = check_user_id
      and membership.status = 'active'
      and membership.role in ('owner', 'manager')
  );
$$;

create or replace function private.is_team_owner(check_team_id uuid, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_memberships membership
    where membership.team_id = check_team_id
      and membership.user_id = check_user_id
      and membership.status = 'active'
      and membership.role = 'owner'
  );
$$;

create or replace function private.can_manage_user(target_user_id uuid, viewer_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_memberships viewer
    join public.team_memberships target
      on target.team_id = viewer.team_id
     and target.status = 'active'
    where viewer.user_id = viewer_user_id
      and viewer.status = 'active'
      and viewer.role in ('owner', 'manager')
      and target.user_id = target_user_id
  );
$$;

revoke all on function private.is_active_team_member(uuid, uuid) from public;
revoke all on function private.is_team_manager(uuid, uuid) from public;
revoke all on function private.is_team_owner(uuid, uuid) from public;
revoke all on function private.can_manage_user(uuid, uuid) from public;
grant execute on function private.is_active_team_member(uuid, uuid) to authenticated;
grant execute on function private.is_team_manager(uuid, uuid) to authenticated;
grant execute on function private.is_team_owner(uuid, uuid) to authenticated;
grant execute on function private.can_manage_user(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Updated-at and auth-profile triggers
-- ---------------------------------------------------------------------------

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

-- Trigger creation is idempotent through explicit drops.
drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_updated_at();

drop trigger if exists teams_touch_updated_at on public.teams;
create trigger teams_touch_updated_at
before update on public.teams
for each row execute function private.touch_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Transactional product RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_team_with_owner(team_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  created_team_id uuid;
begin
  if caller is null then
    raise exception 'Authentication required';
  end if;

  if char_length(btrim(team_name)) < 1 or char_length(btrim(team_name)) > 120 then
    raise exception 'Team name must be between 1 and 120 characters';
  end if;

  insert into public.teams (name, created_by)
  values (btrim(team_name), caller)
  returning id into created_team_id;

  insert into public.team_memberships (team_id, user_id, role, status)
  values (created_team_id, caller, 'owner', 'active');

  return created_team_id;
end;
$$;

create or replace function public.accept_team_invite(raw_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_email citext;
  hashed_token text;
  invitation public.team_invites%rowtype;
begin
  if caller is null then
    raise exception 'Authentication required';
  end if;

  if raw_token is null or char_length(raw_token) < 32 then
    raise exception 'Invalid invitation token';
  end if;

  select users.email::citext
    into caller_email
  from auth.users users
  where users.id = caller;

  if caller_email is null then
    raise exception 'Authenticated account has no email';
  end if;

  hashed_token := encode(digest(raw_token, 'sha256'), 'hex');

  select invites.*
    into invitation
  from public.team_invites invites
  where invites.token_hash = hashed_token
  for update;

  if not found then
    raise exception 'Invitation not found';
  end if;

  if invitation.accepted_at is not null then
    raise exception 'Invitation has already been accepted';
  end if;

  if invitation.expires_at <= now() then
    raise exception 'Invitation has expired';
  end if;

  if lower(invitation.email::text) <> lower(caller_email::text) then
    raise exception 'Invitation email does not match signed-in account';
  end if;

  insert into public.team_memberships (team_id, user_id, role, status, joined_at)
  values (invitation.team_id, caller, invitation.role, 'active', now())
  on conflict (team_id, user_id) do update
    set role = excluded.role,
        status = 'active',
        joined_at = now();

  update public.team_invites
  set accepted_at = now(), accepted_by = caller
  where id = invitation.id;

  return invitation.team_id;
end;
$$;

create or replace function public.leave_team(target_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_role text;
begin
  if caller is null then
    raise exception 'Authentication required';
  end if;

  select membership.role
    into caller_role
  from public.team_memberships membership
  where membership.team_id = target_team_id
    and membership.user_id = caller
    and membership.status = 'active'
  for update;

  if not found then
    raise exception 'Active membership not found';
  end if;

  if caller_role = 'owner' then
    raise exception 'Team owner cannot leave without transferring ownership';
  end if;

  update public.team_memberships
  set status = 'removed'
  where team_id = target_team_id and user_id = caller;
end;
$$;

revoke all on function public.create_team_with_owner(text) from public;
revoke all on function public.accept_team_invite(text) from public;
revoke all on function public.leave_team(uuid) from public;
grant execute on function public.create_team_with_owner(text) to authenticated;
grant execute on function public.accept_team_invite(text) to authenticated;
grant execute on function public.leave_team(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.team_invites enable row level security;
alter table public.workload_snapshots enable row level security;

-- Profiles
create policy profiles_select_authorized
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select private.can_manage_user(id, auth.uid()))
);

create policy profiles_insert_self
on public.profiles
for insert
to authenticated
with check (id = (select auth.uid()));

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Teams
create policy teams_select_members
on public.teams
for select
to authenticated
using ((select private.is_active_team_member(id, auth.uid())));

create policy teams_update_managers
on public.teams
for update
to authenticated
using ((select private.is_team_manager(id, auth.uid())))
with check ((select private.is_team_manager(id, auth.uid())));

create policy teams_delete_owner
on public.teams
for delete
to authenticated
using ((select private.is_team_owner(id, auth.uid())));

-- Memberships: members see themselves; managers see active roster.
create policy memberships_select_authorized
on public.team_memberships
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_team_manager(team_id, auth.uid()))
);

-- Users may mark their own non-owner membership removed. Creation/promotion is RPC-only.
create policy memberships_delete_self_non_owner
on public.team_memberships
for delete
to authenticated
using (
  user_id = (select auth.uid())
  and role <> 'owner'
);

-- Invitations
create policy invites_select_managers
on public.team_invites
for select
to authenticated
using ((select private.is_team_manager(team_id, auth.uid())));

create policy invites_insert_managers
on public.team_invites
for insert
to authenticated
with check (
  invited_by = (select auth.uid())
  and (select private.is_team_manager(team_id, auth.uid()))
  and (
    role = 'member'
    or (role = 'manager' and (select private.is_team_owner(team_id, auth.uid())))
  )
);

create policy invites_delete_managers
on public.team_invites
for delete
to authenticated
using ((select private.is_team_manager(team_id, auth.uid())));

-- Workload snapshots
create policy snapshots_select_authorized
on public.workload_snapshots
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_team_manager(team_id, auth.uid()))
);

create policy snapshots_insert_self_member
on public.workload_snapshots
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.is_active_team_member(team_id, auth.uid()))
);

create policy snapshots_update_self_member
on public.workload_snapshots
for update
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_active_team_member(team_id, auth.uid()))
)
with check (
  user_id = (select auth.uid())
  and (select private.is_active_team_member(team_id, auth.uid()))
);

create policy snapshots_delete_self
on public.workload_snapshots
for delete
to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Latest-snapshot view. security_invoker preserves underlying RLS.
-- ---------------------------------------------------------------------------

create or replace view public.latest_team_snapshots
with (security_invoker = true)
as
select distinct on (snapshot.team_id, snapshot.user_id)
  snapshot.*
from public.workload_snapshots snapshot
order by snapshot.team_id, snapshot.user_id, snapshot.observed_at desc, snapshot.created_at desc;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.profiles from anon;
revoke all on public.teams from anon;
revoke all on public.team_memberships from anon;
revoke all on public.team_invites from anon;
revoke all on public.workload_snapshots from anon;
revoke all on public.latest_team_snapshots from anon;

-- RLS still decides which rows are visible/allowed.
grant select, insert, update on public.profiles to authenticated;
grant select, update, delete on public.teams to authenticated;
grant select, delete on public.team_memberships to authenticated;
grant select, insert, delete on public.team_invites to authenticated;
grant select, insert, update, delete on public.workload_snapshots to authenticated;
grant select on public.latest_team_snapshots to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Application-side invitation creation sketch (server route)
-- ---------------------------------------------------------------------------
-- 1. Generate 32+ cryptographically random bytes and encode URL-safe.
-- 2. token_hash = SHA-256(raw token), hex.
-- 3. Insert team_invites with the signed-in user's session; RLS confirms manager.
-- 4. Return https://weekform.com/invite/<raw token> exactly once.
-- 5. Never log raw token or include it in analytics.
--
-- Application-side snapshot insert rule:
--   user_id MUST be the current authenticated user ID. Even though RLS enforces
--   this, set it explicitly and filter team queries explicitly for performance.
--
-- Required negative tests before production:
--   * member cannot read peer snapshot
--   * outsider cannot select team/membership/snapshot/invite
--   * forged user_id insert denied
--   * forged unrelated team_id insert denied
--   * manager cannot delete member snapshot
--   * manager cannot invite another owner
--   * wrong-email, expired, accepted, and reused invite denied
--   * regular member cannot promote role
--   * latest_team_snapshots obeys underlying RLS
