# FLOW 구현 보고서

## 구현

- 기사/대리 입력을 프로젝트 → 운행일 → 담당자 → 적재용량 → 회차별 운송내역 → 이번 운행 금액 → 증빙 순서로 연결했다. 기사 기본 차량은 자동 선택을 유지하고 접을 수 있는 차량 확인·변경 영역에 두었다. 기본 표시의 운반 내용은 운송내역 뒤로 이동했다.
- 큰 담당자 선택 칩에 이름·역할을 표시한다. 현재 현장을 검수할 수 있는 활성 담당자만 API로 제공하며 기사·현장별 최근 선택을 기본 적용한다. 사용자·기사·현장 단위 오프라인 목록 캐시, 최근 적재용량 및 차량 톤수 칩, 보내기 전 확인 시트와 초안·재전송을 연결했다.
- `reviewer`/`load_tonnage` 설정은 두 역할 모두 기본 필수다. 관리자는 숨김·선택·필수로 재정의할 수 있다. 임시저장은 빈 값을 허용하고 제출 시 서버에서 현재 설정과 담당자 권한을 재검사한다. 보완 대상·값 보존·스냅샷·개정본·감사에 포함한다.
- 적재용량은 API에서 양수, 정수부 7자리·소수부 3자리까지 검증한다. UI 신규 입력은 소수 1자리, 기존 3자리 값은 반올림 없이 보존한다. 금액 계산·승인·정산 잠금·버전·멱등 계약은 기존 서비스를 그대로 사용한다.
- 검수함 내 담당만/전체 전환, 기본 내 담당+미지정(0건이면 전체), 카드 담당자·적재용량 표시를 추가했다. 다른 담당자 지정 건도 현장 권한이 있으면 승인한다. 대시보드와 이를 사용하는 메뉴 숫자는 내 담당+미지정 검수 대기 건수다.
- 상세·사용대장·현장/기사 집계에 담당자·적재용량을 표시한다. 사용대장에는 담당자 ID/이름, 적재용량 필터와 Excel 열을 추가했다. 가져오기 두 열은 선택이며 담당자 UUID 또는 이름을 권한 있는 후보에 매칭한다. 동명이인은 UUID를 사용한다. 새 값이 없는 원본의 기존 해시는 유지한다.
- 사용 상세에 보고서 PDF 링크와 권한 검사 API를 추가했다. 기존 PDFKit·NotoSansKR를 재사용하며 프로젝트·작성일·담당자·차량 정보·회차별 경로/화물·지급 금액·현재 승인자/시간을 출력한다. 승인 금액에는 승인된 지급 줄만 포함하며 고객 청구 정보는 제외한다.
- `0720_flow_form_fields.sql`은 입력 설정 CHECK만 확장한다. 기반 `0700` 컬럼/스키마를 재사용하고 journal 및 DEPLOY 테스트 개수·이전 스키마 복원 절차를 갱신했다.

## 판단

- 미지정 건도 담당자가 처리해야 하므로 검수함의 ‘내 담당만’과 배지 모두 본인+미지정으로 일치시켰다. 자동 전체 전환과 수동 전체 조회는 기존 현장 범위를 벗어나지 않는다.
- 과거 null 기록을 자동으로 추정하거나 덮어쓰지 않는다. 다시 제출할 때 현재 필수 설정이 적용된다. 오래된 가져오기 파일은 계속 초안으로 가져오고 필수값을 보완한 후 제출한다.
- 적재용량은 차량 제원과 다른 운행 당시 값이며 톤수 칩은 입력을 돕는 제안이다. 집계에는 당시 값 목록을 표시하고 합산하지 않는다.
- 일반 보고서는 A4 한 장이다. 최대 500회차 또는 긴 운반 내용이 들어오면 잘라내거나 읽을 수 없게 축소하지 않고 다음 페이지로 이어지게 했다.
- 기존 E2E의 공통 제출 도우미가 새 필수값을 실제 UI로 채우도록 수정했다. 단계 제목·오류 포커스·회차 접기 측정은 변경된 입력 순서와 회차 영역을 기준으로 갱신했다. 검수/금액/오프라인 단언은 유지한다.

## 공용·소유 범위 밖 최소 변경

