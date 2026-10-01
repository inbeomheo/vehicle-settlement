# INTEG — LIST·PUSH·JOIN·FLOW 병합 후 E2E 복구

작업일: 2026-10-01. 검증 포트: 앱 `3155`, PostgreSQL `54355`.

## 원인과 수정

| 실패 | 확인한 원인 | 처리 |
| --- | --- | --- |
| F5 숨김 입력 복원 2건, FLOW 오프라인, W2 오프라인, W9 설정 캐시 | 정적 오프라인 번들이 실행 중 `ReferenceError: process is not defined`로 중단. LIST가 기사 대시보드에서 불러온 `next/navigation`, 담당자 공통 모듈의 `next/link`가 Next.js 런타임을 번들에 유입시킴. trace에서 `w2-offline-app.js`와 `process.env.__NEXT_ROUTER_BASEPATH`를 확인. | URL 필터 상태를 브라우저 history·popstate 및 React `useSyncExternalStore`로 구현. 목록 조회 훅·페이지 이동·스타일을 Next.js 의존성이 없는 파일로 분리. 기존 담당자 공통 모듈은 재수출하여 호출부 유지. |
| W2 제출 후 내 목록, W7 과거 운행 목록, F6 최신 보완 요청 | 기사 화면과 공용 결재 API가 모두 기본 날짜를 오늘로 제한. 추가로 카드 상태 문구가 기사 안내용에서 담당자 결재 용어로 바뀜. | 기사는 날짜 미지정 시 전체 기간·전체 탭·사용일 내림차순. 명시한 날짜·프로젝트만 적용하며 날짜 해제 버튼 제공. 집계와 목록에 같은 조건 적용. 담당자 기본 오늘 유지. 카드에는 기존 `reviewLabels` 안내 문구 복원, 상태 필터 탭은 LIST 용어 유지. |
| F7a 대장 필드 수 | FLOW가 담당자·적재용량을 핵심 필드에 추가한 의도된 변경. | 카드 기대값 6→8, 담당자·적재용량 표시를 명시 검증. 운반 내용은 계속 ‘더 보기’ 안에 유지. 기존 모바일 가로 넘침 검사 유지. |
| F8B 서버 제출 실패 포커스 | 테스트가 새 필수값인 담당자·적재용량을 채우지 않아 실제 서버 전송 전 검증에 막힘. | 기존 `fillFlowFields`로 화면의 필수값 입력. 중복 요청 1회·진행 중 버튼 비활성화·오류 요약 포커스 검증 유지. |
| F8B 사진 입력 포커스 | FLOW에서 금액·특이사항이 증빙보다 앞에 배치되었으나 테스트는 여전히 ‘직전 회차 복사’ 다음 탭을 사진 입력으로 가정. | 기본 폼에서는 특이사항이 숨김이므로 증빙 직전의 ‘+ 추가 비용’ 버튼에서 탭 이동. 사진 선택→카메라 촬영의 키보드 포커스와 레이블 테두리 2px 이상 검증 유지. |

오프라인 복원 실패는 서비스 워커의 push 처리나 IndexedDB 데이터 소실 때문이 아니었다. `public/sw.js` 및 데이터 저장 구조는 수정하지 않았다. `predev`의 기존 `pwa:build`가 변경된 소스로 번들을 재생성하고 기존 fingerprint로 캐시를 갱신한다. 생성 산출물은 기존 `.gitignore`대로 커밋하지 않는다.

## 전체 실행에서 추가 확인한 간헐 실패

첫 전체 실행은 기존 11개 실패를 모두 해소했으나 `full-flow.spec.ts`에서 141/142로 종료했다. `inputUse` 헬퍼가 API의 `SUBMITTED` 상태만 확인하고 반환해서, 대리 입력 폼의 `location.assign`이 완료되기 전에 다음 사용 건으로 `page.goto`를 실행했다. trace에서 다음 사용 건의 이동이 방금 등록한 대리 입력 상세 이동에 중단되는 것을 확인했다.

