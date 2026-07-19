-- pgTAP policy contract for Weekform Team Cloud v1.
-- Intended for `supabase test db` after applying the Team Cloud migrations,
-- including 202607190001_team_cloud_v1.sql and
-- 202607190003_team_actions.sql.
-- NOT EXECUTED IN THIS REPOSITORY: no Supabase CLI/local Postgres stack was
-- available when this file was authored. Every expectation below is EXPECTED,
-- not VERIFIED, until this file runs against a local stack.
--
-- Actors (docs/hackathon/TEAM_CLAWFATHER_RLS_MATRIX.md):
--   Manager A  — owner of Team T1 (and T2)
--   Member B   — active member of T1
--   Member C   — active member of T1; raw_user_meta_data claims "role":"owner"
--                on purpose (metadata must grant nothing)
--   Outsider D — authenticated, no membership
--   Invitee E  — authenticated, holds the valid invite email
--
-- Assumes the fixture-setup statements run as a role that bypasses RLS
-- (the local `postgres` role), as in span_simulator_rls.sql.

begin;
create extension if not exists pgtap;
select plan(76);

-- ---------------------------------------------------------------------------
-- Schema contract
-- ---------------------------------------------------------------------------

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'teams', 'teams exists');
select has_table('public', 'team_memberships', 'team_memberships exists');
select has_table('public', 'team_invites', 'team_invites exists');
select has_table('public', 'workload_snapshots', 'workload_snapshots exists');
select has_table('public', 'team_actions', 'team_actions exists');
select has_function('private', 'is_team_manager', array['uuid', 'uuid'], 'recursion-safe manager helper exists');
select has_function('private', 'is_active_team_member', array['uuid', 'uuid'], 'recursion-safe membership helper exists');
select has_function('public', 'create_team_with_owner', array['text'], 'atomic team creation RPC exists');
select has_function('public', 'accept_team_invite', array['text'], 'atomic invite acceptance RPC exists');
select has_function('public', 'create_team_action', array['uuid', 'text', 'text'], 'manager action creation RPC exists');
select has_function('public', 'resolve_team_action', array['uuid', 'uuid', 'text'], 'manager action resolution RPC exists');
select has_function('public', 'delete_team_action', array['uuid', 'uuid'], 'manager action deletion RPC exists');
select is(
  has_table_privilege('anon', 'public.team_actions', 'INSERT'),
  false,
  'anonymous clients have no direct team_actions INSERT privilege'
);
select is(
  has_table_privilege('authenticated', 'public.team_actions', 'INSERT'),
  false,
  'authenticated clients have no direct team_actions INSERT privilege'
);
select is(
  has_table_privilege('anon', 'public.team_actions', 'UPDATE'),
  false,
  'anonymous clients have no direct team_actions UPDATE privilege'
);
select is(
  has_table_privilege('authenticated', 'public.team_actions', 'UPDATE'),
  false,
  'authenticated clients have no direct team_actions UPDATE privilege'
);
select is(
  has_table_privilege('anon', 'public.team_actions', 'DELETE'),
  false,
  'anonymous clients have no direct team_actions DELETE privilege'
);
select is(
  has_table_privilege('authenticated', 'public.team_actions', 'DELETE'),
  false,
  'authenticated clients have no direct team_actions DELETE privilege'
);

