# 운영·백업·복구

## 책임과 주기

| 작업 | 담당 역할 | 주기 / 기준 |
| --- | --- | --- |
| DB·증빙 백업 실행·로그 확인 | 시스템 운영 담당자 | 매일 업무 종료 후, 배포·마이그레이션 직전 |
| 확정명세 합계·지급 이력 확인 | 정산 책임자 | 매월 마감, 복구 후 서비스 재개 전 |
| 백업 별도 매체 복사·보관 | 시스템 운영 담당자 | 매 실행 후, 서비스 디스크와 다른 암호화 저장소 |
| 복구 리허설·결과 보관 | 운영 담당자 + 정산 책임자 | 매월 1회, 백업 형식/스키마 변경 시 추가 |
| 실패 대응·재실행 판단 | 운영 책임자 | 비정상 종료 코드 즉시 확인 |

역할별 실명 담당자, 개인정보 보존기간, RPO/RTO는 운영 개시 전에 확정한다. 초기 제안은 일일본 30일·월 마감본 12개월, RPO 24시간이며 법정 보존기간을 확정한 값이 아니다. 이 저장소는 스케줄러를 설치하지 않는다. 운영 담당자가 유지보수 시간과 작업 스케줄을 등록한다.

## 백업

1. 앱 서버와 외부 쓰기 작업을 중지한다. 진행 중인 사진 업로드가 끝났는지 확인한다. DB는 실행 상태로 둔다. DB snapshot과 파일 복사를 함께 일관되게 보관하려면 이 절차가 필요하다.
2. 배포와 동일한 코드 디렉터리에서 `DATABASE_URL`, `STORAGE_DIR`를 확인한다. main 로컬 기본 PG는 54329, 앱은 .env의 PORT(기본 3000)다. 배포 전 `npm run db:migrate`로 W6 적용 이력 보정과 마이그레이션을 완료한다.
3. `npm run backup` 또는 `npm run backup -- /보관경로/새디렉터리`를 실행한다. 백업 경로는 storage 밖의 **새 경로**여야 한다.
4. 종료 코드 0, 출력된 `backup`, `files`, `evidence_files`, `confirmed_statements`를 로그에 보관한다. `manifest.json`과 모든 파일을 함께 별도 매체에 복사한다. 복사가 끝난 후 앱을 재개한다.

`PG_BIN` 명시 경로 → 현재 플랫폼의 `node_modules/@embedded-postgres/<플랫폼>-<아키텍처>/native/bin` → PATH 순서로 `pg_dump`와 `pg_restore`를 찾는다. 둘 다 있으면 custom archive(`database.dump`, `--no-owner --no-acl`)와 PG snapshot을 사용한다. 서버와 호환되는 버전의 클라이언트 도구를 설치한다. 바이너리 실행 실패는 조용히 대체하지 않고 실패 처리한다. DB 접속 비밀번호는 명령 인자에 넣지 않는다.

W5의 embedded-postgres 18 패키지에는 두 도구가 없어 **app-logical-v1** 대안을 실제 검증했다. 이 형식은 적용된 마이그레이션 SQL·해시, public/drizzle의 모든 테이블·모든 행의 문자열 원문, 시퀀스 값을 `database.json`에 보관한다. 수량·날짜·금액·JSON을 JS 부동소수점 값으로 재해석하지 않는다. DB의 적용 이력과 로컬 마이그레이션이 다르면 실패한다. 사용자 정의 DDL·확장·외부 스키마·대용량 운영 DB는 native pg_dump 방식으로 운영해야 한다. 앱 마이그레이션 밖에서 스키마를 바꾸지 않는다.

`storage/`에는 증빙과 교체·삭제 이력용 원본 및 `imports/`의 XLSX 원본도 포함한다. 원본은 시트 재선택·검증에 사용하므로 DB와 함께 보존한다. manifest에는 UTC 생성시각, 형식, 파일 수(manifest 자체 제외), 상대경로별 크기·SHA-256을 기록한다. 백업 디렉터리는 0700으로 생성하며 심볼릭 링크는 거절한다. 백업 전후 파일 해시와 확정명세 합계를 검증한다.

