create or replace function public.submit_answer(
  p_game_slug text,
  p_participant_id uuid,
  p_session_token_hash text,
  p_question_id uuid,
  p_answer jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_state public.game_state%rowtype;
  v_participant_status public.participant_status;
  v_question public.questions%rowtype;
  v_answer public.answers%rowtype;
  v_choice_index integer;
  v_duplicate boolean := false;
begin
  select id
    into v_game_id
    from public.games
    where slug = p_game_slug
      and is_public;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  select *
    into v_state
    from public.game_state
    where game_id = v_game_id
    for update;

  select status
    into v_participant_status
    from public.participants
    where id = p_participant_id
      and game_id = v_game_id
      and session_token_hash = p_session_token_hash;

  if not found then
    raise exception 'INVALID_PARTICIPANT';
  end if;

  if v_participant_status not in ('active', 'revived') then
    raise exception 'NOT_ACTIVE';
  end if;

  if v_state.current_question_id is distinct from p_question_id then
    raise exception 'QUESTION_MISMATCH';
  end if;

  if not v_state.submissions_open
    or v_state.phase <> 'question'
    or v_state.deadline_at is null
    or clock_timestamp() > v_state.deadline_at then
    raise exception 'ANSWER_CLOSED';
  end if;

  select *
    into v_question
    from public.questions
    where id = p_question_id
      and game_id = v_game_id;

  if not found then
    raise exception 'QUESTION_MISMATCH';
  end if;

  if v_question.type = 'ox' then
    if jsonb_typeof(p_answer) <> 'string'
      or p_answer #>> '{}' not in ('O', 'X') then
      raise exception 'INVALID_ANSWER';
    end if;
  elsif v_question.type = 'multiple_choice' then
    if jsonb_typeof(p_answer) <> 'number'
      or p_answer #>> '{}' !~ '^\d+$' then
      raise exception 'INVALID_ANSWER';
    end if;

    v_choice_index := (p_answer #>> '{}')::integer;
    if v_choice_index < 0
      or v_choice_index >= jsonb_array_length(v_question.choices) then
      raise exception 'INVALID_ANSWER';
    end if;
  elsif v_question.type = 'short_answer' then
    if jsonb_typeof(p_answer) <> 'string'
      or char_length(trim(p_answer #>> '{}')) not between 1 and 500 then
      raise exception 'INVALID_ANSWER';
    end if;
  else
    raise exception 'INVALID_ANSWER';
  end if;

  insert into public.answers (
    game_id,
    question_id,
    participant_id,
    answer
  )
  values (
    v_game_id,
    p_question_id,
    p_participant_id,
    p_answer
  )
  on conflict (question_id, participant_id) do nothing
  returning * into v_answer;

  if v_answer.id is null then
    v_duplicate := true;
    select *
      into v_answer
      from public.answers
      where question_id = p_question_id
        and participant_id = p_participant_id;
  end if;

  return jsonb_build_object(
    'id', v_answer.id,
    'answer', v_answer.answer,
    'submittedAt', v_answer.submitted_at,
    'gradingStatus', v_answer.grading_status,
    'isDuplicate', v_duplicate
  );
end;
$$;

revoke all on function public.submit_answer(text, uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_answer(text, uuid, text, uuid, jsonb)
  to service_role;

-- 상태 전이는 이 함수만 통과시켜 여러 필드를 한 트랜잭션으로 바꾸고
-- 모든 변경 전후를 Undo 로그에 남긴다.
revoke update on table public.game_state from authenticated;

create or replace function public.admin_control_game(
  p_game_id uuid,
  p_action text,
  p_question_id uuid default null
)
returns public.game_state
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.game_state%rowtype;
  v_after public.game_state%rowtype;
  v_question public.questions%rowtype;
  v_next_question_id uuid;
  v_answer_key jsonb;
  v_log public.game_action_log%rowtype;
begin
  if not public.is_game_admin(p_game_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select *
    into v_before
    from public.game_state
    where game_id = p_game_id
    for update;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  if p_action = 'select_question' then
    select *
      into v_question
      from public.questions
      where id = p_question_id
        and game_id = p_game_id;

    if not found then
      raise exception 'QUESTION_NOT_FOUND';
    end if;

    update public.game_state
    set
      current_question_id = p_question_id,
      phase = 'lobby',
      submissions_open = false,
      answer_revealed = false,
      timer_started_at = null,
      deadline_at = null,
      revealed_answer = null
    where game_id = p_game_id;

  elsif p_action = 'publish_question' then
    if v_before.current_question_id is null then
      raise exception 'QUESTION_NOT_SELECTED';
    end if;

    update public.game_state
    set
      phase = 'question',
      submissions_open = false,
      answer_revealed = false,
      timer_started_at = null,
      deadline_at = null,
      revealed_answer = null
    where game_id = p_game_id;

  elsif p_action = 'start_timer' then
    if v_before.current_question_id is null or v_before.phase <> 'question' then
      raise exception 'QUESTION_NOT_PUBLISHED';
    end if;

    if v_before.timer_started_at is not null then
      raise exception 'TIMER_ALREADY_STARTED';
    end if;

    select *
      into v_question
      from public.questions
      where id = v_before.current_question_id
        and game_id = p_game_id;

    update public.game_state
    set
      submissions_open = true,
      timer_started_at = clock_timestamp(),
      deadline_at = clock_timestamp() + make_interval(secs => v_question.time_limit_seconds)
    where game_id = p_game_id;

  elsif p_action = 'close_submissions' then
    if v_before.current_question_id is null or v_before.phase <> 'question' then
      raise exception 'QUESTION_NOT_ACTIVE';
    end if;

    update public.game_state
    set
      submissions_open = false,
      phase = 'closed'
    where game_id = p_game_id;

  elsif p_action = 'reveal_answer' then
    if v_before.current_question_id is null
      or v_before.phase not in ('closed', 'judging') then
      raise exception 'QUESTION_NOT_CLOSED';
    end if;

    select correct_answers
      into v_answer_key
      from public.question_answer_keys
      where question_id = v_before.current_question_id;

    if v_answer_key is null then
      raise exception 'ANSWER_KEY_NOT_FOUND';
    end if;

    update public.game_state
    set
      submissions_open = false,
      phase = 'answer',
      answer_revealed = true,
      revealed_answer = v_answer_key
    where game_id = p_game_id;

  elsif p_action = 'next_question' then
    select next_question.id
      into v_next_question_id
      from public.questions as next_question
      where next_question.game_id = p_game_id
        and next_question.question_order > coalesce(
          (
            select current_question.question_order
            from public.questions as current_question
            where current_question.id = v_before.current_question_id
          ),
          0
        )
      order by next_question.question_order
      limit 1;

    if v_next_question_id is null then
      update public.game_state
      set
        phase = 'finished',
        submissions_open = false,
        answer_revealed = false,
        revealed_answer = null
      where game_id = p_game_id;
    else
      update public.game_state
      set
        current_question_id = v_next_question_id,
        phase = 'lobby',
        submissions_open = false,
        answer_revealed = false,
        timer_started_at = null,
        deadline_at = null,
        revealed_answer = null
      where game_id = p_game_id;
    end if;

  elsif p_action = 'finish_game' then
    update public.game_state
    set
      phase = 'finished',
      submissions_open = false,
      answer_revealed = false,
      revealed_answer = null
    where game_id = p_game_id;

  elsif p_action = 'undo' then
    select *
      into v_log
      from public.game_action_log
      where game_id = p_game_id
        and undone_at is null
      order by created_at desc, id desc
      limit 1
      for update;

    if not found then
      raise exception 'NOTHING_TO_UNDO';
    end if;

    update public.game_state
    set current_question_id = nullif(
      v_log.before_state ->> 'current_question_id',
      ''
    )::uuid
    where game_id = p_game_id;

    update public.game_state
    set
      phase = (v_log.before_state ->> 'phase')::public.game_phase,
      submissions_open = (v_log.before_state ->> 'submissions_open')::boolean,
      answer_revealed = (v_log.before_state ->> 'answer_revealed')::boolean,
      timer_started_at = nullif(
        v_log.before_state ->> 'timer_started_at',
        ''
      )::timestamptz,
      deadline_at = nullif(
        v_log.before_state ->> 'deadline_at',
        ''
      )::timestamptz,
      revealed_answer = nullif(
        v_log.before_state -> 'revealed_answer',
        'null'::jsonb
      )
    where game_id = p_game_id;

    update public.game_action_log
    set
      undone_at = clock_timestamp(),
      undone_by = (select auth.uid())
    where id = v_log.id;

    select * into v_after
      from public.game_state
      where game_id = p_game_id;
    return v_after;

  else
    raise exception 'INVALID_ACTION';
  end if;

  select * into v_after
    from public.game_state
    where game_id = p_game_id;

  insert into public.game_action_log (
    game_id,
    action_type,
    before_state,
    after_state,
    performed_by
  )
  values (
    p_game_id,
    p_action,
    to_jsonb(v_before),
    to_jsonb(v_after),
    (select auth.uid())
  );

  return v_after;
end;
$$;

revoke all on function public.admin_control_game(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_control_game(uuid, text, uuid)
  to authenticated;
