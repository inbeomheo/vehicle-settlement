# G-DELETE — 기록 없는 계정 삭제·꺼진 계정 숨기기

## 원인과 수정

- 사용자 관리에는 상태 변경만 있고 물리 삭제 API·삭제 가능 판정이 없었다. ADMIN 전용 `DELETE /api/admin/users/:id`와 공통 삭제 서비스를 추가했다. 양의 정수 version 검증, 409 버전 충돌, 멱등 재생 및 이미 삭제된 ID의 성공 응답을 지원한다.
- 삭제는 관리 공통 advisory lock → 현재 실행자 권한 재검사 → 사용자/연결 기사 FOR UPDATE → 기록·마지막 관리자·본인 검사 → 정리 → 감사 순서의 한 트랜잭션이다. FK를 추가하는 동시 요청도 PostgreSQL 행 잠금과 FK 제약으로 보호한다.
- 두 관리 화면은 전체 계정을 항상 표시했다. 꺼진 계정은 기본 숨기고 `꺼진 계정 N명 보기`를 추가했다. `show_disabled=1`을 기존 URL 쿼리에 병합하며 새로고침·뒤로가기·앞으로가기를 지원한다.
- API의 `deletable`, `delete_reason`으로 삭제 버튼 또는 한국어 이유를 표시한다. 확인창에는 이름·연결 자료 정리·복구 불가 안내를 넣고 서버에서 삭제 조건을 다시 검사한다. 기사 정보/가입/회사 정보 폼은 변경하지 않았다.
- 설명서 관리자 안내와 FAQ에 삭제/계정 끄기의 차이를 추가했다. BASE=로컬 3203으로 PDF를 재생성했다. 인쇄에 불필요한 마지막 로그인 버튼과 하단 여백을 제외하여 마지막 빈 페이지를 없앴다. 34쪽 PDF의 수정 페이지를 PNG로 렌더링해 확인했다. 새 화면 캡처는 설명에 필수가 아니므로 기존 설명서 이미지를 유지했다.

## FK 조사·보존 기준

하드코딩된 업무 테이블 목록 대신 현재 연결의 `to_regclass`와 `pg_constraint`로 실제 FK를 전수 조회한다. 테이블/스키마/열 이름은 SQL identifier로 인용한다. 새 업무 FK가 추가되면 기본적으로 삭제를 거부한다.

| 대상 | 참조 및 처리 |
| --- | --- |
| 사용자 업무 참조 | vehicle_uses 작성자·지정 담당자, use_revisions 제출자·결재자, evidence 업로더, statements 작성·확정·취소자, payment_records 기록·취소자, import_jobs/import_presets 작성자, form_field_settings 수정자: 모두 거부 |
| 기사 업무 참조 | vehicle_uses.driver_id, evidence.owner_driver_id와 명세 항목·과거 제출본 snapshot.driver_id: 모두 거부. 초안·취소·논리 삭제 자료도 포함 |
| 인증·배정 | sessions, push_subscriptions, password_resets(대상/발급자), project_assignments, idempotency_keys: 정리 |
| 가입 | 본인 driver_registrations, 본인이 만들었거나 수락한 invites, 본인이 만든 driver_join_links 및 삭제되는 초대/링크의 수락 영수증: 정리 |
| 감사 | 기존 로그 행을 보존하고 삭제 계정의 nullable user_id만 null 처리. entity_id·before/after·request_id 유지. 실행 관리자 명의 DELETE_USER 1건, before는 publicUser 필드만 기록 |
| 기사 원장 | 다른 사용자·미사용 초대 등 참조가 있으면 기사와 소속 보존. 없으면 기사와 소속 삭제 |
| 사업자·차량 | 해당 소속의 DRIVER_BUSINESS 및 기본차량만 후보. 다른 기사의 소속/기본차량, 운행, 계약, 비용, 명세, 초대/가입 링크 등 실제 FK가 하나라도 있으면 보존. CARRIER는 보존 |