-- ---------------------------------------------------------------------------
-- Fixtures (synthetic identities only; accounts are not sign-in-able)
-- ---------------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'clawfather-manager-a@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'clawfather-member-b@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('20000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'clawfather-member-c@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{"role":"owner"}', now(), now()),
  ('20000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'clawfather-outsider-d@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('20000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'clawfather-invitee-e@example.test', null, now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
on conflict (id) do nothing;

select is(
  (select count(*)::integer from public.profiles
   where id in ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
                '20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000004',
                '20000000-0000-4000-8000-000000000005')),
  5,
  'handle_new_user bootstrapped a profile for every seeded auth user'
);

select ok(
  coalesce(
    (select array_to_string(c.reloptions, ',')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'latest_team_snapshots'),
    ''
  ) like '%security_invoker%',
  'latest_team_snapshots is a security_invoker view and cannot bypass RLS'
);

insert into public.teams (id, name, created_by) values
  ('30000000-0000-4000-8000-000000000001', 'RLS Test Team T1', '20000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002', 'RLS Test Team T2', '20000000-0000-4000-8000-000000000001');

insert into public.team_memberships (team_id, user_id, role, status) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'member', 'active'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'owner', 'active');

-- Expired invite fixture for the expiry-path test (B's email).
insert into public.team_invites (id, team_id, email, role, token_hash, invited_by, created_at, expires_at)
values (
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'clawfather-member-b@example.test',
  'member',
  encode(extensions.digest('synthetic-expired-test-invite-token-00000000', 'sha256'), 'hex'),
  '20000000-0000-4000-8000-000000000001',
  now() - interval '4 days',
  now() - interval '1 day'
);

-- ---------------------------------------------------------------------------
-- Manager A
-- ---------------------------------------------------------------------------

set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::integer from public.teams
   where id in ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002')),
  2,
  'A (owner) can read the teams they belong to'
);

select is(
  (select count(*)::integer from public.team_memberships
   where team_id = '30000000-0000-4000-8000-000000000001'),
  3,
  'A (manager) can read the full active roster of a managed team'
);

select throws_ok(
  $$
    insert into public.team_actions (
      team_id, created_by, action_text, risk_flag_key,
      status, created_at, resolved_at
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'Direct insert must remain unavailable',
      'high-reactive',
      'done',
      now() - interval '1 day',
      now()
    )
  $$,
  '42501',
  'permission denied for table team_actions',
  'A cannot bypass the RPC by inserting identity or lifecycle fields directly'
);

select lives_ok(
  $$
    select public.create_team_action(
      '30000000-0000-4000-8000-000000000001',
      '  Batch incoming requests  ',
      'high-reactive'
    )
  $$,
  'A can create a team action through the manager-only RPC'
);

select ok(
  exists (
    select 1
    from public.team_actions action
    where action.team_id = '30000000-0000-4000-8000-000000000001'
      and action.created_by = '20000000-0000-4000-8000-000000000001'
      and action.action_text = 'Batch incoming requests'
      and action.risk_flag_key = 'high-reactive'
      and action.status = 'open'
      and action.created_at is not null
      and action.resolved_at is null
  ),
  'RPC derives team-scoped actor and open lifecycle fields on the server'
);

select throws_ok(
  $$
    update public.team_actions
    set status = 'done', resolved_at = now() - interval '30 days'
    where team_id = '30000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table team_actions',
  'A cannot bypass the resolution RPC by setting status or resolved_at directly'
);

select throws_ok(
  $$
    delete from public.team_actions
    where team_id = '30000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table team_actions',
  'A cannot delete team action evidence directly'
);

select lives_ok(
  $$
    select public.create_team_action(
      '30000000-0000-4000-8000-000000000001',
      repeat('x', 550),
      null
    )
  $$,
  'A can submit oversized text because the RPC clamps it safely'
);

select is(
  (
    select char_length(action.action_text)
    from public.team_actions action
    where action.team_id = '30000000-0000-4000-8000-000000000001'
      and action.risk_flag_key is null
    order by action.created_at desc, action.id desc
    limit 1
  ),
  500,
  'RPC clamps oversized action text to 500 characters'
);

select lives_ok(
  $$
    select public.resolve_team_action(
      '30000000-0000-4000-8000-000000000001',
      (
        select action.id
        from public.team_actions action
        where action.team_id = '30000000-0000-4000-8000-000000000001'
          and action.risk_flag_key = 'high-reactive'
        limit 1
      ),
      'done'
    )
  $$,
  'A can resolve a team action through the manager-only RPC'
);

select ok(
  exists (
    select 1
    from public.team_actions action
    where action.team_id = '30000000-0000-4000-8000-000000000001'
      and action.risk_flag_key = 'high-reactive'
      and action.status = 'done'
      and action.resolved_at between statement_timestamp() - interval '5 seconds'
                                and statement_timestamp() + interval '5 seconds'
  ),
  'resolution RPC derives the closed status and resolved_at on the server'
);

select lives_ok(
  $$
    select public.delete_team_action(
      '30000000-0000-4000-8000-000000000001',
      (
        select action.id
        from public.team_actions action
        where action.team_id = '30000000-0000-4000-8000-000000000001'
          and action.risk_flag_key is null
        order by action.created_at desc, action.id desc
        limit 1
      )
    )
  $$,
  'A can delete a team action through the manager-only RPC'
);

select is(
  (
    select count(*)::integer
    from public.team_actions action
    where action.team_id = '30000000-0000-4000-8000-000000000001'
      and action.risk_flag_key is null
  ),
  0,
  'delete RPC removes only the explicitly scoped manager action'
);

select throws_ok(
  $$
    select public.create_team_action(
      '30000000-0000-4000-8000-000000000001',
      '   ',
      null
    )
  $$,
  '22023',
  'Action text is required',
  'RPC rejects blank action text after trimming'
);

select throws_ok(
  $$
    select public.create_team_action(
      '30000000-0000-4000-8000-000000000001',
      E'\t\n\r\f\013',
      null
    )
  $$,
  '22023',
  'Action text is required',
  'RPC rejects tabs, newlines, form feeds, and vertical tabs as blank text'
);

select throws_ok(
  $$
    select public.create_team_action(
      '30000000-0000-4000-8000-000000000001',
      'Try an unsupported signal',
      'member-productivity-score'
    )
  $$,
  '22023',
  'Risk flag key is not allowlisted',
  'RPC rejects risk keys outside the closed allowlist'
);

-- ---------------------------------------------------------------------------
-- Member B
-- ---------------------------------------------------------------------------

set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000002';

select throws_ok(
  $$
    insert into public.team_actions (
      id, team_id, created_by, action_text, risk_flag_key,
      status, created_at, resolved_at
    ) values (
      '60000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      'Forged direct member action',
      'high-meetings',
      'done',
      now() - interval '1 day',
      now()
    )
  $$,
  '42501',
  'permission denied for table team_actions',
  'B cannot insert a team action directly even when forging server-owned fields'
);

select throws_ok(
  $$
    update public.team_actions
    set status = 'dropped', resolved_at = now()
    where team_id = '30000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table team_actions',
  'B cannot update a team action directly'
);

select throws_ok(
  $$
    delete from public.team_actions
    where team_id = '30000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'permission denied for table team_actions',
  'B cannot delete a team action directly'
);

select throws_ok(
  $$
    select public.create_team_action(
      '30000000-0000-4000-8000-000000000001',
      'Member-authored manager action',
      'high-meetings'
    )
  $$,
  '42501',
  'An active team manager or owner role is required',
  'B cannot create a manager action as a plain member'
);

select throws_ok(
  $$
    select public.resolve_team_action(
      '30000000-0000-4000-8000-000000000001',
      (
        select action.id
        from public.team_actions action
        where action.team_id = '30000000-0000-4000-8000-000000000001'
        limit 1
      ),
      'dropped'
    )
  $$,
  '42501',
  'An active team manager or owner role is required',
  'B cannot resolve a manager action as a plain member'
);

select throws_ok(
  $$
    select public.delete_team_action(
      '30000000-0000-4000-8000-000000000001',
      (
        select action.id
        from public.team_actions action
        where action.team_id = '30000000-0000-4000-8000-000000000001'
        limit 1
      )
    )
  $$,
  '42501',
  'An active team manager or owner role is required',
  'B cannot delete a manager action as a plain member'
);

select lives_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, allocated_pct, content_fingerprint
    ) values (
      '50000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '2026-W29', now(), now(), 'summary', 80, 'synthetic-test-fingerprint-b1'
    )
  $$,
  'B can insert their own snapshot into their active team'
);

