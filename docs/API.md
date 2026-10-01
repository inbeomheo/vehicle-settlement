# W1 API·서비스 계약

모든 경로는 `src/app/api/**/route.ts`. JSON 성공 `{ data }`, 실패 `{ error: { code, message, details? } }`와 `x-request-id` 헤더를 반환한다. 파일 다운로드는 바이너리다. 모든 응답은 `Cache-Control: no-store`이다. UUID 경로와 입력은 서버에서 검증한다. 권한 없는 단건은 404, 인증 실패는 401이다.

## 공통

- 쿠키 `sid`: HttpOnly, SameSite=Lax, 30일. 운영에서는 Secure.
- JSON 변경 요청: `Content-Type: application/json`. 재전송 시 동일 `Idempotency-Key`를 사용한다. 사용자별 키를 트랜잭션 advisory lock으로 직렬화하고 성공 응답을 저장한다. 같은 키에 경로·메서드·원문 body가 다르면 `422 IDEMPOTENCY_MISMATCH`.
- 실패 응답은 저장하지 않는다. 수정한 요청은 새 키를 사용한다. 재생 때도 현재 사용자 상태·접근 권한을 재검사한다.
- 생성에는 별도로 `client_request_id`를 권장한다. 생성 시 검증·기본값 적용 후 본문의 SHA-256을 보관한다. 같은 식별자·같은 본문은 동일 사용 건으로 수렴하고, 다른 본문은 헤더 멱등 키가 달라도 `422 IDEMPOTENCY_MISMATCH`다. 해시는 후속 PATCH로 바뀌지 않는다. 해시가 없는 기존 건은 본문 일치를 증명할 수 없어 새 헤더 키의 생성 재요청을 422로 거부하며 기존 상세에서 PATCH한다(이미 저장된 헤더 멱등 응답 재생은 유지).
- `version`: **vehicle_uses.version**. PATCH와 submit/approve/request-fix/confirm-by-driver/cancel, 라인 검수 모두 최신 사용 건 버전이 필요하다. 충돌은 `409 VERSION_CONFLICT`, `details.current_version`에 현재 버전을 제공한다.
- 증빙 변경도 부모 사용 건 version을 증가시킨다. 업로드 완료 뒤 사용 상세를 다시 조회한다. 실패 상태만 변경하거나 동일 파일을 재전송한 경우에는 내용 버전을 증가시키지 않는다.
- 수량은 `"1"`, `"2.500"` 같은 음이 아닌 decimal 문자열. 원 단위 정수 금액만 허용한다. 서버 금액·단가·승인액 필드를 일반 저장 요청에 넣으면 422다.

## 오프라인 재전송 (F6)

- 결과가 불명확한 생성 POST의 원본 본문·멱등 키·폼 행 식별자는 IndexedDB에 보관한다. 첨부 취소·새로고침·추가 편집 후에도 먼저 원본 요청을 재생해 서버 ID를 확보하고, 새 수정분은 복원된 행 ID와 `version`을 담아 PATCH한다. 명확한 입력 검증 거부는 원본 재생 대상으로 남기지 않는다.
- 마지막으로 저장한 상세·version은 화면 표시용 최신 상세와 분리한다. 전송 전후 최신 GET을 비교하고, 본인 대기 증빙의 생성·업로드·교체·삭제로 설명되는 version 증가만 허용한다. 사용 내용·검수 상태·다른 증빙 또는 설명할 수 없는 version 변화는 `conflict`로 전환한다. 사용자에게 최신 수량·금액·비고를 표시하고 최신 값 불러오기 후 다시 저장·제출하도록 한다.
- 제출 재생 응답은 과거 처리 결과다. 성공 또는 멱등 재생 뒤에는 항상 최신 상세를 GET하여 초안·폼 상태를 확정한다. 최신 조회가 실패하면 완료로 표시하지 않고 같은 제출 키를 보존한다. 과거 제출 이후 보완요청된 건은 최신 NEEDS_FIX로 표시하며 자동 재제출하지 않는다. 목록은 기존 대기열 변경 이벤트에서 최신 목록을 조회한다.

## 인증·초대

- `POST /api/auth/login`: `{ login_id, password }` → 사용자 + Set-Cookie.
- `POST /api/auth/logout`: `{}` → `{ logged_out: true }`, 쿠키 제거·DB 세션 폐기.
- `GET /api/me`: 현재 사용자. password_hash는 반환하지 않는다.
- `GET /api/invites`: 관리자만, 토큰 해시를 제외한 초대 목록.
- `POST /api/invites`: `{ role, name, phone?, driver_id?, project_ids?: UUID[] }` → 초대 + `invite_url`. 기사 역할에는 driver_id 필수.
- `POST /api/invites/:token/accept`: `{ login_id, password }` → 새 사용자 + 세션 쿠키. 비밀번호 최소 8자·UTF-8 최대 72바이트, 토큰 1회용/7일. URL의 동적 디렉터리 이름은 Next 라우트 충돌을 피하려고 `[id]`로 통일했지만 외부 URL 의미는 token이다.
- `DELETE /api/invites/:id`: 초대 회수.

## 비밀번호 재설정·변경 (PW)

- `POST /api/admin/users/:id/password-reset`: ADMIN만, 본인 포함 ACTIVE 사용자에게 생성. 빈 본문 → `{ id, user_id, expires_at, reset_url }`. 24시간·1회용 `/reset/:token`. 같은 사용자의 이전 미사용 링크는 폐기한다. `Idempotency-Key` 재요청에는 링크를 제거한 결과와 안내만 반환한다. 원본 토큰은 DB·감사·멱등 응답에 보관하지 않는다.
- `GET /api/password-resets/:token`: 로그인 불필요. 유효하면 `{ status: "VALID", name, login_id }`, 잘못됨·만료·사용·폐기·비활성 계정이면 `{ status: "INVALID", name: null, login_id: null }`.
- `POST /api/password-resets/:token`: 로그인 불필요. `{ password, password_confirmation }` → `{ changed: true }`. 비밀번호 교체·링크 사용 처리·모든 세션 폐기·해당 계정 로그인/비밀번호 확인 잠금 해제·감사를 한 트랜잭션으로 처리한다. IP 잠금은 여러 사용자에게 공유되므로 유지한다. 사용할 수 없는 링크는 `404 NOT_FOUND`와 “링크가 만료되었거나 이미 사용되었습니다. 관리자에게 새 링크를 요청하세요.”를 반환한다. 세션을 발급하지 않으며 새 비밀번호로 로그인해야 한다.
- `POST /api/auth/password`: 로그인한 모든 역할. `{ current_password, password, password_confirmation }` → `{ changed: true }`. 현재 세션을 재검사하고 다른 세션 및 미사용 재설정 링크를 폐기한다. 현재 암호 불일치는 `422 VALIDATION_FAILED`. 계정별 별도 확인 카운터를 기존 throttle 헬퍼로 잠그며 10분 내 5회 실패하면 15분 동안 `429 LOGIN_THROTTLED` (`Retry-After: 900`). 여러 세션의 동시 실패도 누적한다. 실패 횟수의 커밋을 보장하려고 외부 멱등 트랜잭션은 적용하지 않는다.
- 새 비밀번호는 초대와 동일하게 최소 8자·UTF-8 최대 72바이트. 확인 입력이 다르면 422. 본문은 비밀번호 세 필드 외 추가 필드를 허용하지 않는다.
- 감사 동작: `CREATE_PASSWORD_RESET`, `RESET_PASSWORD`, `CHANGE_PASSWORD`, `CHANGE_PASSWORD_FAILED`. 비밀번호·비밀번호 해시·재설정 토큰·토큰 해시는 기록하지 않는다.

