-- pgTAP-style policy contract for Weekform Span Simulator.
-- Intended for `supabase test db` after applying 202607180001_span_simulator.sql.
-- Not executed in this repository: Supabase CLI/local services are not installed here.

begin;
create extension if not exists pgtap;
select plan(27);

select has_table('public', 'simulation_personas', 'simulation_personas exists');
select has_table('public', 'simulation_runs', 'simulation_runs exists');
select has_table('public', 'simulation_members', 'simulation_members exists');
select has_table('public', 'simulation_artifacts', 'simulation_artifacts exists');
select has_table('public', 'simulation_week_snapshots', 'simulation_week_snapshots exists');
select has_function('private', 'is_simulator_admin', array['uuid'], 'DB-backed simulator admin helper exists');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sim-admin@example.test', crypt('not-a-real-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ordinary-member@example.test', crypt('not-a-real-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ordinary-manager@example.test', crypt('not-a-real-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"team_role":"manager"}', now(), now())
on conflict (id) do nothing;

insert into private.simulator_admins (user_id, reason)
values ('10000000-0000-0000-0000-000000000001', 'Span Simulator policy test')
on conflict (user_id) do nothing;

set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';
select is((select count(*)::integer from public.simulation_personas), 0, 'ordinary member cannot enumerate simulator personas');

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000003';
select is((select count(*)::integer from public.simulation_runs), 0, 'team manager metadata does not grant simulator access');

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.simulation_runs), 0, 'explicit simulator admin can query the run table');

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';
select is((select count(*)::integer from public.simulation_runs), 0, 'non-admin cannot enumerate simulation runs');
select throws_ok(
  $$
    insert into public.simulation_runs (
      simulation_run_id, status, config, sharing_policy, persona_version,
      scenario_version, generator_version, seed, created_by
    ) values (
      '20000000-0000-0000-0000-000000000001', 'queued', '{}', '{}',
      'data-analyst@1', 'golden@1', 'test-generator@1', 20260718,
      '10000000-0000-0000-0000-000000000002'
    )
  $$,
  '42501',
  'new row violates row-level security policy for table "simulation_runs"',
  'non-admin cannot create a simulation run'
);

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';
select lives_ok(
  $$
    insert into public.simulation_personas (
      persona_id, slug, persona_version, name, definition, is_builtin,
      generator_version, created_by
    ) values (
      '30000000-0000-0000-0000-000000000001', 'data-analyst', 1,
      'Data Analyst', '{"synthetic":true}', true, 'test-generator@1',
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  'simulator admin can create a versioned persona'
);

select lives_ok(
  $$
    insert into public.simulation_runs (
      simulation_run_id, status, config, sharing_policy, persona_version,
      scenario_version, generator_version, seed, created_by
    ) values (
      '20000000-0000-0000-0000-000000000001', 'queued',
      '{"span":{"unit":"weeks","value":1}}', '{"level":"categories"}',
      'data-analyst@1', 'golden@1', 'test-generator@1', 20260718,
      '10000000-0000-0000-0000-000000000001'
    )
  $$,
  'simulator admin can create a synthetic run'
);

select throws_ok(
  $$
    update public.simulation_personas
    set definition = '{"synthetic":true,"rewritten":true}'
    where persona_id = '30000000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'permission denied for table simulation_personas',
  'authenticated admins must create a new persona version instead of rewriting one'
);

select throws_ok(
  $$
    update public.simulation_runs
    set seed = 1
    where simulation_run_id = '20000000-0000-0000-0000-000000000001'
  $$,
  'P0001',
  'Canonical simulation run inputs and provenance are immutable',
  'canonical run inputs cannot be rewritten after insertion'
);

select lives_ok(
  $$
    insert into public.simulation_members (
      simulation_member_id, simulation_run_id, persona_id, persona_version,
      member_key, display_name, generator_version, seed
    ) values (
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001', 1,
      'simulated-data-analyst-01', 'SIMULATED Data Analyst 01',
      'test-generator@1', 20260718
    )
  $$,
  'simulator admin can create a permanently marked synthetic member'
);

select throws_ok(
  $$
    insert into public.simulation_artifacts (
      simulation_run_id, simulation_member_id, artifact_kind, week_id, payload,
      content_hash, persona_version, generator_version, seed, is_synthetic
    ) values (
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001', 'raw_event', '2026-W01', '{}',
      repeat('a', 64), 1, 'test-generator@1', 20260718, false
    )
  $$,
  '23514',
  null,
  'database rejects an artifact that drops the synthetic marker'
);

select throws_ok(
  $$
    insert into public.simulation_artifacts (
      simulation_run_id, simulation_member_id, artifact_kind, week_id, payload,
      content_hash, persona_version, generator_version, seed
    ) values (
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001', 'raw_event', '2026-W01', '{}',
      repeat('b', 64), 1, 'test-generator@1', 999
    )
  $$,
  'P0001',
  'Simulation artifact provenance does not match its member',
  'database rejects artifact provenance that does not match its member'
);

select lives_ok(
  $$
    insert into public.simulation_artifacts (
      simulation_artifact_id, simulation_run_id, simulation_member_id,
      artifact_kind, week_id, payload, content_hash, persona_version,
      generator_version, seed
    ) values (
      '50000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001', 'raw_event', '2026-W01',
      '{"app_name":"Synthetic BI","window_title":"SIMULATED dashboard"}',
      repeat('c', 64), 1, 'test-generator@1', 20260718
    )
  $$,
  'matching synthetic artifact is accepted'
);

select lives_ok(
  $$
    insert into public.simulation_week_snapshots (
      simulation_week_snapshot_id, simulation_run_id, simulation_member_id,
      week_id, snapshot, reliable_new_work_capacity_pct, allocated_pct,
      reactive_pct, meeting_pct, fragmented_work_pct, blocked_pct,
      context_switch_score, wip_load_score, summary_confidence,
      category_allocation, work_mode_allocation, sharing_level,
      persona_version, generator_version, seed, computed_at
    ) values (
      '60000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001', '2026-W01',
      '{"week_id":"2026-W01"}', 24, 92, 20, 22, 18, 6,
      0.34, 0.52, 0.82, '[]', '[]', 'categories',
      1, 'test-generator@1', 20260718, now()
    )
  $$,
  'matching synthetic week snapshot is accepted'
);

update public.simulation_runs
set status = 'completed', completed_at = now(), canonical_fingerprint = repeat('d', 64)
where simulation_run_id = '20000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::integer from public.simulation_manager_snapshots),
  1,
  'simulator admin can read completed rows from the isolated manager simulation view'
);

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::integer from public.simulation_manager_snapshots),
  0,
  'ordinary team manager cannot read the simulation manager view'
);

set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000001';
select lives_ok(
  $$ delete from public.simulation_runs where simulation_run_id = '20000000-0000-0000-0000-000000000001' $$,
  'simulator admin can permanently delete a run'
);
select is((select count(*)::integer from public.simulation_members), 0, 'run deletion cascades to members');
select is((select count(*)::integer from public.simulation_artifacts), 0, 'run deletion cascades to artifacts');
select is((select count(*)::integer from public.simulation_week_snapshots), 0, 'run deletion cascades to week snapshots');
select is(
  (select count(*)::integer from public.simulation_audit_events where action = 'deleted'),
  1,
  'minimal deletion audit receipt survives the generated-data cascade'
);

select * from finish();
rollback;
