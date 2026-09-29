# 화물차 사용·청구·정산 앱

기사와 담당자가 같은 사용 내역으로 **등록 → 증빙 제출 → 검수 → 월 정산 → 엑셀·PDF 출력 → 지급 확인**을 끝내는 단일 회사 웹앱입니다.
Next.js 15 / React 19 / TypeScript / Tailwind 4 / Drizzle / PostgreSQL. 설계 기준은 [DESIGN](docs/DESIGN.md)입니다.

## 기능

- 기사: 모바일 운행 등록, 사진·전표 첨부, 휴대폰 임시저장·오프라인 재전송, 보완 재제출, 본인 지급명세 확인.
- 담당자: 대리 입력, 현장별 검수·추가비 보류, 사용대장 검색·엑셀, 변경 이력, 관리자는 기준정보·단가 기간·사용자·배정 관리. 현장 담당자는 배정 현장 가져오기와 검수를 사용합니다.
- 정산: 지급/고객청구 분리, 전월 미정산분 포함, 확정 스냅샷·잠금, Excel/PDF, 전액 지급·입금과 오입력 취소, 다음 명세 조정.
- 가져오기: xlsx/UTF-8 csv, 시트·헤더 선택과 수정 가능한 자동 열 매핑, 개인 매핑 프리셋, 오류·중복 미리보기, 유효 행 임시저장, 작업 이력·오류 엑셀.
- 입력 항목 설정: 관리자가 `/m/master/form-fields`에서 기사·담당자별 숨김/선택/필수를 지정합니다. 회사 기본값과 현장별 항목 재정의, 미리보기·감사로그·동시 수정 충돌을 지원합니다. 기사 기본 화면은 최소 입력이며 설정은 오프라인에도 보관합니다.
- 운영: DB와 증빙 파일 동시 백업, 체크섬 manifest, 빈 DB 복구·검증. [운영 절차](docs/OPERATIONS.md).

## 설치·실행

Node **24**와 npm이 필요합니다. 기본 로컬 실행에는 Docker가 필요하지 않습니다.

```sh
npm ci
cp .env.example .env
npm run db:start
npm run db:migrate
npm run seed
npm run dev
```

기본 로컬 `.env` 설정 예시:

```dotenv
PG_PORT=54329
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/vehicle_app
STORAGE_DIR=./storage
APP_URL=http://localhost:3000
PORT=3000
```

접속: <http://localhost:3000>. 일반 단독 설치의 `.env.example` 기본값은 DB 54329, 앱 3000입니다.
`db:start`는 `.data/pg`에 embedded PostgreSQL을 초기화하여 백그라운드로 실행하고, 같은 포트가 실행 중이면 재사용합니다. 로그는 `.data/postgres.log`입니다. 외부 PostgreSQL에서는 `DATABASE_URL`을 설정하고 `db:start`를 생략합니다. 운영용 `docker-compose.yml`은 별도 `POSTGRES_PASSWORD` 설정이 필요합니다.

프로덕션 실행은 `npm run build` 후 `npm run start -- --port 3000`입니다. 운영은 HTTPS와 Secure 세션 쿠키를 사용합니다. `.env`, `.data/`, `storage/`를 저장소에 커밋하지 않습니다.

## 데모 계정

| 아이디     | 비밀번호  | 역할                     |
| ---------- | --------- | ------------------------ |
| admin      | admin1234 | 관리자                   |
| site       | demo1234  | 두 현장의 현장 담당자    |
| settlement | demo1234  | 모든 현장의 정산 담당자  |
| driver1    | demo1234  | 김성호 / 한길 운송 / 1톤 |
| driver2    | demo1234  | 이정민 / 동서 운송 / 5톤 |

시드는 서울 현장(사진 필수), 인천 보안 현장(대체증빙 허용), 차량 3대, 기사 2명, 운송사 2곳·기사 사업자·고객, 일대 300,000원·회당 100,000원·고객 청구 일대 350,000원 계약을 생성합니다. 시드 단가는 부가세 별도입니다. `admin`이 이미 있으면 시드는 데이터를 추가하지 않습니다. 데모 계정은 개발 전용이며 운영 전 계정·비밀번호를 교체하세요.

## 사용 흐름 따라하기

