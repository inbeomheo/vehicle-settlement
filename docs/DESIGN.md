# 화물차 사용·청구·정산 앱 — 설계 계약서 (v1)

이 문서는 모든 워커가 따르는 **단일 기준**이다. 구현 중 이 문서와 다르게 해야 할 이유가 생기면
임의로 바꾸지 말고 코디네이터에게 질문(ask)한다. 원 기획서: `docs/spec/기획서.txt`, 구현 지시서: `docs/spec/구현지시서.md`.

## 0. 완료 기준

기사와 담당자가 같은 사용 내역으로 **한 번의 월 정산을 정확히 끝낼 수 있어야 한다.**

> 기사/담당자 사용 내역 등록 → 증빙 제출 → 담당자 검수 → 거래처별 월 정산 → 엑셀·PDF 출력 → 지급 확인

## 1. 기술 스택 (고정)

| 영역 | 선택 |
|---|---|
| 언어 | TypeScript (strict) |
| 웹/서버 | Next.js 15 App Router 단일 앱. API는 `src/app/api/**/route.ts` Route Handler |
| UI | React 19 + Tailwind CSS 4. 컴포넌트 라이브러리 없이 `src/components/ui/*` 소형 컴포넌트 |
| DB | PostgreSQL 16+. ORM: Drizzle ORM + `pg`. 마이그레이션: drizzle-kit (필요 시 커스텀 SQL 마이그레이션으로 부분 유니크 인덱스) |
| 로컬 DB | `embedded-postgres` 로 `.data/pg` 에 실제 PG 실행 (`npm run db:start`). 포트는 env `PG_PORT` (기본 54329). 운영/서버는 `docker-compose.yml` 의 postgres 또는 `DATABASE_URL` |
| 검증 | zod (서버에서 모든 입력 재검증) |
| 금액 | 원화 **정수(원)**. 수량·시간은 `numeric(12,3)` 를 문자열로 다루고 계산은 `decimal.js` |
| 파일 | 로컬 파일시스템 `storage/` (env `STORAGE_DIR`). 다운로드는 권한 검사 라우트로만 |
| 엑셀 | `exceljs` |
| PDF | `pdfkit` + 번들 한글 폰트 `assets/fonts/NotoSansKR-*.ttf` (OFL, 고지 포함) |
| 오프라인 | IndexedDB(`idb`) 초안·업로드 대기열 + 직접 작성한 `public/sw.js`, `public/manifest.webmanifest` |
| 테스트 | Vitest (서비스·API 통합 테스트, 실제 PG 사용, 테스트마다 격리 DB/스키마), Playwright (E2E) |
| 시간 | 모든 업무 날짜는 `Asia/Seoul` 기준 `date` 타입(YYYY-MM-DD). 타임스탬프는 `timestamptz` |

패키지 매니저는 **npm**. Node 24.

## 2. 디렉터리 구조

```
src/
  app/
    (auth)/login, (auth)/invite/[token]
    d/...            기사 화면 (모바일 우선)
    m/...            담당자 화면 (PC·모바일)
    api/...          Route Handlers (얇게: 인증 → zod → 서비스 호출 → 응답)
  server/
    db/schema.ts     Drizzle 스키마 (단일 파일 또는 schema/*.ts)
    db/client.ts
    auth/            세션·비밀번호·초대
    authz.ts         권한/접근 범위 헬퍼 (모든 조회·수정·다운로드·출력에서 사용)
    http.ts          에러 형식, idempotency 래퍼, 요청 컨텍스트
    audit.ts
    domain/          순수 계산 로직 (금액·세금·반올림·상태 전이) — DB 의존 없음
    services/        업무 서비스 (트랜잭션 단위). API와 테스트는 여기만 호출
  components/
  client/            브라우저 전용 (offline queue, api client)
tests/
  integration/       Vitest (서비스/API)
  e2e/               Playwright
docs/
scripts/             db 시작, 시드, 백업/복구
```

## 3. 역할과 접근 범위

