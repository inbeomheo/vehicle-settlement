# 최종 검증 결과 — W7

검증일: **2026-09-29 (Asia/Seoul)**. `main`, PostgreSQL **54329**, E2E 웹 포트 **3000** (`.env`의 PORT, 미지정 시 3000).
Vitest는 실제 PG의 파일별 격리 DB·임시 storage, Playwright는 **vehicle_e2e / .data/e2e-storage**를 사용한다. 기존 개발 서버를 재사용하지 않는다.

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

## W5 회귀

- `tests/integration/W5-import.test.ts` **7개**: 유효/오류/중복, 운행·청구수량 분리, 0원·미확정, 동시 확정, 프리셋/작성자 권한, 권한 회수, 입력 검증, 외부 멱등 키 선점 방어. 수식 업로드 전체 거부 기대는 W7 결정에 따라 **캐시 결과 허용**으로 갱신했다.
- `tests/integration/W5-backup.test.ts` **1개**: 실제 PG 백업 → 스키마/파일 삭제 → 복원, 증빙 SHA-256·확정 300,000원·시퀀스/FK, 손상·덮어쓰기 거부.
- `tests/e2e/full-flow.spec.ts` **2개**: 기사/담당자 보완·보류 검수 → 전월분 정산 → 실제 Excel/PDF 다운로드 → 지급·기사 확인·void 및 타 기사 차단, 360px 가져오기 재업로드 0건.

## W6 회귀 목록

| 테스트 파일 | 수 | 검증 내용 |
| --- | ---: | --- |
| `tests/integration/W6-offline.test.ts` | 15 | 사진·바이너리 오류 상태, 408/429/5xx 재시도, 권한/검증 차단 |
| `tests/integration/W6-form.test.ts` | 11 | 고정 단위 기본 수량, 상세 입력 간소화, 실패 첨부 취소 |
| `tests/integration/W6-uses.test.ts` | 10 | 고정 단위 4종, VAT 포함 총액 보존, 공급가 override, 양수/음수 조정 승인 보존 |
| `tests/integration/W6-invites.test.ts` | 1 | 초대 토큰 최초 응답, DB 평문 제거·멱등 재생 |
| `tests/integration/W6-statements.test.ts` | 4 | 조정 원명세 취소 차단, 초안 합계, 최초 요청 멱등 비교, 초안 편집 |
| `tests/integration/W6-statement-ui.test.ts` | 4 | 지급 URL 필터, 초안 후보·제외 UI |
| `tests/integration/W6-demo.test.ts` | 1 | 시연 16건·명세 2건, 상태·증빙·수량·재실행 멱등 |
| `tests/e2e/W6-manager.spec.ts` | 2 | 역할별 메뉴/직접 URL, 지급 URL 필터 (SITE_MANAGER 가져오기는 W7에서 허용) |
| `tests/e2e/W6-offline-form.spec.ts` | 1 | 360px 폼 상세 펼침·입력 보존·첨부 복구 |
| `tests/e2e/W6-settlement.spec.ts` | 2 | 초안 편집, 미지급 대시보드 연결 |

W6: Vitest **46개**, Playwright **5개**. W6의 초기 보고서는 당시 worktree 결과이며 여기의 합산 결과가 main의 최종 상태다.

## W7 회귀 목록

