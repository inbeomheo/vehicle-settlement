# W1 API·서비스 계약

모든 경로는 `src/app/api/**/route.ts`. JSON 성공 `{ data }`, 실패 `{ error: { code, message, details? } }`와 `x-request-id` 헤더를 반환한다. 파일 다운로드는 바이너리다. 모든 응답은 `Cache-Control: no-store`이다. UUID 경로와 입력은 서버에서 검증한다. 권한 없는 단건은 404, 인증 실패는 401이다.

## 공통

- 쿠키 `sid`: HttpOnly, SameSite=Lax, 30일. 운영에서는 Secure.
- JSON 변경 요청: `Content-Type: application/json`. 재전송 시 동일 `Idempotency-Key`를 사용한다. 사용자별 키를 트랜잭션 advisory lock으로 직렬화하고 성공 응답을 저장한다. 같은 키에 경로·메서드·원문 body가 다르면 `422 IDEMPOTENCY_MISMATCH`.
- 실패 응답은 저장하지 않는다. 수정한 요청은 새 키를 사용한다. 재생 때도 현재 사용자 상태·접근 권한을 재검사한다.
- 생성에는 별도로 `client_request_id`를 권장한다. 같은 식별자는 동일 사용 건으로 수렴한다.
- `version`: **vehicle_uses.version**. PATCH와 submit/approve/request-fix/confirm-by-driver/cancel, 라인 검수 모두 최신 사용 건 버전이 필요하다. 충돌은 `409 VERSION_CONFLICT`, `details.current_version`에 현재 버전을 제공한다.
- 증빙 변경도 부모 사용 건 version을 증가시킨다. 업로드 완료 뒤 사용 상세를 다시 조회한다. 실패 상태만 변경하거나 동일 파일을 재전송한 경우에는 내용 버전을 증가시키지 않는다.
- 수량은 `"1"`, `"2.500"` 같은 음이 아닌 decimal 문자열. 원 단위 정수 금액만 허용한다. 서버 금액·단가·승인액 필드를 일반 저장 요청에 넣으면 422다.

## 인증·초대

- `POST /api/auth/login`: `{ login_id, password }` → 사용자 + Set-Cookie.
- `POST /api/auth/logout`: `{}` → `{ logged_out: true }`, 쿠키 제거·DB 세션 폐기.
- `GET /api/me`: 현재 사용자. password_hash는 반환하지 않는다.
- `GET /api/invites`: 관리자만, 토큰 해시를 제외한 초대 목록.
- `POST /api/invites`: `{ role, name, phone?, driver_id?, project_ids?: UUID[] }` → 초대 + `invite_url`. 기사 역할에는 driver_id 필수.
- `POST /api/invites/:token/accept`: `{ login_id, password }` → 새 사용자 + 세션 쿠키. 비밀번호 8~72자, 토큰 1회용/7일. URL의 동적 디렉터리 이름은 Next 라우트 충돌을 피하려고 `[id]`로 통일했지만 외부 URL 의미는 token이다.
- `DELETE /api/invites/:id`: 초대 회수.

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
- BASE 고정형 단위는 수량 기본 1. PER_TRIP 등의 수량 미입력은 null/PENDING이며 운행 수로 저장하지 않는다. 기본운임 포함 항목은 computed/approved 0원으로 처리한다.
- 금액 근거는 계약 snapshot에 저장한다. 수량 변경에는 당시 단가를 사용한다. 사용일·차량·현장·거래처/단위를 변경하면 해당 근거를 새로 조회한다. 기사 변경에 따른 숨겨진 고객청구 재계산은 서버 소유 값으로 처리한다.
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
5. MIME: image/jpeg, image/png, image/webp, image/heic, image/heif, application/pdf. 최대 20MB. SVG/HTML은 허용하지 않는다. 메타와 실제 크기·형식이 일치해야 한다.
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

## 가져오기 (W5·W7)

담당자 역할만 사용한다. 작업·프리셋은 작성자에게만 보이며, 등록된 사용 건의 현장 권한은 다시 검사한다. 응답은 기존 `{ data }`/`{ error }` 형식이다.

| 요청 | 입력 / 결과 |
| --- | --- |
| `POST /api/import/upload` | multipart `file`: xlsx 또는 UTF-8 csv. 10MB/20시트/선택 시트 2,000행/100열, 셀 500자·작업 JSON 5MB. XLSX는 시트별 첫 20행 rows·추천 header_row·mapping 반환; preview에서 선택 시트 전체를 제한 내 스트리밍 |
| `GET /api/import` | 본인의 최근 100개 작업(파일명·작성자명·일시·상태·summary) |
| `GET /api/import/:id` | 원본 셀·선택 매핑·미리보기·집계 |
| `POST /api/import/:id/preview` | `{ sheet: 0기반 인덱스, header_row: 1기반 행번호, mapping: { field: 0기반 열번호 }, excluded_rows?: [1기반 원본 행번호] }` |
| `POST /api/import/:id/commit` | `{}`. 저장한 매핑을 서버에서 재검증하여 유효 행만 DRAFT/PROXY 생성. 완료 작업 재요청은 기존 결과 반환 |
| `GET /api/import/:id/errors.xlsx` | 원본 행번호·각 원본 셀·오류 사유가 있는 Excel |
| `GET /api/import/presets` | 본인 매핑 목록 |
| `POST /api/import/presets` | `{ name, mapping }`. 같은 작성자·이름이면 갱신, 감사로그 기록 |

필드 키: `use_date`, `project`, `driver`, `vehicle`, `payee`, `origin`, `destination`, `cargo_desc`, `trips`, `billing_unit`, `quantity`, `unit_price`, `extra`, `reason`, `notes`.
미지정 열은 mapping에서 생략한다. 동일 열 중복 매핑은 거부한다. 상세 규칙은 [ASSUMPTIONS](ASSUMPTIONS.md).

행 결과는 `VALID | ERROR | SKIPPED`, `errors`, `warnings`, `source_row_hash`, 등록 후 `use_id`다. summary의 `valid/errors/skipped`는 현재 작업 행 분류, `success`는 이 작업에서 생성된 건수다. 같은 완료 작업 재요청의 success는 최초 성공 건수이며, **새 업로드 작업**으로 정규화된 내용이 동일한 파일을 재저장하여 가져와도 success=0이다.

commit은 generic 응답 캐시를 사용하지 않는다. job 행 잠금 + 가져오기 공통 advisory lock + source_row_hash unique로 멱등성을 제공하며 매 요청에서 현재 권한을 검사한다. 프리셋 저장은 공용 Idempotency-Key 래퍼를 쓴다. upload/preview는 새 파일 및 재검증 요청으로 취급한다. 예상하지 못한 commit 실패는 전체 rollback하여 PREVIEW에서 재시도할 수 있다.

W7: 캐시 결과가 없는 수식/오류 셀은 매핑된 열에서만 해당 행 오류다. 동일 내용의 파일 내 발생 순번을 해시에 포함하여 실제 반복행을 보존하며, `excluded_rows`는 확정 때도 적용한다. UTF-8이 아닌 CSV는 422와 UTF-8 저장 안내를 반환한다. 기존 W5 작업의 바이트 기반 해시는 유지하고 유사 경로 경고로 확인한다.


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