| 역할 (`users.role`) | 가능한 작업 | 접근 범위 |
|---|---|---|
| `DRIVER` 기사 | 본인 운행 등록·증빙·제출·보완, 본인 내역과 지급(PAYABLE) 인정액 확인 | `vehicle_uses.driver_id = user.driver_id` 인 건 **그리고** 배정된 현장. 고객청구(RECEIVABLE) 금액·다른 기사 자료는 절대 노출 안 함 |
| `SITE_MANAGER` 현장 담당자 | 대리 입력, 검수(승인·보완요청), 비용 수정 | 배정된 현장(`project_assignments`) |
| `SETTLEMENT_MANAGER` 정산 담당자 | 명세 작성·확정·취소, 지급·입금 기록, 조정, 검수도 가능 | 배정된 현장 (또는 `users.all_projects=true`) |
| `ADMIN` 관리자 | 전부 + 사용자·권한·기준정보·단가 | 전체 |

- 권한 검사는 **서버에서만 신뢰**한다. `src/server/authz.ts` 의 함수로 목록 필터와 단건 접근 검사를 한 곳에서 제공한다.
  - `accessibleProjectIds(ctx)` / `assertCanReadUse(ctx, use)` / `assertCanEditUse` / `assertCanReview` / `canSeeReceivable(ctx)` 등.
- 접근 불가 단건은 존재를 숨기기 위해 **404** 로 응답한다.
- 작성자(`created_by_user_id`)와 실제 기사(`driver_id`)를 따로 저장. `entered_as`: `DRIVER_SELF` | `PROXY`. 대리 입력을 기사 작성/확인으로 표시하지 않는다.
- 권한 회수: `users.status='DISABLED'` 또는 배정 `revoked_at` 설정 즉시 모든 요청(대기열 재전송 포함)이 거부된다. 세션 조회 시 매번 사용자 상태를 확인한다.

## 4. 인증

- 로그인 ID(휴대폰번호 또는 아이디) + 비밀번호. 해시는 `@node-rs/argon2` 또는 `bcryptjs`.
- DB 세션: `sessions.token_hash`(SHA-256), httpOnly·SameSite=Lax 쿠키 `sid`, 만료 30일(모바일 반복 로그인 부담 최소화), 로그아웃·비활성화 시 폐기.
- 초대: 관리자가 역할·이름·연락처·(기사면 driver 연결)·현장 배정으로 초대 생성 → 1회용 토큰 링크 `/invite/<token>` (만료 7일). 사용·만료·취소된 토큰은 재사용 불가. 초대받지 않은 사람은 가입 불가 (공개 가입 없음).
- 최초 관리자: `npm run seed` 또는 `scripts/create-admin.ts`.
- 개인정보 최소 수집: 주민번호·신분증 필드 없음. 연락처는 담당자 이상에게만.

## 5. 데이터 모델

테이블명 snake_case, PK는 `uuid` (`gen_random_uuid()`), 모든 테이블 `created_at`, 수정되는 테이블은 `updated_at`, 동시 수정 대상은 `version int` (낙관적 잠금).

### 5.1 사용자·기준정보

- `users`: id, login_id(unique), password_hash, name, phone, role, driver_id(null, fk drivers), all_projects bool, status(`ACTIVE`|`DISABLED`), version
- `sessions`: id, user_id, token_hash(unique), expires_at, revoked_at, last_seen_at
- `invites`: id, token_hash(unique), role, name, phone, driver_id, project_ids jsonb, expires_at, used_at, used_by_user_id, revoked_at, created_by
- `projects` 현장: id, code(unique), name, active, evidence_policy(`PHOTO_REQUIRED`|`PHOTO_OR_ALTERNATIVE`|`NONE`)
- `project_assignments`: id, user_id, project_id, valid_from, valid_to(null), revoked_at. 유효 배정 = revoked_at null 이고 오늘이 기간 내
- `work_types` 공종: id, name, active
- `counterparties` 거래처: id, name, biz_no, kind(`CARRIER` 운송사 | `DRIVER_BUSINESS` 기사 사업자 | `CUSTOMER` 원청·고객), contact_name, phone, bank_account, active
- `drivers`: id, name, phone, default_vehicle_id, active
- `driver_affiliations` 기사 소속(지급처) 기간: id, driver_id, counterparty_id, valid_from, valid_to(null)
- `vehicles`: id, plate_no(unique), vehicle_type(차종), tonnage numeric, active
- 사용 중지(active=false)는 선택 목록에서만 빠지고 과거 기록 조회는 정상.

### 5.2 계약·단가

