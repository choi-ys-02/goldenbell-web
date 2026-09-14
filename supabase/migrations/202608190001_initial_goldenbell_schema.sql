create type public.game_phase as enum (
  'lobby',
  'question',
  'closed',
  'judging',
  'answer',
  'finished'
);

create type public.question_type as enum (
  'ox',
  'multiple_choice',
  'short_answer'
);

create type public.participant_status as enum (
  'active',
  'eliminated',
  'pending',
  'revived'
);

create type public.grading_status as enum (
  'ungraded',
  'correct',
  'incorrect',
  'pending'
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  is_public boolean not null default false,
  join_open boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_slug_format_check
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint games_title_length_check
    check (char_length(trim(title)) between 1 and 100)
);

create table public.game_admins (
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  question_order integer not null,
  type public.question_type not null,
  question_text text not null,
  choices jsonb,
  time_limit_seconds integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_id_game_unique unique (id, game_id),
  constraint questions_game_order_unique unique (game_id, question_order),
  constraint questions_order_positive_check check (question_order > 0),
  constraint questions_text_length_check
    check (char_length(trim(question_text)) between 1 and 2000),
  constraint questions_time_limit_check
    check (time_limit_seconds between 5 and 300),
  constraint questions_choices_check check (
    (
      type = 'multiple_choice'
      and choices is not null
      and jsonb_typeof(choices) = 'array'
      and jsonb_array_length(choices) between 2 and 5
    )
    or (
      type in ('ox', 'short_answer')
      and choices is null
    )
  )
);

-- 정답은 공개 문제 행과 분리한다. 참가자용 publishable key에는 이 테이블의
-- SELECT 권한을 부여하지 않는다.
create table public.question_answer_keys (
  question_id uuid primary key references public.questions(id) on delete cascade,
  correct_answers jsonb not null,
  grading_note text,
  updated_at timestamptz not null default now(),
  constraint question_answer_keys_array_check check (
    jsonb_typeof(correct_answers) = 'array'
    and jsonb_array_length(correct_answers) > 0
  )
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  name text not null,
  status public.participant_status not null default 'active',
  session_token_hash text not null unique,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participants_id_game_unique unique (id, game_id),
  constraint participants_name_length_check
    check (char_length(trim(name)) between 1 and 40),
  constraint participants_token_hash_length_check
    check (char_length(session_token_hash) = 64)
);

create table public.game_state (
  game_id uuid primary key references public.games(id) on delete cascade,
  current_question_id uuid,
  phase public.game_phase not null default 'lobby',
  submissions_open boolean not null default false,
  answer_revealed boolean not null default false,
  timer_started_at timestamptz,
  deadline_at timestamptz,
  revealed_answer jsonb,
  participant_count integer not null default 0,
  active_count integer not null default 0,
  submission_count integer not null default 0,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint game_state_current_question_game_fk
    foreign key (current_question_id, game_id)
    references public.questions(id, game_id),
  constraint game_state_counts_nonnegative_check check (
    participant_count >= 0
    and active_count >= 0
    and submission_count >= 0
  ),
  constraint game_state_active_count_check
    check (active_count <= participant_count),
  constraint game_state_open_requires_question_check check (
    not submissions_open
    or (phase = 'question' and current_question_id is not null)
  ),
  constraint game_state_reveal_consistency_check check (
    answer_revealed = (revealed_answer is not null)
    and (
      not answer_revealed
      or (
      phase = 'answer'
      and current_question_id is not null
      )
    )
  ),
  constraint game_state_timer_order_check check (
    deadline_at is null
    or (timer_started_at is not null and deadline_at > timer_started_at)
  )
);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  question_id uuid not null,
  participant_id uuid not null,
  answer jsonb not null,
  submitted_at timestamptz not null default now(),
  grading_status public.grading_status not null default 'ungraded',
  grading_note text,
  is_finalized boolean not null default false,
  finalized_at timestamptz,
  finalized_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint answers_question_game_fk
    foreign key (question_id, game_id)
    references public.questions(id, game_id)
    on delete cascade,
  constraint answers_participant_game_fk
    foreign key (participant_id, game_id)
    references public.participants(id, game_id)
    on delete cascade,
  constraint answers_participant_question_unique
    unique (question_id, participant_id),
  constraint answers_payload_size_check
    check (octet_length(answer::text) between 1 and 4000),
  constraint answers_finalization_check check (
    is_finalized = (finalized_at is not null)
    and (not is_finalized or grading_status <> 'ungraded')
  )
);

