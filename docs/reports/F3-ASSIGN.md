# F3-ASSIGN 현장 배정 막힘 수정

## 원인과 수정

| 항목 | 원인 | 수정 | 회귀 검증 |
| --- | --- | --- | --- |
| 기사 홈·운행 등록 | 유효 배정이 없으면 빈 선택 상자만 표시 | 홈 상단에 안내 1회, 폼에는 빈 선택 상자 대신 같은 카드. 서버 저장·보내기 버튼과 전송 진입을 차단 | F3-ASSIGN E2E: 360px, 실제 글자 20px, 안내 개수·버튼 비활성·가로 넘침 |
| 기사관리 | 배정 변경이 별도 사용자 관리에 있어 찾기 어려움 | 목록·정보 상세에 배정 현장, 미배정 주황 표시, 체크 즉시 추가·해제, 모든 활성 현장 선택. 닫기 버튼 제공 | F3-ASSIGN 통합: 권한·감사·기간, E2E: 배정 → 기사 현장 선택 가능 → 회수 → 안내 복귀, 담당자 1440/390px |
| 새 현장 | 기사 초대 후 현장을 만들어도 기존 기사 배정이 생기지 않음 | 기본 켜진 자동 배정 선택. 활성 DRIVER 전원에게 오늘부터 배정하고 현장 생성·배정·감사를 같은 트랜잭션으로 저장, 결과 인원 표시 | F3-ASSIGN 통합: 대상·제외·감사·롤백·해제·기존 API·PATCH, E2E: 기본 체크·실제 배정·결과 인원 |
| 기사 초대·가입 링크 | 개별 초대는 빈 현장을 허용. 공용 링크는 이미 최소 1개 검증 | DRIVER 개별 초대도 서버에서 최소 1개 필수. 두 화면에 필수 안내·전체 선택·빈 선택 시 생성 비활성 | F3-ASSIGN 통합: 연결 유무·생략·빈 배열·정상·다른 역할, E2E: 두 화면 필수·전체 선택, 기존 가입·초대 E2E |
| 시작 준비 | 기본 정보가 있으면 체크리스트가 사라져 미배정 기사를 놓침 | 현재 유효한 활성 현장이 없는 활성 기사 수와 기사관리 링크. 0명일 때만 해당 안내 숨김 | F3-ASSIGN 통합: 미래·만료·중지 현장·비활성 계정 제외, E2E: 실제 대시보드 안내 |
| 사용 설명서 | 현장 생성·기사관리 배정 설명 부재 | 관리자 본문 2문장, 현장 배정·현장 생성 장면 2장만 로컬 재촬영 | MANUAL-captures E2E: 390/1440px, 이미지 로딩·원본 동일·넘침, 직접 화면 확인 |

## 권한과 호환성 판단

- 배정 편집은 기존 규칙대로 ADMIN 전용. 정산·현장 담당자는 배정 편집 권한을 새로 받지 않는다.
- 기사관리에서도 `/api/admin/assignments` POST 및 `/:id` DELETE와 기존 서비스의 관리자 잠금·기간 중복 검사·감사·HTTP 멱등 처리를 사용한다. 배정에는 원래 version 필드가 없다. 기사 정보·계정 변경의 사용자 version 규칙은 유지한다.
- `assign_all_drivers`는 생성 전용. 화면은 true가 기본이며 기존 API 호출에서 생략하면 false로 동작한다. 수정 시에는 추가 배정을 하지 않는다. 사용 중지한 현장에 자동 배정 요청은 거부한다.
- 별도 마이그레이션·패키지는 없다. `driver-identity.ts`, `uses.ts`는 변경하지 않았다.
- 오프라인 공용 컴포넌트에는 Next 전용 import를 추가하지 않았고 `pwa:build` 및 기존 오프라인 E2E가 통과했다.

## 테스트 결과

새 통합 3개와 새 E2E 3개를 먼저 저장하고 각각 수정 전 실패를 확인했다. 권한·감사는 실제 PostgreSQL로 검증했다.

- `npm run typecheck && npm run lint && npm run format:check && npm test`: 85개 파일, 492개 테스트 통과.
- 관련 E2E: 고유 17개 통과. F3-ASSIGN 3, JOIN-drivers 5, W2-driver 2, W6-offline-form 2, W8b-admin 3, MANUAL-captures 2.
- 관련 E2E 첫 실행의 14개 통과 후, 기존 관리자 초대 3개에 새 필수 현장 선택 단계를 반영했다. 최종 F3-ASSIGN/W8b-admin/MANUAL-captures 8개 재실행 통과.
- 기존 통합 JOIN-drivers/W8b-admin의 성공 초대 입력도 현장을 지정하도록 갱신했다. 기존 JOIN E2E의 연결 없는 현장 삭제 시나리오는 자동 배정 체크를 끄고 검증한다.
- CLI는 `PG_PORT=54391 DOTENV_CONFIG_PATH=.env.local`, 웹/E2E는 `PORT=3191 APP_URL=http://localhost:3191`만 사용했다. E2E 전후 개발 DB의 운행·명세·지급·증빙·감사·가져오기 행 수가 동일했다.
- 캡처: 54391의 별도 로컬 시연 DB `vehicle_manual_f3_assign`, `BASE=http://localhost:3191 node docs/manual/capture/assignments.mjs`. 운영 사이트·운영 DB·배포 비밀 파일 미접근.

## 바꾼 공용 파일

- 서버: `src/server/services/admin.ts`, `schemas.ts`, `setup-status.ts`, `driver-profiles.ts`(현재 배정 현장의 활성 조건만).
- 화면: `src/client/driver-dashboard.tsx`, `src/components/use-form/use-form.tsx`, `src/components/manager/{dashboard,drivers,driver-join-links,master,users}.tsx`. 안내 카드와 배정 편집기를 별도 파일로 추가했다.
- 문서: `docs/API.md`, `src/app/manual/page.tsx`, `docs/manual/README.md`, `docs/manual/capture/lib.mjs`(3191 로컬 주소만 추가 허용), 전용 부분 캡처 스크립트, `45-drivers`·`48-project-create`의 원본/공개 PNG.
- 기존 테스트: 통합 `JOIN-drivers`, `W8b-admin`; E2E `JOIN-drivers`, `W8b-admin`, `MANUAL-captures`.

## 남은 운영 작업

코드에서 확인된 미해결 결함은 없다. 이 작업은 운영에 배포하지 않았고 기존 운영 배정 데이터도 변경하지 않았다. 배포 후 기존 미배정 기사에 대해서는 **기사관리 → 현장 배정 → 모든 현장 선택**을 한 번 실행해야 한다. 이후 새 현장은 기본 자동 배정되며 새 기사 초대는 현장 없이는 만들 수 없다.
