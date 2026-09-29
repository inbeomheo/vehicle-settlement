# 화물차 사용·청구·정산 앱

기사와 담당자가 같은 사용 내역으로 **등록 → 증빙 제출 → 검수 → 월 정산 → 엑셀·PDF 출력 → 지급 확인**을 끝내는 단일 회사 웹앱입니다.
Next.js 15 / React 19 / TypeScript / Tailwind 4 / Drizzle / PostgreSQL. 설계 기준은 [DESIGN](docs/DESIGN.md)입니다.

## 기능

- 기사: 모바일 운행 등록, 사진·전표 첨부, 휴대폰 임시저장·오프라인 재전송, 보완 재제출, 본인 지급명세 확인.
- 담당자: 대리 입력, 현장별 검수·추가비 보류, 사용대장 검색·엑셀, 변경 이력, 기준정보·단가 기간·사용자·배정 관리.
- 정산: 지급/고객청구 분리, 전월 미정산분 포함, 확정 스냅샷·잠금, Excel/PDF, 전액 지급·입금과 오입력 취소, 다음 명세 조정.
- 가져오기: xlsx/UTF-8 csv, 시트·헤더 선택과 수정 가능한 자동 열 매핑, 개인 매핑 프리셋, 오류·중복 미리보기, 유효 행 임시저장, 작업 이력·오류 엑셀.
- 운영: DB와 증빙 파일 동시 백업, 체크섬 manifest, 빈 DB 복구·검증. [운영 절차](docs/OPERATIONS.md).

## 설치·실행

Node **24**와 npm이 필요합니다. 기본 로컬 실행에는 Docker가 필요하지 않습니다.

```sh
npm ci
cp .env.example .env
# W5 worktree에서는 .env를 아래 값으로 설정합니다.
npm run db:start
npm run db:migrate
npm run seed
npm run dev -- --port 3105
```

W5의 `.env` 설정 예시(다른 작업 디렉터리와 포트를 공유하지 않습니다):

```dotenv
PG_PORT=54334
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54334/vehicle_app
STORAGE_DIR=./storage
APP_URL=http://localhost:3105
PORT=3105
```

접속: <http://localhost:3105>. 일반 단독 설치의 `.env.example` 기본값은 DB 54329, 앱 3000입니다.
`db:start`는 `.data/pg`에 embedded PostgreSQL을 초기화하여 백그라운드로 실행하고, 같은 포트가 실행 중이면 재사용합니다. 로그는 `.data/postgres.log`입니다. 외부 PostgreSQL에서는 `DATABASE_URL`을 설정하고 `db:start`를 생략합니다. 운영용 `docker-compose.yml`은 별도 `POSTGRES_PASSWORD` 설정이 필요합니다.

프로덕션 실행은 `npm run build` 후 `npm run start -- --port 3105`입니다. 운영은 HTTPS와 Secure 세션 쿠키를 사용합니다. `.env`, `.data/`, `storage/`를 저장소에 커밋하지 않습니다.

## 데모 계정

| 아이디     | 비밀번호  | 역할                     |
| ---------- | --------- | ------------------------ |
| admin      | admin1234 | 관리자                   |
| site       | demo1234  | 두 현장의 현장 담당자    |
| settlement | demo1234  | 모든 현장의 정산 담당자  |
| driver1    | demo1234  | 김기사 / 한길 운송 / 1톤 |
| driver2    | demo1234  | 이기사 / 동서 운송 / 5톤 |

시드는 서울 현장(사진 필수), 인천 보안 현장(대체증빙 허용), 차량 3대, 기사 2명, 운송사 2곳·기사 사업자·고객, 일대 300,000원·회당 100,000원·고객 청구 일대 350,000원 계약을 생성합니다. 시드 단가는 부가세 별도입니다. `admin`이 이미 있으면 시드는 데이터를 추가하지 않습니다. 데모 계정은 개발 전용이며 운영 전 계정·비밀번호를 교체하세요.

## 사용 흐름 따라하기

