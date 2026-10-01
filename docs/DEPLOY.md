# 테스트용 Vercel + Supabase 배포

Next.js 앱만 Vercel에 올리고, 기존 서울 Supabase PostgreSQL의 **vehicle 스키마**에 연결한다. Supabase Auth·Storage·service_role 키는 사용하지 않는다. 인증과 접근 권한은 기존 서버 서비스가 판단한다. public의 다른 앱 테이블은 조회·변경·백업·복구 대상이 아니다.

## 환경변수

Vercel 프로젝트의 Preview/Production 중 실제 배포할 환경에 설정한다. `NEXT_PUBLIC_` 접두사를 붙이지 않는다. Node.js 24, 빌드 명령 `npm run build`, 설치 `npm ci`, 리전 `icn1`을 사용한다.

| 이름 | 배포 값 | 미설정 시 동작 |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://vehicle_app.<project-ref>:<인코딩한 비밀번호>@<대시보드 풀러 호스트>:5432/postgres?sslmode=require` | 로컬 PG |
| `DB_SCHEMA` | `vehicle` | 앱 public, 마이그레이션 이력 drizzle |
| `STORAGE_DRIVER` | `db` | local |
| `APP_URL` | 실제 접속하는 `https://...` 고정 도메인 | 기존 앱 설정 |
| `MAX_UPLOAD_BYTES` | `4194304` (4MiB) | Vercel 4MiB, 로컬 증빙 20MiB·가져오기 파일 10MiB |
| `PG_POOL_MAX` | `3` | Vercel 3, 로컬 10 |
| `PG_SSL_NO_VERIFY` | 기본 미설정, 인증서 체인 검증 실패 때만 `1` | URL의 sslmode·인증서 설정 사용 |

`PG_SSL_NO_VERIFY=1`은 TLS 암호화는 유지하지만 서버 인증서 검증을 생략한다. 올바른 CA 검증을 우선한다. 런타임과 마이그레이션·시드·백업 CLI에 같은 환경을 전달한다. 환경변수 변경 후 재배포한다. `STORAGE_DIR`는 db 드라이버의 앱 실행에는 필요 없고, 백업/복구 CLI의 임시 작업 디렉터리로만 쓰인다.