- `rate_agreements`: id, name, direction(`PAYABLE` 지급 | `RECEIVABLE` 청구), counterparty_id, project_id(null=전 현장), vehicle_type(null), tonnage(null), billing_unit, unit_price int(원), valid_from date, valid_to date(null), tax_mode, rounding, min_charge int(null), notes, active, version
  - `billing_unit`: `PER_TRIP` 회당·건당 | `PER_DAY` 일대 | `HALF_DAY` 반일 | `MONTHLY` 월대 | `PER_HOUR` 시간 | `PER_TON` 톤 | `PER_M3` 루베 | `LUMP_SUM` 1식(왕복 묶음 등)
  - `tax_mode`: `VAT_EXCLUDED`(공급가+부가세10% 별도) | `VAT_INCLUDED`(단가에 포함) | `TAX_EXEMPT`
  - `rounding`: `HALF_UP` | `DOWN` | `UP` (원 단위)
  - 이미 비용 항목에서 참조된 계약의 단가·단위·기간은 수정 불가 → 새 적용기간 행을 추가하고 기존 행 `valid_to` 를 닫는다 (단가 이력).
  - 조회 규칙: (direction, counterparty, 사용일이 기간 내, project 일치 또는 null, vehicle_type/tonnage 일치 또는 null) 중 가장 구체적인 것. 없으면 단가 미확정.

### 5.3 차량 사용 (핵심)

**차량 사용 건(VehicleUse) 1 : N 운행(Trip), 1 : N 비용 항목(ChargeLine), 1 : N 증빙(Evidence).**

- `vehicle_uses`
  - id, use_no(unique, 예 `U-2609-00012`), client_request_id(unique, null 허용 — 생성 멱등), create_request_hash(nullable SHA-256; 생성 요청 본문 일치 검사, F6)
  - use_date(실제 사용일, date), end_date(null; 월대 등 기간형)
  - project_id, work_type_id(null), requester(text), driver_id, vehicle_id
  - payee_counterparty_id (지급 대상; 기본값 = 사용일 기준 기사 소속), customer_counterparty_id(null; 고객 청구 대상)
  - cargo_desc(운반 내용), notes
  - **snapshot jsonb**: 사용 당시의 기사명·연락처, 차량번호·차종·톤수, 지급처명·사업자번호, 현장명, 고객명. 생성·내용수정 시 갱신, 이후 기준정보가 바뀌어도 이 값으로 표시·출력.
  - operation_status: `PLANNED` | `IN_PROGRESS` | `COMPLETED` | `CANCELED`
  - review_status: `DRAFT` | `SUBMITTED` | `NEEDS_FIX` | `APPROVED`
  - current_revision_no int, approved_revision_id(null)
  - created_by_user_id, entered_as(`DRIVER_SELF`|`PROXY`), driver_confirmed_at(null; 대리입력 건을 기사가 확인한 시각)
  - source_row_hash(null, unique; 엑셀 가져오기 중복 방지)
  - version, created_at(시스템 입력일), updated_at
  - **차량+날짜 유니크 제약 없음.** 같은 날 같은 차량의 다른 계약 사용 건이 존재 가능.
- `trips` 운행 실적
  - id, vehicle_use_id, seq(사용 건 내 회차, unique(vehicle_use_id, seq)), status(`PLANNED`|`IN_PROGRESS`|`COMPLETED`|`CANCELED`)
  - origin, destination, via(text[] null), depart_at, arrive_at(timestamptz null), cargo_desc, quantity numeric(null), quantity_unit(null), hours numeric(null), is_empty_return bool, notes, client_row_id(null; 클라이언트 행 식별, 재전송 중복 방지)
  - 같은 날짜·경로 반복 운행은 **정상 데이터**. 중복 의심은 경고만 하고 차단·삭제하지 않는다.
