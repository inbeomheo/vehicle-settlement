# PUSH — 담당자·기사 웹 푸시

구현 커밋: `1b6d5d2` (`feat/push`).

## 구현

- `web-push`만 직접 의존성으로 추가하고 필요한 타입은 로컬 선언으로 한정했다.
- `0730_push_subscriptions.sql`: 사용자 FK/cascade, endpoint unique, 구독 키 JSON, 브라우저 정보, 생성·갱신·최근 성공 시각, 실패 수와 사용자 인덱스. journal 및 DEPLOY 마이그레이션 수(12)·구버전 롤백 목록을 맞췄다.
- 로그인 사용자의 구독 저장·조회·삭제 API. 사용자 ID는 세션으로 결정한다. 타인 구독 소유권 변경은 거부, 타인 조회·삭제는 정보 없이 false. HTTPS Google/Mozilla/Apple/Windows 푸시 주소만 받아 서버의 임의 URL 요청을 막는다. 감사로그에는 구독 ID만 기록한다.
- 담당자 PC/휴대폰 메뉴 아래와 기사 홈 아래 알림 받기·끄기. 권한은 버튼 클릭으로 요청, 로딩·미설정·미지원·차단·실패 표시, iPhone/iPad 홈 화면 추가 안내. 기존 담당자/기사 버튼 토큰 재사용. 로그아웃 시 브라우저·서버 양쪽 구독 해제를 시도하며, 푸시 장애가 로그아웃을 막지 않는다.
- 제출·보완 라우트 바깥의 `withUsePush`가 성공 응답 후 `after`로 예약한다. 업무 서비스 `uses.ts`, 공용 `withRoute`는 변경하지 않았다. 바깥 멱등 트랜잭션 커밋 이후 실행하고 재생 응답은 건너뛴다.
- 제출/재제출: 지정 담당자만, 미지정 시 현재 현장 검수 권한자 전원. 보완: 본인 기사 계정만. 기존 `assertCanReview`/`assertCanReadUse`로 현장 배정·활성 상태를 확인하며 발송 직전 다시 검사한다. 지연된 상태/version 불일치 알림은 생략한다.
- 제목·기사·현장·첫 운송경로·저장된 PAYABLE 요청/계산 금액과 상세 링크. 정수 합계는 BigInt, 고객청구 정보 제외. 404/410 삭제, 기타 실패 수 누적, 성공 시 최근 시각과 실패 수 0. 전송 제한 5초, TTL 1시간, 최대 10건씩 병렬 처리.
- `public/sw.js` push/notificationclick: OS 알림, 앱 내부 상세 경로만 허용, 정확히 같은 상세 창이면 재사용하고 작성 중인 다른 창을 덮어쓰지 않는다. 기존 오프라인 캐시 이벤트 유지.

## 결정·인계

- 실제 저장소의 `public/sw.js`는 생성 파일이 아니라 직접 관리하는 원본이었다. `src/client/offline/build-shell.mjs`가 SW 원본 내용까지 해시하여 `public/sw-version.js`를 생성한다. 생성 스크립트 변경 없이 SW 변경이 버전에 반영된다.
- VAPID 세 값이 누락/불일치하거나 subject가 mailto 형식이 아니면 푸시만 비활성화한다. 비밀키는 커밋하지 않았다. `.env.example`, `docs/DEPLOY.md`에 새 키 생성·환경변수·실기기 확인 방법을 기록했다. 운영 적용 시 대화에서 공유한 키 대신 새 키를 생성한다.
- 지정 담당자의 권한이 회수되면 다른 담당자에게 확대 발송하지 않는다. 여러 계정이 같은 기사에 연결되면 현재 현장 권한이 있는 활성 기사 계정들에게 발송한다.
- 구독 저장·삭제는 endpoint 소유권 조건으로 반복 실행 가능하다. Idempotency-Key 응답 재생을 적용하지 않아 알림 끈 뒤 같은 기기에서 다시 켤 수 있다. 타인 소유 구독을 현재 계정으로 자동 이전하지 않고 브라우저 재구독을 요구한다.
- 별도 인앱 종/뱃지, 자동 푸시 재시도 큐는 추가하지 않았다. 고객 요청 범위의 명시적 제출·재제출 API에 연결했고 담당자의 일반 수정에 따른 자동 재제출에는 별도 훅을 추가하지 않았다.
- PostgreSQL 기본 시각은 마이크로초, JS Date는 밀리초여서 갱신 중 구독 보호 비교는 DB 시각을 밀리초로 맞춰 비교한다.

