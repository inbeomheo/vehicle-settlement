# F2-LOOKUP 2차 검토 결함 수정

2026-10-01. 전용 PostgreSQL `PG_PORT=54381`, 웹/E2E `PORT=3181`만 사용했다. 운영 DB·배포 비밀 파일은 접근하지 않았으며 새 패키지·마이그레이션은 없다.

## 결함과 수정

| 결함 | 원인 | 수정 및 회귀 검증 |
| --- | --- | --- |
| 새 기사 대리 입력 불가 | FIX-SEC가 계정 배정 또는 기존 운행이 있는 기사만 선택지에 포함했다. | 활성 기사·차량·DRIVER_BUSINESS 전체를 반환한다. 민감 필드는 모든 역할에서 제외하고 CUSTOMER는 현장 관련 목록만 유지한다. 계정·기본차량 연결·운행 이력이 없는 기사/차량/지급처의 조회 및 PROXY 저장, 비활성 제외, 배정 외 현장·무관한 고객 거부를 실제 PG로 검증한다. 새 E2E는 새 기사 선택→대리 저장 응답까지 확인한다. |
| W7 가져오기·AGG 대장 필터 회귀 | 가져오기 매칭은 좁아진 lookups를 사용했고, 대장 선택지는 SITE_MANAGER를 거부하는 listMaster를 호출했다. | 가져오기는 복구된 lookups를 재사용하고 대장 options도 최소 필드 lookups로 전환한다. ADMIN/SETTLEMENT 전용 admin API는 그대로다. 기존 W7 및 1440px·390px 집계→대장 기대값을 변경하지 않았다. |
| 100행 이후 경고·제외 누락 | 미리보기 응답이 처음 100행·오류·직접 제외만 필터링했다. | 모든 오류·경고·직접 제외 행을 항상 반환한다. 나머지 일반 행은 서버 저장본에서 100행씩 조회하며 페이지 이동 중 미검증 제외 선택도 유지한다. 추가 경고 행은 매핑된 값과 필요한 표시 정보만 직렬화한다. 전체 행/경고 건수를 표시하며 UTF-8 JSON `{data}` 4MiB 상한은 유지한다. 205행에서 103행 단가 차이·104행 중복 의심·206행 오류, 2페이지 정상 행 제외와 최종 저장 201건을 통합 검증한다. E2E는 화면의 경고·페이지·체크 보존·제외 후 203건 저장을 확인한다. |
| 파일 10MB 안내 불일치 | 화면과 로컬 서비스는 10MB, 배포 요청은 4MiB였다. | 공용 상수로 요청 4MiB·multipart 여유 64KiB·파일 3.94MB를 통일한다. 선택 즉시 큰 파일을 거부하고 서버도 동일하게 검사한다. 로컬/배포 조건에서 정확한 경계 파일 multipart 성공, 1바이트 초과 및 Content-Length 없는 큰 본문 거부, 브라우저의 업로드 요청 0회를 검증한다. |
| 가입 사업자 안내 충돌 | 공용 필드가 기존 사업자 자동 연결 안내를 재사용했다. | 공용/미연결 개별 가입은 기존 사업자가 있으면 관리자에게 기사 추가(개별 초대)를 요청하도록 안내한다. 연결 초대는 등록된 기사·사업자 정보로 가입함을 별도 안내한다. 관리자 정보 편집과 본인 편집 문구도 실제 권한에 맞춘다. 공용·미연결 초대·연결 초대 E2E로 확인한다. |

## 판단과 호환성

