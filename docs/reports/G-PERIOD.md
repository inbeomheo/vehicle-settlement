# G-PERIOD — 회사 마감 기간 빠른 선택

## 원인과 수정

1. 회사 마감일이 저장되지 않아 화면들이 달력 월을 각각 계산했다. `company_settings.closing_start_day`(기본 19, 정수 1~28)를 추가하고 회사 정보 폼 한 항목에서 저장한다. 기존 ADMIN 쓰기·잠금·감사 경로를 사용하며 zod와 PostgreSQL CHECK가 함께 범위를 검사한다. 부분 수정 시 생략한 마감일은 보존한다.
2. 집계·내 정산·새 정산·운행 결재·사용대장의 기간 선택이 서로 달랐다. `src/shared/closing-period.ts`의 서울 날짜·마감 계산을 공유하며 두 빠른 버튼에 실제 날짜를 표시한다. 시작일 1은 `이번 달/지난달`이다. 집계 상세·집계 엑셀·거래명세표 엑셀은 같은 조회 기간을 그대로 전달한다.
3. 설정을 읽기 전에 잘못된 기본 기간으로 요청하지 않도록 로딩·실패·재시도를 제공한다. 설정 조회 API는 로그인한 활성 사용자에게 마감일과 서울 날짜만 공개하며 회사 개인정보는 노출하지 않는다.
4. 새 E2E에서 사용대장 빠른 선택의 URL과 입력칸이 불일치하는 문제를 발견했다. 조회 조건과 입력칸을 함께 갱신하도록 수정 후 재검증했다.

금액·수량·명세 확정 로직은 변경하지 않았고 기존 명세·스냅샷은 보존한다. 새 npm 패키지는 없다.

## 화면별 기본 기간 결정

| 화면 | 기본 기간 | 명시적 선택·예외 |
|---|---|---|
| 현장·기사별 집계 | 이번 마감 | URL의 from/to·지급처·현장·기사·상세·정렬 보존 |
| 집계 상세 | 집계와 같은 기간 | 빠른 선택 뒤 상세 상태 유지 |
| 집계 엑셀·거래명세표 엑셀 | 집계에서 선택한 기간 | 두 다운로드 요청에 같은 from/to 전달 |
| 기사 내 정산 | 이번 마감 | 기존 month URL·직접 기간 보존, 월별 보기 유지 |
| 월 정산 새 명세 | 이번 마감 | 취소 명세 재작성은 원래 명세 기간 유지 |
| 월 정산 기존 명세 목록 | 전체 유지 | 기존 상태·방향 필터 유지 |
| 운행 결재 | 오늘 유지 | 날짜 필터에 두 마감 버튼 추가 |
| 차량 사용대장 | 전체 유지 | 필터에서 빠른 선택 시 page=1, URL·입력칸 동시 반영 |
| 기사 내 운행 목록 | 전체 유지 | 공유 날짜 필터에 두 마감 버튼 추가 |

사용대장과 기사 목록의 기존 전체 조회, 명시된 과거 기간·취소 명세 재작성은 고객의 기존 업무 흐름으로 판단하여 보존했다. 마감일 1에도 날짜 범위를 보여 주되 버튼 이름은 달력 월로 표시한다.

## 테스트

- 먼저 실패: G-PERIOD 단위 테스트의 미구현 계산 모듈, 실제 PostgreSQL 통합 테스트의 기본 마감일 누락, 집계·기사 E2E의 빠른 버튼 누락을 확인했다. 로그는 `/private/tmp/g-period-red-vitest.log`, `/private/tmp/g-period-red-e2e.log`에 두고 회귀 테스트 본문은 `tests/`에 저장했다.
- 단위 17건: 18/19일 경계, 월말, 윤년·평년 2월, 연말·연초, 시작일 1/28, 지난 마감, 서울 자정, 라벨, 잘못된 시작일.
- 통합 2건: 기본값·1~28 저장·잘못된 값·부분 수정·감사·DB CHECK, ADMIN 외 쓰기 금지, 로그인 필수·모든 활성 역할의 최소 설정 조회·계정 비활성화 차단.
- E2E 4건: 1440px 집계 URL·상세 상태·두 엑셀·뒤로가기, 360px 기사 아주 크게/직접 입력 가로 넘침, 실제 회사 정보 변경의 각 화면 반영, 설정 실패 시 임의 조회 금지·재시도 및 새 정산 기본/지난 마감.
- 기존 AGG-summary와 W8a-driver의 달력 월 버튼 기대는 새 마감 버튼 계약에 맞게 갱신했다. 기존 명시적 월 URL·기간 입력·정산 확정·지급·출력·오프라인 제출은 유지한다.