select throws_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, allocated_pct, content_fingerprint
    ) values (
      '50000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000003',
      '2026-W29', now(), now(), 'summary', 80, 'synthetic-test-fingerprint-b2'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "workload_snapshots"',
  'B cannot forge user_id to write a snapshot as C'
);

select throws_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, allocated_pct, content_fingerprint
    ) values (
      '50000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000002',
      '2026-W29', now(), now(), 'summary', 80, 'synthetic-test-fingerprint-b3'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "workload_snapshots"',
  'B cannot write a snapshot into team T2 where B has no membership'
);

select throws_ok(
  $$
    update public.workload_snapshots
    set user_id = '20000000-0000-4000-8000-000000000003'
    where client_snapshot_id = '50000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'B cannot reassign an own snapshot to another user via UPDATE'
);

select is(
  (select count(*)::integer from public.workload_snapshots
   where user_id = '20000000-0000-4000-8000-000000000002'),
  1,
  'B can read their own snapshots'
);

select is(
  (select count(*)::integer from public.team_memberships
   where team_id = '30000000-0000-4000-8000-000000000001'),
  1,
  'B (member) sees only their own membership row, not the roster'
);

-- ---------------------------------------------------------------------------
-- Member C (metadata claims "role":"owner"; must grant nothing)
-- ---------------------------------------------------------------------------