- 활성 이름 목록 확대는 사용자가 내린 새 결정이다. 기존 FIX-SEC 보고서의 신규 기사 최초 연결 필요 조건을 대체한다. 기사 본인의 lookups 제한과 민감 필드 제거, admin API 제한은 유지한다.
- CARRIER는 소속/현장 관련 범위를 유지하되 활성 기사 전체의 소속을 포함한다. CUSTOMER는 소속만으로 포함하지 않는다.
- 기존 사용 건의 거래처가 비활성/선택지 밖이더라도 같은 거래처를 유지하는 수정은 허용한다. 새로 지정하는 값은 선택지 범위를 검사한다.
- 미리보기 집계·검증·저장은 서버 전체 원본을 사용한다. 페이지 조회는 소유자 인증·기존 현장 권한 검사를 유지한다. 첫 100행의 기존 식별자 응답은 호환성을 위해 유지하고 추가 경고 행에서 생략한다.
- 기존 SEC 통합/E2E의 이름 목록 범위 기대는 새 정책으로 갱신하고 민감 정보·배정 외 현장 차단 검증은 유지/강화했다. OPS의 일반행 페이지 fixture에는 경고가 생기지 않도록 계약과 같은 명시 단가를 추가했다. F1 테스트의 원본 해시에는 첫 페이지 존재 단언만 추가했다.

## 검증 결과

- 수정 전 통합 회귀에서 새 기사 누락, 대장 options 403, 100행 뒤 경고 누락, 파일 한도 안내 불일치의 실패를 확인했다. 기존 W7와 AGG 1440px·390px도 수정 전 실패를 재현했다. 가입 안내 E2E도 수정 전 안내 누락으로 실패했다.
- 새 테스트: `tests/integration/F2-lookup.test.ts` 2건, `F2-import-preview.test.ts` 3건, `tests/e2e/F2-lookup.spec.ts` 2건, `F2-join-copy.spec.ts` 1건.
- `npm run typecheck && npm run lint && npm run format:check && PG_PORT=54381 npm test` 통과. 최종 **83개 파일, 478개 테스트** 통과, lint 경고/오류 없음.
- 관련 Playwright **38건 전부 통과**: F2-lookup/F2-join-copy, W7-manager, AGG-summary, SEC-scope, W8a-proxy, W8b-import, OPS-import, JOIN-drivers, W8b-admin, W3-review, F8a-manager. 최초 확장 실행에서 OPS의 기존 표시 문구/경고 fixture 1건을 새 정책에 맞추고 페이지 이동 검증을 추가했으며 재실행 통과했다. 새 테스트 3건과 OPS 1건의 최종 재실행도 전부 통과했다.
- E2E 준비·정리에서 개발 DB 주요 테이블 건수 전후 일치를 확인했다. `predev`의 오프라인 셸 빌드도 통과했으며 Next 전용 모듈을 오프라인 번들 대상에 추가하지 않았다.

## 공용·인접 파일

- `src/server/services/uses.ts`: 대리 입력 헤더의 신규 지급처·고객 검증만 추가했다. 승인·금액 로직은 변경하지 않았다.
- `src/app/api/ledger/options/route.ts`: 목록 권한·최소 필드 조회만 변경했다. `ledger.ts`, `ledger.tsx`, quick-approval, PRICE 및 다른 작업자의 UI 영역은 변경하지 않았다.
- `src/shared/upload-limits.ts`, `src/server/upload-limits.ts`: 가져오기 전용 상수/헬퍼를 추가했다. 증빙 한도는 유지했다.
- `src/components/driver-information-fields.tsx`, `driver-join-form.tsx`, `src/app/(auth)/invite/[token]/page.tsx`: 가입/정보편집 안내 문맥을 구분했다.
- `tests/integration/SEC-security.test.ts`, `OPS-import.test.ts`, `F1-import.test.ts`, `tests/e2e/SEC-scope.spec.ts`, `OPS-import.spec.ts`: 변경된 정책·미리보기 계약에 대한 fixture/기대/타입 반영.
- `docs/API.md`: 조회 범위와 페이지/파일 한도 계약을 갱신했다.

## 남은 문제

수정 범위에서 알려진 미해결 결함과 실패 검사는 없다. 운영 배포는 이 작업에 포함하지 않았다. 신규 DB 마이그레이션은 필요하지 않다.