## 사용 건

생성 예:

```json
{
  "client_request_id": "device-generated-unique-id",
  "use_date": "2026-09-15",
  "project_id": "현장 UUID",
  "driver_id": "기사 UUID",
  "vehicle_id": "차량 UUID",
  "billing_unit": "PER_DAY",
  "trips": [
    { "seq": 1, "origin": "상차장", "destination": "현장", "client_row_id": "trip-1" },
    { "seq": 2, "origin": "상차장", "destination": "현장", "client_row_id": "trip-2" }
  ]
}
```

- `POST /api/uses`, `PATCH /api/uses/:id`: 공통 필드 `use_date`, `end_date?`, `project_id`, `work_type_id?`, `requester?`, `driver_id`, `vehicle_id`, `payee_counterparty_id?`, `customer_counterparty_id?`, `cargo_desc?`, `notes?`, `operation_status?`, `trips?`, `charge_lines?`. PATCH는 일부 필드와 `version`, 선택 `change_reason`을 받는다.
- 지급처 생략 시 사용일 기준 소속을 사용한다. 기사는 본인 기사와 소속 지급처만 지정 가능하며 customer 필드·RECEIVABLE 입력은 금지한다. 담당자는 대리 입력으로 기록한다.
- `billing_unit`, `quantity`: 기본 비용 자동 생성/변경을 위한 편의 입력. 생성에서 `charge_lines`를 생략하면 PAYABLE BASE와, 고객 지정 시 RECEIVABLE BASE를 생성한다. 명시 배열을 전달하면 그 배열이 비용 목록이다.
- PATCH의 `trips`·`charge_lines`는 **각 배열 전체 교체**다. 기존 행은 `id`를 넣어 유지한다. 운행은 `client_row_id`로도 재식별 가능하다. 비용은 누락되면 논리삭제하며, 기사 요청에서 보이지 않는 RECEIVABLE과 W4 조정 라인은 유지한다. 배열 자체를 생략하면 기존 행을 유지한다. 운행 삭제 시 해당 행의 비용·증빙 연결은 사용 건 수준으로 이동한다.
- 운행 필드: `id?`, `seq`, `status?`(기본 COMPLETED), `origin`, `destination`, `via?`, `depart_at?`, `arrive_at?`, `cargo_desc?`, `quantity?`, `quantity_unit?`, `hours?`, `is_empty_return?`, `notes?`, `client_row_id?`.
- 비용 필드: `id?`, `trip_id?`, `direction?`(기본 PAYABLE), `charge_type`, `billing_unit?`, `quantity?`, `requested_amount?`, `reason?`, `included_in_base?`. 추가비는 requested_amount와 reason 필수. 일반 저장에서 ADJUSTMENT 생성은 지원하지 않는다(W4 소유).
- BASE 고정형 단위는 수량 기본 1. PER_TRIP 등의 수량 미입력은 null/PENDING이며 운행 수로 저장하지 않는다. 계약 변경 시 이번 요청의 숫자 수량을 우선한다(일대 3일·명시적 0 포함). 수량을 생략하면 이전 수량을 재사용하지 않고 고정형은 1, 실적형은 null(제출 차단)이다. 폼의 빈 수량 `null`도 새 계약에서는 같은 기본값을 적용한다. 동일 계약에서 수량을 생략하면 기존 값을 유지한다. 기본운임 포함 항목은 computed/approved 0원으로 처리한다.
- 금액 근거는 계약 snapshot에 저장한다. 가져온 파일 단가도 `agreement_snapshot.source=IMPORT`와 함께 보존하며 계약 ID가 없어도 저장 단가(0원 포함)를 사용한다. 수량·비고 변경에는 당시 단가를 사용한다. 사용일·기사·차량·현장·거래처/단위를 실제로 변경하면 해당 근거를 새로 조회한다. 요청에 `billing_unit`이 있으면 반드시 그 단위로 조회하며, 생략한 경우에만 단위를 자동 선택한다. 기사 변경에 따른 숨겨진 고객청구 재계산은 서버 소유 값으로 처리한다.
- 사용 건 snapshot은 생성·사용 내용 수정 시 현재 기준정보에서 채운다. 기준정보만 수정해도 기존 사용 건이 자동으로 바뀌지는 않는다. 제출 revision은 이전 snapshot을 보존한다.
- `GET /api/uses/:id`: 사용 건 + `trips`, `charge_lines`, `evidence`(현재 증빙), `revisions`, `duplicate_hint`. 저장·검수 API도 사용 상세를 반환한다. 파일 storage_key는 반환하지 않는다.
- `GET /api/uses`: `page=1`, `pageSize=20`(최대100), `project_id`, `driver_id`, `from`, `to`, `review_status`, `operation_status`, `search`(사용번호/운반내용), `sort=use_date|created_at|use_no`, `order=asc|desc`.
- 목록 결과 `{ rows, page, pageSize, total, totals: { pageSum, filteredSum, receivablePageSum?, receivableFilteredSum? } }`. 합계는 승인된 라인의 공급가 기준. pageSum/filteredSum은 PAYABLE이며 고객청구 합계는 담당자에게만 별도 제공한다.

## 제출·검수

- `POST /api/uses/:id/submit`: `{ version }`. DRAFT/NEEDS_FIX에서 제출, 증빙 검사, 새 revision 생성.
- `POST /api/uses/:id/approve`: `{ version, comment?, lines?: [{ id, line_review_status: "APPROVED"|"HELD"|"REJECTED", approved_amount?, reason? }] }`. 생략한 PENDING 라인은 서버 계산/요청액으로 승인하며, 먼저 라인 검수한 결과는 유지한다. PENDING 가격을 승인하려면 담당자가 승인 공급가를 지정해야 한다.
- 승인액 override는 **최종 공급가액**이다. override가 없으면 VAT_INCLUDED 금액을 공급가와 세액으로 분리한다. 추가비의 요청액을 그대로 확정할 의무는 없다.
- `PATCH /api/charge-lines/:id/review`: `{ version, line_review_status, approved_amount?, reason? }`. SUBMITTED 상태만 허용하며 `{ ...line, use_version }`을 반환한다. 사용 건 전체 승인은 별도 approve 호출로 현재 revision에 연결한다.
- `POST /api/uses/:id/request-fix`: `{ version, comment?, fix_items: [{ target, message }] }`.
- 승인/제출 후 내용 변경: 기사는 DRAFT, 담당자는 새 revision을 자동 생성해 SUBMITTED. 이전 결정·검수자·시각·감사로그는 보존하며 이전 revision은 SUPERSEDED. 증빙 변경도 동일하게 적용한다. 필수 증빙은 실제 submit과 approve에서도 재검사한다.
- 유효 명세가 비용을 잠갔으면 모든 내용 변경은 `409 STATEMENT_LOCKED`.
- `POST /api/uses/:id/confirm-by-driver`: `{ version }`. 대리 입력의 실제 기사만 확인 가능하며 승인 상태를 바꾸지 않는다.
- `POST /api/uses/:id/copy`: `{ client_request_id, use_date? }`(기본 서울 오늘). 새 DRAFT/PLANNED, 증빙·승인·명세 연결·운행 시간 제외. 새 사용일의 소속과 계약을 조회한다.
- `POST /api/uses/:id/cancel`: `{ version, reason }`. operation CANCELED, 검수 DRAFT, 이력 보존.