실패 시 비정상 종료 코드 1과 stderr의 `백업 실패`를 수집한다. 중간 디렉터리 `<경로>.partial` 및 가능한 경우 `FAILED.txt`를 남기며 완료 경로로 승격하지 않는다. 부족한 디스크·접속 장애·누락 파일·해시/합계 오류를 해결한 뒤 **새 경로**로 재실행한다. `.partial`을 성공 백업으로 취급하지 않는다.

## 복구

복구는 신뢰하는 자체 백업만 사용한다. 논리 백업은 저장된 SQL 마이그레이션을 실행한다. 앱과 외부 쓰기를 중지하고 원 DB·storage의 별도 백업을 보존한 상태에서 진행한다.

```sh
# 빈 DB 또는 초기화된 앱 스키마, 빈 storage를 대상으로 환경을 지정
DATABASE_URL=postgresql://사용자:비밀번호@호스트:포트/복구전용DB \
STORAGE_DIR=/복구전용/storage npm run restore -- /백업/디렉터리

DATABASE_URL=postgresql://사용자:비밀번호@호스트:포트/복구전용DB \
STORAGE_DIR=/복구전용/storage npm run restore:verify
```

- manifest 경로·파일 수·모든 해시를 먼저 검증한다. 심볼릭 링크·경로 이탈·누락·손상을 거절한다.
- 대상 DB에 업무 데이터가 있거나 대상 storage에 파일이 있으면 **거부**한다. 기존 데이터를 자동 삭제하지 않는다. 대상 DB/폴더를 백업 원본과 분리한다.
- app-logical-v1은 트랜잭션에서 스키마를 재구성하고 원문 데이터를 복원한다. 순환 FK는 잠시 제거하고 모든 데이터를 복원한 다음 FK를 재생성·검증한다. superuser 전용 replication 옵션을 사용하지 않는다. 시퀀스 last_value/is_called도 복구한다.
- native archive는 pg_restore의 `--single-transaction --exit-on-error`로 복구한다. 네이티브 복구가 시작된 뒤 DB/파일 검증 또는 파일 이동이 실패하면 public/drizzle 스키마를 비워 빈 DB로 보상 복구한다. 논리 백업은 COMMIT 전 실패를 롤백하고, COMMIT 후 최종 검증 실패도 빈 DB로 되돌린다. 승격된 storage와 staging은 제거한다. 빈 DB/빈 storage 검사에서 거절된 대상은 변경하지 않는다. 보상 초기화 자체가 실패하면 별도 오류를 반환하므로 앱을 재개하지 말고 운영자가 빈 대상 여부를 점검한다. DB와 파일에 걸친 OS 트랜잭션은 없으므로 복구 동안 서비스 중지를 유지한다.
- 파일은 임시 경로에 복사하여 검증한 후 빈 storage로 이동한다. 검증은 UPLOADED 증빙의 사용 건 연결·파일 크기·SHA-256, 확정명세 INCLUDED 항목의 공급가/세액/총액·스냅샷 금액·잠금을 확인한다.
- 과거 W6 백업은 `npm run db:migrate`를 실행하여 적용 이력을 보정한다. Drizzle은 마지막 created_at보다 큰 journal when만 실행하므로, journal만 고치면 다음 마이그레이션이 건너뛰어질 수 있다. W6 SQL의 정확한 SHA-256과 기존 when=1790660000000이 일치하는 기록만 1790655000000으로 갱신한다. SQL 재실행이나 업무 데이터 변경은 없다.
- 복구 성공 후 정산 책임자가 실제 명세 1건과 사진 1건을 열고 확인한다. 동일 코드에서 로그인·사용대장·출력을 확인한 뒤 앱을 재개한다. 자동 시드는 실행하지 않는다.

## 복구 리허설

권장 방법은 개발·운영 자료와 분리된 PostgreSQL 테스트 DB다.