[Supabase 연결 문서](https://supabase.com/docs/guides/database/connecting-to-postgres)의 **Session pooler 5432**를 기본으로 사용한다. 호스트는 서울 리전 문자열로 추측하지 말고 Dashboard → Connect에서 복사한다. 전용 롤 사용자명은 `vehicle_app.<project-ref>`다. 연결마다 startup `options`로 search_path를 지정한다. 롤 기본 search_path도 아래처럼 설정한다.

트랜잭션 풀러 6543은 세션 상태와 준비된 쿼리에 제약이 있으므로 이 앱의 기본 배포 경로로 사용하지 않는다. 이를 선택하려면 롤 기본 search_path·풀러 옵션 지원·마이그레이션의 임시 테이블·트랜잭션을 실제 프로젝트에서 별도 검증하고, 관리 작업은 세션 풀러/직접 연결로 수행한다. 앱은 이름 있는 prepared statement를 사용하지 않는다. 이 저장소의 자동 검증은 실제 PostgreSQL이며 Supavisor 자체 검증은 아니다.

## 코디네이터가 한 번 준비할 롤·스키마

아래는 기존 DB 관리자가 실행할 예시다. 새 롤/스키마를 만드는 작업이며 **public의 ACL·테이블·함수는 변경하지 않는다**. 비밀번호는 안전하게 생성해 대체하고 SQL 기록이나 저장소에 남기지 않는다. 이미 존재하는 롤/스키마는 소유권·용도를 먼저 확인한다.

```sql
BEGIN;
CREATE ROLE vehicle_app LOGIN PASSWORD '<새 비밀번호>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT CONNECT ON DATABASE postgres TO vehicle_app;

-- PUBLIC에서 상속되는 권한은 NOINHERIT나 롤별 REVOKE로 차단되지 않는다.
-- 기존 앱의 ACL을 바꾸지 않고 사전 조건을 검증한다.
DO $$
BEGIN
  IF has_schema_privilege('vehicle_app', 'public', 'USAGE')
     OR has_schema_privilege('vehicle_app', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'public 접근 권한이 상속됩니다. 공유 DB 권한을 검토한 후 다시 준비하세요.';
  END IF;
END $$;

CREATE SCHEMA vehicle AUTHORIZATION vehicle_app;
REVOKE ALL ON SCHEMA vehicle FROM PUBLIC, anon, authenticated;
ALTER ROLE vehicle_app SET search_path TO vehicle;
-- F10 마이그레이션이 ON COMMIT DROP 임시 테이블을 사용한다.
GRANT TEMPORARY ON DATABASE postgres TO vehicle_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vehicle_app IN SCHEMA vehicle
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
```

사전 조건이 실패하면 트랜잭션을 ROLLBACK한다. 공유 DB에서 `REVOKE ... FROM PUBLIC`을 실행해 해결하지 않는다. PostgreSQL에는 PUBLIC 권한을 특정 롤에만 거부하는 기능이 없다. 코디네이터가 기존 권한 구조를 검토하거나 별도 DB/프로젝트를 선택해야 한다. `vehicle`은 Supabase Data API의 exposed schemas에 추가하지 않는다. anon/authenticated에 권한을 주지 않으며, 앱 롤은 스키마 내부 객체만 소유한다. 앱 자체 로그인·권한 검사를 계속 사용하므로 Supabase JWT 정책으로 대체하지 않는다.

앱 접속 정보로 다음을 확인한다.

```sql
SELECT current_user, current_schema(), gen_random_uuid();
SELECT has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
       has_schema_privilege(current_user, 'public', 'CREATE') AS public_create;
```

current_schema는 vehicle, 두 권한은 false여야 한다. `gen_random_uuid()`는 PostgreSQL 16+ 내장 함수여서 public/pgcrypto 확장을 search_path에 추가할 필요가 없다. 앱 마이그레이터는 스키마 존재를 확인하고 없으면 중단한다. `vehicle.__drizzle_migrations`를 사용하며 public/drizzle을 생성하지 않는다.

## 마이그레이션·시드·배포 순서

운영자의 로컬 셸 또는 비밀 환경변수가 설정된 CI에서 실행한다. 아래 명령 실행 전에 전용 DATABASE_URL과 위 환경을 지정한다. 원격 DB에서는 `db:start`, `db:reset`, 자동 E2E를 실행하지 않는다.

```sh
npm ci
npm run db:deploy
npm run seed
npm run seed:demo
npm run restore:verify
npm run build
```

`db:deploy`는 기존 `db:migrate`와 같다. 시드는 README의 관리자·기사·담당자 계정과 기준정보를 넣는다. `seed:demo`는 2026년 9월 사용·검수·정산·지급·작은 시연 증빙을 넣으며 db 드라이버를 따른다. 둘 다 재실행할 수 있다. 공개된 데모 비밀번호가 생성되므로 테스트 배포에 Vercel Deployment Protection을 적용하거나 사용자 관리에서 비밀번호를 교체한 뒤 제공한다. 실제 고객 자료를 넣지 않는다.

Vercel에 저장소/브랜치와 환경변수를 연결하고 배포한다. 빌드에 DB 마이그레이션을 자동 실행하지 않는다. `prebuild`가 `pwa:build`를 실행하며 생성된 오프라인 JS/CSS/버전 파일은 gitignore 대상이다. PDF의 `assets/fonts`는 `outputFileTracingIncludes`로 서버 함수에 포함하고 process.cwd() 기준 기존 경로로 읽는다. 배포 후 로그인 → 증빙 업로드/다운로드 → 엑셀 재미리보기 → 명세 PDF 한글 출력을 확인한다. HTTPS와 기존 Secure 쿠키·APP_URL 검사는 유지한다.

## 백업·복구

앱 쓰기를 중지하고 운영자 PC/CI에서 수행한다. Vercel 함수 안에서 실행하지 않는다. 같은 환경변수와 동일 버전 코드가 필요하다.

```sh
npm run backup -- /안전한/새백업경로
# 동일 이름 vehicle 스키마를 미리 만든 빈 복구 대상 DB에 연결
npm run restore -- /안전한/새백업경로
npm run restore:verify
npm run db:deploy
```

DB_SCHEMA를 지정하면 항상 앱 논리 백업을 사용한다. 지정 스키마의 테이블·시퀀스·마이그레이션만 보관하며 bytea 증빙과 XLSX 원본도 포함한다. db 드라이버 백업에는 로컬 storage 파일을 복사하지 않는다. 모든 blob의 SHA-256·크기, 증빙 연결과 확정 합계를 검증한다. manifest에 스키마/드라이버를 기록하고 다른 설정으로 복구하면 변경 전에 거부한다. 자동 드라이버 전환·스키마 이름 변경은 지원하지 않는다.

복구 대상에 업무 행이 있으면 거부한다. 전용 스키마 안의 객체만 재구성하고 스키마 자체와 ACL은 유지하므로 CREATE DATABASE 권한이 필요 없다. 쓰기를 중지한 빈 전용 대상에서만 사용한다. 공용 public/drizzle 초기화 경로는 DB_SCHEMA 미설정의 기존 로컬 모드에만 남아 있다. 임의 DDL이 있는 스키마는 논리 백업 대상이 아니다.

기존 로컬 DB는 DB_SCHEMA를 설정하지 않는다. public과 drizzle의 기존 위치를 유지한다. 초기 SQL 두 파일의 public 한정자 제거에 따른 **알려진 이전 SHA-256 두 개만** 적용 시각까지 확인해 새 해시로 보정한다. 업무 SQL을 재실행하지 않으며, W6 시각 보정도 유지한다. 구버전 백업 복구 후 `db:migrate`를 실행한다.

## 테스트 배포 한계

- [Vercel 함수 요청/응답 제한](https://vercel.com/docs/functions/limitations)에 맞춰 전체 업로드 본문을 4MiB로 제한한다. multipart 경계 때문에 XLSX 파일은 4MiB보다 약간 작아야 한다. JSON은 기존 2MiB와 MAX_UPLOAD_BYTES 중 작은 값이다. 프록시가 먼저 거부할 크기의 요청은 플랫폼 메시지가 반환될 수 있다.
- 증빙 삭제는 기존처럼 논리 삭제여서 원본을 남긴다. DB bytea는 작은 테스트 자료용이며 대량 이미지·대형 PDF/엑셀은 DB 용량, 메모리, 응답 제한에 걸릴 수 있다.
- 콜드 스타트·함수 시간 제한, Supabase 요금제 용량과 연결 수의 영향을 받는다. 인스턴스마다 최대 3개 연결이므로 총 연결 수는 별도 관리한다.
- 기본 seed 계정과 고정 2026년 9월 demo 자료는 시연용이다. 무중단 복구·자동 백업 스케줄·운영 전환은 이 작업 범위가 아니다.
- 코드의 자동 검증과 실제 Vercel/Supabase 배포 검증은 별개다. 실제 프로젝트 연결·URL 발급은 코디네이터가 준비한 대상에서 수행한다.

참고: [Next.js 파일 추적](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [node-postgres SSL](https://node-postgres.com/features/ssl).

## 실제 사용 시작 (시연 데이터 지우기)

시연 데이터와 시연 계정을 모두 지우고 관리자 계정 하나만 남긴다. 관리자 비밀번호는 아무도 모르는 임의 값이고, 24시간짜리 비밀번호 설정 링크가 출력된다.

```sh
CONFIRM_FRESH_START=지우기 APP_URL=https://<배포 주소> npm run start:fresh -- [관리자아이디] [관리자이름]
```

관리자가 링크에서 비밀번호를 정하고 로그인하면 대시보드의 "시작 준비"에 회사 정보 → 현장 → 차량 → 운송사·기사 사업자 → 기사 → 기사 소속 → 계약·단가 → 사람 초대 순서가 나온다. 모두 등록하면 사라진다.

## 휴대폰·PC 웹 푸시 (PUSH)

`0730_push_subscriptions`를 먼저 적용한다. `DB_SCHEMA=vehicle`에서도 같은 마이그레이션을 사용한다.

```sh
npx web-push generate-vapid-keys
```

출력된 Public Key를 `VAPID_PUBLIC_KEY`, Private Key를 `VAPID_PRIVATE_KEY`, 실제 운영자 이메일을 `VAPID_SUBJECT=mailto:운영자@example.com`으로 Vercel 환경변수에 저장하고 재배포한다. 키는 한 번 생성해 유지한다. 비밀키는 문서·소스·로그에 기록하지 않는다. 대화에 공유했던 키 대신 새 운영 키를 생성한다. 키 교체 후에는 각 기기에서 알림을 껐다 켜 다시 구독한다. 세 값 누락·키 불일치·잘못된 mailto는 알림만 비활성화하고 업무 처리는 유지한다.

담당자는 메뉴 아래, 기사는 홈 아래 **알림 받기**를 눌러 브라우저 권한을 허용한다. 기기마다 켜야 한다. iPhone·iPad는 iOS/iPadOS 16.4 이상에서 **공유 → 홈 화면에 추가**한 앱을 열어 설정한다. HTTPS가 필요하며 개발 localhost는 예외다. 운영 검증은 담당자 기기 구독 → 기사 제출 → 알림 클릭 → 담당자 보완 요청 → 기사 알림 순으로 진행한다. 잠금화면에 기사명·현장·운송내역·금액이 표시될 수 있다.

제출·재제출 및 보완 요청 API의 가장 바깥 트랜잭션이 완료된 뒤 Next.js `after`로 발송한다. 같은 멱등 키의 재생 응답은 발송하지 않는다. 전송 실패는 업무 응답을 바꾸지 않으며 404/410 구독은 삭제, 기타 오류는 `failure_count`에 누적하고 성공 시 0으로 초기화한다. 로그아웃 버튼은 해당 브라우저 구독을 해제한다. 예약 후 상태가 바뀐 이전 알림은 생략한다. 별도 큐·재시도 작업은 없으므로 서버 중단·시간 제한·기기 설정에 따른 미수신 가능성이 있다. 앱 검수함의 내역이 최종 기준이다.

`public/sw.js`는 이 저장소에서 직접 관리하는 원본이다. `npm run pwa:build`의 `src/client/offline/build-shell.mjs`가 그 내용까지 해시해 `public/sw-version.js`를 생성하므로 push/click 처리 변경도 서비스워커 버전에 반영된다. 기존 공개 오프라인 자산 캐시 정책은 유지한다.

참고: [web-push 공식 사용법](https://github.com/web-push-libs/web-push), [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after), [WebKit 홈 화면 웹 푸시](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