## 증빙

1. `POST /api/uses/:id/evidence`: `{ client_upload_id, trip_id?, kind, original_name?, mime?, size?, sha256?, text_value? }`.
2. 파일은 PENDING으로 생성. `PUT /api/evidence/:id/content`에 원시 바이트, 정확한 Content-Type을 전송.
3. 서버는 크기·MIME·파일 시그니처·선택 SHA-256을 검사하고 자체 SHA-256을 계산. 실패는 FAILED, 성공은 UPLOADED.
4. 메타 생성은 client_upload_id, 파일 업로드는 같은 파일 해시로 멱등. 실패 파일은 같은 증빙 id로 재시도하며, 콘텐츠 PUT은 JSON Idempotency-Key 응답 저장 대신 파일 자체 멱등성을 사용한다. 로그인·초대 수락 또한 JSON 응답 키 저장 없이 세션/1회 토큰 규칙을 사용한다.
5. MIME: image/jpeg, image/png, image/webp, image/heic, image/heif, application/pdf. 최대 4MiB(화면 표시 4MB, 공용 `EVIDENCE_MAX_BYTES`). `MAX_UPLOAD_BYTES`가 더 작으면 그 값을 적용한다. PDF는 파일 선택 즉시, 이미지는 리사이즈 후 같은 한도를 검사한다. SVG/HTML은 허용하지 않는다. 메타와 실제 크기·형식이 일치해야 한다.
6. SLIP_NO 또는 CONFIRMATION의 text_value는 메타 단계에서 UPLOADED 처리. PHOTO_REQUIRED는 파일 필요, PHOTO_OR_ALTERNATIVE는 해당 텍스트도 가능.
7. `GET /api/evidence/:id/file`: 사용 건 접근 검사 후 다운로드. 교체된 원파일도 권한 범위 안에서 revision 이력으로 조회 가능. 논리삭제 파일은 404.
8. `POST /api/evidence/:id/replace`: `{ reason, evidence: 새 메타 입력 }`. 새 client_upload_id 필수. 원본 replaced_by_id/replace_reason과 실제 파일은 보존. 새 파일이 업로드되기 전에는 필수 증빙을 충족하지 않는다.
9. `DELETE /api/evidence/:id`: `{ reason }`. 행과 파일을 물리 삭제하지 않는다.

## 선택 목록·단가

- `GET /api/lookups`: `{ projects, drivers, vehicles, counterparties, work_types, affiliations }`. 활성 선택지와 유효 현장 배정만 제공. 기사는 본인 기사·소속 지급처만 받고 연락처·계좌·고객 정보는 제외.
- `GET /api/rates/lookup`: `project_id`, `counterparty_id`, `vehicle_id`, `use_date`, `direction?`(PAYABLE), `billing_unit?`, `completed_trips?`.
- 결과 `{ rate, price_status, suggested_quantity }`. rate 없음은 PENDING. PER_TRIP의 완료운행수는 제안일 뿐 저장하지 않는다.
- 구체성은 현장 > 차종 > 톤수 순으로 비교하며 동일 조건은 적용 시작일이 최신인 행 우선, 동률은 생성 시각/id로 결정한다.

## W4 공통 잠금 계약

사용 건 변경은 부모 vehicle_uses를 FOR UPDATE한 뒤 비용 전체를 id 순으로 FOR UPDATE하고 locked_statement_id를 검사한다. 명세 작업에서도 부모를 잠근다면 **부모 사용 건(id 순) → 비용(id 순)** 순서를 지킨다. 비용 잠금만 취하는 확정은 비용을 잠근 뒤 승인 상태를 재검사해야 한다. W1의 확정 잠금 경쟁 통합 테스트가 이 경계를 검증한다.

정산 확정에서 `assertEvidenceSatisfied(ctx, use)`를 재사용하되 SUBMIT_BLOCKED를 명세의 CONFIRM_BLOCKED 사유 목록으로 변환한다. 필수 증빙 검사와 합계 계산은 서비스 트랜잭션 안에서 수행한다. `rawUse`, `rawDetail`은 내부 업무용 전체 필드이므로 기사 응답에는 반드시 `getUse` 또는 `redactForDriver`를 사용한다.

## 가져오기 (F4 단일 식별자)

담당자 역할만 사용한다. 작업·프리셋은 작성자에게만 보이며, 등록된 사용 건의 현장 권한은 다시 검사한다. 응답은 기존 `{ data }`/`{ error }` 형식이다.

| 요청 | 입력 / 결과 |
| --- | --- |
| `POST /api/import/upload` | multipart `file`: xlsx 또는 UTF-8 csv. 10MB/20시트/선택 시트 2,000행/100열, 셀 500자·작업 JSON 5MB. XLSX는 시트별 첫 20행 rows·추천 header_row·mapping 반환; preview에서 선택 시트 전체를 제한 내 스트리밍 |
| `GET /api/import` | 본인의 최근 100개 작업(파일명·작성자명·일시·상태·summary) |
| `GET /api/import/:id` | 헤더 선택용 첫 20행·선택 매핑·제한된 미리보기·전체 집계 |
| `POST /api/import/:id/preview` | `{ sheet: 0기반 인덱스, header_row: 1기반 행번호, mapping: { field: 0기반 열번호 }, apply_contract_rate?: boolean(기본 false), excluded_rows?: [1기반 원본 행번호] }` |
| `POST /api/import/:id/commit` | `{}`. 저장한 매핑을 서버에서 재검증하여 유효 행만 DRAFT/PROXY 생성. 완료 작업 재요청은 기존 결과 반환 |
| `GET /api/import/:id/errors.xlsx` | 원본 행번호·각 원본 셀·오류 사유가 있는 Excel |
| `GET /api/import/presets` | 본인 매핑 목록 |
| `POST /api/import/presets` | `{ name, mapping }`. 같은 작성자·이름이면 갱신, 감사로그 기록 |

필드 키: `use_date`, `project`, `driver`, `vehicle`, `payee`, `origin`, `destination`, `cargo_desc`, `trips`, `billing_unit`, `quantity`, `unit_price`, `extra`, `reason`, `notes`.
미지정 열은 mapping에서 생략한다. 동일 열 중복 매핑은 거부한다. 상세 규칙은 [ASSUMPTIONS](ASSUMPTIONS.md).

행 결과는 `VALID | ERROR | SKIPPED`, `errors`, `warnings`, `source_row_hash`, 검증 성공 시 `source_ids`(매칭된 현장·기사·차량·지급처 UUID), 등록 후 `use_id`다. 검증 실패 행은 `source_row_hash=""`이며 UUID 근거도 저장하지 않는다. summary의 `valid/errors/skipped`는 현재 작업 행 분류, `success`는 이 작업에서 생성된 건수다. 같은 완료 작업 재요청의 success는 최초 성공 건수이며, **새 업로드 작업**으로 정규화된 내용이 동일한 파일을 재저장하여 가져와도 success=0이다.

