-- Weekform A6: per-team share policies (docs/EXPANSION_ROADMAP.md §A6).
--
-- Adds a single jsonb column, `teams.share_policy`, holding the team's
-- narrowing-only share cap:
--
--   { "version": 1,
--     "maxShareLevel": "summary" | "categories" | "projects",
--     "acceptedMetrics": null | { "<metricKey>": boolean, ... } }
--
-- NULL means the team has no policy: each member's own consent applies
-- unchanged. Semantics are enforced CLIENT-SIDE as an intersection with the
-- member's consent (`applyTeamSharePolicy` in the desktop `cloudPolicy.ts`,
-- mirrored by `apps/web/lib/teamPolicy.ts`): the policy can only NARROW what a
-- member consented to, never widen it, and malformed/unknown content degrades
-- toward the narrowest interpretation on read. The database therefore only
-- guards shape and size here — a hostile or corrupt value cannot widen
-- anything because no client trusts it beyond the defensive parser.
--
-- Authorization is unchanged and already sufficient:
--   * teams_select_members  — every active member can read the policy;
--   * teams_update_managers — only owners/managers can write it (RLS UPDATE
--     policy from 202607190001_team_cloud_v1.sql).
--
-- Same honesty rule as 202607190001: this file is committed for review;
-- repository presence is not evidence that it has been applied to any local or
-- hosted Supabase project.

begin;

alter table public.teams
  add column if not exists share_policy jsonb;

alter table public.teams
  add constraint teams_share_policy_shape check (
    share_policy is null
    or (
      jsonb_typeof(share_policy) = 'object'
      and pg_column_size(share_policy) <= 2048
    )
  );

comment on column public.teams.share_policy is
  'Narrowing-only team share cap (TeamSharePolicyV1). NULL = no policy. Applied client-side as member consent INTERSECT policy; it can never widen a member''s consent.';

commit;