- `charge_lines` 비용 항목
  - id, vehicle_use_id, trip_id(null), direction(`PAYABLE`|`RECEIVABLE`), counterparty_id
  - charge_type: `BASE` 기본운임 | `WAITING` 대기료 | `TOLL` 통행료 | `EXTRA_STOP` 경유비 | `CANCEL_FEE` 취소·회차비 | `EXPENSE` 실비 | `OTHER` | `ADJUSTMENT` 조정
  - billing_unit, quantity numeric(12,3)(null), unit_price int(null), rate_agreement_id(null), rate_basis_date, agreement_snapshot jsonb(계약명·단위·단가·세금·반올림 당시값)
  - tax_mode, rounding
  - computed_amount int(null) = round(quantity × unit_price) (최소요금 반영)
  - requested_amount int(null) 기사·작성자 요청액 (추가비)
  - approved_amount int(null) 승인액 — **정산에 쓰는 최종 공급가액**
  - tax_amount int(null) (approved_amount 기준 계산)
  - price_status: `PENDING` 단가 미확정 | `CONFIRMED`. **미확정(null)과 0원은 다르다.** 0원은 CONFIRMED + approved_amount=0.
  - line_review_status: `PENDING` | `APPROVED` | `HELD` 보류(별도 검토) | `REJECTED`
  - reason(추가비 사유), included_in_base bool(기본운임 포함 항목 표시)
  - adjusts_statement_id(null) — `ADJUSTMENT` 가 어떤 원명세를 정정하는지
  - locked_statement_id(null) — 유효 **확정** 명세에 포함되면 설정, 명세 취소 시 해제
  - deleted_at(null; 논리 삭제), version
  - **서버는 청구 수량을 운행 행 수로 자동 해석하지 않는다.** UI는 PER_TRIP의 미입력 수량에 완료 운행 수를 자동 입력하고 수정 가능함을 안내한다(F7B 사용자 지시). 사용자가 직접 입력·삭제하면 이후 자동 변경하지 않으며, 저장·제출 시 전달한 수량을 서버가 검증·계산한다. PER_DAY/HALF_DAY/MONTHLY/LUMP_SUM 은 기본 수량 1.
- `evidence` 증빙
  - id, vehicle_use_id, trip_id(null), kind(`PHOTO`|`RECEIPT` 인수증|`WEIGH_TICKET` 계근표|`CONFIRMATION` 확인서|`SLIP_NO` 전표번호(텍스트형 대체증빙)|`OTHER`)
  - client_upload_id(unique; 업로드 멱등), storage_key(null), original_name, mime, size, sha256, text_value(전표번호 등)
  - upload_status: `PENDING` | `UPLOADED` | `FAILED`, uploaded_by, uploaded_at
  - replaced_by_id(null), replace_reason, deleted_at
- `use_revisions` 제출 버전·검수 기록
  - id, vehicle_use_id, revision_no, snapshot jsonb(사용건+운행+비용+증빙목록 전체), submitted_by, submitted_at
  - decision: `PENDING` | `APPROVED` | `NEEDS_FIX` | `SUPERSEDED`, decided_by, decided_at, comment
  - fix_items jsonb: `[{ target: "trip:2.destination" | "evidence" | "charge:<id>" | ..., message: "하차 장소만 추가해 주세요" }]`

### 5.4 정산·지급

- `statements` 정산명세 (지급명세 / 고객 청구명세)
  - id, statement_no(unique, 확정 시 부여: 지급 `PAY-YYYYMM-0001`, 청구 `BIL-YYYYMM-0001`; 작성 중엔 null)
  - direction, counterparty_id, period_start, period_end(정산 기간, 기본 해당 월), title
  - status: `DRAFT` 작성중 | `CONFIRMED` 확정 | `CANCELED` 취소
  - counterparty_snapshot jsonb, issuer_snapshot jsonb(회사정보)
  - supply_total, tax_total, grand_total (int; 확정 시 고정)
  - due_date(지급 예정일 / 입금 예정일)
  - confirmed_at/by, canceled_at/by, cancel_reason, created_by, client_request_id(unique), version
  - `replaces_statement_id`(null): 취소 후 재작성 연결
- `statement_items`
  - id, statement_id, charge_line_id, inclusion(`INCLUDED`|`HELD`), hold_reason
  - snapshot jsonb: 사용번호·실제 사용일·현장·차량·기사·운반내용·운행수·과금단위·수량·단가·공급가·세액·비고 (확정 시 고정)
  - supply_amount, tax_amount
  - is_active_lock bool (확정명세의 INCLUDED 항목이면 true, 취소 시 false)
  - unique(statement_id, charge_line_id)
  - **부분 유니크 인덱스**: `unique(charge_line_id) WHERE is_active_lock` → 같은 비용 항목이 두 유효 확정명세에 들어갈 수 없음(방향은 charge_line에 1개뿐이므로 방향별 독립)