중복 식별자는 하나다: **SHA-256(정규화된 매핑 값 + 매칭된 현장·기사·차량·지급처 UUID + 파일 내 동일 내용 발생 순번)**. 매핑 값은 사용일·출발·도착·운반내용·운행횟수·과금단위·청구수량·원본 단가 문자열·추가비·사유·비고다. 날짜·Decimal 수량·단위 별칭·금액 표기를 정규화하며 원본 단가의 빈 문자열과 명시적 0은 구분한다. 기준정보 표기는 매칭 UUID로 치환한다. 파일 바이트·파일명·시트/헤더/열 위치·행 번호·계약 적용 단가·세금 등 파생값은 제외한다. 따라서 줄바꿈·열 순서·계약·계약단가 옵션을 바꾸어도 동일 자료의 추가 등록은 0건이고, 동명이어도 UUID가 다른 현장은 별개다. 검증에 성공한 제외 행은 발생 순번에 포함하고, 검증 실패 행은 포함하지 않는다.

가져오기 upload/preview/get/commit 응답은 시트별 첫 20행만 `sheets[].rows`로 제공한다. `preview`는 처음 100행과 모든 오류 행·직접 제외한 행이고 `preview_total`은 전체 검증 행 수다. `summary`와 확정은 항상 서버에 보관한 전체 원본 기준이며 클라이언트가 보낸 행은 사용하지 않는다. `{data}` 전체 UTF-8 JSON이 4MiB를 초과하면 422와 “행이 너무 많습니다. 나눠서 올려 주세요”를 반환한다. 오류 Excel은 제한된 응답이 아닌 서버 저장본의 모든 오류 행을 사용한다.

commit은 generic 응답 캐시를 사용하지 않는다. job 행 잠금 + 가져오기 공통 advisory lock + source_row_hash unique로 멱등성을 제공하며 매 요청에서 현재 권한을 검사한다. 프리셋 저장은 공용 Idempotency-Key 래퍼를 쓴다. upload/preview는 새 파일 및 재검증 요청으로 취급한다. 예상하지 못한 commit 실패는 전체 rollback하여 PREVIEW에서 재시도할 수 있다.

캐시 결과가 없는 수식/오류 셀은 매핑된 열에서만 해당 행 오류다. 파일 내 실제 반복행은 각각 보존하며 `excluded_rows`는 확정 때도 적용한다. UTF-8이 아닌 CSV는 422와 UTF-8 저장 안내를 반환한다. 온라인 가져오기는 `vehicle_uses.source_row_hash`만 비교하며 과거 작업의 해시 호환 조회·원본 행 재해석은 하지 않는다. 기존 개발 자료는 `npx tsx scripts/recalculate-import-hashes.ts`로 한 번 재계산한다. 실패 행·작업은 로그와 함께 건너뛰며 후속 가져오기를 막지 않는다. 실행 범위·보존 항목은 [ASSUMPTIONS](ASSUMPTIONS.md)의 재계산 규칙을 따른다.


## W9 입력 항목 설정

- `GET /api/form-settings?project_id=<uuid>`: 현장 접근 권한 검사 후 `{data:{project_id,modes:{[field_key]:"HIDDEN"|"OPTIONAL"|"REQUIRED"}}}`. DRIVER는 기사 모드만 반환한다. 담당자는 본인 모드와 보완요청 대상 선택에 필요한 `driver_modes`(현장에 유효한 기사 모드)를 함께 받는다.
- `GET /api/admin/form-fields?project_id=<uuid>`: ADMIN 전용. query 생략은 회사 기본. `{data:{project_id,fields:[{field_key,driver_mode,manager_mode,version}],company:{driver,manager},effective:{driver,manager},pending_fixes:{[field_key]:건수}}}`. 설정 없는 항목은 mode=null, version=0이다. `pending_fixes`는 취소되지 않은 현재 NEEDS_FIX 사용 건의 해당 항목 보완요청 수(동일 건·항목 중복 제외)다. 회사 범위는 현장 기사 모드 재정의가 없는 항목만 센다.
- `PUT /api/admin/form-fields`: ADMIN 전용, 멱등 키 지원. `{project_id:null|uuid,fields:[{field_key,driver_mode:null|mode,manager_mode:null|mode,version}]}`. 변경할 항목만 보내며 각 행의 두 역할 모드를 함께 보낸다. null은 상위 기본 따름. 저장 후 위 GET 형식 반환. 다중 항목은 원자적으로 저장·감사 기록하며 버전 충돌은 `409 VERSION_CONFLICT`, `details.current`에 최신 설정을 반환한다.
- `field_key`: `end_date`, `work_type`, `requester`, `cargo_desc`, `operation_status`, `notes`, `via`, `cargo`, `quantity`, `quantity_unit`, `hours`, `depart_at`, `arrive_at`, `trip_status`, `is_empty_return`, `trip_notes`, `extra_charges`. 고정 필수 항목은 설정할 수 없다.
- 사용 제출의 설정 필수 누락은 `422 SUBMIT_BLOCKED`, `details.fields:[{target,reason}]`. reason과 message에 한국어 항목 이름을 포함한다. DRAFT 저장·HIDDEN의 기존 값은 허용한다.
- `request-fix`는 담당자 모드와 무관하게 최신 현장 기사 모드가 HIDDEN인 대상을 `422 VALIDATION_FAILED`, `details.fields:[{target,reason}]`로 거부한다. 헤더·`use.` 별칭·회차·추가비 그룹/개별 라인을 검사하며 고객 청구·정산 조정도 기사 수정 불가 사유로 거부한다. 기본운임은 추가비 숨김과 별개다. 취소는 자동 재제출·설정 필수값 검사를 수행하지 않고 승인 무효화·잠금 검사·이력 보존만 수행한다.

## F1 명세 확정 재확인

초안 상세·생성·수정 응답의 `confirmation_token`은 서버가 포함 항목 ID, 비용 라인 ID·version·승인 공급가·세액, 정산 가능 여부와 합계로 만든 SHA-256 해시다. 확정·취소 명세에서는 null이다.

`POST /api/statements/:id/confirm`은 `{ version, confirmation_token }`을 필수로 받는다. 서버는 부모 사용 건과 비용 라인을 잠그고 확정 가능 여부를 재검사한 뒤 토큰을 비교한다. 변경된 초안은 `409 STATEMENT_CHANGED`와 `details.{supply_total,tax_total,grand_total,included_count,confirmation_token}`을 반환한다. 클라이언트는 최신 상세를 다시 조회·표시하고 사용자의 재확인을 받는다. 기존 명세 version 충돌은 `VERSION_CONFLICT`, 미승인·잠금·증빙 등 확정 불가 사유는 `CONFIRM_BLOCKED`를 유지한다.

## F7A 담당자 조회·집계 보완