-- 진행자 작업의 전후 상태를 저장해 이후 Undo 기능의 기반으로 사용한다.
create table public.game_action_log (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  action_type text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  performed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references auth.users(id) on delete set null,
  constraint game_action_log_type_length_check
    check (char_length(trim(action_type)) between 1 and 80),
  constraint game_action_log_undo_check
    check (undone_at is null or undone_by is not null)
);

create index questions_game_order_idx
  on public.questions(game_id, question_order);
create index participants_game_status_idx
  on public.participants(game_id, status);
create index answers_game_question_idx
  on public.answers(game_id, question_id);
create index answers_question_grading_idx
  on public.answers(question_id, grading_status, is_finalized);
create index game_action_log_game_created_idx
  on public.game_action_log(game_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger games_touch_updated_at
before update on public.games
for each row execute function public.touch_updated_at();

create trigger questions_touch_updated_at
before update on public.questions
for each row execute function public.touch_updated_at();

create trigger answer_keys_touch_updated_at
before update on public.question_answer_keys
for each row execute function public.touch_updated_at();

create trigger participants_touch_updated_at
before update on public.participants
for each row execute function public.touch_updated_at();

create trigger answers_touch_updated_at
before update on public.answers
for each row execute function public.touch_updated_at();

create or replace function public.initialize_game_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.game_state (game_id) values (new.id);
  return new;
end;
$$;

create trigger games_initialize_state
after insert on public.games
for each row execute function public.initialize_game_state();

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

create trigger game_state_prepare_update
before update on public.game_state
for each row execute function public.prepare_game_state_update();

create or replace function public.refresh_game_counts(target_game_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.game_state
  set
    participant_count = (
      select count(*)::integer
      from public.participants
      where game_id = target_game_id
    ),
    active_count = (
      select count(*)::integer
      from public.participants
      where game_id = target_game_id
        and status in ('active', 'revived')
    )
  where game_id = target_game_id;
$$;

create or replace function public.sync_participant_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger participants_sync_counts
after insert or delete or update of game_id, status on public.participants
for each row execute function public.sync_participant_counts();

create or replace function public.refresh_submission_count(target_game_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.game_state as state
  set submission_count = (
    select count(*)::integer
    from public.answers
    where game_id = target_game_id
      and question_id = state.current_question_id
  )
  where state.game_id = target_game_id;
$$;

create or replace function public.sync_submission_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_submission_count(old.game_id);
    return old;
  end if;

  perform public.refresh_submission_count(new.game_id);
  return new;
end;
$$;

create trigger answers_sync_submission_count
after insert or delete on public.answers
for each row execute function public.sync_submission_count();

create or replace function public.is_game_admin(target_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.game_admins
    where game_id = target_game_id
      and user_id = (select auth.uid())
  );
$$;

revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.initialize_game_state() from public, anon, authenticated;
revoke all on function public.prepare_game_state_update() from public, anon, authenticated;
revoke all on function public.refresh_game_counts(uuid) from public, anon, authenticated;
revoke all on function public.sync_participant_counts() from public, anon, authenticated;
revoke all on function public.refresh_submission_count(uuid) from public, anon, authenticated;
revoke all on function public.sync_submission_count() from public, anon, authenticated;
revoke all on function public.is_game_admin(uuid) from public, anon, authenticated;
grant execute on function public.is_game_admin(uuid) to anon, authenticated;

alter table public.games enable row level security;
alter table public.game_admins enable row level security;
alter table public.questions enable row level security;
alter table public.question_answer_keys enable row level security;
alter table public.participants enable row level security;
alter table public.game_state enable row level security;
alter table public.answers enable row level security;
alter table public.game_action_log enable row level security;

revoke all on table public.games from anon, authenticated;
revoke all on table public.game_admins from anon, authenticated;
revoke all on table public.questions from anon, authenticated;
revoke all on table public.question_answer_keys from anon, authenticated;
revoke all on table public.participants from anon, authenticated;
revoke all on table public.game_state from anon, authenticated;
revoke all on table public.answers from anon, authenticated;
revoke all on table public.game_action_log from anon, authenticated;

grant select on table public.games, public.questions, public.game_state
  to anon, authenticated;
grant select on table public.game_admins, public.question_answer_keys,
  public.participants, public.answers, public.game_action_log
  to authenticated;

grant update on table public.games, public.game_state to authenticated;
grant insert, update, delete on table public.questions, public.question_answer_keys
  to authenticated;
grant update (status) on table public.participants to authenticated;
grant update (
  grading_status,
  grading_note,
  is_finalized,
  finalized_at,
  finalized_by
) on table public.answers to authenticated;
grant insert on table public.game_action_log to authenticated;
grant update (undone_at, undone_by) on table public.game_action_log to authenticated;

create policy "public and admins can read games"
on public.games
for select
to anon, authenticated
using (is_public or public.is_game_admin(id));

create policy "admins can update games"
on public.games
for update
to authenticated
using (public.is_game_admin(id))
with check (public.is_game_admin(id));

create policy "admins can read own memberships"
on public.game_admins
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "current public question and admins can read questions"
on public.questions
for select
to anon, authenticated
using (
  public.is_game_admin(game_id)
  or exists (
    select 1
    from public.game_state as state
    join public.games as game on game.id = state.game_id
    where state.game_id = questions.game_id
      and state.current_question_id = questions.id
      and game.is_public
      and (
        state.phase in ('question', 'closed', 'judging')
        or (state.phase = 'answer' and state.answer_revealed)
      )
  )
);

create policy "admins can manage questions"
on public.questions
for all
to authenticated
using (public.is_game_admin(game_id))
with check (public.is_game_admin(game_id));

create policy "admins can manage answer keys"
on public.question_answer_keys
for all
to authenticated
using (
  exists (
    select 1
    from public.questions
    where id = question_id
      and public.is_game_admin(game_id)
  )
)
with check (
  exists (
    select 1
    from public.questions
    where id = question_id
      and public.is_game_admin(game_id)
  )
);

create policy "admins can read participants"
on public.participants
for select
to authenticated
using (public.is_game_admin(game_id));

create policy "admins can update participants"
on public.participants
for update
to authenticated
using (public.is_game_admin(game_id))
with check (public.is_game_admin(game_id));

create policy "public and admins can read game state"
on public.game_state
for select
to anon, authenticated
using (
  public.is_game_admin(game_id)
  or exists (
    select 1
    from public.games
    where id = game_state.game_id
      and is_public
  )
);

create policy "admins can update game state"
on public.game_state
for update
to authenticated
using (public.is_game_admin(game_id))
with check (public.is_game_admin(game_id));

create policy "admins can read answers"
on public.answers
for select
to authenticated
using (public.is_game_admin(game_id));

create policy "admins can grade answers"
on public.answers
for update
to authenticated
using (public.is_game_admin(game_id))
with check (
  public.is_game_admin(game_id)
  and (not is_finalized or finalized_by = (select auth.uid()))
);

create policy "admins can read action log"
on public.game_action_log
for select
to authenticated
using (public.is_game_admin(game_id));

create policy "admins can append action log"
on public.game_action_log
for insert
to authenticated
with check (
  public.is_game_admin(game_id)
  and performed_by = (select auth.uid())
);

create policy "admins can mark actions undone"
on public.game_action_log
for update
to authenticated
using (public.is_game_admin(game_id))
with check (
  public.is_game_admin(game_id)
  and undone_by = (select auth.uid())
);

alter table public.game_state replica identity full;
alter table public.answers replica identity full;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'game_state'
    ) then
      alter publication supabase_realtime add table public.game_state;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'answers'
    ) then
      alter publication supabase_realtime add table public.answers;
    end if;
  end if;
end;
$$;
