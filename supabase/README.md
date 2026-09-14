# Supabase 데이터베이스 운영

이 디렉터리의 마이그레이션이 Golden Bell 데이터베이스의 기준 원본이다.
Dashboard에서 테이블을 직접 수정하지 않고 이후 변경도 새 migration으로 관리한다.

## 연결 순서

1. Supabase에서 새 프로젝트를 만든다.
2. 프로젝트의 Connect 화면에서 Project URL, Publishable key, Secret key를 확인한다.
3. `.env.example`을 복사해 `.env.local`을 만들고 실제 값을 입력한다.
4. Supabase CLI로 프로젝트를 연결한다.

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

운영 프로젝트에 적용하기 전에는 개발 프로젝트에서 검증하고
`db push --dry-run` 결과를 먼저 확인한다.

개발용 예시 행사와 OX·객관식·주관식 문제 3개가 `seed.sql`에 들어 있다.
로컬 Supabase에서는 `db reset` 시 자동 적용된다. 원격 개발 프로젝트에서만
필요하다면 아래처럼 적용하고, 운영 DB에는 예시 데이터를 넣지 않는다.

```bash
npx supabase db push --include-seed
```

마이그레이션 적용 후 연결 상태는 개발 서버에서 다음 URL로 확인할 수 있다.

```text
http://localhost:3000/api/health/supabase
```

- 연결 성공: HTTP 200, `{ "status": "ok" }`
- 환경변수 누락 또는 연결 실패: HTTP 503

## 보안 경계

| 데이터 | 참가자/관객 | 인증된 진행자 | 서버 Secret key |
| --- | --- | --- | --- |
| 공개 행사·게임 상태 | 읽기 | 읽기/진행 | 전체 |
| 현재 공개 문제 | 읽기 | 전체 | 전체 |
| 정답 키 | 차단 | 읽기/관리 | 전체 |
| 참가자 | 직접 접근 차단 | 읽기/상태 변경 | 전체 |
| 답안 | 직접 접근 차단 | 읽기/채점 | 전체 |
| 진행 작업 로그 | 차단 | 읽기/추가 | 전체 |

참가 등록과 답안 제출은 Next.js 서버 API를 통해서만 처리한다.
브라우저에는 무작위 참가자 세션 토큰만 저장하고 DB에는 SHA-256 해시만 저장한다.
Secret key는 RLS를 우회하므로 `NEXT_PUBLIC_` 접두사를 붙이거나 브라우저 코드에서
가져오면 안 된다.

## 관리자 계정 연결

1. Supabase Dashboard의 Authentication > Users에서 진행자 계정을 만든다.
2. 행사 데이터가 생성된 뒤 해당 사용자를 `game_admins`에 연결한다.

개발 seed를 사용했다면 SQL Editor에서 다음 데이터 작업을 한 번 실행한다.

```sql
insert into public.game_admins (game_id, user_id)
select
  '20260000-0000-4000-8000-000000000001'::uuid,
  id
from auth.users
where email = '진행자 이메일';
```

이후 `/admin/login`에서 해당 이메일과 비밀번호로 로그인한다. 참가자는 Supabase
Auth를 사용하지 않으며, 브라우저별 무작위 참가 세션으로만 복구한다.

## 주요 설계 결정

- `questions`와 `question_answer_keys`를 분리해 정답 선공개를 막는다.
- `answers(question_id, participant_id)` unique constraint로 중복 답안을 차단한다.
- 자동 채점 결과와 `is_finalized`를 분리해 관리자 확정 전에는 탈락시키지 않는다.
- `game_action_log`가 이후 진행자 Undo 기능의 전후 상태를 보관한다.
- `game_state`와 `answers`만 Realtime publication에 포함한다.
- `game_state`의 집계값을 trigger로 갱신해 참가자/제출자 수를 안전하게 공개한다.
- `submit_answer`가 상태 행을 잠근 뒤 마감 시각과 중복 제출을 원자적으로 검사한다.
- `admin_control_game`만 게임 상태를 변경할 수 있고 모든 작업을 Undo 로그에 남긴다.
- 자동 채점 결과는 참가자 상태와 분리하며 관리자의 `판정 확정` 후에만 반영한다.
- 판정 확정은 `grading_batches`에 이전 상태를 저장해 직전 확정을 취소할 수 있다.
- 주관식은 공백·대소문자·일반 문장부호를 정규화하고 불일치는 보류로 분류한다.

## 현재 마이그레이션

- `202608190001_initial_goldenbell_schema.sql`: 기본 테이블, RLS, Realtime
- `202608190002_gameplay_functions.sql`: 참가 세션, 답안 제출, 게임 진행 RPC
- `202608190003_grading_and_recovery.sql`: 자동·수동 채점, 판정 확정·취소, 복구 강화
- `202608200004_test_reset.sql`: 관리자 전용 테스트 데이터 초기화와 일괄 삭제 최적화

마이그레이션 후 `supabase/tests/schema_security.test.sql`을 SQL Editor에서 실행하면
RLS, 권한, 중복 제출 제약과 채점 RPC 권한을 회귀 검사할 수 있다.

## 타입 갱신

원격 마이그레이션을 적용한 뒤 DB 타입을 다시 생성한다.

```bash
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
```