- `GET /api/statements/candidates`: `includeDrafts="true"|"false"`(기본 false)를 추가한다. 운행 상태 CANCELED는 항상 제외한다. 검수 DRAFT 또는 제출 차수 0인 사용은 기본 숨기며, `unsubmitted_count`는 같은 권한·거래처·기간 조건의 미제출 **사용 건 수**다(비용 줄 중복 제외). true일 때만 해당 비용과 `미제출 사용 건` 사유를 반환하며 포함 가능 여부는 false다. 확정 트랜잭션에서도 취소·미제출을 재검사한다.
- `GET /api/statements`: rows/total에는 선택한 상태의 모든 명세를 유지한다. `totals.pageSum/filteredSum`은 해당 페이지/검색 결과의 CONFIRMED 명세만 합산하며 DRAFT·CANCELED는 제외한다. 취소 명세 상세·목록의 `payment_status`, `collection_status`는 null이다. 화면은 `—(취소됨)`으로 표시한다. 지급 관리와 대시보드 미지급 집계 역시 CONFIRMED만 대상이다.
- 명세 상세·출력 순서는 실제 사용일 → 사용번호 → 비용 ID다. 확정·취소 명세 정렬은 고정 snapshot을 사용하며 당시 값·합계를 다시 계산하지 않는다.
- `GET /api/ledger` 및 대장 Excel의 합계는 CANCELED 사용을 제외한다. 취소 행과 당시 금액은 조회에 남으며 `operation_status`로 취소 뱃지를 표시한다.
- `GET /api/audit`: `include_sessions="true"|"false"`(기본 false)로 로그인·로그아웃 세션 이력을 포함한다. 기존 역할/현장 접근 범위는 유지한다. 설정 이력의 `entity_label`은 `요청자(서울 현장)`처럼 항목·현장을 제공한다. 신규 설정 감사에는 당시 `project_name`을 보존하며 기존 감사는 현장 기준정보로 보완한다. 조회 응답의 `before/after.approved_revision_id`는 해당 제출본 차수(`제출본 #3`)로 해석한다. 저장된 감사 원문은 변경하지 않는다.
- 담당자 `/m/uses/new?project=`와 `/m/master/form-fields?project=`는 UUID 형식·현장 존재·접근 범위를 검증하고 잘못된 값을 제거한 URL로 이동한다. 대리 입력은 활성 현장만 허용하고, 설정 화면은 사용 중지 현장도 관리 가능하다. 폼 설정의 현장 선택은 URL에 반영되어 새로고침·뒤로가기 때 복원된다. 직접 API의 잘못된 현장값은 기존대로 `422 VALIDATION_FAILED`와 `details[].path=["project_id"]`를 반환한다.

## F8A — 가져오기 미리보기 삭제 대상

`DELETE /api/import`는 선택적인 JSON 본문 `{ ids: string[] }`를 받는다. `ids`는 UUID 1~100개이며 빈 배열·잘못된 ID·100개 초과는 422다. 전달한 ID 중 요청자 소유이고, 여전히 PREVIEW이며, 마지막 수정 후 7일이 지난 작업만 잠금 후 삭제한다. `{ data: { deleted } }`는 실제 삭제 건수다. 본문/ids 생략 시 기존 전체 오래된 미리보기 정리 동작은 유지한다.

담당자 화면은 최근 100건 중 확인창에 표시한 파일 ID만 보낸다. 목록 밖 자료나 확인 후 새로 오래된 상태가 된 자료는 이 요청으로 삭제하지 않는다. 확인 이후 다시 검증하거나 완료된 자료도 서버 조건에 따라 보존한다.

## F9 보안 경계

- JSON 요청은 스트리밍 2MiB, 증빙 PUT은 4MiB 제한을 초과하면 `413 PAYLOAD_TOO_LARGE`다.
- 로그인은 계정별 10분 내 5회/IP별 20회 실패 시 15분 잠금(`429 LOGIN_THROTTLED`, `Retry-After: 900`). 성공 시 해당 계정·현재 IP 카운터를 초기화한다. 로그인·초대 수락에서 UTF-8 72바이트 초과 비밀번호는 422이며 한국어 오류를 제공한다.
- 기사 상세의 revisions는 각 snapshot.driver_id가 본인인 것만 반환한다. 다른 기사에게 속했던 증빙은 현재 목록·자신의 새 제출본에서도 제거하며 파일 직접 접근은 404다. F10부터 증빙 생성 시의 불변 owner_driver_id로 기사 귀속을 판단하며, 다른 기사 귀속·null 귀속은 숨긴다. 담당자는 기존 이력을 유지한다. 감사 API는 계속 담당자 전용이다.
- 유효 배정 현장이 없는 SITE_MANAGER 및 현장 제한 SETTLEMENT_MANAGER는 가져오기 업로드 단계에서 403이다.

## F10 증빙 귀속과 제한 안내

- `owner_driver_id`는 증빙 메타 생성 시 서버가 잠근 부모 사용 건의 기사로 설정하는 읽기 전용 값이다. 클라이언트 입력은 허용하지 않는다. 업로더 역할/연결 변경·사용 건 기사 변경·파일 재업로드로 바뀌지 않는다.
- 기사의 증빙 목록·revision 내부 증빙·다운로드·업로드·삭제·교체·client_upload_id 재전송·Idempotency-Key 재생은 현재 사용 건/현장 권한과 귀속 기사 일치를 모두 검사한다. 다른 기사 또는 null 귀속 단건은 404다. 해당 사용 건이 다시 본래 기사에게 배정되면 그 기사의 증빙은 다시 보인다.
- 사용 상세의 `restricted_evidence_count`는 기사가 볼 수 없는 현재(삭제/교체되지 않은) 증빙 수다. `restricted_evidence_satisfies_policy`는 그 제한 증빙만으로 현재 현장의 필수 증빙 정책을 충족하는지를 알려준다. 파일명·ID·본문은 포함하지 않는다. 담당자 응답은 건수 0/false이고 원래 전체 증빙을 유지한다.
- 숨겨진 증빙도 해당 사용 건의 제출·승인·정산 근거로 인정한다. PENDING/FAILED, 삭제, 교체된 증빙은 기존대로 필수 충족에서 제외한다. 클라이언트 안내 값은 검증 권한을 부여하지 않으며 서버가 매번 최종 재검사한다.

## AGG 현장·기사별 집계

