-- Queue an atomic, bounded set of confirm requests from the authenticated
-- user's current review-safe replica. The caller supplies identity triples
-- only; confirm semantics, ownership, lifecycle state, and chronology remain
-- server-derived.
create or replace function public.queue_review_confirm_batch(
  p_targets jsonb
) returns uuid[]
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := auth.uid();
  item jsonb;
  target_block_id text;
  target_week_id text;
  target_revision text;
  target_key text;
  seen_targets text[] := array[]::text[];
  command_ids uuid[] := array[]::uuid[];
  result uuid;
  existing_action text;
  existing_patch jsonb;
  replica_conflict boolean;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if p_targets is null or jsonb_typeof(p_targets) <> 'array'
    or jsonb_array_length(p_targets) not between 1 and 50
  then raise exception 'invalid confirm batch'; end if;

  -- Validate every target before entering the write loop. Any later exception
  -- also rolls the function transaction back, so partial batches cannot appear.
  for item in select value from jsonb_array_elements(p_targets)
  loop
    if jsonb_typeof(item) <> 'object' then raise exception 'invalid confirm target'; end if;
    if (select count(*) from jsonb_object_keys(item)) <> 3
      or not (item ?& array['blockId','weekId','expectedRevision'])
    then raise exception 'invalid confirm target'; end if;
    target_block_id := item ->> 'blockId';
    target_week_id := item ->> 'weekId';
    target_revision := item ->> 'expectedRevision';
    if target_block_id is null or btrim(target_block_id) <> target_block_id
      or char_length(target_block_id) not between 1 and 160
      or target_week_id is null or target_week_id !~ '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$'
      or target_revision is null or target_revision !~ '^[0-9a-f]{16}$'
    then raise exception 'invalid confirm target'; end if;
    target_key := target_block_id || chr(31) || target_week_id || chr(31) || target_revision;
    if target_key = any(seen_targets) then raise exception 'duplicate confirm target'; end if;
    seen_targets := array_append(seen_targets, target_key);
  end loop;

  select count(target.value) <> jsonb_array_length(p_targets) into replica_conflict
  from jsonb_array_elements(p_targets) as target(value)
  join public.personal_workload_replicas replica
    on replica.user_id = actor and replica.week_id = target.value ->> 'weekId'
  cross join lateral jsonb_array_elements(replica.payload -> 'blocks') block
  where replica.payload ->> 'weekId' = target.value ->> 'weekId'
    and block ->> 'blockId' = target.value ->> 'blockId'
    and block ->> 'weekId' = target.value ->> 'weekId'
    and block ->> 'revision' = target.value ->> 'expectedRevision'
    and coalesce((block ->> 'userVerified')::boolean, false) = false;
  if replica_conflict then raise exception 'replica revision conflict'; end if;

  for item in select value from jsonb_array_elements(p_targets)
  loop
    target_block_id := item ->> 'blockId';
    target_week_id := item ->> 'weekId';
    target_revision := item ->> 'expectedRevision';
    perform pg_advisory_xact_lock(hashtextextended(
      actor::text || chr(31) || target_week_id || chr(31) || target_block_id || chr(31) || target_revision,
      0
    ));

    result := null;
    existing_action := null;
    existing_patch := null;
    select command.command_id, command.action, command.patch
      into result, existing_action, existing_patch
    from public.review_commands as command
    where command.user_id = actor and command.week_id = target_week_id
      and command.block_id = target_block_id
      and command.expected_revision = target_revision
      and command.status <> 'rejected'
    order by command.created_at desc, command.command_id desc
    limit 1
    for update;

    if result is not null then
      if existing_action = 'confirm' and existing_patch is null then
        command_ids := array_append(command_ids, result);
        continue;
      end if;
      raise exception 'another review request is already pending for this block revision';
    end if;

    insert into public.review_commands(
      user_id, block_id, week_id, expected_revision, action, patch,
      status, created_by, created_at, decided_at, decision_reason
    ) values (
      actor, target_block_id, target_week_id, target_revision, 'confirm', null,
      'pending', actor, now(), null, null
    )
    on conflict (user_id, week_id, block_id, expected_revision) where status = 'pending'
      do nothing
    returning command_id into result;

    if result is null then
      select command.command_id, command.action, command.patch
        into result, existing_action, existing_patch
      from public.review_commands as command
      where command.user_id = actor and command.week_id = target_week_id
        and command.block_id = target_block_id
        and command.expected_revision = target_revision
        and command.status = 'pending'
      for update;
      if result is null or existing_action <> 'confirm' or existing_patch is not null then
        raise exception 'another review request is already pending for this block revision';
      end if;
    end if;
    command_ids := array_append(command_ids, result);
  end loop;

  return command_ids;
end;
$$;

revoke all on function public.queue_review_confirm_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.queue_review_confirm_batch(jsonb)
  to authenticated;