관리자는 **기준정보 → 입력 항목 설정**에서 회사 기본값을 정하고 **설정 저장**합니다. 특정 현장만 다르게 쓰려면 현장을 선택해 항목을 변경합니다. **회사 기본 따름**이나 **재정의 해제**로 되돌릴 수 있습니다. 아래 미리보기는 저장 전 기사에게 보일 항목을 보여줍니다. 기본 기사 폼에는 사용일·현장·차량·출발·도착·운반 내용(선택)·증빙 및 과금 입력이 표시됩니다. 추가비는 필요할 때 버튼으로 추가합니다. 필수 항목이 비어도 임시저장은 가능하지만 제출 전 안내되며 서버에서도 검사합니다.

1. `driver1` 로그인 → **운행 등록** → 서울 현장, 사용일, 출발·도착 입력 → 운행 5행 추가. 일대 청구수량은 **1**, 기본운임은 **300,000원**입니다. 사진을 첨부하고 **담당자에게 제출**합니다. 휴대폰 임시저장·서버 작성중·제출 완료·사진 실패를 구분합니다.
2. `driver2`로 같은 방식으로 입력하고 회당 **청구수량 5**를 지정합니다. 기본운임은 **500,000원**입니다. 운행 행 개수만으로 청구수량이 확정되지 않습니다.
3. `site` → 대리 입력에서 전월 사용일 1건을 입력·제출합니다. 검수함에서 보완 항목·메시지를 보내고, 기사 재제출 후 승인합니다. 추가비 한 줄은 사유를 적고 **보류**한 뒤 나머지를 승인할 수 있습니다.
4. `settlement` → **월 정산 → 새 정산** → 거래처·기간 → 후보 조회. 전월 미정산분의 실제 사용일과 `전월분` 표시를 확인합니다. 보류를 제외하고 초안을 만들고 **명세 확정**합니다. 금액·증빙·권한·다른 명세 잠금은 서버가 재검사합니다.
5. 확정 상세에서 엑셀·PDF를 다운로드합니다. 출력은 당시 스냅샷을 사용합니다. PDF는 세금계산서가 아닙니다.
6. 지급일·방법·참고번호를 입력하여 **지급 기록 저장**합니다. 기사의 **내 정산**에서 본인 해당분만 `지급 완료`로 표시됩니다.
7. 지급 오입력은 사유와 함께 **오입력 취소 → 기록 취소 확인**을 실행합니다. 원기록을 남기고 미지급으로 복귀합니다. 실제 지급 후 금액 정정은 원명세를 유지한 조정 항목으로 처리합니다.

가져오기는 `/m/import`에서 파일 선택 → 시트·헤더·열 매핑 확인 → **미리보기 검증** → **유효 행 임시저장** 순서입니다. 등록은 `DRAFT + PROXY`이고 자동 승인하지 않습니다. 상세에서 사진을 추가하고 제출·검수합니다. 현장 담당자도 배정 현장에 가져올 수 있습니다. 재저장한 파일도 정규화된 내용이 같으면 건너뛰고 파일 안의 반복 행은 보존합니다. 유사 경로의 중복 의심 행은 경고를 보고 개별 제외할 수 있습니다. 수식은 저장된 결과값을 사용하고 결과 없는 매핑 셀만 행 오류로 처리합니다. UTF-8이 아닌 CSV는 UTF-8 저장 안내와 함께 거부합니다. 자세한 수량·단가 규칙은 [업무 가정](docs/ASSUMPTIONS.md)을 참고하세요.

