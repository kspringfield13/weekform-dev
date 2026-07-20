-- Keep exactly one approval-pending Web request per review-safe block revision.
-- Preserve older duplicates as rejected upgrade history rather than deleting them.
with ranked_pending as (
  select
    user_id,
    command_id,
    row_number() over (
      partition by user_id, block_id, week_id, expected_revision
      order by created_at desc, command_id desc
    ) as pending_rank
  from public.review_commands
  where status = 'pending'
)
update public.review_commands as command
set
  status = 'rejected',
  decided_at = now(),
  decision_reason = 'Rejected by duplicate-safety upgrade; a newer pending request was retained'
from ranked_pending
where command.user_id = ranked_pending.user_id
  and command.command_id = ranked_pending.command_id
  and ranked_pending.pending_rank > 1;

create unique index if not exists review_commands_one_pending_block_revision_idx
  on public.review_commands(user_id, week_id, block_id, expected_revision)
  where status = 'pending';

create or replace function public.queue_review_command(
  p_block_id text,
  p_week_id text,
  p_expected_revision text,
  p_action text,
  p_patch jsonb default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  result uuid;
  existing_action text;
  existing_patch jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if p_block_id is null or btrim(p_block_id) <> p_block_id
    or char_length(p_block_id) not between 1 and 160
  then raise exception 'invalid block id'; end if;
  if p_week_id is null or p_week_id !~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$'
  then raise exception 'invalid week id'; end if;
  if p_expected_revision is null or p_expected_revision !~ '^[0-9a-f]{16}$'
  then raise exception 'invalid expected revision'; end if;
  if p_action not in ('confirm','exclude','relabel') then raise exception 'invalid review action'; end if;
  if (p_action = 'relabel') <> coalesce(jsonb_typeof(p_patch) = 'object', false)
  then raise exception 'invalid review patch'; end if;
  if p_action = 'relabel' and (
    (select bool_or(key not in ('category','mode','plannedStatus','blockerFlag')) from jsonb_object_keys(p_patch) key)
    or p_patch = '{}'::jsonb
    or (p_patch ? 'category' and not coalesce(p_patch ->> 'category' in (
      'Planned analysis / project work','Ad hoc stakeholder requests','Recurring reporting',
      'Dashboard development / edits','SQL / data modeling / query work','QA / data validation',
      'Debugging / issue investigation','Documentation / requirement clarification',
      'Meetings / stakeholder syncs','Admin / coordination','Blocked / waiting / dependency delay'
    ), false))
    or (p_patch ? 'mode' and not coalesce(p_patch ->> 'mode' in ('Deep work','Reactive','Collaborative','Fragmented','Blocked'), false))
    or (p_patch ? 'plannedStatus' and not coalesce(p_patch ->> 'plannedStatus' in ('planned','unplanned','fixed','blocked'), false))
    or (p_patch ? 'blockerFlag' and not coalesce(jsonb_typeof(p_patch -> 'blockerFlag') = 'boolean', false))
  ) then raise exception 'invalid review patch'; end if;
  if not exists (
    select 1 from public.personal_workload_replicas r,
      lateral jsonb_array_elements(r.payload -> 'blocks') block
    where r.user_id = actor and r.week_id = p_week_id
      and block ->> 'blockId' = p_block_id and block ->> 'revision' = p_expected_revision
  ) then raise exception 'replica revision conflict'; end if;

  loop
    insert into public.review_commands(
      user_id, block_id, week_id, expected_revision, action, patch, created_by
    ) values (actor, p_block_id, p_week_id, p_expected_revision, p_action, p_patch, actor)
    on conflict (user_id, week_id, block_id, expected_revision) where status = 'pending'
      do nothing
    returning command_id into result;
    if result is not null then return result; end if;

    select command_id, action, patch
      into result, existing_action, existing_patch
    from public.review_commands
    where user_id = actor and week_id = p_week_id and block_id = p_block_id
      and expected_revision = p_expected_revision and status = 'pending'
    for update;
    -- The winner may have terminalized after our conflict. Retry the insert.
    if result is null then continue; end if;
    if existing_action = p_action and existing_patch is not distinct from p_patch then
      return result;
    end if;
    raise exception 'another review request is already pending for this block revision';
  end loop;
end;
$$;

revoke all on function public.queue_review_command(text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.queue_review_command(text,text,text,text,jsonb) to authenticated;