- `payment_records` 지급·입금 기록
  - id, statement_id, kind(`PAYMENT` 지급 | `RECEIPT` 입금 — 명세 direction과 일치), amount, paid_on date, method, reference(송금 참고번호), memo, recorded_by, recorded_at
  - voided_at, voided_by, void_reason (오입력 취소; 행은 삭제하지 않음)
  - client_request_id(unique)
  - v1: **전액 1회 완납만** (amount == grand_total). 부분 유니크 `unique(statement_id) WHERE voided_at IS NULL`.
  - 명세의 지급 상태는 유효 기록 존재 여부로 파생: `UNPAID` | `PAID`. 청구명세는 `UNBILLED`(작성중) / `BILLED`(확정) / `RECEIVED`(입금).

### 5.5 공통

- `audit_logs`: id, at, user_id, action, entity_type, entity_id, before jsonb, after jsonb, reason, request_id
- `idempotency_keys`: id, user_id, key, route, request_hash, status_code, response_body jsonb, created_at; unique(user_id, key)
- `import_jobs`: id, file_name, status(`PREVIEW`|`COMMITTED`|`FAILED`), mapping jsonb, summary jsonb, rows jsonb, created_by, committed_at
- `company_settings` (단일 행): id, name(회사명), biz_no(사업자번호), address(주소), representative(대표자), default_tax_mode(기본 세금모드), settlement_contact(정산 담당 연락처)

## 6. 업무 규칙 (반드시 테스트로 증명)

1. **사용 건·운행·과금 단위 분리.** 일대 30만 원 + 운행 5건 → BASE 1줄, 수량 1, 300,000원.
2. **회당 10만 원 × 청구수량 5** → 500,000원 (수량은 사용자가 확정한 값).
3. **기사/차량/지급처/비용현장 분리** + snapshot 으로 당시 정보 유지.
4. **지급과 청구 분리.** PAYABLE 과 RECEIVABLE 은 별도 charge_line. 지급단가 수정이 청구단가를 바꾸지 않는다. 기사에게 RECEIVABLE 은 API 응답에서 제거.
5. **당시 단가 보존.** 금액 계산 결과와 근거(agreement_snapshot)를 저장. 과거 건을 현재 단가표로 재계산하지 않는다. 금액은 서버가 최종 계산·검증(클라이언트가 보낸 금액을 신뢰하지 않음; 요청액만 입력으로 받음).
6. **상태 3축 분리.** 운행 완료 ≠ 승인 ≠ 정산 ≠ 지급.
7. **승인은 제출 버전(use_revisions)에 연결.** 승인 후 내용(사용건 필드·운행·비용·증빙) 변경 시:
   - 잠긴(locked_statement_id) 비용이 있으면 변경 거부 `409 STATEMENT_LOCKED` (명세 취소 먼저)
   - 아니면 approved 해제: 기사 수정 → `DRAFT`(재제출 필요), 담당자 수정 → 새 revision 자동 생성 후 `SUBMITTED`. 이전 revision·승인 기록은 보존(`SUPERSEDED`).
   - 추가비 한 줄만 `HELD` 로 두고 나머지를 승인할 수 있다 (라인별 line_review_status).
8. **명세 확정은 서버 트랜잭션에서 재검사 후 잠금.** 포함 항목 각각:
   사용건 `APPROVED` && 라인 `APPROVED` && `price_status=CONFIRMED` && approved_amount not null && 필수 증빙 충족 && 라인 direction/counterparty 가 명세와 일치 && 다른 유효 확정명세에 없음 && deleted_at null.
   - 구현: `SELECT ... FOR UPDATE` 로 대상 charge_lines 잠금 → 검사 → `UPDATE charge_lines SET locked_statement_id=$s WHERE id=ANY($ids) AND locked_statement_id IS NULL` 영향 행 수 검사 → statement_items.is_active_lock=true (부분 유니크가 최종 방어). 실패 시 전체 롤백 + 사유 목록 반환(`422 CONFIRM_BLOCKED`, details: [{chargeLineId, useNo, reason}]).
   - 확정 후 화면·엑셀·PDF 는 statement_items.snapshot 과 statements 합계만 사용.