```sh
npm test -- tests/integration/W5-backup.test.ts tests/integration/W7-operations.test.ts
```

이 테스트는 실제 PG에 증빙 1개·확정명세 1개(300,000원)를 만들고, 백업한 뒤 public/drizzle 스키마와 증빙 폴더를 삭제한다. 백업만으로 복원하고 SHA-256·합계·시퀀스·FK를 검증하며, 손상 파일과 잘못된 확정 합계의 실패도 확인한다. W7은 네이티브 실행 경계만 대역으로 바꾸고 실제 PG에서 복원 완료 후 파일 검증 실패의 빈 DB 원복, 기존 W6 시각 보정 후 후속 마이그레이션 적용도 검증한다. 실제 pg_restore 바이너리 성공 리허설은 설치 환경에서 별도로 수행한다. 자동 생성 DB와 임시 폴더만 사용하고 종료 시 정리한다. 성공 로그는 [VERIFICATION](VERIFICATION.md)에 첨부했다.

수동으로 `vehicle_app`을 초기화하는 리허설은 반드시 **전용 worktree/전용 DB/전용 storage**에서 진행한다.

```sh
# 전용 환경에서 앱을 중지한 뒤
npm run backup -- .data/backups/rehearsal
npm run db:reset
mv storage .data/storage-before-rehearsal
npm run restore -- .data/backups/rehearsal
npm run restore:verify
```

기존 폴더 이름이 있으면 다른 이름을 사용한다. `.data/pg`를 실행 중에 복사하는 방식은 이 백업 절차가 아니다. 백업 검증은 매니페스트 무결성 검사이며 암호화나 전자서명은 제공하지 않는다.

## F9 요청 크기·시간 제한과 보안 헤더

앱은 Content-Length 유무·정확성과 무관하게 스트림의 실제 바이트를 센다. JSON은 2MiB, 증빙 PUT은 20MiB를 초과하는 즉시 읽기를 취소하고 `413 PAYLOAD_TOO_LARGE`를 반환한다. 가져오기 multipart는 11MiB(파일 자체 10MiB), XLSX 전체 엔트리의 실제 해제 누적량은 32MiB다. ZIP 중앙/로컬 헤더, CRC, data descriptor를 검증하고 검증된 비압축 ZIP만 ExcelJS에 전달한다. 배정이 없는 현장 담당자·현장 제한 정산 담당자는 업로드 본문을 읽기 전에 403으로 거부한다.

앞단 프록시도 제한한다. Nginx 기준 일반 API `client_max_body_size 2m`, `/api/evidence/<uuid>/content`만 `20m`, `/api/import/upload`만 `11m`으로 설정한다. 각 location의 기존 upstream 설정을 유지한다. 권장 초기값은 `client_body_timeout 15s`, `proxy_connect_timeout 5s`, `proxy_send_timeout 60s`, `proxy_read_timeout 60s`다. 느린 전송의 무한 지속을 막기 위해 LB/인그레스에도 **전체 요청 시간** 제한(일반 60초, 증빙 업로드 90초)을 설정한다. Nginx의 body/read timeout은 바이트 사이 유휴 시간 제한이므로 전체 시간 제한을 대신하지 않는다. 프록시가 먼저 거부하면 앱 JSON 대신 프록시 413/408이 올 수 있다.

모든 앱·API·정적 파일 응답에 아래 헤더를 적용한다.

- `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`: 외부·동일 출처 iframe 삽입 차단.
- `X-Content-Type-Options: nosniff`: 선언된 MIME 형식을 사용한다.
- `Referrer-Policy: strict-origin-when-cross-origin`: 다른 출처에는 출처만 전달한다.
- `Permissions-Policy: camera=(self), microphone=(), geolocation=()`: 같은 출처 기사 촬영은 허용하며 현재 사용하지 않는 마이크·위치는 차단한다.

