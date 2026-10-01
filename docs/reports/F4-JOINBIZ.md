# F4-JOINBIZ 고객 리뷰 반영

## 수정 내용

1. 새 현장 사진 증빙 기본값
   - 원인: 현장 DB 기본값이 PHOTO_REQUIRED이고 관리자 폼은 증빙 옵션의 첫 값을 기본으로 선택했다.
   - DB·API·관리자 폼 기본값을 NONE(증빙 선택)으로 통일했다. 기사 사진 단계에 “사진·증빙 (선택)”과 사진 없이 보낼 수 있다는 안내를 표시한다. 기존 PHOTO_REQUIRED/PHOTO_OR_ALTERNATIVE 검증은 유지한다.
   - 0750 마이그레이션은 컬럼 기본값만 변경하며 기존 현장 행은 갱신하지 않는다.

2. 같은 사업자의 여러 기사 가입
   - 원인: 공용 링크와 기사 연결 없는 개별 초대가 모두 사업자번호 중복을 거부하여 관리자 승인을 표현할 경로가 없었다.
   - 두 링크 생성 화면에 소속 사업자 지정(선택)을 추가했다. 활성 DRIVER_BUSINESS/CARRIER 선택 또는 새 사업자 상호·번호 입력이 가능하다. 새 사업자와 링크는 같은 트랜잭션에서 저장·감사한다.
   - driver_join_links와 invites에 nullable counterparty_id FK를 추가했다. 가입 시 서버가 링크의 ID를 사용하고 활성·종류를 다시 검사한다. 기사 입력으로 사업자를 바꿀 수 없으며 공개 화면은 상호·마스킹한 번호만 표시한다.
   - 최초 소속은 가입일 1년 전부터 적용한다. 같은 운송사 여러 기사의 단가 조회는 소속으로 허용하고 다른 기사의 운행·금액 조회는 계속 차단한다. 개별 초대 1회 수락, 미지정 링크의 사업자번호 중복 거부, 세션·멱등 규칙은 유지한다.
   - 사업자번호가 없는 기존 운송사도 지정할 수 있게 했으며, 번호를 임의로 생성하거나 원장을 수정하지 않는다.

3. 설명서
   - 사진·증빙 선택 안내 및 같은 운송사 기사 여러 명의 소속 지정 가입 안내를 반영했다.
   - docs/manual/capture/join-business.mjs로 3197 로컬 시연 화면의 46-join-link 한 장을 갱신했다(원본·공개 PNG 동일). 새 캡처 스크립트는 3197 외 주소를 거부한다. 공용 캡처 도구는 허용 목록에 3197만 추가했으며 외부 요청 차단을 유지한다.
   - public/manual/vehicle-manual.pdf를 34쪽으로 재생성하고 전체 페이지 렌더링 및 변경된 7·30·31쪽을 확대 확인했다.

## 회귀 테스트와 결과

- 수정 전 새 현장 기본값이 PHOTO_REQUIRED인 실패 및 지정 사업자/새 사업자 입력을 거부하는 실패를 확인했다. Playwright에서도 현장 기본 선택값 실패와 설명서 문구 누락 실패를 확인한 뒤 수정했다.
- tests/integration/F4-JOINBIZ.test.ts 6건: DB/API 기본값, 지정 가입·다중 기사·1년 전 소속·단가·사진 없는 제출·격리, 역할/종류/비활성 검증, 입력 변조 거부, 미지정 중복 거부, 새 사업자 생성·중복·감사·롤백, 개별 초대 1회/역할 제한, 번호 없는 운송사.
- tests/e2e/F4-JOINBIZ.spec.ts 3건: 관리자 새 현장·사업자·링크 생성 → 360px 기사 가입 → 사진 없는 제출, 기존 운송사 및 개별 초대 지정, 웹/PDF 설명서 안내.
- DEPLOY 테스트 이력 수 16개로 갱신. 레거시 복구 테스트가 새 FK를 내려 이전 DB를 재현하도록 보완하고, 기존 PHOTO_REQUIRED 현장의 정책 보존을 검증했다.
- npm run typecheck, npm run lint, npm run format:check 모두 통과.
- npm test: 87개 파일, 513개 테스트 통과.
- 관련 Playwright: F4-JOINBIZ, JOIN-drivers, F2-join-copy, F3-ASSIGN, FLOW-driver, W2-driver, FIX-REQ-manual, MANUAL-captures 총 20건 통과.
- 모든 DB 실행은 PG_PORT=54397, 웹·E2E·캡처는 PORT=3197/BASE=http://localhost:3197을 사용했다. E2E 전후 개발 DB 업무 건수는 같았다. 운영 DB와 deploy-secrets는 읽거나 변경하지 않았다. 새 npm 패키지는 추가하지 않았다.

## 공용 파일 변경

- src/server/db/schema.ts, drizzle/meta/_journal.json, 신규 0750 SQL: 기본값 및 FK만 추가.
- src/server/services/auth.ts, schemas.ts, admin-schemas.ts, driver-identity.ts: 기존 초대·가입·현장 기본값 경로에 필요한 최소 확장. 일반 초대 조회 응답은 기존 형태를 유지한다.
- src/components/manager/users.tsx, master-config.ts, src/components/driver-information-fields.tsx, src/components/evidence/editor.tsx: 소속 선택/표시와 증빙 선택 표시. Next 전용 import 추가 없음.
- docs/DESIGN.md, docs/API.md, docs/manual/capture/lib.mjs, DEPLOY 및 기존 설명서 테스트: 새 계약·마이그레이션·캡처 포트·변경 문구 반영.
- drivers.tsx, 집계 자세히 보기, 거래명세표 엑셀은 수정하지 않았다.

## 남은 작업

구현 범위의 미해결 결함은 없다. 운영 배포 시 0750 마이그레이션을 적용해야 한다. 기존 운영 현장 3곳을 NONE으로 바꾸는 작업은 요청대로 코디네이터가 배포 후 별도로 수행한다.