9. **정정 경로.** 작성·검수중: 수정 후 제출 / 승인 후 확정 전: 변경 시 재승인 / 확정·지급 전: 사유 입력 후 명세 취소(잠금 해제, 이력 보존) → 수정·재확정 / 지급 기록 오입력: void(원기록 보존, 미지급 복귀) / 지급 후 금액 변경: 원명세 유지, `ADJUSTMENT` 라인(음수 가능, adjusts_statement_id, 사유 필수)을 다음 명세에 포함. 지급 기록이 있는 명세는 취소 불가(먼저 void).
10. **멱등성.** 생성·제출·승인·확정·지급기록 요청은 `Idempotency-Key` 헤더(및 생성은 client_request_id)로 1회만 반영. 같은 키 재요청은 저장된 응답 재생. 동시 수정은 `version` 불일치 시 `409 VERSION_CONFLICT` (현재 값 반환).
11. **운행일 ≠ 정산 기간.** 명세의 period 와 사용일은 독립. 이전 달 사용분도 미정산이면 다음 달 명세 후보에 "전월분" 표시로 포함. 과거 확정명세는 자동 변경하지 않는다.
12. **임시저장/서버제출/첨부 업로드 상태 분리.** 기기 초안(IndexedDB) → 서버 저장(DRAFT) → 제출(SUBMITTED). 사진 실패 시 사진만 재전송(client_upload_id 로 중복 없음). 필수 증빙이 `UPLOADED` 가 아니면 제출 불가(서버 검사).
13. **권한 회수** 즉시 모든 경로(조회·수정·첨부 다운로드·엑셀·PDF·대기열 재전송) 차단.

### 필수 증빙 규칙
- 현장 `evidence_policy`:
  - `PHOTO_REQUIRED`: 사용 건에 UPLOADED 된 PHOTO/RECEIPT/WEIGH_TICKET/CONFIRMATION 파일 1개 이상
  - `PHOTO_OR_ALTERNATIVE`: 위 파일 1개 이상 **또는** SLIP_NO(텍스트)·CONFIRMATION 1개 이상 (촬영 금지 현장)
  - `NONE`: 없음
- 제출 시 검사, 명세 확정 시 재검사.

### 금액·세금 계산 (`src/server/domain/money.ts`)
- computed = rounding(quantity × unit_price), min_charge 있으면 max 적용.
- 세액: `VAT_EXCLUDED` → tax = round_half_up(supply × 0.1); `VAT_INCLUDED` → 단가·금액이 부가세 포함가: supply = round_half_up(gross/1.1), tax = gross − supply; `TAX_EXEMPT` → 0.
- 명세 합계 = 포함 항목의 supply/tax 합. 명세 레벨 재반올림 없음(라인 합산) — 화면·엑셀·PDF 동일.

## 7. API 규칙

- JSON. 성공 `{ data }`, 실패 `{ error: { code, message, details? } }`.
- 코드: `UNAUTHENTICATED`(401), `FORBIDDEN`(403), `NOT_FOUND`(404; 접근불가 포함), `VALIDATION_FAILED`(422), `VERSION_CONFLICT`(409), `STATEMENT_LOCKED`(409), `CONFIRM_BLOCKED`(422), `SUBMIT_BLOCKED`(422), `IDEMPOTENCY_MISMATCH`(422). 예상하지 못한 서버 오류는 `INTERNAL_ERROR`(500; 내부 상세 비공개).
- 모든 mutation 은 `withRoute(handler, { idempotent: true })` 같은 공용 래퍼 사용 (`src/server/http.ts`): 세션 → 사용자 상태 확인 → zod → 서비스 → 감사로그.
- 목록 API는 `page`, `pageSize`, 정렬, 필터를 받고 `{ data: { rows, page, pageSize, total, totals: { pageSum, filteredSum } } }` 처럼 **현재 페이지 합계와 전체 검색결과 합계를 구분**해 반환.

### 엔드포인트 목록 (소유 워커 표기)

