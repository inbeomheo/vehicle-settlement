# DRV — 기사 내 정산 현장별·날짜별 보기

## 구현 요약

- `/d/settlements`의 월 이동, 받은 돈·받을 돈, 지급명세, `N월 운행` 제목과 기존 기사 상태 문구를 유지했다.
- 기본 현장별 보기에서 현장명, 운행 건수·회차 수, 승인 공급가, 검수 전 예상 공급가를 제공하고 현장 카드를 펼쳐 운행 상세로 이동한다. 날짜별 보기는 최신 날짜부터 일별 합계와 운행 목록을 제공한다.
- 기간 합계, 직접 시작일·종료일 선택, 월별 복귀를 추가했다. `month`, `view=project|date`, `from`, `to`를 URL에 저장하며 새로고침·뒤로가기를 지원한다.
- 기존 `/api/statements/mine`에 `period_totals`, `projects`, `dates`를 추가했다. 비용·회차는 허용된 운행 ID로 일괄 조회하여 기존 운행별 비용 조회를 줄였다. 스키마·마이그레이션·새 패키지는 추가하지 않았다.
- rem 글자 크기, 기존 기사 입력·버튼 스타일, 44px 이상 터치 영역, 금액 줄바꿈 방지, 한글 단어 유지, 로딩·빈 상태·오류와 재시도를 적용했다.

## 결정 사항

1. 승인 금액은 기존 내 정산 `approved_supply` 및 사용대장과 동일한 삭제되지 않은 **PAYABLE / APPROVED 비용 줄의 승인 공급가**다. 사용 건 전체의 검수 상태로 임의 재계산하지 않는다. 합산은 기존 `sumMoney`를 사용한다.
2. 검수 전은 **PENDING·HELD** 비용 줄의 저장된 `computed_amount ?? requested_amount`를 기존 `calculateTax`로 공급가 환산한다. 기본운임 포함은 0원, 조정 금액은 이미 공급가다. 거절·삭제 비용은 제외하며, 금액 미정은 0원과 구별해 별도로 안내한다. 요청·계약 예상액은 승인액과 섞지 않는다.
3. 취소 사용 건은 이력 목록과 상세 링크에 남기고 `취소 / 합계에서 제외`로 표시한다. 기간·현장·날짜별 건수·회차·금액 합계에서는 제외한다. 개별 취소 회차도 회차 수에서 제외한다. 나머지 회차는 상태와 무관한 등록 회차 수이며 청구 수량으로 사용하지 않는다.
4. 실제 운행일의 시작일·종료일을 모두 포함한다. 서버·화면이 같은 zod 기간 검증을 사용하며 최대 1년은 시작일의 다음 해 기준일까지 미만으로 정했다(윤년 한 해 허용). 잘못된 날짜·역전·초과는 422다.
5. 현장은 ID로 묶고 기간 내 최신 운행의 저장된 현장명을 사용한다. 승인 금액 내림차순, 동률이면 검수 전 금액 내림차순이다. 운행 목록과 날짜 묶음은 최신 날짜부터 표시한다. 경로는 기존 기사 목록의 `route_summary` 함수를 추출해 재사용했다.
6. 받은 돈·받을 돈·지급명세는 기존대로 **선택 기간과 명세 기간이 겹치는 확정 명세의 본인분**이다. 명세는 세금 포함·전월분 포함이 가능하고, 운행 합계는 실제 운행일·세금 제외 기준이다. 직접 기간 화면에서 이 차이를 안내한다.
7. 기존 `assertActive`, `accessibleUseFilter`, 명세 항목 snapshot의 본인 기사 검사로 권한을 유지한다. 다른 기사, 미배정·회수된 현장, 고객 청구 비용은 추가 집계에도 노출하지 않는다.
8. 참고 `greendong.xlsx`는 ExcelJS로 읽기만 하여 현장 집계 시트 1개와 기사별 시트 8개 구조를 확인했다. 원본은 수정하지 않았다.

## 변경 범위·공용 파일