## 테스트

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run format:check
```

- Vitest는 실제 PG의 파일별 독립 DB를 생성·마이그레이션·삭제합니다. 개발 DB를 초기화하지 않습니다. 별도 서버는 `TEST_DATABASE_URL`을 지정하고 CREATE DATABASE 권한을 부여합니다.
- `npm run test:e2e`: Playwright 브라우저 시나리오를 전용 `vehicle_e2e` DB에서 실행합니다. 아래 E2E 절을 참고하세요.
- `npm run format`은 Prettier로 포맷합니다. 커밋 전 `format:check`를 통과시킵니다.
- 14개 필수 시나리오별 테스트명·결과 및 복구 리허설 로그: [VERIFICATION](docs/VERIFICATION.md).

## 시연용 9월 데이터

기본 계정·기준정보 시드 이후 실행합니다.

```sh
npm run seed
npm run seed:demo
```

`seed:demo`는 2026년 9월 사용 15건과 8월 이월 1건을 생성합니다. 기사 2명의 작성중·제출·보완요청·승인 건, 일대 5회 운행, 회당 청구수량, 대기비 보류, 고객 청구와 작은 시연 증빙 이미지가 포함됩니다. 확정 지급명세는 지급완료 1건(660,000원), 미지급 1건(880,000원)입니다. 금액·검수·명세·지급은 실제 서비스 함수를 통해 생성하며, 재실행하면 같은 데이터를 유지합니다.

`site` 또는 `settlement` 계정으로 `/m`에서 검수 대기·보완 대기·증빙 누락·미정산 승인액·미지급액을 확인할 수 있습니다. 처음부터 다시 만들 때는 로컬 데이터를 지우는 `npm run db:reset` 후 `npm run seed && npm run seed:demo`를 실행합니다.

## E2E 전용 환경

```sh
npm run test:e2e
```

Playwright는 `.env`의 PostgreSQL 호스트·포트를 사용하되 데이터베이스 이름을 `vehicle_e2e`로 고정합니다. 매 실행의 globalSetup에서 이 전용 DB를 재생성·마이그레이션·기본 seed하고, 증빙은 `.data/e2e-storage`에 저장합니다. 웹 서버와 스펙의 서비스 호출 모두 같은 전용 DB를 사용합니다. 개발 DB의 사용·명세·지급·증빙·감사로그·가져오기 작업 수는 실행 전후 비교하며 달라지면 실패합니다.

웹 서버 포트는 `.env`의 `PORT`, PostgreSQL은 `PG_PORT`입니다. 기존 개발 서버를 재사용하지 않으므로 E2E 실행 전에 해당 웹 포트를 비워 주세요. 이 설정은 `tests/e2e/full-flow.spec.ts`를 포함해 모든 E2E 스펙에 적용됩니다.

## 백업·복구

앱을 중지한 유지보수 시간에 실행합니다. 백업은 비밀번호 해시와 증빙을 포함하므로 접근 권한을 제한하고 별도 매체에 보관합니다.

```sh
npm run backup
# 출력된 .data/backups/<시각> 경로를 별도로 보관
# 복구 대상은 빈 DB와 빈 STORAGE_DIR로 준비
npm run restore -- .data/backups/<시각>
npm run restore:verify
npm run db:migrate  # 구버전 백업의 적용 이력 보정·후속 마이그레이션
```

복구는 기존 데이터가 있는 대상에 덮어쓰지 않습니다. `npm run db:reset`은 **로컬 vehicle_app 전체를 삭제**하므로 복구 리허설 전용 환경에서만 사용하세요. 복구 후 검증·파일 이동이 실패하면 복구된 업무 DB를 비우고 승격한 파일을 제거합니다. 실제 리허설·주기·담당·실패 대응은 [OPERATIONS](docs/OPERATIONS.md)에 있습니다.

## 테스트용 클라우드 배포

Vercel + 기존 Supabase의 전용 `vehicle` 스키마 배포는 [DEPLOY](docs/DEPLOY.md)를 참고하세요. DB 파일 저장과 배포 환경을 설정하며 로컬 기본 실행은 그대로 유지합니다.

## 인계 자료

- [설계](docs/DESIGN.md), [API 계약](docs/API.md), [업무 가정·미확정 규칙](docs/ASSUMPTIONS.md)
- [검증 결과](docs/VERIFICATION.md), [운영 절차](docs/OPERATIONS.md), [후속 기능](docs/ROADMAP.md), [제3자 고지](docs/THIRD_PARTY.md)
- 워커 보고서: [W1](docs/reports/W1.md), [W2](docs/reports/W2.md), [W3](docs/reports/W3.md), [W4](docs/reports/W4.md), [W5](docs/reports/W5.md), [W6](docs/reports/W6.md), [W7](docs/reports/W7.md), [W8A](docs/reports/W8A.md), [W8B](docs/reports/W8B.md), [W9](docs/reports/W9.md)
