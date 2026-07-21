-- Weekform Team Cloud v1 — synthetic local seed (Team Clawfather)
--
-- SYNTHETIC DATA ONLY. Every identity, team, email, and metric below is
-- invented for local development and demos. This file contains no passwords,
-- no service keys, no project URLs, and no real email addresses.
--
-- Portability notes:
--   * This seed targets a LOCAL Supabase stack (`supabase db reset`), where
--     seed.sql runs as a role that bypasses RLS and where the `auth` schema
--     exists. It is not intended for hosted projects.
--   * Seeding auth.users directly is a local convenience, not a supported auth
--     flow. The rows below have NULL encrypted_password, so they can NOT be
--     signed into. To exercise sign-in interactively:
--       1. `supabase start`
--       2. Create users in Studio (Auth > Users > Add user) or via the local
--          auth API with your own throwaway credentials.
--       3. The on_auth_user_created trigger bootstraps their profiles.
--     If your local stack rejects direct auth.users inserts, delete the
--     "Synthetic auth identities" block and seed only the public.* rows for
--     users you created through the local auth API (substitute their UUIDs).
--
-- Cast: Ana Manager (owner of team T1), Ben Member and Cai Member (active
-- members of T1), Dee Outsider (authenticated, no membership). Cai carries
-- raw_user_meta_data {"role":"owner"} on purpose: it must grant nothing.

begin;

-- ---------------------------------------------------------------------------
-- Synthetic auth identities (local stacks only; not sign-in-able)
-- ---------------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ana.manager@example.test', null, now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Ana Manager (synthetic)"}', now(), now()),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'ben.member@example.test', null, now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Ben Member (synthetic)"}', now(), now()),
  ('a0000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'cai.member@example.test', null, now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Cai Member (synthetic)","role":"owner"}', now(), now()),
  ('a0000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dee.outsider@example.test', null, now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"Dee Outsider (synthetic)"}', now(), now())
on conflict (id) do nothing;

-- on_auth_user_created has already bootstrapped profiles; make display names
-- deterministic even if the trigger was disabled locally.
insert into public.profiles (id, display_name) values
  ('a0000000-0000-4000-8000-000000000001', 'Ana Manager (synthetic)'),
  ('a0000000-0000-4000-8000-000000000002', 'Ben Member (synthetic)'),
  ('a0000000-0000-4000-8000-000000000003', 'Cai Member (synthetic)'),
  ('a0000000-0000-4000-8000-000000000004', 'Dee Outsider (synthetic)')
on conflict (id) do update set display_name = excluded.display_name;

-- ---------------------------------------------------------------------------
-- Synthetic team and memberships
-- ---------------------------------------------------------------------------

insert into public.teams (id, name, created_by) values
  ('b0000000-0000-4000-8000-000000000001', 'Synthetic Clawfather Team',
   'a0000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.team_memberships (team_id, user_id, role, status) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'member', 'active'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'member', 'active')
on conflict (team_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Synthetic workload snapshots (allowlisted metrics only; no titles, notes,
-- evidence, or calendar/chat content — see TEAM_CLAWFATHER_ARCHITECTURE.md §2)
-- ---------------------------------------------------------------------------

insert into public.workload_snapshots (
  id, client_snapshot_id, schema_version, team_id, user_id, week_id,
  observed_at, source_updated_at, share_level,
  reliable_new_work_capacity_pct, allocated_pct, reactive_pct, meeting_pct,
  fragmented_work_pct, blocked_pct, carryover_risk_pct,
  context_switch_score, wip_load_score, summary_confidence,
  category_allocation, work_mode_allocation, project_allocation,
  reviewed_blocks, eligible_blocks, content_fingerprint
) values
  ('c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 1,
   'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   '2026-W29', now() - interval '2 days', now() - interval '2 days', 'categories',
   28, 72, 18, 24, 12, 4, 15, 0.42, 0.55, 0.82,
   '[{"label":"Planned analysis / project work","value":40},{"label":"Recurring reporting","value":32}]',
   '[{"label":"Deep work","value":46},{"label":"Collaborative","value":24},{"label":"Reactive","value":18}]',
   null, 34, 40, 'synthetic-fingerprint-ana-2026w29'),
  ('c0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 1,
   'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002',
   '2026-W29', now() - interval '1 day', now() - interval '1 day', 'summary',
   18, 82, 30, 18, 22, 8, 25, 0.61, 0.68, 0.74,
   null, null, null, 21, 33, 'synthetic-fingerprint-ben-2026w29'),
  ('c0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 1,
   'b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003',
   '2026-W29', now() - interval '3 hours', now() - interval '3 hours', 'projects',
   35, 65, 12, 20, 9, 2, 10, 0.30, 0.48, 0.88,
   '[{"label":"SQL / data modeling / query work","value":52}]',
   '[{"label":"Deep work","value":58},{"label":"Collaborative","value":20}]',
   '[{"label":"synthetic-project-atlas","value":36},{"label":"synthetic-project-lumen","value":16}]',
   40, 42, 'synthetic-fingerprint-cai-2026w29')
on conflict (user_id, client_snapshot_id) do nothing;

-- ---------------------------------------------------------------------------
-- Synthetic invites. Raw tokens appear ONLY here, in a synthetic local seed,
-- so the acceptance flow can be exercised end to end:
--   * open invite raw token:    synthetic-open-invite-token-for-local-use-only
--     (for a fifth user you create locally with email eve.invitee@example.test)
--   * expired invite raw token: synthetic-expired-invite-token-local-only-0000
-- Only SHA-256 hashes are stored, matching the production contract.
-- ---------------------------------------------------------------------------

insert into public.team_invites (
  id, team_id, email, role, token_hash, invited_by, created_at, expires_at
) values
  ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'eve.invitee@example.test', 'member',
   encode(extensions.digest('synthetic-open-invite-token-for-local-use-only', 'sha256'), 'hex'),
   'a0000000-0000-4000-8000-000000000001', now(), now() + interval '72 hours'),
  ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
   'ben.member@example.test', 'member',
   encode(extensions.digest('synthetic-expired-invite-token-local-only-0000', 'sha256'), 'hex'),
   'a0000000-0000-4000-8000-000000000001', now() - interval '4 days', now() - interval '1 day')
on conflict (id) do nothing;

commit;