- `GET /api/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&include=approved|all`: 담당자 전용, 기본 `include=approved`. `from`·`to` 필수, 실제 사용일 양끝 포함, 종료일은 시작일의 다음 해 같은 날짜 미만(최대 1년). 잘못된 입력은 422, 기사는 403이다.
- `GET /api/summary/export.xlsx`: 같은 입력·권한·현장 범위·계산으로 `현장별`, `기사별`, `표` 3시트를 내려준다. 파일명은 `현장기사별집계_시작일_종료일.xlsx`, 숫자 셀은 `#,##0`이다.
- 응답 `{ data: { from, to, include, projects, drivers, cells, totals } }`. `projects`는 `{id,name,...합계}`, `drivers`는 `{id,name,affiliations:string[],...합계}`, `cells`는 `{project_id,driver_id,...합계}`다. 합계 필드는 `count`, `approved_supply`, `approved_tax`, `pending_supply`, `pending_unknown_count`. `totals`에 `grand_total`(승인 공급가+세액), `driver_count`, `project_count`를 추가한다.
- `count`는 사용대장 한 줄(사용 건) 기준이며 비용 줄·회차 수로 중복하지 않는다. `approved`는 승인 공급가가 있는 PAYABLE 줄을 가진 사용 건만(0원 포함), `all`은 취소되지 않은 모든 사용 건을 센다. 보류·반려만 있는 건은 `all`의 건수에는 포함되지만 금액에는 포함되지 않는다.
- 승인 공급가는 사용대장의 `ledgerBase`를 재사용한다. 사용 건 전체 승인 여부와 별개로 삭제되지 않은 PAYABLE/APPROVED 줄의 저장된 승인 공급가·세액을 합산한다. 취소 사용 건, 삭제·보류·반려 비용, RECEIVABLE은 금액에서 제외한다. 정산 완료 금액도 운행일 기준 집계에 포함하며 명세의 정산 기간/확정/지급 상태로 다시 제한하지 않는다.
- `all`의 검수 전 금액은 PENDING 줄만 별도 표시한다. 기본운임 포함은 0, 그 외 `BASE: requested_amount ?? computed_amount`, 그 외 `computed_amount ?? requested_amount`를 기존 `calculateTax`로 공급가 환산한다. ADJUSTMENT는 저장된 공급가 차액 그대로다. 미정 비용은 금액에 더하지 않고 `pending_unknown_count`로 알린다.
- `ledgerBase`의 기존 `accessibleUseFilter` 권한을 그대로 적용한다. 관리자 및 `all_projects=true` 정산 담당자는 전체, 현장 담당자 및 현장 제한 정산 담당자는 현재 유효 배정 현장만 조회한다. 기사·현장 식별자는 UUID, 이름은 해당 범위 내 최신 사용 스냅샷, 상호는 각 실제 사용일에 유효한 `driver_affiliations → counterparties` 이름을 중복 제거한다.
- `/m/summary` URL은 `from`, `to`, `include`, `view=projects|drivers|table`을 유지한다. 대장 연결은 기존 `/m/ledger?from&to&project_id&driver_id` 필터를 사용한다.

## DRV 기사 현장별·날짜별 정산

`GET /api/statements/mine?periodStart=YYYY-MM-DD&periodEnd=YYYY-MM-DD`는 기존 `uses`, `summary`, `statements`에 다음 읽기 전용 집계를 추가한다. 기사 역할·본인 운행·현재 유효한 현장 배정을 모두 검사한다. 유효한 실제 날짜, 시작일 ≤ 종료일, 시작일의 다음 해 같은 날짜 미만(최대 1년)을 zod로 검증하며 실패는 422다. 조회일 양 끝은 포함한다.

- `period_totals`: `{ count, trip_count, approved_supply, pending_supply, unpriced_count, canceled_count }`.
- `projects`: `{ project_id, project_name, ...period_totals, uses }[]`. 승인 공급가 내림차순, 동률이면 검수 전 공급가 내림차순. 이름은 해당 기간의 최신 운행에 저장된 현장명이다.
- `dates`: `{ date, ...period_totals, uses }[]`. 실제 운행일 내림차순.
- 기존 `uses`와 묶음 내부 `uses`의 행: 기존 `id, use_no, use_date, review_status, project_name, held_count, approved_supply`에 `project_id, operation_status, route_summary, trip_count, pending_supply, pending_count, unpriced_count`를 추가한다. 경로는 기존 기사 목록과 같은 첫 경로 + 나머지 회차 요약이다.

승인 공급가는 기존 기사 정산·사용대장과 동일하게 삭제되지 않은 PAYABLE/APPROVED 라인의 `approved_amount` 합이다. 검수 전은 PENDING/HELD의 저장된 `BASE: requested_amount ?? computed_amount`, 그 외 `computed_amount ?? requested_amount`를 기존 세금 함수로 공급가 환산한다(기본운임 포함은 0, ADJUSTMENT는 이미 공급가). REJECTED·삭제 비용은 제외한다. 금액이 없는 항목은 `unpriced_count`로 구분하며 합계에 더하지 않는다. 사용 건·개별 회차의 CANCELED는 집계 건수·회차에서 제외하며 취소 사용 건의 금액은 기간·현장·날짜 합계에서 제외한다. 취소 운행 행은 이력 조회를 위해 남긴다.

지급명세·받은 돈·받을 돈은 기존처럼 **선택 기간과 명세 기간이 겹치는 확정 지급명세의 본인분**을 조회한다. 운행 합계는 **실제 운행일과 세금 제외 공급가** 기준이므로 지급명세 합계(세금 포함·전월분 가능)와 의미가 다르다. 다른 기사·고객 청구 정보는 추가 집계에도 포함하지 않는다.

화면 URL은 기존 `month=YYYY-MM`과 `view=project|date`(기본 project), 직접 기간 `from=YYYY-MM-DD&to=YYYY-MM-DD`를 사용한다. from/to가 있으면 month보다 우선하며 월별 복귀 때 from/to만 제거한다. 새로고침·뒤로가기에서도 선택을 복원한다.


## PRICE 운행 금액 직접 입력

- BASE에도 `requested_amount: null | integer(0..2147483647)`를 받는다. 기사 본인·담당자 대리 입력 모두 지원한다. `null`/생략은 요청액 없음이며 기존 요청액을 지울 때는 `null`을 보낸다. 단가·계산액을 일반 입력으로 받지 않는다. 요청액은 줄의 `tax_mode` 기준(기본 VAT_EXCLUDED 공급가)이다.
- 저장 시 계산액 또는 요청액이 있으면 `price_status=CONFIRMED`이며 승인 상태는 여전히 PENDING이다. 승인액·세액은 담당자 확인 이후 확정된다. 금액 0은 미정과 구분한다.
- 승인 기본값·검수 전 예상액은 기본운임에서 **요청액 → 계약 계산액** 순이다. 추가비는 기존 계산액 → 요청액 순, 기본운임 포함은 0이다. 승인 `approved_amount`는 최종 공급가로 우선하며 세금 계산·감사·버전·승인 무효화·멱등·명세 잠금 규칙은 그대로다.
- 대장 `review_base_amount`, `review_extra_amount`, `review_total_amount`는 적용 금액을 공급가로 환산한다. `has_base_amount_difference`는 지급 BASE의 PENDING 줄에서 계약 계산액과 요청액이 모두 있고 다를 때 true다. 검수함은 이를 “계약 단가와 다른 금액”으로 표시하고 바로 승인/일괄 선택에서 제외한다. 계약 없이 요청액만 있으면 다른 문제가 없는 한 바로 승인할 수 있다.
- 기사 목록 `payable_base_amount`는 승인 전 요청액 → 계산액, 승인 후 승인 공급가를 표시한다(기존 목록의 승인 전 줄 세금모드 기준 표시 유지). 기사 정산·현장/기사 집계의 pending_supply는 같은 선택 규칙으로 공급가 환산한다. 정산 후보의 `estimated_supply`는 승인 공급가 또는 검수 전 예상 공급가이며 `snapshot.supply_amount`를 대체하지 않는다. 승인 전 후보는 포함 불가다. 대시보드는 기존 승인 후 미정산액·확정 미지급액을 사용한다.
- `GET /api/uses/recent-routes?driver_id=<본인 기사 UUID>`의 각 경로에 `last_amount: number | null`(공급가)을 추가한다. 같은 출발·도착의 가장 최근 제출본 시각, 생성시각, ID 순으로 선택한 제출 스냅샷의 PAYABLE BASE 제안 금액 합이다. 제출 뒤 아직 보내지 않은 수정값과 다른 기사로 귀속된 제출본은 참고하지 않는다. 최신 건의 금액이 미정이면 과거 금액으로 건너뛰지 않는다. 미제출·취소·삭제·반려 비용은 참고 금액에서 제외하고 현재 현장 권한을 검사한다. 기존 `driver_id`/`user_id` 조회 범위는 유지한다. 폼은 선택한 기사 ID를 명시하고, 1회차 최근 경로 선택 시 계약이 없고 빈 요청액에만 채운다. 직접 입력은 덮어쓰지 않는다.
- 가져오기 단가 열은 기존대로 **단가 × 청구수량**이다. 파일 단가 합계는 기존처럼 계산액에 저장한다(별도 요청액은 null). 기존 단가/계산액/중복 식별자와 사용일·과금단위 변경 시 재조회 동작을 유지한다. `agreement_snapshot.contract_computed_amount`, `contract_min_charge`에 계약 비교 근거를 보관해 다른 금액을 검수 이슈로 표시한다. 같은 계약에서 수량 수정 시 비교 계약액도 갱신한다. 단가 빈칸/계약단가 적용 옵션/0원 처리의 기존 규칙은 유지한다.
- 폼의 숫자 표시는 천 단위 쉼표이고 API에는 정수만 전송한다. IndexedDB 초안·원본 생성 요청 재생·생성 행 ID 복원에도 BASE 요청액을 보존한다. 최근 금액 표시용 로컬 필드는 API에서 제외한다.

