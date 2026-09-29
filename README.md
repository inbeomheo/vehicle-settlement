# 화물차 사용·청구·정산 앱

Next.js 15 App Router / React 19 / TypeScript strict / Tailwind 4 / Drizzle / 실제 PostgreSQL.
설계 기준: [docs/DESIGN.md](docs/DESIGN.md). W1은 기반·인증·사용 건 백엔드를 구현하며, 기사/담당자 화면 본체와 정산 서비스는 후속 워커 범위입니다.

## 실행

Node **24**와 npm을 사용합니다. Docker는 필요하지 않습니다.

```sh
npm install
cp .env.example .env
npm run db:start
npm run db:migrate
npm run seed
npm run dev
```

http://localhost:3000 에 접속합니다. `db:start`는 `.data/pg`에 embedded PostgreSQL을 초기화하고 백그라운드로 실행한 뒤 종료합니다. 기본 포트는 **54329**, 실행 중이면 재사용합니다. 로그는 `.data/postgres.log`입니다. 포트를 바꾸면 `.env`의 `PG_PORT`와 `DATABASE_URL`을 함께 변경하세요. 외부 PostgreSQL 사용 시 `DATABASE_URL`을 설정하고 `db:start`를 생략합니다.

| 로그인 ID | 비밀번호 | 역할 |
|---|---|---|
| admin | admin1234 | 관리자 |
| site | demo1234 | 현장 담당자 (두 현장 배정) |
| settlement | demo1234 | 정산 담당자 (모든 현장) |
| driver1 | demo1234 | 김기사 / 한길 운송 / 1톤 |
| driver2 | demo1234 | 이기사 / 동서 운송 / 5톤 |

시드는 두 현장(사진 필수 / 대체증빙 허용), 차량 3대, 운송사 2곳·기사 사업자 1곳·고객 1곳과 30만원 일대·10만원 회당·35만원 고객 청구 계약을 만듭니다. `admin`이 이미 있으면 기존 데이터를 유지합니다. 데모 계정은 개발용입니다.

로그인 후 기사는 `/d`, 담당자는 `/m`으로 이동합니다. 현재 각 메뉴는 역할 가드가 적용된 **준비 중** 페이지입니다. 초대는 관리자 API에서 생성하고 `/invite/<token>`에서 수락합니다. 공개 가입은 없습니다.

## 명령

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run start
```

- `npm test`: 실제 PG를 자동 준비하고 테스트 파일마다 별도 DB를 생성·마이그레이션·삭제합니다. 개발 DB 데이터는 수정하지 않습니다. 별도 서버를 쓰려면 `TEST_DATABASE_URL`을 지정하며, 테스트 계정에는 CREATE DATABASE 권한이 필요합니다.
- `npm run test:e2e`: Playwright 설정만 준비되어 있습니다. E2E 시나리오는 후속 UI 워커가 추가합니다.
- `npm run db:generate`: Drizzle 스키마 변경에 대한 새 마이그레이션 생성.
- `npm run db:reset`: **로컬 vehicle_app 데이터 전체 초기화** 후 마이그레이션. 필요할 때만 실행하고 이후 seed를 실행하세요.
- `docker-compose.yml`: PostgreSQL 16 운영/대안 설정. W1 개발·검증에서는 사용하지 않았습니다. `POSTGRES_PASSWORD`를 별도로 지정합니다.

환경 변수는 [.env.example](.env.example)을 참고하세요. `STORAGE_DIR` 기본값은 `./storage`, `APP_URL`은 초대 링크의 기준 주소입니다. 운영 쿠키에는 Secure가 붙으므로 HTTPS로 서비스합니다. 비밀값·`.data/`·`storage/`는 Git에서 제외됩니다.

## 다른 워커를 위한 계약

- [API 입력·응답 및 처리 규칙](docs/API.md)
- [W1 보고서: 모듈·함수·테스트 헬퍼·검증 결과](docs/reports/W1.md)
- [업무 가정](docs/ASSUMPTIONS.md)

DB 컬럼과 API 필드는 **snake_case**, Drizzle 테이블 export는 `vehicleUses`, `chargeLines` 같은 camelCase입니다. 수량은 문자열, 금액은 정수 원입니다. 기사에게는 RECEIVABLE·고객 정보·연락처가 응답에서 제거됩니다. 생성·검수 등 재전송에는 `Idempotency-Key`를 사용하고, 수정·상태 전이에는 최신 사용 건 `version`을 전달하세요.
