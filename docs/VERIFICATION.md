# 검증 결과 — W5 통합 인계

검증일: 2026-09-29. `feat/w5`, W1~W4 병합 기반. PostgreSQL 54334 / 앱 3105.
Vitest는 실제 PostgreSQL의 격리 DB, Playwright는 시드가 있는 개발 DB와 실제 Chromium을 사용했다.

## 필수 시나리오 14개

아래 이름은 `docs/spec/구현지시서.md §12`의 각 행을 실제 테스트에 연결한다. 한 테스트가 여러 시나리오를 검증하는 경우 같은 위치를 함께 기재했다.

| # | 시나리오 | 테스트 위치 / 정확한 테스트명 | 결과 |
| --- | --- | --- | --- |
| 1 | 일대 30만 원에 실제 운행 5건 → 30만 원 | `tests/integration/uses.test.ts` — `(a,c) 일대 30만원은 운행 5건이어도 BASE 한 줄, 반복 경로 보존` | 통과 |
| 2 | 회당 10만 원, 청구수량 5회 → 50만 원 | `tests/integration/uses.test.ts` — `(b) 회당 청구수량 5, 실적 3건은 50만원; 실적은 제안일 뿐` | 통과 |
| 3 | 같은 날·같은 경로 실제 반복 운행 보존 | `tests/integration/uses.test.ts` — `(a,c) 일대 30만원은 운행 5건이어도 BASE 한 줄, 반복 경로 보존` | 통과 |
| 4 | 같은 등록 요청 두 번 → 한 건 | `tests/integration/routes-auth.test.ts` — `(d) 동시 Idempotency-Key 생성 2회는 같은 응답과 한 건, 요청 불일치 422`; `uses.test.ts` — `(d) 동시 client_request_id 생성은 하나만 저장` | 통과 |
| 5 | 기사·차량·소속 변경 후 과거 snapshot 유지 | `tests/integration/uses.test.ts` — `(e) 기사·차량·소속 정보 변경 후에도 기존 스냅샷 유지` | 통과 |
| 6 | 다음 달 계약 변경 후 이전 승인·확정 금액 유지 | `tests/integration/uses.test.ts` — `(f) 새 기간 단가는 새 건에만 적용, 참조 계약 직접 수정 차단`; `W4-exports-auth.test.ts` — `기준정보·단가 변경 및 원자료 훼손에도 확정 화면/XLSX/PDF 모델과 금액은 고정` | 통과 |
| 7 | 승인 후 비용 수정 → 재승인 | `tests/integration/review.test.ts` — `(g) 기사 비용 수정은 DRAFT, 이전 승인과 revision 보존`; `담당자 내용 수정은 새 revision 자동 SUBMITTED` | 통과 |
| 8 | 두 담당자 같은 비용 동시 마감 → 중복 방지 | `tests/integration/W4-statements.test.ts` — `별도 커넥션·두 담당자의 동시 확정은 하나만 성공하고 전체 패자는 CONFIRM_BLOCKED` | 통과 |
| 9 | 사진 실패 후 사진만 재전송, 사용 중복 없음 | `tests/integration/evidence-auth.test.ts` — `(h) 업로드 실패 후 증빙만 재전송, 운행과 증빙 중복 없음`; `tests/e2e/W2-driver.spec.ts` — `모바일 5회 운행·사진 실패 재시도·일대 30만원 제출·보완 항목 재제출` | 통과 |
| 10 | 지급 오입력 취소 → 원기록·취소 이력·잔액 복구 | `tests/integration/W4-payments.test.ts` — `확정·전액·방향만 허용하며 지급 PAID → void UNPAID, 취소 이력과 원기록 보존` | 통과 |
| 11 | 전월 사용분 다음 달 정산 → 날짜·기간 분리 | `tests/integration/W4-statements.test.ts` — `U001 200,000+30,000, U002 일대 300,000/5운행 = 530,000; 늦게 승인된 9/30 사용분 400,000은 10월 전월분` | 통과 |
| 12 | 타 기사 자료·첨부·출력물 차단 | `tests/integration/evidence-auth.test.ts` — `(i) 다른 기사 사용 건·증빙 파일은 404, 기사 응답과 revision에 고객 청구·연락처 없음`; `W4-exports-auth.test.ts` — `기사 정산은 본인 PAYABLE 항목 금액만, 타 기사·전체 명세·export URL은 404` | 통과 |
| 13 | Excel·PDF 내역·합계 = 확정명세 | `tests/integration/W4-exports-auth.test.ts` — `기준정보·단가 변경 및 원자료 훼손에도 확정 화면/XLSX/PDF 모델과 금액은 고정`; `W4-boundaries.test.ts` — `세액은 각 라인 5원의 1원씩 합산하며 화면·엑셀·PDF 입력이 모두 12원으로 일치` | 통과 |
| 14 | 단가 미확정 정산 확정 차단·사유 | `tests/integration/W4-statements.test.ts` — `단가 미확정는 확정 시 재검사하여 항목별 차단 사유를 반환한다` (`it.each`의 `%s` = `단가 미확정`) | 통과 |

14개 모두 기존 W1~W4 테스트에 대응한다. W5는 누락을 확인한 뒤 가져오기·복구·전 과정 브라우저 연결에 대한 별도 테스트를 추가했다.