헬퍼가 반환하기 전에 생성된 ID의 상세 URL과 페이지 로드 완료를 `page.waitForURL`로 기다리도록 수정했다. 기사·담당자 모두 같은 경계를 사용한다. 임의 sleep·재시도 횟수 증가·테스트 제외는 사용하지 않았다.

## 회귀 검증 보강

- LIST 실제 PostgreSQL 통합 테스트: 오늘·어제·40일 전 기사 운행의 기본 전체 기간·최신순, 기간·프로젝트 조건, 한쪽 날짜만 지정, 집계 일치, 담당자 기본 오늘.
- LIST 기사 E2E: 기본 전체 탭 3건, 이전 날짜 선택·프로젝트 유지·새로고침, 전체 기간 해제·뒤로 가기. 담당자 목록·엑셀·승인 시나리오 유지.
- FLOW 기존 오프라인 E2E: 폼 복구뿐 아니라 오프라인 `/d` 홈→기기 초안 재진입, 브라우저 실행 오류 없음, 연결 복구 후 단일 제출까지 확인.

## 변경 범위

- 기사 목록: `src/client/driver-dashboard.tsx`.
- 공용 필터: `src/components/approval-filters.tsx`.
- 공용 모듈 최소 분리: `src/components/manager/common.tsx`에서 기존 API·조회 훅을 `src/client/use-remote.ts`로, 입력 스타일·Pager를 `src/components/list-controls.tsx`로 이동하고 기존 export 유지. 담당자 `UseLink`는 Next.js Link를 그대로 사용.
- 서버 결재 조회: `src/server/services/approvals.ts`. 권한·금액·상태 판단은 서버 유지.
- E2E 5개 파일 및 LIST 통합 테스트, 이 보고서.
- 새 패키지·스키마·마이그레이션 변경 없음. 비밀값·DB·증빙 데이터 커밋 없음.

## 최종 검증

| 검증 | 결과 |
| --- | --- |
| 전체 Playwright E2E, Chromium, workers=1, 기본 retries=0 | **142/142 통과**, 9.5분. 전용 `vehicle_e2e` DB를 처음부터 생성한 전체 실행. skip·fixme·기대 실패 추가 없음. |
| 간헐 실패 안정화 확인 | `full-flow.spec.ts`의 전체 업무 시나리오 `--grep '기사 →' --repeat-each=3`: **3/3 통과**, 1.5분. 이후 전체 E2E에서도 통과. |
| `npm test` | **70개 파일, 413/413 통과**, 58.70초. 기존 412개에 LIST 실DB 회귀 테스트 1개 추가. |
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과, 오류 0. 기존 `docs/manual/capture/driver-b.mjs:1`의 미사용 `top` 경고 1개는 작업 범위 밖이라 유지. |
| `npm run format:check` | 통과 |
| 개발 DB 보존 | E2E 전후 `vehicle_uses`, `statements`, `payment_records`, `evidence`, `audit_logs`, `import_jobs` 모두 0건으로 동일. |

실행 환경은 모든 DB·앱 명령에 `PG_PORT=54355`, `PORT=3155`와 이 워크트리의 54355 개발 DB URL을 명시했다. Playwright 설정이 E2E용 DB 이름을 `vehicle_e2e`로 바꾸고 `.data/e2e-storage`를 사용한다. 3000·3134·3200·54329 등 다른 포트의 서비스에는 접근하거나 변경하지 않았다.

최종 실행 명령:

```sh
# 위 전용 환경변수를 지정한 셸에서 실행
npm run test:e2e
npm run typecheck && npm run lint && npm test && npm run format:check
# full-flow 대기 조건 수정 후 typecheck·lint·format:check를 한 번 더 실행
```

로컬 검증 기록(커밋 제외): `.data/integ-e2e-final.log`, `.data/integ-full-flow-repeat.log`, `.data/integ-checks-final.log`.

제품 수정 커밋: `6fdf32a`. 테스트 기대값·이동 경합 수정 커밋: `6e1eb23`. 모든 커밋에 `Co-Authored-By: Codex <noreply@openai.com>`을 마지막 줄로 기록했다.
