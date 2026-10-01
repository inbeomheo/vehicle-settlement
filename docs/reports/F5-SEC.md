# F5-SEC 최종 보안 결함 수정

## 환경·범위

- 전용 워크트리 PostgreSQL 54398, 웹/E2E 3198만 사용했다. 운영 DB·다른 워크트리 DB는 접근하지 않았다.
- 새 패키지·마이그레이션·클라이언트 변경 없음.
- 공유 변경: `src/server/selection-scope.ts` 신설, `lookups.ts`에 선택 범위 적용, `docs/API.md`에 계약 보충.
- F4-JOINBIZ 범위의 `driver-join.ts`는 활성 현장 재검사/배정/표시에 필요한 부분만 수정했다. `drivers.tsx`, 가입 폼, 사업자 지정, 증빙 기본값은 변경하지 않았다.

## SEC3-02: 현장 범위 밖 고객 전현장 단가 노출

원인: 단가 조회가 요청 현장 권한과 기사 소속만 검사하여 현장 담당자의 거래처 권한을 빠뜨렸다.

수정: 단가 조회·저장·목록에서 거래처 범위 SQL을 공유한다. 고객은 요청 현장과 관련된 거래처만 조회·새 지정할 수 있으며 전현장 계약만으로는 권한이 생기지 않는다. 기존 F2의 활성 기사 지급처 선택과 관리자의 조회를 유지한다.

회귀: 배정 회수 뒤 UUID 직접 조회, 두 접근 가능 현장 사이 고객 범위, 기사 타 지급처·고객 조회 거부, 허용된 담당자/기사/관리자 조회를 검증한다.

## SEC3-01: 기사 운행을 통한 타인 차량 연결·수정 방해

원인: 차량 존재·활성 여부만 검사하고 임의의 기사 초안도 목록 및 공유 차량 보호의 근거로 사용했다.

수정: 기사 생성/차량 변경은 기본차량 또는 접근 가능한 본인 승인·대리입력 이력 차량으로 제한하고 다른 활성 기사의 기본차량은 제외한다. 목록도 같은 조건이다. 공유 차량 보호에서 타 기사가 작성한 미승인 운행을 제외한다. 차량을 유지하는 기존 운행 수정·담당자 대리는 보존한다.

회귀: 타인 차량 직접 POST 차단, 차량 변경 거부, DRAFT/SUBMITTED/NEEDS_FIX/APPROVED/PROXY의 허용·거부 경계, 공유 기본차량, 피해 기사 톤수 수정 및 화면 저장을 검증한다.

## SEC3-03: 중지된 현장 초대 수락

원인: 기사 연결형 개별 초대는 수락 시 활성 현장 재검사가 없었다. 공용·미연결 초대는 일부 중지에도 모두 거부했다.

수정: 기사 가입 경로가 활성 현장 검사를 공유하며 가입 트랜잭션 동안 현장 행을 SHARE 잠금한다. 활성 0개는 지정한 한국어 안내와 422로 거부하고 초대를 보존한다. 일부 중지는 활성 현장만 배정·감사하며 공용 가입 화면도 이를 반영한다.

회귀: 개별/공용/미연결 초대의 전부 중지 거부·미소진·재시도·일부 활성 배정, 세션 미발급 및 모바일 안내를 검증한다.

## 검증

- 수정 전 신규 통합 테스트: 14개 중 결함 경계 13개 실패, 정상 전체 업무 흐름 1개 통과.
- 신규 E2E: 초대 수락 거부·일부 활성 가입·기존 위조 초안에 의한 차량 수정 방해를 재현했다.
- `npm run typecheck && npm run lint && npm run format:check && npm test`: 모두 통과. Vitest 87파일 520개 통과(신규 통합 14개 포함).
- Playwright: 아래 10파일 22개 전부 통과(신규 E2E 3개 포함).
  - `SEC3-security`, `SEC-scope`, `SEC2-identity`, `JOIN-drivers`, `F3-ASSIGN`
  - `F2-lookup`, `F9-security`, `F2-join-copy`, `W2-driver`, `PW-password`
- 수정 전 코드를 일시 적용해 보정한 E2E 3개 모두 해당 결함으로 실패하는 것도 확인했다. 이후 수정 코드를 복원해 최종 전체 검사했다.
- E2E 전후 개발 DB `vehicle_uses/statements/payment_records/evidence/audit_logs/import_jobs`는 모두 0건으로 동일했다.
- 첫 전체 실행은 `DB_SCHEMA=public` 강제 지정으로 기본 `drizzle` 마이그레이션 스키마를 전제한 운영 테스트가 실패했다. 기본 설정(`DB_SCHEMA=''`)으로 다시 실행해 전체 통과했다. 제품/테스트 코드를 바꿔 우회하지 않았다.

최종 검증 환경:

```bash
export PG_PORT=54398 PORT=3198 APP_URL=http://localhost:3198
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54398/vehicle_app
export DB_SCHEMA=''
npm run typecheck && npm run lint && npm run format:check && npm test
PORT=3198 npx playwright test tests/e2e/SEC3-security.spec.ts tests/e2e/SEC-scope.spec.ts tests/e2e/SEC2-identity.spec.ts tests/e2e/JOIN-drivers.spec.ts tests/e2e/F3-ASSIGN.spec.ts tests/e2e/F2-lookup.spec.ts tests/e2e/F9-security.spec.ts tests/e2e/F2-join-copy.spec.ts tests/e2e/W2-driver.spec.ts tests/e2e/PW-password.spec.ts
```

## 판단·남은 문제

- 승인 이력은 현재 `review_status=APPROVED`, 대리 입력은 서버가 설정한 `entered_as=PROXY`를 근거로 삼는다. 과거 승인 후 내용이 변경된 기사 운행은 새 차량 접근 근거로 사용하지 않는다.
- 과거 운행 원본·스냅샷은 변경하지 않는다. 이번 작업은 배포하지 않았으며 운영 반영은 별도다.