## W5 추가 검증

`tests/integration/W5-import.test.ts` (7개):

- `유효·오류·중복 행 분류, 운행5/일대1, PROXY DRAFT, 오류 엑셀 및 재가져오기 중복 0`
- `회당 운행횟수는 청구수량이 아니며 파일 단가 누락은 PENDING, 0원은 CONFIRMED, 계약 차이는 경고`
- `동일 파일 동시 확정은 한 건만 생성하고 실제 반복행은 보존, 비슷한 기존 사용은 경고만`
- `CSV 문자열·별칭 자동 매핑·프리셋 저장/수정은 작성자별이며 다른 사용자·기사 접근 차단`
- `미리보기 이후 현장 권한 회수·비활성화는 확정/재요청 차단하며 클라이언트 검증 결과를 신뢰하지 않음`
- `잘못된 파일·수식·중복 매핑·금액 범위는 거부하고 확정 직전 기준정보를 다시 검증한다`
- `외부 client_request_id가 가져오기 해시를 선점해도 기존 사용 건을 덮어쓰지 않는다`

`tests/integration/W5-backup.test.ts` (1개):

- `백업 → DB 초기화 → 복구 → 증빙 SHA-256·확정 합계·시퀀스 검증 통과, 손상·덮어쓰기·실패 차단`

`tests/e2e/full-flow.spec.ts` (2개):

- `기사 → 보완·재제출·보류 검수 → 전월분 정산 → 엑셀/PDF → 지급·기사 확인 → 오입력 취소·미지급, 타 기사 URL 차단`
- `360px 가져오기: 자동 매핑·프리셋·오류 다운로드·임시저장·같은 파일 재업로드 0건`

전체 흐름은 driver1의 일대 5운행(300,000원), driver2의 실적 2운행·청구수량 5(500,000원), site의 8/31 대리입력(300,000원)을 **화면에서 입력**한다. site가 보완 요청하고 기사가 수정·재제출한 뒤 통행료 5,000원을 보류한다. settlement가 9월 명세 2개를 확정하여 부가세 포함 660,000원·550,000원을 확인한다. 각 명세의 실제 Excel/PDF 다운로드와 Excel 재독입, 지급 기록, 두 기사의 내 정산, void 이후 원기록 보존·미지급 복귀를 검증한다. 타 기사 직접 URL과 출력 API는 차단한다.

## 백업·복구 실행 로그

실제 PostgreSQL 테스트에서 스키마와 증빙 폴더를 삭제한 후 다음 검증이 통과했다. 임시 경로만 생략했다.

```text
pg_dump/pg_restore 없음: 앱 논리 백업(마이그레이션·원문 데이터·시퀀스) 사용
{"format":"app-logical-v1","files":2,"evidence_files":1,"confirmed_statements":1}
{"result":"통과","evidence_files":1,"confirmed_statements":1}
W5 리허설 통과: 빈 DB 복구 / 증빙 파일 1 / 확정명세 1 / 총액 300000 / 시퀀스 보존 / 손상 백업 차단
```

CLI도 별도로 실행했다. `npm run backup -- .data/w5-qa/cli-backup` → 빈 `w5_restore_rehearsal` DB와 별도 storage로 `npm run restore -- ...` → `npm run restore:verify`:

```text
{"format":"app-logical-v1","files":5,"evidence_files":4,"confirmed_statements":2}
{"result":"통과","evidence_files":4,"confirmed_statements":2}
{"result":"통과","evidence_files":4,"confirmed_statements":2}
```

존재하지 않는 STORAGE_DIR를 지정한 실패 확인:

```text
STORAGE_DIR=.data/w5-qa/missing-storage npm run backup -- .data/w5-qa/expected-failure
백업 실패: ENOENT: no such file or directory, open '<백업경로>.partial/storage/<사용ID>/<증빙ID>'
종료 코드: 1
```

테스트는 손상 manifest/증빙, 확정 합계 불일치, 비어 있지 않은 storage 거부도 확인한다. native pg_dump 분기는 현재 설치본에 도구가 없어 실행하지 않았으며, 실제 수용 검증은 문서화한 앱 논리 백업 대안으로 완료했다.

## 전체 명령 결과

| 명령 | 결과 |
| --- | --- |
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npm test` | 통과 — 15파일 / 102테스트 |
| `npm run build` | 통과 — Next.js 프로덕션 빌드 |
| `npm run test:e2e` | 통과 — 4파일 / 8테스트 (1.2분) |
| `npm run format:check` | 통과 |

전체 실행 로그는 Git 제외 경로 `.data/w5-qa/vitest.log`, `build.log`, `e2e.log`, `restore.log`, `backup-failure.log`에 남겼다. 실패 시 Playwright trace는 `test-results/`에 생성된다. 로그에 기존 pg 동시 query 사용의 deprecation 안내가 있으나 테스트 실패는 아니다.

추가 육안 검증: ego-browser에서 가져오기 매핑·미리보기 화면을 360px로 확인했다. 실제 scrollWidth=360으로 페이지 가로 넘침이 없었다. 스크린샷은 `.data/w5-qa/import-mobile.png`에 보관했다.
