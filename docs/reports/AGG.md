# AGG — 담당자 현장·기사별 집계

2026-09-30. 작업 경로 `차량앱-wt/summary`. PostgreSQL **54346**, Playwright/Next.js **3146**만 사용했다. 새 패키지·마이그레이션 없음. 참고 `greendong.xlsx`의 집계 1시트·기사 8시트 구조를 읽기 전용으로 확인했고 파일은 수정하지 않았다.

## 구현 요약

- `/m/summary`: 사용대장 바로 아래 아이콘이 있는 **현장·기사별 집계** 메뉴. 이번 달/지난달, 직접 시작일·종료일, 승인만/검수 전 포함, 현장별/기사별/한눈에 표를 제공한다. `from`, `to`, `include`, `view`를 URL에 보존하고 새로고침·뒤로가기를 지원한다.
- 승인 공급가·세액 포함 합계, 운행 건수, 기사·현장 수를 요약한다. 카드 내부는 승인 금액 큰 순으로 표시한다. 표는 기사 행·현장 열·행/열/전체 합계, 첫 열 고정, 표 영역만 가로 스크롤, 금액 오른쪽 정렬을 적용했다. 카드와 표의 금액 모두 한국어 원 단위로 표시한다.
- 기사/현장 줄을 누르면 기존 `/m/ledger?from&to&project_id&driver_id`로 이동한다. 대장에 이미 필요한 필터가 있어 대장 구현은 변경하지 않았다.
- `GET /api/summary`, `GET /api/summary/export.xlsx`: 같은 서비스 결과를 사용한다. 엑셀은 현장별/기사별/표 3시트, 기간·포함 기준 헤더, 숫자 셀 `#,##0`, 승인액·검수 전 금액 분리를 제공한다. 다운로드 실패도 화면에서 안내한다.
- 기존 담당자 디자인 토큰, rem 글자 크기, 44px 이상 조작 영역, 로딩·빈 결과·오류·재시도 처리를 적용했다. 360px/글자 20px에서도 페이지 가로 넘침이 없고 표만 스크롤된다.

## 계산·권한 결정

1. **금액 기준:** `ledgerBase`를 재사용한다. 삭제되지 않은 PAYABLE 비용 줄 중 `line_review_status=APPROVED`의 저장된 `approved_amount`를 합산한다. 사용 건 전체 승인 여부를 별도로 강제하지 않아 개별 승인 단계에서도 사용대장·기사 내 정산의 인정 공급가와 일치한다. 저장된 승인 세액을 그대로 합산하고 합계 단계에서 다시 반올림하지 않는다. 금액 덧셈은 기존 `sumMoney`/Decimal을 사용한다.
2. **취소·보류·반려:** 사용대장 합계/정산 후보처럼 `vehicle_uses.operation_status=CANCELED`를 제외한다. HELD/REJECTED/삭제 비용과 RECEIVABLE은 집계 금액에서 제외한다. 취소된 개별 회차의 수로 사용 건의 비용을 임의 배분·삭감하지 않는다. 확정·지급된 비용도 운행일 기준 집계에 포함한다. 명세 확정 가능액이나 미지급액을 계산하는 화면은 아니다.
3. **검수 전:** `include=all`에서 PENDING 줄만 별도 합산한다. 기본운임 포함 항목은 0원, 나머지는 기존 승인 계산과 같은 `computed_amount ?? requested_amount` 및 `calculateTax`를 사용한다. VAT_INCLUDED는 공급가로 환산하고 ADJUSTMENT는 저장된 공급가 차액을 쓴다. 금액이 없으면 0원 확정으로 오인하지 않도록 `pending_unknown_count`와 ‘금액 미정 N줄’을 표시한다. 승인 공급가·세액 포함 합계에 검수 전 금액을 더하지 않는다.
4. **건수:** 기존 사용대장 한 줄(사용 건)을 1건으로 세며 화면/엑셀에 명시했다. 비용 여러 줄·여러 회차가 있어도 건수가 중복되지 않는다. 승인만에서는 승인액이 존재하는 지급 줄이 있는 건(0원 포함), 검수 전 포함에서는 취소되지 않은 모든 사용 건을 센다. 보류·반려 비용만 있는 사용 건도 후자의 건수에는 남고 금액에는 더하지 않는다.
5. **기간:** 실제 `use_date`로 양끝을 포함한다. 최대 1년은 시작일의 다음 해 같은 날짜 미만까지이며 윤년을 허용한다. 실제 날짜 형식/기간 역전/범위 초과/잘못된 포함 기준을 zod로 검증한다.
6. **기사·상호:** 실제 `vehicle_uses.driver_id`로 그룹화하며 입력자를 기사로 취급하지 않는다. 현장·기사 이름은 접근 가능한 기간 내 가장 최근 사용 스냅샷을 사용한다. 상호는 해당 사용일에 유효한 `driver_affiliations → counterparties` 이름들을 중복 제거해 모두 표시한다. 동명 기사·현장은 ID로 구분한다. 집계의 이름·금액·소속 조회는 한 SQL 문으로 같은 DB 스냅샷을 사용한다.
7. **권한:** 기존 `managerOnly`, `ledgerBase → accessibleUseFilter`를 재사용한다. 관리자와 `all_projects=true` 정산 담당자는 전체, 현장 담당자는 현재 유효 배정 현장만 접근한다. 기존 권한을 그대로 재사용하라는 지시에 따라 **`all_projects=false` 정산 담당자의 현장 제한도 유지**했다. 기사 JSON/엑셀은 403, 미로그인은 401, 배정 회수·사용자 비활성화는 다음 요청부터 반영한다. 페이지는 기존 담당자 레이아웃 서버 가드를 사용한다.