업무 기록 거부 문구: `운행·정산 기록이 있어 삭제할 수 없어요. '계정 끄기'를 쓰세요.` (422)

## 고객 취지에 따른 결정

- 감사 FK는 nullable이므로 사용자 ID만 null로 만들고 로그 자체를 남겼다. 삭제 대상 식별은 DELETE_USER의 entity_id와 공개 before로 가능하다.
- 삭제되는 관리자가 만든 가입 링크·초대와 연결된 수락 영수증은 제거하지만 이미 가입한 다른 사용자는 삭제하지 않는다. 다른 관리자가 만든 공유 링크는 유지한다.
- 과거 제출본에만 남은 기사도 업무 기록으로 보아 삭제를 거부한다. 이 누락은 별도 실패 회귀 테스트로 확인한 뒤 보완했다.
- 사업자·차량의 소유 필드는 없으므로 연결 소속과 기본차량을 정리 후보로 삼고, 다른 참조가 있으면 남기는 보수적인 기준을 사용했다.
- 마이그레이션·새 npm 패키지·오프라인 번들 변경은 없다.

## 회귀 테스트와 결과

- `tests/integration/G-DELETE.test.ts`: 24개. 최초 5개 실패를 확인한 뒤 구현했다. 전용 자료/인증/가입/배정 정리, 감사 보존·비밀값 제외, 멱등, 초안, 검수/정산/지급 등 각 업무 FK 단독 참조, 과거 기사 증빙·명세·제출본, 공유 자료/다른 연결 사용자 보존, 역할·버전·본인·마지막 관리자, 새 업무 FK, 동시 초안 등록을 검증한다.
- `tests/e2e/G-DELETE.spec.ts`: 두 관리 화면 × 1440/390px의 4개. 구현 전 필터 부재 실패를 확인했다. 기록 없는 기사 삭제·목록 제거, 기록 있는 기사 삭제 불가 안내, 기본 숨김/개수/토글, 기존 쿼리 유지·새로고침·뒤/앞 이동, 화면 너비를 검증한다. 기록 보유 사례는 테스트가 직접 만든 초안으로 검증한다.
- 관련 기존 E2E: JOIN-drivers 5개, W8b-admin 3개, FIX-REQ-manual 1개 통과. JOIN-drivers의 계정 끄기 후 기대값은 기본 숨김을 반영했다.
- 최종 `npm run typecheck`, `npm run lint`, `npm run format:check` 통과. `npm test`: **90 파일, 558개 통과**. 관련 Playwright: **13개 통과**.
- PG_PORT=54403, DOTENV_CONFIG_PATH=.env.local, PORT=3203 사용. E2E 전후 개발 DB 주요 업무 건수 동일(모두 0). 운영 비밀 파일과 운영 DB는 접근하지 않았다.

## 공용 파일·인접 범위 변경

- `src/server/services/admin.ts`: 사용자 목록의 삭제 플래그 추가만.
- `src/server/services/driver-profiles.ts`: 조회 타입/응답에 삭제 플래그 추가만. 프로필 저장·사업자/차량 필드 변경 없음.
- `src/components/manager/users.tsx`, `drivers.tsx`: 목록 필터와 관리 버튼 영역만.
- `src/app/api/admin/users/[id]/route.ts`: 기존 PATCH 유지, DELETE 추가.
- `docs/API.md`, `src/app/manual/page.tsx`, `docs/manual/capture/lib.mjs`, `docs/manual/export.mjs`, `public/manual/vehicle-manual.pdf`: API/설명서/로컬 포트 허용·PDF 출력 반영.
- `tests/e2e/JOIN-drivers.spec.ts`: 계정 끄기 후 숨김 및 명시적 보기 단계 추가.

남은 문제: 확인된 미해결 사항 없음. 운영 배포는 이 작업에 포함하지 않았다.
