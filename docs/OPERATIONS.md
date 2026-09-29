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
2. 배포와 동일한 코드 디렉터리에서 `DATABASE_URL`, `STORAGE_DIR`를 확인한다. W5 로컬은 PG 54334이며 다른 worktree 포트에 연결하지 않는다.
3. `npm run backup` 또는 `npm run backup -- /보관경로/새디렉터리`를 실행한다. 백업 경로는 storage 밖의 **새 경로**여야 한다.
4. 종료 코드 0, 출력된 `backup`, `files`, `evidence_files`, `confirmed_statements`를 로그에 보관한다. `manifest.json`과 모든 파일을 함께 별도 매체에 복사한다. 복사가 끝난 후 앱을 재개한다.

`PG_BIN` 명시 경로 → 현재 플랫폼의 `node_modules/@embedded-postgres/<플랫폼>-<아키텍처>/native/bin` → PATH 순서로 `pg_dump`와 `pg_restore`를 찾는다. 둘 다 있으면 custom archive(`database.dump`, `--no-owner --no-acl`)와 PG snapshot을 사용한다. 서버와 호환되는 버전의 클라이언트 도구를 설치한다. 바이너리 실행 실패는 조용히 대체하지 않고 실패 처리한다. DB 접속 비밀번호는 명령 인자에 넣지 않는다.

W5의 embedded-postgres 18 패키지에는 두 도구가 없어 **app-logical-v1** 대안을 실제 검증했다. 이 형식은 적용된 마이그레이션 SQL·해시, public/drizzle의 모든 테이블·모든 행의 문자열 원문, 시퀀스 값을 `database.json`에 보관한다. 수량·날짜·금액·JSON을 JS 부동소수점 값으로 재해석하지 않는다. DB의 적용 이력과 로컬 마이그레이션이 다르면 실패한다. 사용자 정의 DDL·확장·외부 스키마·대용량 운영 DB는 native pg_dump 방식으로 운영해야 한다. 앱 마이그레이션 밖에서 스키마를 바꾸지 않는다.

`storage/`에는 증빙과 교체·삭제 이력용 원본도 포함한다. manifest에는 UTC 생성시각, 형식, 파일 수(manifest 자체 제외), 상대경로별 크기·SHA-256을 기록한다. 백업 디렉터리는 0700으로 생성하며 심볼릭 링크는 거절한다. 백업 전후 파일 해시와 확정명세 합계를 검증한다.

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
- native archive는 pg_restore의 `--single-transaction --exit-on-error`로 복구한다. 복구 직후 파일 검증에 실패하면 앱을 재개하지 말고 빈 대상으로 다시 복구한다. native 복구 커밋과 파일 이동은 하나의 DB 트랜잭션이 아니므로 서비스 중지 상태를 유지해야 한다.
- 파일은 임시 경로에 복사하여 검증한 후 빈 storage로 이동한다. 검증은 UPLOADED 증빙의 사용 건 연결·파일 크기·SHA-256, 확정명세 INCLUDED 항목의 공급가/세액/총액·스냅샷 금액·잠금을 확인한다.
- 복구 성공 후 정산 책임자가 실제 명세 1건과 사진 1건을 열고 확인한다. 동일 코드에서 로그인·사용대장·출력을 확인한 뒤 앱을 재개한다. 자동 시드는 실행하지 않는다.

## 복구 리허설

권장 방법은 개발·운영 자료와 분리된 PostgreSQL 테스트 DB다.

```sh
npm test -- tests/integration/W5-backup.test.ts
```

이 테스트는 실제 PG에 증빙 1개·확정명세 1개(300,000원)를 만들고, 백업한 뒤 public/drizzle 스키마와 증빙 폴더를 삭제한다. 백업만으로 복원하고 SHA-256·합계·시퀀스·FK를 검증하며, 손상 파일과 잘못된 확정 합계의 실패도 확인한다. 자동 생성 DB와 임시 폴더만 사용하고 종료 시 정리한다. 성공 로그는 [VERIFICATION](VERIFICATION.md)에 첨부했다.

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