## LIST 운행 결재 목록

- `GET /api/approvals`: 담당자는 기존 유효 현장 범위, 기사는 유효 현장과 본인 기사 범위를 서버에서 강제한다. `from`, `to`는 실제 운송일 양끝 포함(각 기본 서울 오늘), `project_id`, `driver_id`, `reviewer_user_id`(UUID 또는 `me`), `transport_search`(출발·도착·사용 건/회차 운반 내용, 최대 100자), `review_status`, `page`, `pageSize`(최대 100)를 받는다. 날짜 내림차순이며 같은 날짜의 순서는 기존 목록 정렬을 따른다.
- `rows/page/pageSize/total/totals`는 기존 담당자 대장·기사 목록 응답을 재사용한다. `counts: {ALL,DRAFT,SUBMITTED,NEEDS_FIX,APPROVED}`는 상태를 제외한 같은 필터의 개수다. 취소는 ALL에만 포함한다. `summary: {count,amount,unknown_count}`는 현재 상태까지 포함한 전체 검색 결과의 취소 제외 건수·지급 공급가·미확정 비용 개수다. 금액은 기존 검토 공급가(저장된 승인액 우선, 기본운임 요청액→계약액, VAT_INCLUDED 공급가 환산)를 합하며 삭제·반려 비용과 고객청구는 제외한다. 페이지와 무관하다.
- `options: {projects,drivers,reviewers}`는 현재 접근 가능한 운행에 존재하는 선택지다. 다른 날짜로 이동해도 유지하며, 기사는 projects만 제공한다. 담당자는 reviewer_user_id와 연결된 현재 사용자 이름을 본다. null은 미지정이며 ‘나’에 포함하지 않는다.
- `GET /api/approvals/export.xlsx`: 담당자 전용. 같은 필터와 권한으로 모든 페이지를 출력하며 입력·검토 공급가와 승인 공급가를 구분한다. 취소 행을 남기고 합계에서 제외한다.
- `/m/approvals`, `/d`는 필터와 페이지를 URL 쿼리에 유지한다. 승인·선택 승인은 기존 `/api/uses/:id/approve`의 버전·멱등·감사·권한 검사를 그대로 사용한다. 검수함과 동일한 quickApprovable 규칙으로 선택을 제한하며 여러 건 중 실패한 건은 개별 오류로 남긴다.

## PUSH 웹 푸시

- `GET /api/push`: 로그인 필수. `{enabled, publicKey}`만 반환하며 VAPID 비밀키·subject는 노출하지 않는다. 설정 누락·오류 시 false/null.
- `POST /api/push/subscriptions`: `{endpoint, keys:{p256dh,auth}, expirationTime?:number|null}`. 현재 사용자에게 구독을 저장·갱신한다. endpoint는 HTTPS 브라우저 푸시 서비스(Google/Mozilla/Apple/Windows)만 허용한다. 타인 endpoint 소유권 변경은 403, 사용자 ID 입력은 422. user_agent는 요청 헤더에서 최대 512자로 저장한다. 설정이 꺼져 있으면 저장 없이 `{enabled:false,subscribed:false}`.
- `GET /api/push/subscriptions?endpoint=...`: 본인 해당 기기의 `{subscribed}`만 반환한다. 타인 구독 정보는 노출하지 않는다.
- `DELETE /api/push/subscriptions`: `{endpoint}`. 본인 소유만 삭제하며 없으면 같은 성공 응답 `{subscribed:false}`. 등록·삭제는 원자적이며 반복 호출 결과가 동일하다. 별도 Idempotency-Key 응답 저장은 사용하지 않는다(끄기 후 다시 켜기 가능). 감사에는 구독 ID만 남기고 endpoint·구독 키는 제외한다.
- 제출·보완 API 성공 커밋 후 비동기 발송. 제출·재제출은 `reviewer_user_id` 지정 담당자, 미지정 시 현재 현장 검수 권한자 전원. 지정자가 비활성/권한 밖이면 다른 사람에게 확대 발송하지 않는다. 보완은 해당 기사 계정 중 현재 현장 접근 가능한 활성 사용자에게 보낸다. 지연 발송 시 version·상태가 달라졌으면 생략한다. 사용자에게 표시하는 금액은 저장된 PAYABLE 요청액/계산액만 사용한다.

## JOIN 기사 가입·정보·현장 관리