CSP는 frame-ancestors만 제한하므로 현재 Next 스크립트·PWA 서비스 워커·파일 입력·PDF 다운로드를 유지한다. PDF는 독립 다운로드/탭으로 제공하며 iframe 삽입은 허용하지 않는다. 배포 후 프록시가 이 헤더들을 덮어쓰지 않는지 확인한다.

## F9 로그인 실패 제한·관리자 잠금 해제

배포 전 `npm run db:migrate`로 `0400_f9_login_throttle.sql`을 적용한다. DB `login_throttles` 행 잠금으로 다중 인스턴스의 실패 횟수를 공유한다. 계정별 10분 내 5회, IP별 10분 내 20회 실패하면 각각 15분 잠근다. 잠금 중에는 올바른 비밀번호도 429이며 `Retry-After: 900`과 한국어 안내를 반환한다. 잠금 중 추가 요청으로 만료 시각을 연장하지 않는다. 잠금이 끝난 뒤 성공하면 해당 계정·현재 IP 카운터를 모두 초기화한다. 실패는 사용자 존재 여부와 무관하게 같은 응답 정책과 bcrypt 비교를 거치며 별도 `LOGIN_FAILED` 감사로그에 기록한다. 비밀번호·원문 로그인 ID·원문 IP는 이 감사로그에 저장하지 않고 SHA-256 키와 결과만 보관한다.

운영에는 `TRUSTED_CLIENT_IP_HEADER=x-real-ip`처럼 **프록시가 실제 연결 IP로 덮어쓰는 단일 IP 헤더**를 지정하고, 앱 직접 외부 접근을 차단한다. 예를 들어 단일 Nginx 프록시는 `proxy_set_header X-Real-IP $remote_addr;`를 사용한다. 여러 프록시 뒤에서는 신뢰하는 프록시 CIDR만 real_ip 설정에 등록한다. 사용자 제공 `X-Forwarded-For`의 첫 항목을 그대로 신뢰하지 않는다. 설정이 없거나 헤더가 없거나 올바른 단일 주소가 아니면 `unavailable` 공용 IP 버킷으로 제한한다. 개발에는 안전한 기본값이나, 운영에서 미설정하면 서로 다른 사용자가 공용 잠금에 걸릴 수 있다. IPv6는 표준 표기로 정규화한다.

신원을 확인한 시스템 관리자는 배포 서버에서 DB 관리 자격으로 다음 명령을 실행한다. 브라우저 공개 잠금 해제 API는 없다. 실제 계정과 해당 IP가 모두 잠겼다면 각각 해제한다. 명령은 지정한 카운터만 초기화하고 `LOGIN_UNLOCKED` 감사로그를 남긴다.

```sh
npx tsx scripts/unlock-login.ts --account '사용자아이디'
npx tsx scripts/unlock-login.ts --ip '192.0.2.10'
# 프록시 미설정으로 공용 버킷이 잠긴 경우 설정을 바로잡은 뒤 실행
npx tsx scripts/unlock-login.ts --ip unavailable
```

카운터의 오래된 해시 행은 운영 보존정책에 따라 별도 유지보수 시간에 정리할 수 있다. 예: `DELETE FROM login_throttles WHERE updated_at < now() - interval '30 days' AND (locked_until IS NULL OR locked_until < now());`. 감사로그 보존은 별도 기존 정책을 따른다. 이 작업을 자동 예약하지는 않는다.

신규 비밀번호는 기존 최소 8자를 유지하며 UTF-8 72바이트를 초과할 수 없다(한글 24자=72바이트). 로그인·가입·서버 해시/검증 경계가 동일하게 `비밀번호가 너무 깁니다`로 거부한다. bcrypt 해시는 유지한다. 과거 72바이트 초과로 생성된 비밀번호는 원문 길이를 해시에서 복구할 수 없으므로, 해당 사용자는 관리자에게 계정 복구를 요청해 제한 안의 비밀번호를 설정해야 한다. 기존 bcrypt 절단으로 만들어진 해시를 안전한 새 비밀번호로 자동 추정하지 않는다.
