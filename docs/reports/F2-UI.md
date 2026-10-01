# F2-UI 화면 결함 수정

## 범위와 판단

- `.env.local`의 PG_PORT=54383, 웹/E2E PORT=3183만 사용했다. 운영 DB·운영 사이트에 접근하지 않았다.
- 서버 권한·금액 계산·상태 전이·DB 스키마는 바꾸지 않았다. 마이그레이션과 패키지 추가 없음.
- 다른 작업자의 lookups/import/가입 및 ledger 금액·바로 승인 판정 코드는 변경하지 않았다.

## 결함별 원인·수정·회귀 테스트

1. **진행상태 선택 표시**: 흰 배경·테두리·글자색이 든 기본 버튼 뒤에 활성 클래스를 추가해 서로 충돌했다. 크기/배치와 상태 색상을 분리하고 활성/비활성 색상·굵기를 배타적으로 구성했다. `aria-pressed` 유지. 새 `tests/e2e/F2-UI.spec.ts`에서 기사·담당자의 실제 계산된 배경색과 글자 굵기, 선택 변경을 검사한다. 수정 전 두 테스트 실패, 수정 후 통과.
   - 집계 보기/포함 기준, 검수함 담당 범위/분류, 기사 정산 보기, 글자 크기, 사용 상세 탭을 전수 확인했다. 나머지는 이미 배타적 스타일이다. 집계·검수함·정산·글자 크기 전환 E2E를 추가했다.
   - 글자 크기 버튼은 40px에서 최소 44px로 늘리고 글자 크기도 rem으로 통일했다.
2. **결재 표 잘림**: 표 머리의 필터와 90rem 최소 너비 때문에 결재 열이 화면 밖으로 밀렸다. 모든 필터를 표 위 접는 막대로 옮기고 접근 가능한 필터 이름을 유지했다. 담당자 ‘전체/나’도 같은 선택 상자에서 고른다. 표는 고정 레이아웃, 운송내역 줄바꿈, 숫자 정렬, 결재 열 5rem 및 세로 버튼 배치로 바꿨다. 새 E2E에서 1280/1440px 실제 scrollWidth, 결재 열 위치, 표 머리 입력 부재를 검사한다. 수정 전 실패, 수정 후 통과. 기존 LIST 테스트는 표 내부 셀렉터 대신 접근 가능한 이름을 사용한다.
3. **사이드바 알림 잘림**: 알림 상자가 메뉴와 같은 스크롤 영역에 있었다. 메뉴 목록만 스크롤하고 알림·글자 크기·계정·링크는 축소되지 않는 하단에 둔다. 새 E2E는 관리자 전체 메뉴와 알림 차단 안내를 높이 800px, 보통/아주 크게 글자로 검사한다. 수정 전 실패, 수정 후 통과.
4. **기사 필터가 목록을 가림**: 실제 코드의 기본값은 이미 접힘이었으나 설명서 촬영이 필터를 직접 펼쳤고 요약도 길고 선택 현장이 빠져 있었다. 접힘 기본값을 유지하고 기간·현장·담당자·검색어 요약을 표시한다. 긴 조건은 잘라 숨기지 않고 줄바꿈한다. 새 E2E는 초기/새로고침 접힘, 조건 요약, 360px·20px 가로 넘침을 검사한다. 수정 전 요약 검사 실패, 수정 후 통과. 오프라인 셸에 Next 전용 import 추가 없음.
5. **설명서**: 촬영 가드를 localhost:3183, 준비용 DB를 54383으로 고정하고 외부 주소 거부를 유지했다. 주소 회귀 테스트를 먼저 실패시킨 뒤 수정했다. 시연 seed/seed:demo 상태에서 재촬영하며 기사 필터는 접힘, 결재 필터는 펼침 상태를 보여 준다. 웹 본문도 새 동작에 맞췄다.

## 공용 파일

- `src/components/approval-filters.tsx`: 기사·담당자 공통 탭/날짜 배치.
- `src/components/manager/navigation.tsx`: 담당자 공통 사이드바.
- `src/components/ui/text-size.tsx`: 공통 글자 크기 버튼 터치 영역/rem.
- `src/app/manual/page.tsx`, `docs/manual/*`, `public/manual/*`: 설명서 본문·도구·이미지·PDF.
- `tests/e2e/F8B-accessibility.spec.ts`: 텍스트 없는 장식 SVG에 텍스트 명암비 4.5:1을 적용하던 오검사를 제외한다. 실제 보조 문구 검사는 유지하며 재검증 통과.

## 검증

- 타입 검사·린트·포맷 검사 통과.
- Vitest 실제 PostgreSQL 포함 81개 파일 / 473개 테스트 통과.
- 최종 관련 E2E 49건 중 **47건 통과, 기존 AGG 대장 연결 2건 실패**. F2-UI 새 회귀 6건, LIST, FIX-MONEY, 기사 정산, PUSH, 오프라인, 접근성, 설명서 테스트는 모두 통과했다. 따라서 전체 E2E 통과 조건은 아직 충족하지 않는다.
- 새 결함 회귀 5건은 수정 전 모두 실패했고 수정 후 통과했다. 추가 토글 전수 점검 1건도 통과했다. 설명서 주소 회귀 7건도 수정 전 실패/수정 후 통과했다.
- 설명서 원본/공개 PNG를 재촬영했고, PDF 34쪽을 재생성해 전체 페이지 렌더링과 주요 장면을 직접 확인했다. 11b/20b/21/26/27/28/29/17/18 포함.
- 앱 60개 화면/글자 크기 조합의 가로 넘침·실제 잘림 없음(의도한 말줄임 제외). 설명서 360/390/1440px도 가로 넘침·잘림 없음.
- 촬영 중 Next 개발 서버의 일시적 JSON 파싱 오류로 관리자 스크립트가 한 번 중단됐고, 같은 로컬 서버에서 admin/driver-c를 재실행해 완료했다.

실행 명령(전용 환경):

```sh
export DOTENV_CONFIG_PATH=.env.local PG_PORT=54383 PORT=3183
npm run typecheck && npm run lint && npm run format:check && npm test
PORT=3183 npx playwright test tests/e2e/F2-UI.spec.ts tests/e2e/LIST-approvals.spec.ts tests/e2e/FIX-MONEY.spec.ts tests/e2e/AGG-summary.spec.ts tests/e2e/PUSH-settings.spec.ts tests/e2e/DRV-driver-views.spec.ts tests/e2e/F8B-accessibility.spec.ts tests/e2e/W6-offline-form.spec.ts tests/e2e/FIX-REQ-manual.spec.ts tests/e2e/MANUAL-captures.spec.ts
```

## 남은 범위 밖 문제

`AGG-summary.spec.ts`의 1440px/390px 두 건: 집계에서 사용대장으로 이동한 후 기사 선택지가 비어 실패한다. 기존 README에 기록된 `/api/ledger/options` → 현장 담당자에게 금지된 `listMaster` 호출 문제다. F2-LOOKUP/코디네이터 통합 후 재검증이 필요하며 본 작업에서는 해당 서버 파일을 수정하지 않았다.