set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000003';

select throws_ok(
  $$
    select public.create_team_action(
      '30000000-0000-4000-8000-000000000001',
      'Metadata-forged manager action',
      'high-fragmentation'
    )
  $$,
  '42501',
  'An active team manager or owner role is required',
  'C cannot create a manager action despite a forged metadata owner role'
);

select is(
  (select count(*)::integer from public.workload_snapshots
   where user_id = '20000000-0000-4000-8000-000000000002'),
  0,
  'C cannot read peer B''s snapshots despite metadata role claim'
);

select is(
  (select count(*)::integer from public.latest_team_snapshots
   where user_id = '20000000-0000-4000-8000-000000000002'),
  0,
  'C cannot read peer snapshots through the latest_team_snapshots view'
);

select throws_ok(
  $$
    insert into public.team_invites (team_id, email, role, token_hash, invited_by, expires_at)
    values (
      '30000000-0000-4000-8000-000000000001', 'forged-by-c@example.test', 'member',
      encode(extensions.digest('synthetic-forged-invite-token-by-c-00000000', 'sha256'), 'hex'),
      '20000000-0000-4000-8000-000000000003', now() + interval '72 hours'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "team_invites"',
  'C (member with forged metadata role) cannot create invitations'
);

-- ---------------------------------------------------------------------------
-- Manager A: reads members, cannot delete their history, mints invites
-- ---------------------------------------------------------------------------

set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::integer from public.workload_snapshots
   where user_id = '20000000-0000-4000-8000-000000000002'),
  1,
  'A (manager) can read active member B''s snapshot'
);

delete from public.workload_snapshots
where user_id = '20000000-0000-4000-8000-000000000002';

select is(
  (select count(*)::integer from public.workload_snapshots
   where user_id = '20000000-0000-4000-8000-000000000002'),
  1,
  'A''s delete of B''s snapshot silently matches zero rows: managers cannot delete member history'
);

select lives_ok(
  $$
    insert into public.team_invites (team_id, email, role, token_hash, invited_by, expires_at)
    values (
      '30000000-0000-4000-8000-000000000001', 'clawfather-invitee-e@example.test', 'member',
      encode(extensions.digest('synthetic-valid-test-invite-token-for-e-0001', 'sha256'), 'hex'),
      '20000000-0000-4000-8000-000000000001', now() + interval '72 hours'
    )
  $$,
  'A (owner) can create a hashed member invitation'
);

-- ---------------------------------------------------------------------------
-- Outsider D: enumerates nothing, forges nothing, wrong-email acceptance fails
-- ---------------------------------------------------------------------------

set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000004';

select throws_ok(
  $$
    select public.create_team_action(
      '30000000-0000-4000-8000-000000000001',
      'Outsider-authored manager action',
      'low-headroom'
    )
  $$,
  '42501',
  'An active team manager or owner role is required',
  'D cannot create a manager action as an outsider'
);