| 항목 | 테스트 위치 | 수정 전 실패 / 최종 검증 |
| --- | --- | --- |
| 1 | `W7-ui.test.ts`, `W7-manager.spec.ts` | SITE_MANAGER 가져오기 가드 실패 → 메뉴/페이지 허용, 배정 외 행 ERROR |
| 2 | `W7-import.test.ts` (4개) | 반복 32,767자 공유 문자열 허용·뒤늦은 제한 → 3초 내 크기 오류, 행/열/5MB 한도 거부 |
| 3 | `W7-import.test.ts` | CP949 업로드 HTTP 200 → UTF-8 안내 **422** |
| 4 | `W7-ui.test.ts`, `W7-manager.spec.ts` | 정산 막다른 링크 → 금액 유지·정산 담당자 확인·링크 없음 |
| 5 | `W7-import.test.ts` | 행별 lookups 재조회 → 날짜별 1회/확정 시 새 캐시, 전체 로그 동시 query 경고 없음 |
| 6 | `W7-import.test.ts` (2개) | 수식/오류 하나로 전체 거부 → 캐시 결과 사용·매핑된 오류 행만 ERROR, 미선택 2,001행 시트 무시 |
| 7 | `W7-import.test.ts` (2개), `W7-manager.spec.ts` | 재저장 파일 해시 상이·제외 입력 거부 → 날짜/수량/ID 표기·빈 행 차이에도 동일 해시, 동시 0/2건, 개별 제외 |
| 8 | `W7-uses.test.ts` | 생략 수량 1로 초기화 → 기존 2.500·750,000원 유지 |
| 9 | `W7-operations.test.ts` | 네이티브 복원 이후 검증 실패 시 데이터 잔류 → 실제 PG의 빈 DB로 보상 복구 |
| 10 | `W7-operations.test.ts` | 미래 journal 시각 → 과거 순서, 기존 적용 기록 보정·재실행 멱등·후속 SQL 적용 |
| 11 | `W7-operations.test.ts`, 전체 E2E teardown | 개발 DB 2종만 검사 → 6종 데이터 생성 감지 및 전후 비교 |
| 12 | `W7-ui.test.ts`, `W7-display.test.ts` | 2.500 원문 표시 → 명세 2.5/사용대장 1,234.5, Excel 숫자/서식·PDF 모델, 저장 snapshot 유지 |
| 13 | `W7-ui.test.ts`, `W7-display.test.ts` | 경로 반복·금액 없음 → 경로/운행 수, 기본 300,000·추가 5,000·합계 305,000·요청비 표시 |
| 14 | `W7-uses.test.ts`, `W7-driver.spec.ts` | 동일 날짜 ID 정렬·금액 미제공 → 날짜/입력순·동시각 채번순(99,999→100,000), 본인 PAYABLE 금액·보조 복사 버튼·360px |

통합 파일명은 `tests/integration/`, 브라우저 파일명은 `tests/e2e/` 기준이다. W7: Vitest **5파일 / 22개**, Playwright **2파일 / 2개**.
수정 전 실패 로그: `.data/w7-qa/red-import-uses.log`, `red-cp949.log`, `red-ui.log`, `red-operations-ui.log`, `red-display.log`, `red-e2e.log`, `red-order-tie.log`. 모두 Git 제외.

## 최종 실행 결과

2026-09-29 14:26~14:29 KST 실행. 다음 명령 모두 종료 코드 0:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
npm run test:e2e
```

| 명령 | 최종 결과 |
| --- | --- |
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npm test` | **27파일 / 170개 통과** (기존 W1~W6 148 + W7 22) |
| `npm run build` | Next.js 프로덕션 빌드 통과 |
| `npm run format:check` | 통과 |
| `npm run test:e2e` | **9파일 / 15개 통과** (기존 13 + W7 2), 1.5분 |

전체 Vitest·E2E 로그에서 pg 동시 query `DeprecationWarning`은 **0건**이다. Next 개발 서버의 색상 환경변수/exit-listener 진단은 테스트 실패가 아니며 pg 경고와 별개다.

개발 DB 전후 (전 항목 동일):

| 테이블 | 전 | 후 |
| --- | ---: | ---: |
| vehicle_uses | 16 | 16 |
| statements | 2 | 2 |
| payment_records | 1 | 1 |
| evidence | 14 | 14 |
| audit_logs | 89 | 89 |
| import_jobs | 0 | 0 |

로그: `.data/w7-qa/vitest-final.log`, `build-final.log`, `format-final.log`, `e2e-final.log` (Git 제외).
최종 정렬 보완과 코드·문서 커밋 후 재빌드에서도 `git status --porcelain` 출력 없음·`git diff --exit-code` 성공을 확인했다. 재빌드 로그: `.data/w7-qa/build-clean.log`.

## 추가 확인과 한계

- 실제 개발 DB에서도 `npm run db:migrate` 성공. W6 SQL은 그대로이며 적용 시각만 해시를 대조해 보정한다. Drizzle 판단 방식과 운영 절차는 [W7 보고서](reports/W7.md), [OPERATIONS](OPERATIONS.md)에 기록했다.
- 360px ego-browser 육안 확인: 검수함의 경로/금액 카드, SITE_MANAGER 대시보드의 880,000원·정산 담당자 안내. scrollWidth=360, 지급 링크 없음. Playwright 기사 화면 screenshot에서도 작은 복사 버튼·금액 확인.
- PDF를 Poppler로 PNG 렌더링·텍스트 추출하여 `2.5`, 750,000원 합계, 한글·표·꼬리말을 확인했다. QA 파일은 `.data/w7-qa/quantity.pdf/png/txt`, `review-mobile.png`, `dashboard-mobile.png`, `test-results/W7-driver-360px.png`이며 Git 제외다.
- 네이티브 `pg_restore` 성공 경계 이후 실패는 실행 경계 대역 + 실제 PG로 검증했다. 설치 바이너리를 통한 native 전체 성공 리허설은 기존 W5와 동일하게 별도 운영 환경에서 수행할 항목이다. 논리 백업 전체 복구는 실제 실행했다.
- XLSX 수식은 계산하지 않는다. CSV 자동 CP949 변환·대용량 비동기 작업은 지원하지 않는다. W5 과거 바이트 해시는 소급 변경하지 않으며 중복 의심 경고에서 개별 제외할 수 있다.


