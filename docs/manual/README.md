# 사용 설명서

- 공개 본문: `/manual` (`src/app/manual/page.tsx`). 로그인 없이 열 수 있다.
- PDF: `public/manual/vehicle-manual.pdf`. 웹 본문과 같은 화면·문구로 생성한다.
- `img/`: **로컬 시연 데이터**를 실제 화면에서 조작해 찍은 원본. `public/manual/`에 같은 PNG를 복사한다.
- `capture/`: 기사 등록 → 보완 → 현장 검수 → 월 정산·지급 → 관리자 순서의 Playwright 스크립트.
- 최근 전체 촬영: 2026-10-01. 운행·정산 예시는 2026년 9월로 고정한다. 실제 고객 자료는 사용하지 않는다.

## 안전 및 로컬 준비

캡처·감사·PDF 내보내기의 기본 주소는 **`http://localhost:3183`**이며 F3-ASSIGN 부분 촬영용 **`http://localhost:3191`**도 허용한다. `BASE`를 생략하면 기본 주소를 쓴다. 운영 주소·외부 주소·허용하지 않은 포트가 들어오면 브라우저 실행 전에 종료하며, 브라우저의 외부 요청도 차단한다. 운영 사이트와 운영 DB에는 접속하지 않는다.

이 워크트리 `.env.local`의 `PG_PORT=54383`를 확인한다. CLI는 `.env.local`을 자동으로 읽지 않으므로 아래 환경 변수를 지정한다. DB 명령의 `DATABASE_URL`이 별도로 설정되어 있다면 반드시 전용 로컬 DB인지 먼저 확인한다.

```sh
export DOTENV_CONFIG_PATH=.env.local
export PG_PORT=54383
export PORT=3183
export APP_URL=http://localhost:3183
export BASE=http://localhost:3183
npm run db:start
npm run db:migrate
npm run seed
npm run seed:demo
npm run dev -- -p 3183
```

`seed`·`seed:demo`는 재실행해도 기존 자료를 유지한다. **이미 촬영한 흐름을 처음부터 다시 찍을 때만** 이 워크트리의 버려도 되는 시연 DB를 `npm run db:reset`으로 초기화하고 `seed`·`seed:demo`를 다시 실행한다. DB 초기화 없이 `all.mjs`를 반복하면 이미 보완·승인·정산한 상태가 남아 실패할 수 있다.

알림 버튼까지 재현하려면 서버 시작 시 **로컬 전용 임시 VAPID 키**를 전달한다. 실제 구독·외부 푸시는 하지 않는다. 운영 키를 복사하지 않는다.

```sh
node --input-type=module <<'JS'
import webPush from 'web-push';
import { spawn } from 'node:child_process';
const keys = webPush.generateVAPIDKeys();
const server = spawn('npm', ['run', 'dev', '--', '-p', '3183'], {
  stdio: 'inherit',
  env: { ...process.env, VAPID_PUBLIC_KEY: keys.publicKey,
    VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:manual@example.com' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
JS
```

## 다시 찍기

서버를 실행한 상태에서 저장소 루트의 별도 터미널에서 실행한다.

```sh
BASE=http://localhost:3183 node docs/manual/capture/all.mjs
```

`all.mjs`는 다음 순서로 실행하며 실패하면 멈춘다.

1. `checklist.mjs`: 시작 준비. **54383의 vehicle_app만** 사용하며 시연 회사 설정을 잠시 비웠다가 `finally`에서 복원한다.
2. `driver-a.mjs`: 로그인, 기사 홈, 프로젝트·운행일, 담당자·적재용량, 운송내역, 금액, 사진, 보내기 확인·완료.
3. `driver-b.mjs`: 보완 요청·재전송, 현장별/날짜별 정산, 비밀번호 변경, 글자 크기 예시.
4. `driver-extra.mjs`: 목록 탭·필터, 알림 받기, 계약 없는 과금방식의 금액 직접 입력.
5. `site.mjs`: 내 담당만/전체 검수함, 운행 결재, 비용 검수, 운행 보고서 PDF, 개별·일괄 승인.
6. `settle.mjs`: 현장·기사별 집계, 한눈에 표, 정산 후보·확정·PDF·전액 지급 기록.
7. `admin.mjs`: 입력 항목, 사용자, 기준정보, 기사관리, 가입 링크·가입 화면, 현장 이름만 등록.
8. `driver-c.mjs`: 지급 후 기사 내 정산.