- 기사 화면: `src/app/d/settlements/page.tsx`, 신규 `period-picker.tsx`, `use-views.tsx`.
- 서버: `src/server/services/statements-driver.ts`, 신규 `driver-use-groups.ts`, `src/shared/driver-settlement-period.ts`, `src/server/domain/route-summary.ts`.
- 공용 `src/server/services/statements-schemas.ts`: 기사 조회 스키마만 공유 기간 스키마의 재수출로 교체했다. 다른 명세 스키마는 그대로다.
- 공용 `src/server/services/uses.ts`: 기존 경로 요약 문자열 생성만 공통 `routeSummary` 호출로 교체했다. 금액·권한·저장 동작은 변경하지 않았다.
- 공용 **`docs/API.md` 맨 끝에 `DRV 기사 현장별·날짜별 정산` 절 15줄을 추가**했다. 기존 절은 수정하지 않았다.
- `manager-access.ts`, `navigation.tsx`, 담당자 집계, 비밀번호 기능, 기사 홈, 공용 레이아웃은 변경하지 않았다.

## 검증 결과

환경은 이 worktree의 PostgreSQL **54347**, Playwright 서버 **3147**만 사용했다. `.env.local`의 PG_PORT를 확인했고 CLI에는 두 포트를 명시했다.

| 검증 | 결과 |
| --- | --- |
| `npm run typecheck` | 통과 |
| `npm run lint` | 통과, 기존 문서 캡처 스크립트 경고 1건 |
| `npm run format:check` | 통과 |
| `PG_PORT=54347 PORT=3147 npx vitest run` | **61개 파일, 356개 테스트 통과** |
| 신규 `tests/integration/DRV-driver-views.test.ts` | **6개 통과**, 실제 격리 PostgreSQL |
| 신규 `tests/e2e/DRV-driver-views.spec.ts` | **2개 통과** |
| 관련 기존 E2E 5개 파일 | **30개 모두 통과** |
| `git diff --check` | 통과 |

관련 기존 E2E는 `W4-settlement`, `W8a-driver`, `F7B-driver`, `Senior-form`, `full-flow`다. 최초 합동 실행에서 기존 30개와 신규 주요 흐름 1개가 통과했다. 신규 오류 테스트가 Next의 숨은 route announcer까지 `alert`로 선택해 실패하여, 테스트 선택 범위를 `main`으로 좁힌 뒤 신규 파일 2개 테스트를 재실행해 모두 통과했다. 기존 E2E 파일은 수정하지 않았다.

```sh
PG_PORT=54347 PORT=3147 npx playwright test \
  tests/e2e/DRV-driver-views.spec.ts \
  tests/e2e/W4-settlement.spec.ts \
  tests/e2e/W8a-driver.spec.ts \
  tests/e2e/F7B-driver.spec.ts \
  tests/e2e/Senior-form.spec.ts \
  tests/e2e/full-flow.spec.ts
PG_PORT=54347 PORT=3147 npx playwright test tests/e2e/DRV-driver-views.spec.ts
```

신규 통합 테스트는 다른 기사·고객 청구 미노출, 사용대장·기존 요약·지급명세와 공급가 일치, 다중 현장·다중 회차 정렬, 기간 경계, 취소, 보류·거절·삭제·기본운임 포함, 부가세 포함 예상액, 승인 0원·미정 구분, 현장 회수·비활성 기사, API 인증·날짜 검증을 확인했다.

신규 E2E는 360px·아주 크게(20px)에서 현장 펼치기, 날짜 전환, 직접 기간, 새로고침·뒤로가기·월별 복귀, 상세 이동, 가로 넘침과 금액 잘림 없음, 입력칸 높이, 기간 오류·빈 상태·로딩·API 실패 재시도를 확인했다. `test-results`의 `projects-360-20.png`, `dates-360-20.png`를 생성하고 직접 확인했다(테스트 산출물은 커밋 제외).

E2E 전후 개발 DB의 사용·명세·지급·증빙·감사·가져오기 건수는 모두 동일했다.

## 남은 문제

- 기능 수용 기준에 해당하는 미해결 문제는 없다.
- 기존 `docs/manual/capture/driver-b.mjs:1`의 미사용 `top` lint 경고 1개는 이번 소유 범위 밖이므로 수정하지 않았다. lint 종료 코드는 0이다.
- 비밀값, `.data/`, `storage/`, 참고 Excel, 테스트 캡처는 커밋하지 않았다.