- `POST /api/driver-join-links` (ADMIN, 멱등): `{project_ids:uuid[1..100],expires_in_days?:1..90}`. 기본 14일이며 중복 현장은 제거한다. 활성 현장만 허용한다. 최초 응답의 `join_url`을 여러 기사에게 전달한다. 토큰은 SHA-256으로만 저장하며 멱등 응답·감사에는 원문 링크를 저장하지 않는다. 재생 응답은 URL 대신 새 링크 생성 안내를 반환한다.
- `GET /api/driver-join-links` (ADMIN): 링크 ID·version·현장 ID/이름·생성일·만료일·폐기일·`used_count`(가입 인원). 원문 링크는 다시 조회할 수 없다. `DELETE /api/driver-join-links/:id`는 `{version}`으로 폐기한다. 버전 불일치는 409이며 기존 가입 계정은 유지한다.
- `POST /api/join/:token` (인증 불필요): `{client_request_id:uuid,login_id,password,profile:{name,phone,business_name,biz_no,plate_no,vehicle_type?,tonnage}}`. 비밀번호 8자 이상·UTF-8 72바이트 이하, 전화번호 숫자 9~11자리(0 시작, 공백·하이픈 정규화), 사업자번호 10자리 또는 `000-00-00000`, 톤수는 양수·소수 3자리 이하다. 차종 기본 카고. 가입 완료 시 세션 쿠키와 사용자 정보를 반환한다.
- 가입은 관리자 기준정보 변경과 같은 advisory lock 아래 한 트랜잭션으로 사업자번호가 같은 DRIVER_BUSINESS 거래처 재사용/생성 → 차량번호 정규화 재사용/생성 → 기사 → 오늘부터 소속 → DRIVER 사용자 → 링크 현장 배정 → 가입 사용 기록·감사·세션을 저장한다. 기존 사업자의 상호가 우선한다. 사용 중지된 사업자·차량은 가입을 거부한다. 다른 활성 기사의 동일 전화/기본차량은 422로 안내한다. 같은 client_request_id·동일 요청 재전송은 기존 사용자로 성공(새 세션 발급), 변경된 요청은 422 IDEMPOTENCY_MISMATCH. 폐기·만료 링크와 비활성 계정은 재생도 불가하다. 비밀번호·원문 토큰은 가입 이력에 저장하지 않는다.
- 기존 `POST /api/invites`는 DRIVER 역할의 `driver_id` 생략을 허용한다. `/invite/:token`에서 정보를 직접 입력하고 `POST /api/invites/:token/accept`에 위 가입 본문을 전달한다. 이 초대는 기존처럼 한 사람만 수락할 수 있다. 기사 연결이 있는 기존 초대와 다른 역할 초대의 `{login_id,password}` 수락은 그대로 유지한다.
- `GET /api/drivers`, `GET /api/drivers/:userId`: 가입된 DRIVER 계정의 이름·전화·상호·사업자번호·기본차량·차종·톤수·현재 현장·가입일·계정 상태·사용자 version. ADMIN/SETTLEMENT_MANAGER는 전체 기사관리 조회, SITE_MANAGER는 현재 유효 배정 현장이 겹치는 기사와 그 교집합 현장만 읽는다. 정산 업무의 기존 현장 접근 범위는 변경하지 않는다. 다른 역할/범위는 403/404.
- `PATCH /api/drivers/:userId` (ADMIN, 멱등): `{...profile,version}`. 계정 끄기/켜기는 기존 `/api/admin/users/:id`의 status/version, 비밀번호 재설정은 기존 `/api/admin/users/:id/password-reset`을 사용한다.
- `GET /api/driver-profile` (DRIVER): 본인 정보만, 본인 전화번호 포함. `PATCH /api/driver-profile`은 동일 profile/version으로 본인만 수정하며 멱등 재생을 지원한다. 저장 응답은 `{id,version}`이고 화면은 GET으로 갱신한다. 일반 기사 응답의 타인 연락처 숨김 규칙은 그대로 유지한다.
- 정보 수정은 사용자 version 검사·관리자 공통 잠금·중복 검사를 수행하고 사용자와 기사 이름/전화를 함께 갱신한다. 사업자 변경 시 기존 소속은 어제 종료하고 오늘 새 소속을 만든다. 오늘 이미 변경한 소속은 오늘 행을 갱신하며 감사로 이력을 남긴다. 미래 예약 소속이 있으면 관리자 확인을 안내한다. 여러 기사가 공유하는 거래처의 상호 변경은 거부하며 기준정보에서 관리자에게 수정하도록 안내한다. 차량번호 변경은 차량 재사용/생성과 기본차량 변경으로 처리한다. 사용 건·제출본·정산 스냅샷은 수정하지 않는다.
- `POST /api/admin/projects`: code는 선택(null/빈 문자열/생략 가능)이며 서버가 `P-<UUID>`를 생성한다. 기존 고유 제약을 유지한다. PATCH의 빈 code는 기존 코드를 유지한다. `DELETE /api/admin/projects/:id` (ADMIN, 멱등)는 현장 잠금 후 운행·계약·배정·항목설정·개별초대·공용링크 연결을 검사한다. 연결이 있으면 422와 사용 중지 안내, 없으면 실제 삭제하고 감사를 남긴다. FK가 동시 참조 추가도 보호한다.


## FLOW 담당자·적재용량·운행 보고서

- 생성/수정 본문에 `reviewer_user_id: uuid|null`, `load_tonnage: string|null`을 받는다. 적재용량은 0보다 큰 `numeric(10,3)` 범위(정수부 7자리, 소수부 최대 3자리), 기사 UI는 소수 1자리까지 입력한다. 담당자는 활성 ADMIN 또는 현재 현장에 검수 권한이 있는 SITE_MANAGER/SETTLEMENT_MANAGER만 허용한다. 배정 기간·회수·all_projects는 기존 authz를 재사용하며 제출 때도 재검증한다.
- 입력 설정 키 `reviewer`, `load_tonnage`는 기사·대리 입력 모두 기본 REQUIRED다. DRAFT 저장은 빈 값을 허용하고 제출 시 필수 설정을 검사한다. HIDDEN/OPTIONAL 재정의와 `reviewer`, `load_tonnage` 보완 대상, 개정본·스냅샷·감사·오프라인 재전송을 지원한다. 과거 null 기록은 보존하며 재제출 시 현재 설정을 적용한다.
- `GET /api/uses/reviewers?project_id=<uuid>&driver_id=<uuid>`: 현장 접근 범위 검사, 기사는 본인 driver_id만 허용. `{reviewers:[{id,name,role}],default_reviewer_id,recent_loads}`. 담당자 연락처/계정 정보는 반환하지 않는다. 취소 제외 최근 30건에서 활성 후보인 마지막 선택과 최근 적재용량 최대 5개를 제공한다. 클라이언트는 사용자·현장·기사별로 오프라인 캐시를 분리한다.
- 사용대장 조회·내보내기: `reviewer_user_id`, `reviewer_name`(부분 일치), `load_tonnage`(정확한 숫자 일치), `reviewer_scope=mine|all|auto` 추가. mine은 본인 담당+미지정, auto는 해당 범위가 없으면 전체다. 기본 대장은 all, 검수함은 auto다. 응답 행에 담당자 이름·ID·적재용량, 응답에 적용된 reviewer_scope를 포함한다. 지정 담당자가 달라도 기존 현장 검수 권한이 있으면 승인 가능하다.
- 대시보드 `review_pending` 및 이를 사용하는 메뉴 배지는 접근 가능한 SUBMITTED/취소 제외 중 본인 담당+미지정만 센다.
- 현장·기사 집계의 각 group에 `reviewers`(당시 담당자 이름 목록), `loads`(적재용량 목록)를 추가한다. 여러 운행의 적재용량을 합산하거나 차량 제원 톤수로 대체하지 않는다.
- 엑셀 가져오기 `reviewer`, `load_tonnage`는 선택 열이다. 담당자 이름 또는 UUID를 현재 현장 검수 가능 후보와 정확히 매칭하며 동명이인은 UUID가 필요하다. 값이 있는 새 열만 원본 중복 식별자에 포함하여 기존 파일 해시를 유지한다. 사용대장 Excel 뒤에 담당자·적재용량 열을 추가한다.
- `GET /api/uses/:id/report.pdf`: 기존 사용 상세와 동일한 본인·현장 권한, no-store PDF. 프로젝트·작성일·담당자·차량/기사/차종/적재용량·운행일·회차별 경로/운반내용·지급 공급가·현재 승인자/승인시각을 출력한다. 고객 청구 금액은 출력하지 않는다. 기본 A4 한 장이며 많은 회차·긴 내용은 누락 없이 다음 장으로 이어진다. 승인 금액은 승인된 지급 비용만 합산하며 승인 전은 검수 전 금액으로 구분한다.