휴대폰은 390×844 CSS px / 2배 PNG(780×1688), PC는 1440×900 / 1배다. 기본 글자 크기는 **보통**이며 `16-text-xlarge`만 글자 확대 안내용으로 ‘아주 크게’를 선택한다. 개발 도구 표시는 캡처에서 숨긴다. 빈 로그인·가입 화면을 사용하며 계정·비밀번호가 입력된 그림은 공개하지 않는다. 사용자 관리 목록의 로그인 아이디는 회색으로 가린다. `WATCH=1`이면 브라우저를 표시한다.

`shot()`은 원본과 공개 PNG를 함께 저장한다. PDF에서 만든 `24b-use-report`, `35-pdf-1`도 스크립트가 두 위치에 저장한다. `statement.pdf`와 `use-report.pdf`는 시연 출력 원본이다.

## PDF 재생성과 검증

```sh
BASE=http://localhost:3183 node docs/manual/export.mjs
mkdir -p /private/tmp/manual-qa
BASE=http://localhost:3183 OUT=/private/tmp/manual-qa node docs/manual/capture/audit-manual.mjs
BASE=http://localhost:3183 node docs/manual/capture/audit-app.mjs
BASE=http://localhost:3183 OUT=/private/tmp/manual-qa SIZE=390x844 node docs/manual/capture/audit-scroll.mjs
pdftotext -layout public/manual/vehicle-manual.pdf /private/tmp/manual-qa/manual.txt
pdftoppm -scale-to 1100 -png public/manual/vehicle-manual.pdf /private/tmp/manual-qa/pdf
```

PNG의 담당자·적재용량, 금액 → 사진 순서, 탭·필터, 결재 표, 가입 폼을 직접 열어 확인한다. PDF 텍스트의 입력 순서와 전액 1회 지급 안내를 확인하고, 렌더링한 페이지의 잘림·빈 페이지·그림 배치를 확인한다. 감사 도구는 화면낭독기 전용 숨김 문구(`sr-only`)를 시각적 잘림에서 제외한다.

E2E는 3183 포트를 직접 기동하므로 촬영용 서버를 종료한 뒤 실행한다. E2E는 같은 54383 서버의 별도 `vehicle_e2e` DB를 사용한다.

```sh
npm run typecheck && npm run lint && npm run format:check && npm test
PORT=3183 npx playwright test tests/e2e/FIX-REQ-manual.spec.ts tests/e2e/MANUAL-captures.spec.ts
```

새 E2E는 390/1440px에서 추가 장면, 모든 그림의 실제 로딩, 원본/공개 파일 일치, 이미지 크기, 가로 넘침, 데모 계정 미노출을 확인한다. 안전 가드는 `tests/unit/MANUAL-capture-safety.test.ts`, 시연 담당자·적재용량·기사 금액은 `tests/integration/W6-demo.test.ts`로 검증한다.

## 이번 검증 결과

- 타입 검사·린트·포맷 검사 통과, Vitest 81개 파일 / 473개 테스트 통과.
- 관련 E2E 49건 중 47건 통과, 기존 AGG 대장 연결 2건 실패. 새 F2-UI 6건과 설명서 3건 모두 통과. 자세한 결과는 [F2-UI 보고서](../reports/F2-UI.md)에 기록했다.
- 원본/공개 PNG 56쌍 일치, 설명서 본문 47개 그림 로딩 확인, PDF 34쪽 렌더링·텍스트 추출 확인.
- 설명서 360/390/1440px 감사에서 가로 넘침·글자 잘림 없음. 앱 60개 화면/글자 크기 조합에서 가로 넘침·실제 잘림 없음(목록의 의도된 말줄임은 별도 표시). PDF 34쪽을 다시 렌더링해 그림과 본문 배치를 확인했다.

## 확인된 범위 밖 문제

전체 관련 E2E 중 `AGG-summary.spec.ts`의 1440px/390px 두 건은 집계에서 사용대장으로 이동한 뒤 기사 필터가 비어 실패한다. `/api/ledger/options`가 현장 담당자에게 허용되지 않는 `listMaster`를 호출하는 기존 경로다. 해당 업무 권한 코드는 F2-LOOKUP 범위여서 이번 작업에서는 변경하지 않았다. F2-UI는 선택 표시·결재 표·사이드바·기사 필터와 설명서 캡처를 수정했다. 집계 화면 자체의 수치·표·엑셀 검증은 통과했다.