## 공용·소유 범위 밖 변경

- `src/server/db/schema.ts`: 신규 pushSubscriptions 선언만 추가.
- `src/components/manager/navigation.tsx`: 설정 컴포넌트 삽입 2곳, 휴대폰 펼침 메뉴 높이·자체 세로 스크롤.
- `src/app/d/page.tsx`: 홈 마지막에 설정 컴포넌트 추가.
- `src/components/logout-button.tsx`: 기기 구독 해제 호출·import 2줄.
- `src/components/manager/audit.tsx`: 푸시 감사 이력 한국어 레이블 3개.
- `src/app/api/uses/[id]/submit/route.ts`, `request-fix/route.ts`: 기존 withRoute 밖 푸시 래퍼만 추가. FLOW 병합 시 유지할 지점.
- `docs/API.md`: PUSH 절만 추가. `docs/DEPLOY.md`, `.env.example`: 환경설정 안내.
- `drizzle/meta/_journal.json`, `tests/integration/DEPLOY*.test.ts`: 신규 마이그레이션 반영. 다른 워커 병합 시 최종 journal 수·idx·적용 시각 확인 필요.
- `package.json`, `package-lock.json`: web-push 의존성. `playwright.config.ts`: 테스트 프로세스에서만 임시 VAPID 키 생성(운영 키 사용 방지).
- manager-access.ts, driver-nav.tsx, manual/page.tsx, authz.ts, uses.ts는 변경 없음.

## 검증

- 전용 `PG_PORT=54353`, `PORT=3153`, 로컬 vehicle_app 및 분리된 Vitest DB/vehicle_e2e만 사용.
- typecheck, lint, format:check 통과. 기존 `docs/manual/capture/driver-b.mjs`의 unused `top` 경고 1개는 변경하지 않았다.
- 전체 Vitest 67파일 391개 통과(신규 PUSH 통합 6개, SW 이벤트 2개 포함). 최종 변경 후에도 동일하게 통과했다.
- PUSH 통합: 실제 PG의 구독 반복·권한·검증·감사, 대상 계산, web-push 경계 모의 호출, 성공/실패 이력, 커밋/멱등/보완/재제출, 키 미설정. DEPLOY: 제한 롤 vehicle 스키마 마이그레이션과 백업·복구.
- PUSH E2E: `context.grantPermissions(['notifications'])`, 실제 SW 활성화·HTTP API·실DB 저장/삭제. 외부 푸시 제공자 구독만 PushManager 모형으로 대체한다. 보통/아주 크게 360px, 44px 이상 버튼, 가로 넘침, 권한 거절·저장 오류·재시도·새로고침·로그아웃·iPhone·미지원·미설정 안내 확인.

- 신규 PUSH 4개 및 지정된 W8a-driver·W8b-manager·W6-manager·Senior-form·F6-offline의 기존 18개, 총 22개 E2E 통과. 개발 DB 업무 자료 수는 실행 전후 동일(전 항목 0). 로그아웃 장애 처리 보강 후 PUSH·W8a-driver 12개를 다시 실행해 통과했다. 브라우저 구독 해제가 실패해도 서버 구독 삭제와 로그아웃이 계속됨을 확인했다.
- 큰 글자 360px 기사/담당자 화면 캡처를 직접 확인했다. 테스트 산출물은 gitignore 대상 test-results에 있다.

## 남은 운영 확인

- 이 worktree의 구현·로컬 검증만 수행한다. Vercel/Supabase 운영 배포·환경변수 등록은 하지 않았다.
- 실제 iPhone/Android/PC의 OS 알림 배달은 운영 키·HTTPS·기기 권한으로 확인해야 한다. CI/E2E는 외부 FCM/APNs까지 배달되는 테스트가 아니다.
- `after`는 영속 큐가 아니다. 서버 종료/시간 제한/푸시 제공자 장애로 알림이 유실될 수 있으며 업무 처리는 이미 성공한다. 검수함이 최종 기준이다.