select throws_ok(
  $$
    select public.resolve_team_action(
      '30000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      'done'
    )
  $$,
  '42501',
  'An active team manager or owner role is required',
  'D cannot resolve a manager action as an outsider'
);

select throws_ok(
  $$
    select public.delete_team_action(
      '30000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'An active team manager or owner role is required',
  'D cannot delete a manager action as an outsider'
);

select is((select count(*)::integer from public.teams), 0, 'D cannot enumerate teams');
select is((select count(*)::integer from public.team_memberships), 0, 'D cannot enumerate memberships');
select is((select count(*)::integer from public.workload_snapshots), 0, 'D cannot enumerate snapshots');
select is((select count(*)::integer from public.team_invites), 0, 'D cannot enumerate invites');
select is((select count(*)::integer from public.latest_team_snapshots), 0, 'D sees nothing through the view');

select throws_ok(
  $$
    insert into public.team_invites (team_id, email, role, token_hash, invited_by, expires_at)
    values (
      '30000000-0000-4000-8000-000000000001', 'forged-by-d@example.test', 'member',
      encode(extensions.digest('synthetic-forged-invite-token-by-d-00000000', 'sha256'), 'hex'),
      '20000000-0000-4000-8000-000000000004', now() + interval '72 hours'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "team_invites"',
  'D cannot create an invite naming T1'
);

select throws_ok(
  $$ select public.accept_team_invite('synthetic-valid-test-invite-token-for-e-0001') $$,
  'P0001',
  'Invitation email does not match signed-in account',
  'D cannot accept an invitation addressed to E''s email'
);

-- ---------------------------------------------------------------------------
-- Invitee E: one-time acceptance, replay denied, team creation RPC
-- ---------------------------------------------------------------------------

set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000005';

select lives_ok(
  $$ select public.accept_team_invite('synthetic-valid-test-invite-token-for-e-0001') $$,
  'E accepts the invitation matching their email exactly once'
);

select is(
  (select count(*)::integer from public.team_memberships
   where user_id = '20000000-0000-4000-8000-000000000005'
     and team_id = '30000000-0000-4000-8000-000000000001'
     and role = 'member' and status = 'active'),
  1,
  'acceptance created an active member membership atomically'
);

select throws_ok(
  $$ select public.accept_team_invite('synthetic-valid-test-invite-token-for-e-0001') $$,
  'P0001',
  'Invitation has already been accepted',
  'an accepted invitation cannot be reused'
);

select lives_ok(
  $$ select public.create_team_with_owner('Synthetic Team Kappa') $$,
  'create_team_with_owner atomically creates team plus owner membership'
);

select is(
  (select count(*)::integer from public.teams),
  2,
  'E now reads exactly the two teams they belong to (T1 and Kappa)'
);

-- ---------------------------------------------------------------------------
-- Member B: expired invitation is rejected
-- ---------------------------------------------------------------------------

set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000002';

select throws_ok(
  $$ select public.accept_team_invite('synthetic-expired-test-invite-token-00000000') $$,
  'P0001',
  'Invitation has expired',
  'an expired invitation cannot be accepted even by the right email'
);

-- ---------------------------------------------------------------------------
-- Anonymous role: table privileges revoked entirely
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok(
  $$
    select public.create_team_action(
      '30000000-0000-4000-8000-000000000001',
      'Anonymous manager action',
      'low-headroom'
    )
  $$,
  '42501',
  'permission denied for function create_team_action',
  'Anonymous callers cannot execute the manager action RPC'
);

select throws_ok(
  $$
    select public.resolve_team_action(
      '30000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      'done'
    )
  $$,
  '42501',
  'permission denied for function resolve_team_action',
  'Anonymous callers cannot execute the manager action resolution RPC'
);

select throws_ok(
  $$
    select public.delete_team_action(
      '30000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  'permission denied for function delete_team_action',
  'Anonymous callers cannot execute the manager action deletion RPC'
);

select throws_ok(
  $$ select count(*) from public.teams $$,
  '42501',
  'permission denied for table teams',
  'anonymous role cannot read teams at all'
);

select * from finish();
rollback;