### 현장 배정 부분 촬영 (F3-ASSIGN)

`BASE=http://localhost:3191 node docs/manual/capture/assignments.mjs`는 54391의 전용 로컬 시연 DB를 연결한 3191 서버에서 기사관리 배정과 현장 생성 두 장면만 갱신한다. 공용 캡처 도구는 추가로 이 로컬 주소만 허용하며 외부 요청 차단은 유지한다. `45-drivers`, `48-project-create`의 원본과 공개 PNG를 함께 갱신한다.

### 소속 사업자 지정 부분 촬영 (F4-JOINBIZ)

`PG_PORT=54397`, `PORT=3197`의 전용 로컬 서버에서 `BASE=http://localhost:3197 node docs/manual/capture/join-business.mjs`를 실행하면 `46-join-link` 원본·공개 PNG만 갱신한다. 사업자 입력은 시연용이며 링크를 실제로 생성하지 않는다. `BASE=http://localhost:3197 node docs/manual/export.mjs`로 사진 선택·소속 사업자 지정 안내를 포함한 PDF를 다시 만든다. 기존 운영 현장 정책은 이 작업의 마이그레이션으로 변경하지 않는다.

F4-JOINBIZ 검증: 타입·린트·포맷 검사, Vitest 87개 파일/513건, 관련 E2E 20건 통과. PDF 34쪽 렌더링 및 사진 선택·소속 지정 안내 페이지 확대 확인 완료. 상세 내용은 [F4-JOINBIZ 보고서](../reports/F4-JOINBIZ.md)를 참고한다.

### 집계 상세·거래명세표 부분 촬영 (F4-DETAIL)

이 워크트리는 `.env.local`의 `PG_PORT=54396`, 웹 `PORT=3196`만 사용한다. 모든 아래 명령은 명시한 전용 로컬 DB와 연결하며 운영 설정은 읽지 않는다.

```sh
DOTENV_CONFIG_PATH=.env.local PG_PORT=54396 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54396/vehicle_app npm run db:migrate
DOTENV_CONFIG_PATH=.env.local PG_PORT=54396 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54396/vehicle_app npm run seed
DOTENV_CONFIG_PATH=.env.local PG_PORT=54396 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54396/vehicle_app npm run seed:demo
DOTENV_CONFIG_PATH=.env.local PG_PORT=54396 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54396/vehicle_app PORT=3196 npm run dev -- --port 3196
BASE=http://localhost:3196 node docs/manual/capture/summary-detail.mjs
BASE=http://localhost:3196 node docs/manual/export.mjs
```

부분 촬영은 시연 데이터만 사용해 `29b-summary-detail`(상세와 합계), `45-drivers`(기사관리 관리 열)의 원본·공개 PNG를 갱신한다. 공용 도구의 로컬 허용 목록에 3196을 추가했고 외부 요청 차단은 유지한다.

### 회사 마감 기간 (G-PERIOD)

전용 PostgreSQL `54402`, 웹 `3202`만 사용한다. 마이그레이션·시연 자료가 준비된 로컬 서버에서 `BASE=http://localhost:3202 node docs/manual/capture/closing-period.mjs`로 집계의 `이번 마감` 버튼을 포함한 `28-summary` 원본·공개 PNG 한 쌍을 갱신한다. `BASE=http://localhost:3202 node docs/manual/export.mjs`로 마감 시작일·빠른 기간 안내를 반영한 PDF를 재생성한다. 캡처 도구는 3202를 로컬 허용 목록에 추가했고 외부 요청은 계속 차단한다.


### 거래처·회사 사업자 정보 (G-BIZ)

거래처와 회사 정보의 대표자·주소·업태·종목 안내를 보완했다. 이 작업은 `DOTENV_CONFIG_PATH=.env.local PG_PORT=54401 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54401/vehicle_app PORT=3201` 환경만 사용한다. 설명서 PDF는 로컬 3201 서버에서 `BASE=http://localhost:3201 node docs/manual/export.mjs`로 재생성한다. 기존 캡처는 유지하며 고객 개인정보는 사용하지 않는다.