| 경로 | 설명 | 소유 |
|---|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me` | 인증 | W1 |
| `GET/POST /api/invites`, `POST /api/invites/:token/accept`, `DELETE /api/invites/:id` | 초대 | W1 |
| `GET/POST /api/uses`, `GET/PATCH /api/uses/:id` | 사용 건 CRUD(운행·비용 포함 중첩 저장) | W1 |
| `POST /api/uses/:id/submit`, `/approve`, `/request-fix`, `/confirm-by-driver`, `/copy`, `/cancel` | 상태 전이 | W1 |
| `PATCH /api/charge-lines/:id/review` | 라인별 승인액·보류 | W1 |
| `POST /api/uses/:id/evidence`(메타 생성), `PUT /api/evidence/:id/content`(업로드), `GET /api/evidence/:id/file`, `DELETE`, `POST /api/evidence/:id/replace` | 증빙 | W1 |
| `GET /api/rates/lookup?...` | 단가 조회(폼 자동채움) | W1 |
| `GET /api/lookups` | 현장·차량·거래처·공종 선택목록(권한 반영) | W1 |
| `GET /api/uses/recent-routes`, 대시보드 카운트 | 입력 편의·대시보드 | W3 |
| `GET /api/ledger`, `GET /api/ledger/export.xlsx` | 사용대장 | W3 |
| `/api/admin/{projects,work-types,counterparties,drivers,affiliations,vehicles,rates,users,assignments,company}` | 기준정보·사용자 | W3 |
| `GET /api/audit` | 변경 이력 | W3 |
| `/api/statements/candidates`, `POST /api/statements`, `PATCH /api/statements/:id/items`, `POST /:id/confirm`, `POST /:id/cancel`, `GET /:id/export.xlsx`, `GET /:id/export.pdf` | 정산 | W4 |
| `POST /api/statements/:id/payments`, `POST /api/payments/:id/void`, `GET /api/payments/overview` | 지급·입금 | W4 |
| `POST /api/adjustments` | 지급 후 조정 | W4 |
| `/api/import/*` | 엑셀 가져오기 | W5 |

## 8. 화면

- 기사 `/d`: 하단 탭 3개 **내 운행 / 운행 등록 / 내 정산**. 큰 글씨·큰 버튼, `inputmode` 맞춤, 오늘 날짜·기본 차량 기본값, 최근 현장·경로, 이전 운행 복사(증빙·승인·정산 연결 제외), "휴대폰에 임시저장" vs "담당자에게 제출 완료" vs "사진 업로드 대기/실패" 구분 표시, 보완요청 항목 강조.
- 담당자 `/m`: 대시보드(검수 대기·보완 대기·증빙 누락·미정산 승인액·미지급액), 검수함, 차량 사용대장(필터·검색·정렬·페이지·합계 구분), 사용 상세(실적·증빙 나란히, 라인별 승인), 대리 입력, 월 정산(거래처·기간 → 포함/보류 → 확정), 명세 상세(엑셀·PDF·취소 이력), 지급 관리(예정일·미지급·지급기록·오입력 취소), 기준정보, 사용자 관리, 변경 이력.
- 문서 이름을 구분 표기: 차량 사용대장 / 운송사 지급명세 / 원청 청구명세. 앱 PDF는 세금계산서가 아님을 표기.

## 9. 업무 가정 (미확정 사항 — docs/ASSUMPTIONS.md 에 유지)

- 기본 업무: 외주 차량비 지급. 고객 청구(RECEIVABLE)는 같은 구조로 v1에 포함하되 기본은 꺼져 있지 않음(거래처 kind=CUSTOMER 존재 시 사용).
- 과금방식: 8종 enum 모두 `수량 × 단가` 로 계산 가능하므로 모두 지원. 일할·휴차공제·최소요금 이외 복잡 규칙은 미지원(수동 조정 라인 사용).
- 지급: 전액 1회 수동 기록. 부분지급·선지급·상계는 후속.
- 단일 회사. 멀티테넌트는 후속.

## 10. 워커 공통 규칙

- 자신에게 배정된 파일/디렉터리만 수정. 공용 파일(`schema.ts`, `package.json`, `http.ts`, `authz.ts`, 레이아웃/내비게이션)을 바꿔야 하면 **최소 변경**하고 worker_done 요약에 명시.
- 스키마 변경이 필요하면 새 마이그레이션 파일로 추가(기존 마이그레이션 수정 금지, W1 이후).
- 커밋은 논리 단위로, 메시지는 한국어 또는 영어, 끝에 `Co-Authored-By` 불필요.
- 완료 전 `npm run typecheck && npm run lint && npm test` 통과.
- 사용자 표시 문구는 한국어.

## 11. W1 세부 입력 계약

필드·enum·업무 모델은 위 정의를 유지한다. 중첩 배열 저장 방식, 입력 JSON, 버전 대상, 응답 합계, 증빙 재전송 및 워커 간 잠금 순서는 [API.md](API.md)에 명시한다. W1의 모듈·테스트 헬퍼 사용법과 검증 결과는 [reports/W1.md](reports/W1.md)에 있다.

## 12. W5 가져오기 영속화 보완

§5.5의 기존 import_jobs와 §5.3의 source_row_hash를 사용한다. 마이그레이션 `0100_w5_import.sql`은 사용 건에 nullable `import_job_id` FK를 추가하고, 개인별 매핑 프리셋 `import_presets(id, name, mapping jsonb, created_by, created_at)` 및 `(created_by, name)` unique를 추가한다. 업무 상태 모델은 변경하지 않는다. 가져온 자료는 DRAFT/PROXY이고 수량·단가·재가져오기 계약은 [ASSUMPTIONS](ASSUMPTIONS.md), HTTP 계약은 [API](API.md)에 기록한다.


## 13. W9 입력 항목 설정

사용자 승인 범위로 `0300_w9_field_settings.sql`을 추가한다. `form_field_settings`는 `project_id`(null=회사), `field_key`, nullable `driver_mode`/`manager_mode`(HIDDEN/OPTIONAL/REQUIRED), `updated_by`, `version`, 생성·수정 시각을 보관한다. 회사 필드와 현장 필드는 별도 부분 유니크 인덱스로 중복을 막는다. null 모드는 상위 기본값을 따르며 재정의 해제 후에도 버전을 유지한다.

`/m/master/form-fields` 및 `/api/admin/form-fields`는 ADMIN 전용이다. `/api/form-settings?project_id=`는 접근 가능한 현장의 요청자 역할에 유효한 모드를 반환하며, 담당자에게는 보완요청 대상 판단용 기사 모드도 제공한다. 공통 폼과 서버 제출은 `src/shared/form-settings.ts`의 항목·라벨·기본값·필수 검사를 공유한다. 표시 설정으로 금액·권한·청구수량·증빙 정책을 해제할 수 없다. 세부 판단은 [ASSUMPTIONS](ASSUMPTIONS.md)의 W9 절을 따른다.

## 14. F9 인증 보안 보완

작업 지시에 따라 `0400_f9_login_throttle.sql`에서 DB 공유 실패 카운터 `login_throttles`를 추가한다. 계정/IP 구분, SHA-256 키, 실패 횟수, 실패 구간 시작, 잠금 만료와 생성/수정 시각을 저장한다. 업무·금액 모델은 변경하지 않는다. API 경계는 [API](API.md), 프록시 설정과 수동 잠금 해제는 [OPERATIONS](OPERATIONS.md)를 따른다.

## 15. F10 증빙 귀속 기사

`0410_f10_evidence_owner.sql`은 evidence에 nullable FK `owner_driver_id`를 추가한다. 서버는 증빙 생성 시 부모 사용 건을 잠그고 당시 driver_id를 기록한다. 업로더의 계정 역할/기사 연결 및 이후 사용 건 기사 변경에 영향을 받지 않으며 DB trigger로 귀속 기사·부모 사용 건 변경을 금지한다. 기존 자료는 버전 이력으로 입증되는 귀속만 복원하고 불명확하면 null(담당자 전용)로 유지한다.

기사는 현재 사용 건·현장 접근 권한과 증빙의 `owner_driver_id = 본인 driver_id`를 모두 충족해야 한다. 제출·승인·정산 확정의 필수 증빙은 기존처럼 해당 사용 건의 유효 증빙 전체로 판단하며, 증빙 열람 가능 여부와 분리한다. 상세 응답은 제한된 현재 증빙의 건수와 필수 정책 충족 여부만 안내용으로 제공한다. [F10 보고서](reports/F10.md) 참조.

## 16. DEPLOY 테스트 배포 확장

사용자 DEPLOY 지시에 따라 DB_SCHEMA 지정 시 전용 스키마와 그 안의 마이그레이션 이력을 사용한다. 미설정 로컬의 public/drizzle 위치는 유지한다. 명시적으로 허용된 초기 SQL 두 파일의 public 한정자 제거 외 기존 업무 마이그레이션은 변경하지 않는다.

`0500_deploy_evidence_blobs.sql`의 `evidence_blobs(storage_key pk, bytes bytea, size int, sha256 text, created_at timestamptz)`는 증빙·가져오기 XLSX 원본을 위한 저장 드라이버다. `STORAGE_DRIVER=db`일 때 업무 트랜잭션에 함께 저장하고, 기본 local은 기존 파일 저장을 유지한다. 증빙 논리 삭제·교체 이력·귀속·권한 계약은 유지한다. 환경·백업·복구·제약은 [DEPLOY](DEPLOY.md)를 따른다.