- `src/shared/form-settings.ts`: 두 키·라벨·기본 필수·공통 검증/보완 대상.
- `src/components/manager/form-fields.tsx`: 새 헤더 항목 추가에 따른 그룹 범위 수정.
- `src/components/manager/audit.tsx`: 새 필드 한국어 라벨.
- `src/components/manager/summary.tsx`, `src/server/services/summary.ts`: 당시 담당자·적재용량 목록.
- `docs/API.md`: FLOW API 계약 추가. `src/app/manual/page.tsx`: 기사 순서·확인 시트 설명 최소 수정.
- `scripts/seed-demo.ts`, `tests/helpers/factories.ts`: 새 필수값을 포함한 데모/시험 입력.
- 기존 E2E 수정 파일: `tests/e2e/submit-helper.ts`, `PRICE-driver-amount.spec.ts`, `Senior-form.spec.ts`, `full-flow.spec.ts`, `F7B-driver.spec.ts`, `W8a-driver.spec.ts`. 필수값·순서 변경 반영이며 회차 접기 높이는 전체 문서 대신 회차 영역만 측정한다.
- 기존 통합 테스트 수정 파일: `tests/integration/F2-import.test.ts`, `PRICE-driver-amount.test.ts`, `W2-offline.test.ts`, `W3-ledger.test.ts`, `W9-form-settings.test.ts`. 가져오기 후 새 필수값 보완, 오프라인 입력값, Excel 열 수와 기본 설정 기대값을 갱신했다.
- `src/server/services/import-rehash.ts`: 새 담당자 UUID 근거를 보존하고 과거 nullable 값을 정규화한다.
- `drizzle/meta/_journal.json`, `tests/integration/DEPLOY*.test.ts`: 마이그레이션 등록/개수/복원.
- `next.config.ts`: 보고서 API의 운영 함수에 PDFKit 리소스·한글 폰트 포함.
- `schema.ts`, `manager-access.ts`, 내비게이션, 기사 메뉴는 변경하지 않았다. 메뉴 배지는 기존 대시보드 호출로 반영된다.

## 검증

- `npm run typecheck`, `npm run lint`, `npm run format:check` 통과.
- 최종 `npx vitest run`: 66개 파일, 388개 테스트 통과(실제 PostgreSQL, DB_SCHEMA=vehicle 배포/복구 테스트 포함).
- `tests/integration/FLOW-use.test.ts` 5개: 역할/배정/회수/활성 상태 검증, 적재용량 경계와 기본 필수, 보완/숨김/개정/감사, 배지/검수 범위/타 담당자 승인, 인증된 PDF 라우트 200·한글 폰트·1페이지·접근 거부, 가져오기 선택 열.
- `tests/e2e/FLOW-driver.spec.ts` 3개: 360px의 보통/아주 크게 입력 순서·담당자 선택·적재용량·확인 시트·전송·최근 기본값·내 담당 검수·PDF, 오프라인 초안 복원과 1회 재전송.
- 관련 E2E 최종 전체 실행: 72개 모두 통과(5분). FLOW, W2, F2, F3, F5, F7B, W8a, W8a-proxy, Senior-form, W9, W6-offline-form, F6-offline, PRICE, W3-review, W8b-manager, full-flow, DRV, AGG를 포함한다. 앞선 실행의 Next 개발 서버 JSON 읽기 오류는 소스 변경 없이 전체 재실행하여 해소를 확인했다.
- `npm run build` 통과. 보고서 라우트의 운영 trace에 NotoSansKR 폰트와 PDFKit 리소스 15개가 포함되고 실제 파일이 존재함을 확인했다.
- PDF를 Poppler로 이미지 렌더링하여 시각 확인하고 `pdfinfo` A4 1페이지, `pdftotext` 한국어 제목·본문·승인 정보 추출을 확인했다.
- 린트는 오류 0개. 기존 `docs/manual/capture/driver-b.mjs`의 미사용 `top` 경고 1개는 FLOW 범위 밖으로 유지했다.

## 운영 반영

이 worktree의 전용 PG 54352, 앱 3152만 사용했다. 운영 배포/운영 DB 변경은 하지 않았다. 배포 시 0720 마이그레이션 적용 후 앱을 갱신해야 한다.
