-- Server-side contract for the only aggregate workload payload managers can receive.
-- The desktop allowlist is necessary but not sufficient: an authenticated client can
-- write its own row directly, so PostgreSQL must independently enforce the same shape.

begin;
set local role postgres;
set local search_path = public, extensions;
create extension if not exists pgtap;
select plan(16);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '27000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'snapshot-contract@example.test', null, now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
) on conflict (id) do nothing;

insert into public.teams (id, name, created_by)
values (
  '37000000-0000-4000-8000-000000000001',
  'Synthetic snapshot contract team',
  '27000000-0000-4000-8000-000000000001'
) on conflict (id) do nothing;

insert into public.team_memberships (team_id, user_id, role, status)
values (
  '37000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  'owner', 'active'
) on conflict (team_id, user_id) do update set role = excluded.role, status = excluded.status;

select has_function(
  'private',
  'is_valid_shared_allocation',
  array['jsonb', 'text[]', 'integer', 'integer'],
  'the database owns an immutable shared-allocation validator'
);

select lives_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, allocated_pct, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000001',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'summary', 140, 'snapshot-contract-overcommit'
    )
  $$,
  'honest overcommitment above 100 percent survives the cloud boundary'
);

select throws_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, context_switch_score, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000002',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'summary', 1.01, 'snapshot-contract-context-score'
    )
  $$,
  '23514', null,
  'unit-interval scores reject values above one'
);

select lives_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, category_allocation, work_mode_allocation,
      content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000003',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'categories',
      '[{"label":"Planned analysis / project work","value":35}]',
      '[{"label":"Deep work","value":35}]',
      'snapshot-contract-valid-taxonomy'
    )
  $$,
  'known category and work-mode allocation entries are accepted'
);

select throws_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, category_allocation, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000004',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'categories',
      '[{"label":"Private invented category","value":10}]',
      'snapshot-contract-unknown-category'
    )
  $$,
  '23514', null,
  'unknown category labels cannot bypass the client allowlist'
);

select throws_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, category_allocation, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000005',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'categories',
      '[{"label":"QA / data validation","value":10,"notes":"must never cross"}]',
      'snapshot-contract-extra-field'
    )
  $$,
  '23514', null,
  'allocation objects reject fields outside label and value'
);

select throws_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, category_allocation, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000006',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'categories',
      (select jsonb_agg(jsonb_build_object('label', 'QA / data validation', 'value', value))
       from generate_series(1, 12) value),
      'snapshot-contract-category-count'
    )
  $$,
  '23514', null,
  'category arrays are bounded to the eleven-item taxonomy'
);

select throws_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, work_mode_allocation, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000007',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'categories',
      '[{"label":"Always online","value":10}]',
      'snapshot-contract-unknown-mode'
    )
  $$,
  '23514', null,
  'unknown work-mode labels are rejected'
);

select throws_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, project_allocation, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000008',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'projects',
      '[{"label":"","value":10}]',
      'snapshot-contract-empty-project'
    )
  $$,
  '23514', null,
  'empty project labels are rejected'
);

select throws_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, project_allocation, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000009',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'projects',
      (select jsonb_agg(jsonb_build_object('label', 'Project ' || value, 'value', 1))
       from generate_series(1, 51) value),
      'snapshot-contract-project-count'
    )
  $$,
  '23514', null,
  'project allocations are bounded to fifty entries'
);

select lives_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, project_allocation, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000013',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'projects',
      (select jsonb_agg(
        jsonb_build_object(
          -- A CJK code point occupies one JavaScript UTF-16 code unit (so this
          -- is valid at the 200-character client limit) and three UTF-8 bytes.
          'label', lpad(project_number::text, 2, '0') || repeat('界', 198),
          'value', 1
        ) order by project_number
      ) from generate_series(1, 50) project_number),
      'snapshot-contract-project-unicode-boundary'
    )
  $$,
  'fifty distinct two-hundred-character Unicode project names fit the server byte bound'
);

select lives_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, project_allocation, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000014',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'projects',
      jsonb_build_array(jsonb_build_object('label', repeat('a', 199) || chr(128512), 'value', 1)),
      'snapshot-contract-project-astral-boundary'
    )
  $$,
  'an astral character remains intact at the two-hundred-code-point project boundary'
);

select throws_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, project_allocation, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000010',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'projects',
      jsonb_build_array(jsonb_build_object('label', repeat('x', 201), 'value', 1)),
      'snapshot-contract-project-length'
    )
  $$,
  '23514', null,
  'project labels longer than the desktop contract are rejected'
);

select throws_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, project_allocation, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000011',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'projects',
      '[{"label":"Approved project","value":10,"stakeholder":"must never cross"}]',
      'snapshot-contract-project-extra'
    )
  $$,
  '23514', null,
  'project allocation objects reject arbitrary sensitive fields'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '27000000-0000-4000-8000-000000000001';

select lives_ok(
  $$
    insert into public.workload_snapshots (
      client_snapshot_id, team_id, user_id, week_id, observed_at,
      source_updated_at, share_level, project_allocation, content_fingerprint
    ) values (
      '57000000-0000-4000-8000-000000000012',
      '37000000-0000-4000-8000-000000000001',
      '27000000-0000-4000-8000-000000000001',
      '2026-W30', now(), now(), 'projects',
      '[{"label":"Approved project","value":10}]',
      'snapshot-contract-authenticated-valid'
    )
  $$,
  'an authenticated member can still write a valid project payload'
);

set local role postgres;
select is(
  (select count(*)::integer
   from public.workload_snapshots
   where user_id = '27000000-0000-4000-8000-000000000001'),
  5,
  'only the five valid synthetic payloads were retained during the contract test'
);

select * from finish();
rollback;
