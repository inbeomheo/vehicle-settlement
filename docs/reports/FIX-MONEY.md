# FIX-MONEY 운영 재현 결함 수정

## 범위와 환경

- PostgreSQL: 이 워크트리 `.env.local`의 `PG_PORT=54371`, 통합 테스트별 격리 DB.
- Playwright: `PORT=3171`, 전용 `vehicle_e2e` DB. 실행 전후 개발 DB 업무 테이블 건수 동일(모두 0).
- 운영 DB·배포 비밀값·다른 작업자의 포트/파일은 변경하지 않았다. 패키지·마이그레이션 추가 없음.

## 결함별 원인·수정·회귀 검증

| 결함 | 원인 | 수정 | 추가 검증 |
| --- | --- | --- | --- |
| 1. 표시하지 않은 최신 금액 승인 | 클릭 후 상세 GET으로 최신 version을 가져옴. 서버의 바로 승인 조건 검사 없음 | 표시한 목록 version과 기본·추가·총 공급가를 전달. 부모·비용 잠금 후 공통 quickApprovable 및 표시 금액 재검사. 불일치는 409와 지정 문구. 선택 승인 실패 건수 안내 | 실제 PG에서 30만→90만원 변경, 금액 근거 위조, 계약 차이·미정·추가비, 동시 승인 검증. 검수함·운행 결재 각각 단건/선택 승인 E2E |
| 2. 최근 경로의 다른 현장 금액 | 최근 제출본 선택에 현장 조건 누락 | 현재 사용 건과 제출 스냅샷 모두 해당 경로 현장과 일치하도록 제한. 폼 경로 선택도 현재 현장으로 필터 | 동일 경로 두 현장, 제출 후 현장 변경한 미제출 초안, 기사 폼 자동 입력 E2E |
| 3. 승인액과 불일치하는 단가 | 계약 단가가 있으면 승인 공급가와 무관하게 반환. 직접 입력 단가를 float 나눗셈으로 반올림 | 계약 계산 공급가와 같으면 계약 단가, 다르면 decimal.js로 공급가/수량. 정수로 나누어떨어지지 않으면 `—`. 새 명세 스냅샷에 계산액·세금모드·반올림 보존 | 14만원 승인, 0원, 수량 3·0.5, 정수로 나누어지지 않는 수량. 실제 PDF 텍스트·XLSX 셀·화면 E2E. 부가세 3종·최소요금 계약 유지 |
| 4. 기사 요청 0원 표시 | `pending_supply !== 0`으로 존재 여부 판단 | 알려진 항목 수(`pending_count > unpriced_count`)로 판정 | 실제 PG 응답의 0원/미정 구분, 기사 정산 E2E |
| 5. 과거 담당자명 변경 | 현재 사용자 이름이 스냅샷보다 우선 | snapshot.reviewer_name 우선, 없을 때만 현재 이름. 담당자 필터는 ID 유지 | 이름 변경 뒤 집계·대장·결재·대장/결재 XLSX 및 결재 화면 E2E |

수정 전에 새 회귀 테스트의 실패를 확인했다. 기존 LIST 통합 테스트는 사용자 ID만 DB에서 교체하여 스냅샷과 어긋난 픽스처를 만들고 있었으므로, 생성 서비스에 담당자를 전달하는 정상 경로로 수정했다.

## 공용·연관 파일 변경

- `src/server/services/schemas.ts`: 선택적 바로 승인 근거 스키마. 비용별 검수와 동시 전달 금지.
- `src/server/services/uses.ts`: 기존 승인 트랜잭션에 바로 승인 검사 추가. 상세 검수 경로는 유지.
- `src/server/services/ledger.ts`: 목록 version 타입 명시, 담당자명 스냅샷 우선.
- `src/components/use-form/use-form.tsx`: 경로 제안·참고 금액을 선택 현장으로 제한. Next 전용 import 추가 없음.
- `src/shared/quick-approval.ts`: 서버·클라이언트 공통 승인 가능 조건.
- `src/shared/charge-amount.ts`: decimal.js 기반 실제 적용 단가.
- `src/server/services/statements.ts`: 고정 명세 항목의 계산 근거 필드 추가(JSON, 마이그레이션 없음).
- `src/server/export/statement-model.ts`: 화면과 같은 적용 단가, 나누어지지 않는 단가 `—` 출력.
- `docs/API.md`: 승인 요청·최근 경로·과거 이름·단가 표시 계약 명시.
- `tests/integration/LIST-approvals.test.ts`: 위 픽스처 수정.

다른 작업자 FIX-OPS/FIX-REQ 소유 파일은 수정하지 않았다. 오프라인 셸 대상에 Next 전용 import를 추가하지 않았다.

## 판단과 남은 제약

- 단가가 없는 금액형 추가비는 기존처럼 단가를 비워 둔다. 공급가·세액은 그대로다.
- 계산액·세금모드가 없는 구형 확정 스냅샷은 저장된 수량·단가로 비교한다. 과거 최소요금/부가세 포함 여부를 현재 계약으로 추측하지 않고 실제 공급가에서 적용 단가를 계산한다. 신규 스냅샷은 이 근거를 모두 보존한다. 기존 확정 금액·세액·스냅샷을 다시 쓰지 않는다.
- 기존 lint 경고 1건(`docs/manual/capture/driver-b.mjs`의 미사용 변수)은 다른 작업자 범위라 유지했다.
- 운영 배포는 수행하지 않았다.

## 최종 검증 결과

- `npm run typecheck && npm run lint && npm run format:check && npm test`: 최종 성공. Vitest **72파일 / 438검증 통과**, 미처리 오류 없음. 새 테스트는 PG 통합 17개·순수 계산 8개.
- Playwright: 새 FIX-MONEY 8개 및 관련 기존 22개, **서로 다른 30개 시나리오 통과**. 대상은 FIX-MONEY, LIST-approvals, PRICE-driver-amount, DRV-driver-views, AGG-summary, W3-review, W4-settlement, F1-statements, W8b-settlement.
- 마지막 폼 현장 필터 변경 후 FIX-MONEY + PRICE-driver-amount **13개 재검증 통과**. 오프라인 기기 초안·재전송 E2E와 셸 번들 생성도 포함.
- 실제 PDF에서 변경된 단가를 추출해 검증하고 XLSX 숫자 셀·대시 표기도 검증했다.
- 중간 전체 실행에서 기존 검토 README에도 기록된 테스트 DB 정리 시 `57P01`이 한 차례 재현되었다(438개 assertion은 모두 통과). DB/client 소유 범위는 변경하지 않았으며, 최종 기본 설정 전체 재실행은 정상 종료했다. 이 간헐적인 기존 테스트 인프라 현상은 FIX-OPS 확인 대상으로 남긴다.
