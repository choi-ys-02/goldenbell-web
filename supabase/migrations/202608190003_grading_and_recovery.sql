alter table public.game_state
  add column grading_finalized boolean not null default false;

create table public.grading_batches (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  question_id uuid not null,
  finalized_by uuid not null references auth.users(id) on delete restrict,
  finalized_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references auth.users(id) on delete set null,
  constraint grading_batches_question_game_fk
    foreign key (question_id, game_id)
    references public.questions(id, game_id)
    on delete cascade,
  constraint grading_batches_undo_check
    check (undone_at is null or undone_by is not null)
);

create unique index grading_batches_active_question_idx
  on public.grading_batches(question_id)
  where undone_at is null;

create table public.grading_batch_items (
  batch_id uuid not null references public.grading_batches(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  answer_id uuid references public.answers(id) on delete set null,
  previous_status public.participant_status not null,
  next_status public.participant_status not null,
  primary key (batch_id, participant_id)
);

alter table public.grading_batches enable row level security;
alter table public.grading_batch_items enable row level security;
revoke all on table public.grading_batches, public.grading_batch_items
  from anon, authenticated;

-- 참가자/답안 상태는 여러 행을 한 번에 맞춰야 하므로 클라이언트의 직접 갱신을
-- 막고 아래 트랜잭션 함수만 사용한다.
revoke update on table public.participants from authenticated;
revoke update on table public.answers from authenticated;
revoke update (status) on table public.participants from authenticated;
revoke update (
  grading_status,
  grading_note,
  is_finalized,
  finalized_at,
  finalized_by
) on table public.answers from authenticated;

create or replace function public.normalize_short_answer(input text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(
    regexp_replace(
      btrim(input),
      '[[:space:][:punct:]…·ㆍ“”‘’]+',
      '',
      'g'
    )
  );
$$;

revoke all on function public.normalize_short_answer(text)
  from public, anon, authenticated;

create or replace function public.sync_participant_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('goldenbell.skip_count_refresh', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.refresh_game_counts(old.game_id);
    return old;
  end if;

  perform public.refresh_game_counts(new.game_id);

  if tg_op = 'UPDATE' and old.game_id is distinct from new.game_id then
    perform public.refresh_game_counts(old.game_id);
  end if;

  return new;
end;
$$;

create or replace function public.prepare_game_state_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.current_question_id is distinct from old.current_question_id then
    new.submissions_open = false;
    new.answer_revealed = false;
    new.timer_started_at = null;
    new.deadline_at = null;
    new.revealed_answer = null;
    new.grading_finalized = false;

    select count(*)::integer
      into new.submission_count
      from public.answers
      where game_id = new.game_id
        and question_id = new.current_question_id;
  end if;

  new.revision = old.revision + 1;
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.auto_grade_question(
  p_game_id uuid,
  p_question_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.game_state%rowtype;
  v_question public.questions%rowtype;
  v_answer_key public.question_answer_keys%rowtype;
  v_question_id uuid;
  v_total integer;
  v_correct integer;
  v_incorrect integer;
  v_pending integer;
begin
  if not public.is_game_admin(p_game_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select *
    into v_state
    from public.game_state
    where game_id = p_game_id
    for update;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  v_question_id := coalesce(p_question_id, v_state.current_question_id);
  if v_question_id is null
    or v_state.current_question_id is distinct from v_question_id then
    raise exception 'QUESTION_MISMATCH';
  end if;

  if v_state.submissions_open
    or v_state.phase not in ('closed', 'judging') then
    raise exception 'QUESTION_NOT_CLOSED';
  end if;

  if v_state.grading_finalized then
    raise exception 'GRADING_FINALIZED';
  end if;

  select *
    into v_question
    from public.questions
    where id = v_question_id
      and game_id = p_game_id;

  select *
    into v_answer_key
    from public.question_answer_keys
    where question_id = v_question_id;

  if v_answer_key.question_id is null then
    raise exception 'ANSWER_KEY_NOT_FOUND';
  end if;

  update public.answers as submitted
  set
    grading_status = case
      when v_question.type = 'short_answer' then
        case
          when jsonb_typeof(submitted.answer) = 'string'
            and exists (
              select 1
              from jsonb_array_elements_text(v_answer_key.correct_answers) as accepted(value)
              where public.normalize_short_answer(accepted.value)
                = public.normalize_short_answer(submitted.answer #>> '{}')
            )
          then 'correct'::public.grading_status
          else 'pending'::public.grading_status
        end
      when exists (
        select 1
        from jsonb_array_elements(v_answer_key.correct_answers) as accepted(value)
        where accepted.value = submitted.answer
      )
      then 'correct'::public.grading_status
      else 'incorrect'::public.grading_status
    end,
    grading_note = case
      when v_question.type = 'short_answer'
        and not exists (
          select 1
          from jsonb_array_elements_text(v_answer_key.correct_answers) as accepted(value)
          where public.normalize_short_answer(accepted.value)
            = public.normalize_short_answer(submitted.answer #>> '{}')
        )
      then '자동 판정보류: 인정 답안과 정확히 일치하지 않음'
      else '자동 채점'
    end
  where submitted.game_id = p_game_id
    and submitted.question_id = v_question_id
    and not submitted.is_finalized;

  update public.game_state
  set
    phase = 'judging',
    submissions_open = false,
    grading_finalized = false
  where game_id = p_game_id;

  select
    count(*)::integer,
    count(*) filter (where grading_status = 'correct')::integer,
    count(*) filter (where grading_status = 'incorrect')::integer,
    count(*) filter (where grading_status = 'pending')::integer
  into v_total, v_correct, v_incorrect, v_pending
  from public.answers
  where game_id = p_game_id
    and question_id = v_question_id;

  return jsonb_build_object(
    'total', v_total,
    'correct', v_correct,
    'incorrect', v_incorrect,
    'pending', v_pending
  );
end;
$$;

create or replace function public.set_answer_grade(
  p_game_id uuid,
  p_answer_id uuid,
  p_status public.grading_status,
  p_note text default null
)
returns public.answers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.game_state%rowtype;
  v_answer public.answers%rowtype;
begin
  if not public.is_game_admin(p_game_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  if p_status not in ('correct', 'incorrect', 'pending') then
    raise exception 'INVALID_GRADE';
  end if;

  select *
    into v_state
    from public.game_state
    where game_id = p_game_id
    for update;

  if v_state.phase not in ('closed', 'judging') then
    raise exception 'QUESTION_NOT_CLOSED';
  end if;

  select *
    into v_answer
    from public.answers
    where id = p_answer_id
      and game_id = p_game_id
      and question_id = v_state.current_question_id
    for update;

  if not found then
    raise exception 'ANSWER_NOT_FOUND';
  end if;

  if v_answer.is_finalized or v_state.grading_finalized then
    raise exception 'GRADING_FINALIZED';
  end if;

  update public.answers
  set
    grading_status = p_status,
    grading_note = nullif(btrim(p_note), '')
  where id = p_answer_id
  returning * into v_answer;

  update public.game_state
  set
    phase = 'judging',
    submissions_open = false
  where game_id = p_game_id;

  return v_answer;
end;
$$;

create or replace function public.finalize_question_grades(
  p_game_id uuid,
  p_question_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.game_state%rowtype;
  v_question_id uuid;
  v_batch_id uuid;
  v_correct integer;
  v_incorrect integer;
  v_pending integer;
  v_missing integer;
begin
  if not public.is_game_admin(p_game_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select *
    into v_state
    from public.game_state
    where game_id = p_game_id
    for update;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  v_question_id := coalesce(p_question_id, v_state.current_question_id);
  if v_question_id is null
    or v_state.current_question_id is distinct from v_question_id then
    raise exception 'QUESTION_MISMATCH';
  end if;

  if v_state.phase <> 'judging' or v_state.submissions_open then
    raise exception 'GRADING_NOT_READY';
  end if;

  if v_state.grading_finalized
    or exists (
      select 1
      from public.grading_batches
      where question_id = v_question_id
        and undone_at is null
    ) then
    raise exception 'GRADING_FINALIZED';
  end if;

  if exists (
    select 1
    from public.answers
    where game_id = p_game_id
      and question_id = v_question_id
      and grading_status = 'ungraded'
  ) then
    raise exception 'GRADING_INCOMPLETE';
  end if;

  insert into public.grading_batches (
    game_id,
    question_id,
    finalized_by
  )
  values (
    p_game_id,
    v_question_id,
    (select auth.uid())
  )
  returning id into v_batch_id;

  insert into public.grading_batch_items (
    batch_id,
    participant_id,
    answer_id,
    previous_status,
    next_status
  )
  select
    v_batch_id,
    participant.id,
    submitted.id,
    participant.status,
    case
      when submitted.id is null then 'eliminated'::public.participant_status
      when submitted.grading_status = 'correct' then participant.status
      when submitted.grading_status = 'incorrect' then 'eliminated'::public.participant_status
      else 'pending'::public.participant_status
    end
  from public.participants as participant
  left join public.answers as submitted
    on submitted.participant_id = participant.id
    and submitted.question_id = v_question_id
  where participant.game_id = p_game_id
    and participant.status in ('active', 'revived');

  perform set_config('goldenbell.skip_count_refresh', 'on', true);

  update public.participants as participant
  set status = item.next_status
  from public.grading_batch_items as item
  where item.batch_id = v_batch_id
    and item.participant_id = participant.id;

  perform set_config('goldenbell.skip_count_refresh', 'off', true);
  perform public.refresh_game_counts(p_game_id);

  update public.answers as submitted
  set
    is_finalized = true,
    finalized_at = clock_timestamp(),
    finalized_by = (select auth.uid())
  from public.grading_batch_items as item
  where item.batch_id = v_batch_id
    and item.answer_id = submitted.id;

  update public.game_state
  set
    phase = 'judging',
    submissions_open = false,
    grading_finalized = true
  where game_id = p_game_id;

  select
    count(*) filter (where next_status in ('active', 'revived'))::integer,
    count(*) filter (where next_status = 'eliminated' and answer_id is not null)::integer,
    count(*) filter (where next_status = 'pending')::integer,
    count(*) filter (where answer_id is null)::integer
  into v_correct, v_incorrect, v_pending, v_missing
  from public.grading_batch_items
  where batch_id = v_batch_id;

  return jsonb_build_object(
    'batchId', v_batch_id,
    'correct', v_correct,
    'incorrect', v_incorrect,
    'pending', v_pending,
    'missing', v_missing
  );
end;
$$;

create or replace function public.undo_finalize_question_grades(
  p_game_id uuid,
  p_question_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.game_state%rowtype;
  v_question_id uuid;
  v_batch public.grading_batches%rowtype;
  v_restored integer;
begin
  if not public.is_game_admin(p_game_id) then
    raise exception 'ADMIN_REQUIRED';
  end if;

  select *
    into v_state
    from public.game_state
    where game_id = p_game_id
    for update;

  if not found then
    raise exception 'GAME_NOT_FOUND';
  end if;

  v_question_id := coalesce(p_question_id, v_state.current_question_id);
  if v_question_id is null
    or v_state.current_question_id is distinct from v_question_id then
    raise exception 'QUESTION_MISMATCH';
  end if;

  if v_state.phase not in ('judging', 'answer') then
    raise exception 'GRADING_NOT_READY';
  end if;

  select *
    into v_batch
    from public.grading_batches
    where game_id = p_game_id
      and question_id = v_question_id
      and undone_at is null
    order by finalized_at desc
    limit 1
    for update;

  if not found then
    raise exception 'NOTHING_TO_UNDO';
  end if;

  if v_state.phase = 'answer' then
    raise exception 'ANSWER_ALREADY_REVEALED';
  end if;

  perform set_config('goldenbell.skip_count_refresh', 'on', true);

  update public.participants as participant
  set status = item.previous_status
  from public.grading_batch_items as item
  where item.batch_id = v_batch.id
    and item.participant_id = participant.id;

  get diagnostics v_restored = row_count;

  perform set_config('goldenbell.skip_count_refresh', 'off', true);
  perform public.refresh_game_counts(p_game_id);

  update public.answers as submitted
  set
    is_finalized = false,
    finalized_at = null,
    finalized_by = null
  from public.grading_batch_items as item
  where item.batch_id = v_batch.id
    and item.answer_id = submitted.id;

  update public.grading_batches
  set
    undone_at = clock_timestamp(),
    undone_by = (select auth.uid())
  where id = v_batch.id;

  update public.game_state
  set
    phase = 'judging',
    submissions_open = false,
    grading_finalized = false
  where game_id = p_game_id;

  return jsonb_build_object('restored', v_restored);
end;
$$;

revoke all on function public.auto_grade_question(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.set_answer_grade(uuid, uuid, public.grading_status, text)
  from public, anon, authenticated;
revoke all on function public.finalize_question_grades(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.undo_finalize_question_grades(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.auto_grade_question(uuid, uuid) to authenticated;
grant execute on function public.set_answer_grade(uuid, uuid, public.grading_status, text) to authenticated;
grant execute on function public.finalize_question_grades(uuid, uuid) to authenticated;
grant execute on function public.undo_finalize_question_grades(uuid, uuid) to authenticated;

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
      revealed_answer = null,
      grading_finalized = false
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
      revealed_answer = null,
      grading_finalized = false
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
      phase = 'closed',
      grading_finalized = false
    where game_id = p_game_id;

  elsif p_action = 'reveal_answer' then
    if v_before.current_question_id is null
      or v_before.phase <> 'judging' then
      raise exception 'QUESTION_NOT_CLOSED';
    end if;

    if not v_before.grading_finalized then
      raise exception 'GRADING_NOT_FINALIZED';
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
    if v_before.phase <> 'answer' then
      raise exception 'ANSWER_NOT_REVEALED';
    end if;

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
        revealed_answer = null,
        grading_finalized = false
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
        revealed_answer = null,
        grading_finalized = false
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
    if v_before.phase = 'judging' then
      raise exception 'USE_GRADING_UNDO';
    end if;

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
      ),
      grading_finalized = coalesce(
        (v_log.before_state ->> 'grading_finalized')::boolean,
        false
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
