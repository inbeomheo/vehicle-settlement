# F2-MONEY2 — 2차 금액 검토 수정

## 범위와 환경

- 전용 `.env.local`, PostgreSQL 54382, 웹/E2E 3182만 사용했다.
- 운영 DB·배포 비밀 파일·다른 포트는 사용하지 않았다. 패키지·마이그레이션 추가 없음.
- 실제 PostgreSQL 격리 DB와 `vehicle_e2e`에서 검증했다. E2E 전후 개발 DB 업무 테이블 건수는 모두 그대로였다.

## 1. 고객 청구를 확인하지 않은 바로 승인

원인은 목록 판정이 PAYABLE만 검사하지만 실제 승인은 PENDING인 양 방향 비용을 처리하는 데 있었다. 청구 계약 50만 원/요청 90만 원, 청구액 미정, 계약 없이 요청액만 있는 경우를 저장소 통합 테스트로 먼저 추가하여 실패를 확인했다.

- PENDING RECEIVABLE에 금액 미정·계약 없음·계약액과 요청액 차이가 있으면 `receivable_needs_review`를 반환한다.
- 공용 `quickApprovable`과 `quickApprovalIssues`가 서버 재검사·검수함·운행 결재·선택 승인에 같은 조건과 사유를 제공한다. “고객 청구 금액 확인 필요”와 “열기”를 표시한다.
- 계약대로인 청구는 `review_receivable_amount` 공급가를 카드/목록에 표시한다. 승인 요청에도 전달하고 잠금 안에서 재검사한다. 고객 청구가 있는데 표시 청구액을 생략한 구버전 요청도 거부한다.
- 이미 상세 검수에서 승인·반려한 청구는 기존 결정을 유지한다. 계약 존재 여부는 저장된 계약 ID로 판단한다. 계약 없이 가져온 청구 단가도 상세 검수 대상으로 보낸다.

추가 테스트는 계약 차이/미정/무계약, 화면 판정과 직접 서버 호출, 공급가 표시 불일치, 세금 모드 3종·0원, 상세 승인/보류/반려 유지, 기사 응답의 청구 비노출을 다룬다.

## 2. 보류액과 승인액 혼동

기존 검수 금액 집계는 REJECTED만 제외해 HELD를 포함했고, 전체 승인은 HELD를 제외했다.

- 어느 방향이든 보류가 있으면 “보류 항목 있음”을 표시하고 바로 승인/선택에서 제외한다.
- 승인 대상 지급액·청구액은 PENDING/APPROVED만 합산한다. 보류 지급/청구는 별도로 표시하며 미정과 0원을 구분한다.
- 기본운임 전체가 보류된 경우에도 승인 대상은 0원, 보류액은 별도 금액으로 표시한다.
- 상세 전체 승인에서는 기존처럼 보류·반려를 제외한다.

추가 테스트는 지급 30만 원+보류 통행료 5만 원, 현재 버전 직접 바로 승인 거부, 상세 승인액 30만 원, 청구 보류의 미정 금액, 기본운임 전체 보류를 검증한다. 검수함·운행 결재 E2E는 사유/분리 금액/열기/선택 제외와 정상 청구의 선택 승인을 확인한다.

## 3. 기사 보내기 완료 화면의 불안정한 이동

단독 원본 테스트는 통과했지만 지연 회귀 테스트에서 제출 POST 200 뒤 같은 `?submitted=1` 문서 GET이 세 번 발생하고 `ERR_ABORTED`가 재현됐다. `syncQueue`의 완료 이벤트 처리와 보내기 함수가 각각 `location.assign`을 호출하고 있었다.

- 컴포넌트의 ref에 이동 목적지를 동기적으로 기록해 같은 완료 페이지 이동을 한 번만 수행한다. Next 전용 import를 추가하지 않았다.
- E2E는 목적지 URL과 완료 화면을 각각 기다린다. 완료 페이지의 hydration/상세 GET에는 15초의 제한을 적용한다.
- 새 회귀 테스트는 문서 이동을 잠깐 지연해 두 완료 경로가 겹치게 하고, 상세 응답을 6.5초 지연해 기본 5초 단언을 넘긴다. 문서 요청 1회, 완료 화면, DB의 SUBMITTED를 확인한다. 이 테스트만 서비스워커를 끄며 기존 오프라인 PRICE 테스트는 그대로 실행한다.

## 검증 결과

- `npm run typecheck`, `npm run lint`, `npm run format:check`: 통과.
- `npm test`: 실제 PostgreSQL 포함 82파일 / 484테스트 통과. 새 MONEY2 통합 테스트는 11개다.
- 관련 E2E `F2-MONEY2-quick-approval`, `FIX-MONEY`, `W3-review`, `LIST-approvals`: 15개 통과.
- 원래 PRICE 실패 사례 단독: 서버를 매번 새로 시작해 3회 연속 통과 (18.3초 / 15.8초 / 15.6초).
- PRICE 전체 6개: 서버를 매번 새로 시작해 3회 연속 통과 (42.5초 / 38.1초 / 37.1초). 로그는 `/private/tmp/f2-money2-price-final-full-{1,2,3}.log`.
- 새 화면 회귀 테스트: 검수함·운행 결재 각 1개, 기사 중복 이동·느린 상세 조회 1개.
- 모든 E2E는 `DOTENV_CONFIG_PATH=.env.local PG_PORT=54382 PORT=3182 npx playwright test ...`로 실행했다. Vitest는 `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54382/postgres`를 명시했다.
- 실패 재현 로그: `/private/tmp/f2-money2-red.log`, `f2-money2-e2e-red.log`, `f2-money2-navigation-red.log`, `f2-money2-held-base-red.log`.
- 최종 전체 통합 테스트 로그: `/private/tmp/f2-money2-complete-suite.log`. 관련 E2E 로그: `f2-money2-related-final.log`.

## 공용 파일 및 다른 작업자 범위

- `src/shared/quick-approval.ts`: 공용 판정과 표시 사유.
- `src/server/services/ledger.ts`, `schemas.ts`, `uses.ts`: 금액 집계·승인 입력·서버 재검사.
- `src/components/manager/quick-approval.ts`, `ledger.tsx`, 새 `review-other-amounts.tsx`: 승인 요청·검수 카드 금액/사유.
- 다른 작업자 UI 범위인 `src/components/manager/approvals.tsx`는 금액 표시 함수와 import만 변경했다. 탭·필터·표 배치 변경 없음.
- `src/components/use-form/use-form.tsx`: 기사 제출 완료 이동 중복 방지만 변경했다. 오프라인 셸 빌드는 E2E 서버 시작 시 실행·통과했다.
- `docs/API.md`: 청구액 확인 및 보류 분리 응답 계약을 갱신했다.

남은 문제: 요청 범위 내 알려진 미해결 결함 없음. 운영 배포와 기존 운영 자료의 정정은 이번 작업에 포함하지 않았다.
