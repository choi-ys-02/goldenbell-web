create or replace function public.sync_submission_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('goldenbell.skip_submission_refresh', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.refresh_submission_count(old.game_id);
    return old;
  end if;

  perform public.refresh_submission_count(new.game_id);
  return new;
end;
$$;

create or replace function public.reset_game_for_testing(
  p_game_id uuid,
  p_mode text default 'gameplay'
)
returns public.game_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.game_state%rowtype;
  v_after public.game_state%rowtype;
  v_first_question_id uuid;
  v_mode text := lower(coalesce(btrim(p_mode), ''));
  v_admin_id uuid := (select auth.uid());
begin
  if not public.is_game_admin(p_game_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if v_mode not in ('gameplay', 'full') then
    raise exception 'INVALID_RESET_MODE';
  end if;

  select *
    into v_before
    from public.game_state
    where game_id = p_game_id
    for update;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  select id
    into v_first_question_id
    from public.questions
    where game_id = p_game_id
    order by question_order
    limit 1;

  perform set_config('goldenbell.skip_count_refresh', 'on', true);
  perform set_config('goldenbell.skip_submission_refresh', 'on', true);

  -- 판정 스냅샷을 먼저 제거해야 답안/참가자 cascade와 무관하게
  -- 활성 판정 unique index까지 깨끗하게 초기화된다.
  delete from public.grading_batches
  where game_id = p_game_id;

  if v_mode = 'full' then
    delete from public.participants
    where game_id = p_game_id;
  else
    delete from public.answers
    where game_id = p_game_id;

    update public.participants
    set status = 'active'
    where game_id = p_game_id
      and status <> 'active';
  end if;

  -- 초기화 전 진행 기록으로 Undo하면 삭제된 답안과 판정은 복구되지 않으므로
  -- 오래된 로그를 제거하고, Undo 대상이 아닌 감사용 초기화 기록만 남긴다.
  delete from public.game_action_log
  where game_id = p_game_id;

  update public.games
  set join_open = true
  where id = p_game_id;

  update public.game_state
  set
    current_question_id = v_first_question_id,
    phase = 'lobby',
    submissions_open = false,
    answer_revealed = false,
    timer_started_at = null,
    deadline_at = null,
    revealed_answer = null,
    grading_finalized = false,
    participant_count = (
      select count(*)::integer
      from public.participants
      where game_id = p_game_id
    ),
    active_count = (
      select count(*)::integer
      from public.participants
      where game_id = p_game_id
        and status in ('active', 'revived')
    ),
    submission_count = 0
  where game_id = p_game_id
  returning * into v_after;

  perform set_config('goldenbell.skip_count_refresh', 'off', true);
  perform set_config('goldenbell.skip_submission_refresh', 'off', true);

  insert into public.game_action_log (
    game_id,
    action_type,
    before_state,
    after_state,
    performed_by,
    undone_at,
    undone_by
  )
  values (
    p_game_id,
    'reset_' || v_mode,
    to_jsonb(v_before),
    to_jsonb(v_after),
    v_admin_id,
    clock_timestamp(),
    v_admin_id
  );

  return v_after;
end;
$$;

revoke all on function public.reset_game_for_testing(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reset_game_for_testing(uuid, text)
  to authenticated;