## 마이그레이션·공용 파일

- `drizzle/0761_company_closing_period.sql`, journal: `when=1790667800000`. G-BIZ의 `0760_business_details`는 `1790667700000`임을 읽기 전용으로 확인했다.
- 이 워크트리의 마이그레이션은 17개다. G-BIZ 병합 후에는 journal idx와 DEPLOY 개수를 최종 전체 기준으로 조정해야 한다(0760 포함 시 18개). 기존 public 이력 복원 테스트에서도 새 열을 제거한 뒤 재적용하도록 갱신했다.
- 공용 최소 변경: `src/server/db/schema.ts`(열·CHECK), `src/server/services/admin-schemas.ts`(검증), `src/components/manager/master-config.ts`(회사 폼 한 항목), `src/components/manager/master.tsx`(선택값 숫자 직렬화), `src/components/approval-filters.tsx`(공유 기간 버튼), `drizzle/meta/_journal.json`, `tests/integration/DEPLOY*.test.ts`.
- 문서 공용 변경: `docs/DESIGN.md`, `docs/API.md`, `src/app/manual/page.tsx`, `docs/manual/README.md`, `docs/manual/capture/lib.mjs`와 안전 가드 테스트. 캡처 도구에 localhost:3202만 추가 허용했다.
- 새 공용 파일: `src/shared/closing-period.ts`, `src/components/closing-period.tsx`, `src/server/services/closing-period.ts`, `src/app/api/closing-period/route.ts`.
- `src/client/*`, `src/components/use-form/*`에 Next 전용 import를 추가하지 않았다. 공유 버튼도 Next 모듈에 의존하지 않으며 오프라인 셸 빌드가 통과했다.

## 환경과 결과

모든 DB 명령은 `.env.local`과 `PG_PORT=54402`, 모든 웹/E2E·설명서 작업은 `PORT=3202` / `BASE=http://localhost:3202`를 사용했다. 통합 테스트는 격리 DB, E2E는 `vehicle_e2e`를 사용했고 E2E 전후 개발 DB의 업무 테이블 건수는 동일했다. 운영 설정 파일과 다른 포트의 DB/웹 서버는 사용하지 않았다.

- `npm run typecheck && npm run lint && npm run format:check && npm test`: 모두 통과. Vitest **91개 파일 / 554건**.
- 관련 E2E는 아래 **41개 서로 다른 테스트**가 최종 통과했다. 새 G-PERIOD 4건 포함이다. 중간에 발견한 대장 입력칸 불일치는 수정했고 테스트 선택자의 Next 라우트 알림 중복은 main 영역으로 한정해 보정했다.
  - AGG-summary 4, DRV-driver-views 2, F2-UI 6, F4-DETAIL 5, LIST-approvals 3, W4-settlement 2, W8a-driver 8.
  - W7-manager 1, W8b-settlement 3, FIX-REQ-manual 1, MANUAL-captures 2, G-PERIOD 4.
- 마지막 G-PERIOD·설명서 E2E 묶음 **7/7 통과**, 설정·기간 단위/통합 묶음 **19/19 통과**. 전체 Vitest는 마지막 서비스 변경 이후에도 재실행하여 통과했다.
- `npm run pwa:build` 통과. 관련 W8a 오프라인 제출·로그아웃 E2E 통과.
- 집계 `28-summary` 캡처 원본·공개 한 쌍 갱신. 로컬 `vehicle_e2e`에 기존 시연 시드를 넣어 실제 화면을 촬영했다. 사용자명·현장·금액은 시연 자료다.
- 설명서 PDF **34쪽** 재생성. 전 페이지 PNG 렌더링·배치 확인, 마감 안내가 바뀐 12·22·24쪽 텍스트 확인 및 24쪽 확대 검토 완료. 본문/그림 잘림과 빈 페이지 없음. 원본·공개 캡처 동일성 및 웹 390/1440px 레이아웃 E2E 통과.

남은 기능 결함은 없다. 운영에는 아직 적용하지 않았으며 코디네이터 병합 때 0760/0761 journal idx 및 최종 DEPLOY 마이그레이션 개수 조정이 필요하다.
