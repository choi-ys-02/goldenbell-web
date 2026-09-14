# 2026 한가위 골든벨

Next.js, TypeScript, Supabase Realtime로 만든 실시간 골든벨 웹앱이다.
현재 Phase 9까지 구현되어 참가 등록, 게임 진행, 답안 제출, 관리자 채점,
판정 확정·취소, 재접속 복구와 프로젝터 행사 연출을 지원한다.

## 로컬 실행

Node.js 22 이상이 필요하다. Supabase 프로젝트 정보를 `.env.local`에 설정한 뒤
다음 명령을 실행한다.

```bash
npm install
npm run dev
```

브라우저에서 다음 주소를 확인한다.

- 홈: `http://localhost:3000`
- 참가 등록: `http://localhost:3000/join`
- 참가자 게임: `http://localhost:3000/play`
- 프로젝터: `http://localhost:3000/screen`
- 관리자: `http://localhost:3000/admin`

환경변수와 DB 마이그레이션 적용 방법은 `supabase/README.md`를 참고한다.

## 확인 명령

```bash
npm run lint
npm run build
```

## Vercel 배포

운영 주소: https://goldenbell-web.vercel.app

- 참가 등록: https://goldenbell-web.vercel.app/join
- 프로젝터: https://goldenbell-web.vercel.app/screen
- 관리자: https://goldenbell-web.vercel.app/admin

2026-09-09 공개 배포 빌드와 관리자 비인증 접근 차단을 확인했다.
기존 Supabase `chuseok-goldenbell` 프로젝트를 재개한 후 공개 주소의 DB 연결,
참가 등록과 게임 화면 이동을 확인했다. 로컬 개발 서버 없이 공개 주소로 접속한다.
DB 연결 상태는 `/api/health/supabase`에서 확인할 수 있다.

이 앱의 배포 루트는 상위 Expo 프로젝트가 아닌 `goldenbell-web` 폴더다.
Vercel의 프레임워크는 Next.js, Node.js는 22 이상으로 설정한다.

Vercel 프로젝트의 Production 환경에 아래 변수를 `.env.local`의 값으로 등록한다.
비밀키는 서버 전용 Sensitive 환경변수로 저장하고 파일 자체는 업로드하지 않는다.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_GAME_SLUG`
- `SUPABASE_SECRET_KEY` (서버 전용)

`APP_BASE_URL`에 로컬 IP를 등록하지 않는다. 기본적으로 배포 주소의 `/join`을
QR에 사용한다. 주소를 고정해야 할 때만 실제 HTTPS 공개 주소를 설정한다.

계정과 환경변수를 연결한 이후 재배포 명령은 다음과 같다.

```bash
npx vercel --prod
```

배포 완료 후 로그아웃한 브라우저에서 `/join`, `/screen`이 열리는지,
`/admin`이 관리자 로그인으로 이동하는지 확인한다. `/api/health/supabase`는
`{"status":"ok"}`를 반환해야 한다. 참가자용 운영 주소는 Vercel 로그인을
요구하지 않아야 하며, 휴대폰 Wi-Fi를 끄고 LTE/5G에서 QR 참가를 확인한다.

## 현재 구현 범위

- DB unique constraint와 서버 RPC를 통한 중복 제출 방지
- 서버 저장 성공 확인 후에만 제출 완료 표시
- Supabase Realtime 게임 상태·제출 현황 동기화
- OX·객관식 자동 채점과 주관식 정규화·판정보류
- 관리자 수동 판정, 판정 확정, 직전 판정 확정 취소
- 참가자 세션 및 미완료 답안의 브라우저 복구
- 네트워크 타임아웃, 온라인 복귀, 포커스 복귀 시 상태 재조회
- 참가자·정답·관리자 데이터에 대한 RLS와 서버 비밀키 경계
- 현재 접속 주소를 자동 인코딩하는 실제 참가용 QR 코드
- 답변 접수·마감, 제출 인원, FINAL 10/5/ONE과 우승 프로젝터 화면
- 관리자 화면의 프로젝터 바로가기와 모바일 FINAL 단계 표시

## QR 코드 확인

배포 환경에서는 `/screen`을 연 현재 도메인의 `/join` 주소가 QR에 자동으로
들어간다. 로컬 개발 중 `/screen`을 `localhost`로 열어도 서버가 노트북의 사설
IPv4 주소를 탐지해 휴대폰용 `/join` 주소를 QR에 넣는다. 프로젝터 화면의
`참가 주소`에 표시된 주소를 휴대폰 브라우저에 직접 입력해도 된다.

자동 탐지가 다른 네트워크 인터페이스를 선택하면 `.env.local`에 다음 값을
추가하고 개발 서버를 다시 시작한다.

```bash
APP_BASE_URL=http://노트북-LAN-IP:3000
```

노트북과 휴대폰은 같은 Wi-Fi에 연결되어 있어야 하며, 행사장 Wi-Fi가 기기 간
통신을 차단하는 경우에는 로컬 주소 대신 Vercel 배포 주소를 사용한다.

## 테스트 데이터 초기화

관리자 화면 하단의 `테스트 데이터 초기화`에서 두 가지 방식을 선택할 수 있다.

- `참가자 유지하고 초기화`: 참가자 세션과 이름은 유지하고 답안, 채점 결과,
  진행 기록을 삭제한다. 모든 참가자를 active로 복구하고 1번 문제 대기 상태로 돌아간다.
- `참가자까지 전체 초기화`: 참가자와 답안, 채점 결과, 진행 기록을 모두 삭제한다.
  기존 휴대폰 세션은 자동으로 무효화되므로 QR로 다시 참가해야 한다.

문제, 인정 정답과 관리자 계정은 두 방식 모두 유지된다. 초기화된 테스트 데이터는
Undo로 복구할 수 없으므로 확인창의 삭제 범위를 확인한 뒤 실행한다.

다음 단계인 Phase 10에서는 70~80명 동시 접속 부하 및 현장 시나리오를 검증한다.