1. `driver1` 로그인 → **운행 등록** → 서울 현장, 사용일, 출발·도착 입력 → 운행 5행 추가. 일대 청구수량은 **1**, 기본운임은 **300,000원**입니다. 사진을 첨부하고 **담당자에게 제출**합니다. 휴대폰 임시저장·서버 작성중·제출 완료·사진 실패를 구분합니다.
2. `driver2`로 같은 방식으로 입력하고 회당 **청구수량 5**를 지정합니다. 기본운임은 **500,000원**입니다. 운행 행 개수만으로 청구수량이 확정되지 않습니다.
3. `site` → 대리 입력에서 전월 사용일 1건을 입력·제출합니다. 검수함에서 보완 항목·메시지를 보내고, 기사 재제출 후 승인합니다. 추가비 한 줄은 사유를 적고 **보류**한 뒤 나머지를 승인할 수 있습니다.
4. `settlement` → **월 정산 → 새 정산** → 거래처·기간 → 후보 조회. 전월 미정산분의 실제 사용일과 `전월분` 표시를 확인합니다. 보류를 제외하고 초안을 만들고 **명세 확정**합니다. 금액·증빙·권한·다른 명세 잠금은 서버가 재검사합니다.
5. 확정 상세에서 엑셀·PDF를 다운로드합니다. 출력은 당시 스냅샷을 사용합니다. PDF는 세금계산서가 아닙니다.
6. 지급일·방법·참고번호를 입력하여 **지급 기록 저장**합니다. 기사의 **내 정산**에서 본인 해당분만 `지급 완료`로 표시됩니다.
7. 지급 오입력은 사유와 함께 **오입력 취소 → 기록 취소 확인**을 실행합니다. 원기록을 남기고 미지급으로 복귀합니다. 실제 지급 후 금액 정정은 원명세를 유지한 조정 항목으로 처리합니다.

가져오기는 `/m/import`에서 파일 선택 → 시트·헤더·열 매핑 확인 → **미리보기 검증** → **유효 행 임시저장** 순서입니다. 등록은 `DRAFT + PROXY`이고 자동 승인하지 않습니다. 상세에서 사진을 추가하고 제출·검수합니다. 같은 파일 바이트의 같은 시트·행은 건너뛰고, 편집된 파일의 유사 행은 경고만 합니다. 자세한 수량·단가 규칙은 [업무 가정](docs/ASSUMPTIONS.md)을 참고하세요.

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
- Playwright는 `.env`의 `PORT`에서 개발 서버를 시작하며 **개발 DB에 테스트 자료를 추가**합니다. 먼저 마이그레이션과 시드를 실행하세요. 운영 DB에서는 실행하지 않습니다. W5 전체 흐름은 위 시드 계정을 사용합니다.
- `npm run format`은 Prettier로 포맷합니다. 커밋 전 `format:check`를 통과시킵니다.
- 14개 필수 시나리오별 테스트명·결과 및 복구 리허설 로그: [VERIFICATION](docs/VERIFICATION.md).

## 백업·복구

앱을 중지한 유지보수 시간에 실행합니다. 백업은 비밀번호 해시와 증빙을 포함하므로 접근 권한을 제한하고 별도 매체에 보관합니다.

```sh
npm run backup
# 출력된 .data/backups/<시각> 경로를 별도로 보관
# 복구 대상은 빈 DB와 빈 STORAGE_DIR로 준비
npm run restore -- .data/backups/<시각>
npm run restore:verify
```

복구는 기존 데이터가 있는 대상에 덮어쓰지 않습니다. `npm run db:reset`은 **로컬 vehicle_app 전체를 삭제**하므로 복구 리허설 전용 환경에서만 사용하세요. 실제 리허설·주기·담당·실패 대응은 [OPERATIONS](docs/OPERATIONS.md)에 있습니다.

## 인계 자료

- [설계](docs/DESIGN.md), [API 계약](docs/API.md), [업무 가정·미확정 규칙](docs/ASSUMPTIONS.md)
- [검증 결과](docs/VERIFICATION.md), [운영 절차](docs/OPERATIONS.md), [후속 기능](docs/ROADMAP.md), [제3자 고지](docs/THIRD_PARTY.md)
- 워커 보고서: [W1](docs/reports/W1.md), [W2](docs/reports/W2.md), [W3](docs/reports/W3.md), [W4](docs/reports/W4.md), [W5](docs/reports/W5.md)