## W9 — 입력 항목 설정 최종 검증 (2026-09-29)

`main`, PostgreSQL 54329, `.env` PORT 기본값인 **3000**에서 실행했다. E2E는 기존처럼 `vehicle_e2e`·`.data/e2e-storage`를 사용한다. 아래 명령을 **순서대로** 실행해 모두 종료 코드 0을 확인했다.

| 명령 | 결과 |
| --- | --- |
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과 |
| `npm test` | **33파일 / 210개 통과** (W9 신규 10개 포함, 실제 PostgreSQL) |
| `npm run build` | Next.js 프로덕션 빌드 통과 |
| `npm run format:check` | 통과 |
| `npm run test:e2e` | **16파일 / 40개 통과**, 2.7분 (W9 신규 390px 4개 포함) |
| `npm run db:migrate` | 개발 DB에 W9 마이그레이션 적용 완료 |

W9 요구별 근거:

| 요구 | 검증 |
| --- | --- |
| 요청자 없는 기본 기사 제출 | `W9-form-settings.test.ts` 기본값 테스트, `W9-form-settings.spec.ts` 최소 폼 사진 제출 |
| 요청자 REQUIRED → 한국어 SUBMIT_BLOCKED / 임시저장 허용 | 실제 서비스·클라이언트 공통 검사와 열린 기사 폼 제출 전 안내 |
| 현장 A 재정의, B 회사 기본 / 해제 | 서비스 항목·역할별 상속 및 모바일 관리자·기사 현장 전환 |
| 버전 충돌 409 / 다중 항목 원자성 | 실제 동시 최초 저장, 오래된 재정의 버전, HTTP 409, 실패 batch의 응답·DB 모두 이전 값 유지 |
| 기사·현장담당자 수정 403 / 권한 범위 | 직접 서비스·HTTP PUT/GET, 타 현장 404·배정 회수 |
| 감사로그·멱등 | 저장/해제 before·after·변경자, 같은 키 재시도 1회 기록, 관리자 감사 조회 |
| 필수 운행 항목·0/false·추가비 | 모든 회차 검사, 공백 경유 차단, 0·공차 아님 유효, 추가비 1건·숨김 기존 값 보존 |
| 고정 필수·대리 입력 | 0건 운행·공백 경로·현장 증빙 차단, 담당자 자동 재제출 검사·실패 시 승인 보존 |
| 오프라인 | IndexedDB 설정 캐시로 앱 재시작, 필수 경유 검사, 온라인 복귀 시 바뀐 요청자 정책으로 오류 복귀 후 재제출 |
| 모바일·회귀 | W9 390px·기존 W2/W6/W7/W8 전체 통과, 숨김 입력 DOM 제외, 입력 16px·44px 이상 |

최종 E2E의 개발 DB 업무 데이터 전후는 사용 **16→16**, 명세 **2→2**, 지급 **1→1**, 증빙 **14→14**, 감사 **89→89**, 가져오기 **0→0**이다. 신규 설정 테이블은 별도의 `db:migrate`로 적용했으며 기본 설정 행은 만들지 않았다. 전체 Vitest·E2E 로그에 pg `DeprecationWarning`은 없다. Next 개발 서버의 색상/exit-listener 경고는 기존 환경 진단이다.

ego-browser 실제 기사·관리자 화면도 390px에서 가로 넘침 없이 확인했다. `.data/w9-qa/`에 `vitest-final.log`, `build-final.log`, `e2e-final.log`, `format-final.log`, `migrate.log`, `admin-390.png`, `driver-390.png`를 보관한다(Git 제외). 중간 빌드/E2E 동시 실행의 `.next` 충돌 결과는 최종 통과에 포함하지 않았다. 자세한 구현·판단·공용 파일 범위는 [W9 보고서](reports/W9.md)에 있다.