## 파일 및 공용 변경

- 신규: `src/server/services/summary.ts`, `summary-export.ts`, `src/app/api/summary/route.ts`, `src/app/api/summary/export.xlsx/route.ts`, `src/app/m/summary/page.tsx`, `src/components/manager/summary.tsx`.
- **공용 `src/server/auth/manager-access.ts`:** `managerMenu`의 사용대장 다음에 `/m/summary` 한 항목만 추가했다. 역할 가드 함수는 변경하지 않았다.
- **공용 `src/components/manager/navigation.tsx`:** `icons`에 `/m/summary` 아이콘 경로 한 항목만 추가했다. 메뉴 하단·계정 링크 관련 영역은 변경하지 않았다.
- **공용 `docs/API.md`:** 마지막에 AGG 집계 API/응답/계산·권한 계약 절만 추가했다.
- `tests/e2e/W6-manager.spec.ts`: 새 메뉴 존재 확인, 관리자 메뉴 기대 개수 10→11.
- 신규 테스트: `tests/integration/AGG-summary.test.ts`, `tests/e2e/AGG-summary.spec.ts`.
- `/d/settlements`, 비밀번호/계정 화면, 공용 스키마·authz·대장·정산 서비스 구현은 변경하지 않았다.

## 검증 결과

실행 환경은 모두 `PG_PORT=54346`, `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54346/vehicle_app`, E2E는 추가로 `PORT=3146`이다. E2E 자체 설정이 동일 포트의 `vehicle_e2e` 격리 DB를 사용한다.

| 검증 | 결과 |
| --- | --- |
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과, 기존 경고 1개는 아래 기재 |
| `npm run format:check` | 통과 |
| `npx vitest run` | **61개 파일 / 358개 테스트 통과** |
| AGG 실DB 통합 테스트 | **8개 통과** — 대장/기사 금액 일치, 개별 승인, 보류/반려/삭제, VAT 포함, 미정/0/음수, 날짜 경계·취소, 소속 변경·동명 구분, 배정·회수·기사 403, 3시트 숫자·합계, 입력 검증 |
| 새 AGG Playwright | **4개 통과** — 1440px·390px 세 보기/직접 기간/URL 복원/대장 필터/엑셀 200, 360px 큰 글자·44px 대상·표 고정/가로 넘침, 빈 결과·오류·재시도·로딩·다운로드 오류 |
| 관련 기존 Playwright | **20개 통과** — W6-manager 2개, W8b-manager 3개(1440/390/360), W7-manager 1개, F8a-manager 14개 |
| `git diff --check` | 통과 |

E2E의 개발 DB 전후 검사에서 사용·정산·지급·증빙·감사·가져오기 건수가 모두 동일했다. 생성한 1440px 표, 390px 현장별/기사별, 360px 큰 글자 표 스크린샷도 육안 확인했다. 스크린샷·테스트 DB·로컬 환경·참고 엑셀은 커밋하지 않는다.

## 남은 문제

- AGG 기능의 미해결 실패 없음.
- 기존 `docs/manual/capture/driver-b.mjs:1`의 사용하지 않는 `top` 변수 lint 경고 1개는 소유 범위 밖이므로 유지했다. lint 종료 코드는 0이다.
- 정산 담당자의 전체 현장 접근은 기존 `all_projects` 권한을 따른다. 이는 의도적으로 유지한 기존 보안 계약이며 새 권한 확대는 하지 않았다.
