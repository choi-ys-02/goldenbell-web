insert into public.games (
  id,
  slug,
  title,
  is_public,
  join_open
)
values (
  '20260000-0000-4000-8000-000000000001',
  '2026-chuseok',
  '2026 한가위 골든벨',
  true,
  true
)
on conflict (id) do nothing;

insert into public.questions (
  id,
  game_id,
  question_order,
  type,
  question_text,
  choices,
  time_limit_seconds
)
values
  (
    '20260000-0000-4000-8000-000000000101',
    '20260000-0000-4000-8000-000000000001',
    1,
    'ox',
    '추석은 음력 8월 15일이다.',
    null,
    20
  ),
  (
    '20260000-0000-4000-8000-000000000102',
    '20260000-0000-4000-8000-000000000001',
    2,
    'multiple_choice',
    '추석을 대표하는 음식은 무엇일까요?',
    '["송편", "떡국", "팥죽", "냉면"]'::jsonb,
    25
  ),
  (
    '20260000-0000-4000-8000-000000000103',
    '20260000-0000-4000-8000-000000000001',
    3,
    'short_answer',
    '조선 시대 거북선을 이끈 장군의 이름은?',
    null,
    30
  )
on conflict (id) do nothing;

insert into public.question_answer_keys (question_id, correct_answers)
values
  ('20260000-0000-4000-8000-000000000101', '["O"]'::jsonb),
  ('20260000-0000-4000-8000-000000000102', '[0]'::jsonb),
  (
    '20260000-0000-4000-8000-000000000103',
    '["이순신", "이 순신", "이순신 장군", "충무공 이순신"]'::jsonb
  )
on conflict (question_id) do nothing;
