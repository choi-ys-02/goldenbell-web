do $$
declare
  missing_rls text[];
begin
  select array_agg(c.relname order by c.relname)
  into missing_rls
  from pg_class as c
  join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any(array[
      'games',
      'game_admins',
      'questions',
      'question_answer_keys',
      'participants',
      'game_state',
      'answers',
      'game_action_log',
      'grading_batches',
      'grading_batch_items'
    ])
    and not c.relrowsecurity;

  if missing_rls is not null then
    raise exception 'RLS is disabled on: %', missing_rls;
  end if;
end;
$$;

do $$
begin
  if has_column_privilege('authenticated', 'public.participants', 'status', 'UPDATE') then
    raise exception 'authenticated must change participant status through grading RPCs only';
  end if;

  if has_column_privilege('authenticated', 'public.answers', 'grading_status', 'UPDATE')
    or has_column_privilege('authenticated', 'public.answers', 'is_finalized', 'UPDATE') then
    raise exception 'authenticated must grade answers through grading RPCs only';
  end if;

  if has_function_privilege(
    'anon',
    'public.auto_grade_question(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'anon must not execute grading functions';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.finalize_question_grades(uuid, uuid)',
    'EXECUTE'
  ) then
    raise exception 'authenticated administrators need grading RPC access';
  end if;

  if has_function_privilege(
    'anon',
    'public.reset_game_for_testing(uuid, text)',
    'EXECUTE'
  ) then
    raise exception 'anon must not reset games';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.reset_game_for_testing(uuid, text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated administrators need reset RPC access';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.question_answer_keys', 'SELECT') then
    raise exception 'anon must not read question_answer_keys';
  end if;

  if has_table_privilege('anon', 'public.participants', 'SELECT') then
    raise exception 'anon must not read participants';
  end if;

  if has_table_privilege('anon', 'public.answers', 'SELECT')
    or has_table_privilege('anon', 'public.answers', 'INSERT')
    or has_table_privilege('anon', 'public.answers', 'UPDATE') then
    raise exception 'anon must not access answers directly';
  end if;
end;
$$;

do $$
begin
  if has_function_privilege(
    'anon',
    'public.submit_answer(text, uuid, text, uuid, jsonb)',
    'EXECUTE'
  ) then
    raise exception 'anon must not call submit_answer directly';
  end if;

  if has_function_privilege(
    'anon',
    'public.admin_control_game(uuid, text, uuid)',
    'EXECUTE'
  ) then
    raise exception 'anon must not call admin_control_game';
  end if;

  if has_table_privilege('authenticated', 'public.game_state', 'UPDATE') then
    raise exception 'authenticated users must use admin_control_game for state transitions';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'answers_participant_question_unique'
  ) then
    raise exception 'duplicate answer protection is missing';
  end if;
end;
$$;
