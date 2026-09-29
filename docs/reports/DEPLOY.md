# DEPLOY 작업 보고서

## 변경 결과

- `DB_SCHEMA`와 연결별 search_path, 풀 크기·SSL 설정을 추가했다. 지정 스키마 안에 업무 객체와 마이그레이션 이력을 두며 없으면 명확한 오류로 중단한다.
- 지시대로 초기 SQL의 `"public".` 한정자 70곳을 제거했다. 기존 public/drizzle DB의 알려진 SQL 해시 두 개만 정확한 적용 시각과 함께 보정해 후속 마이그레이션과 논리 백업을 유지한다.
- `0500_deploy_evidence_blobs.sql`과 local/db 드라이버를 추가했다. 증빙·XLSX 원본의 DB 저장은 업무 트랜잭션에 포함된다. 조회에서 SHA-256·크기를 확인하고, 증빙의 권한·귀속·교체·논리 삭제 계약은 유지한다. 오래된 가져오기 삭제는 DB blob도 같은 트랜잭션에서 삭제한다.
- 백업·복구를 전용 스키마로 제한하고 DB blob까지 검증한다. 스키마/드라이버가 다른 백업과 기존 업무 데이터 덮어쓰기를 거부한다. 복구 시 스키마와 ACL을 보존한다.
- `MAX_UPLOAD_BYTES`를 증빙 메타·실제 스트림·가져오기 파일/multipart·JSON에 적용했다. Vercel 기본은 4MiB, 로컬 기본 한도는 유지한다. PDF 한글 폰트 추적과 `icn1`, `db:deploy`, 배포 환경 예시·절차를 추가했다.

## 모호한 부분의 결정

1. **실제 배포 범위**: 작업 지시의 Change/완료 조건은 배포 지원 코드·문서·검증·커밋이다. 실 Supabase 롤/스키마는 코디네이터가 미리 만든다는 지시를 따랐다. 원격 DB나 Vercel 프로젝트를 변경하거나 공개 URL을 발급하지 않았다.
2. **마이그레이터**: 설치된 Drizzle은 `migrationsSchema`를 지정해도 무조건 CREATE SCHEMA를 실행한다. DB_SCHEMA 미설정은 기존 migrator를 그대로 사용한다. 지정 시 동일 Drizzle migration reader·journal·적용 시각 규칙을 사용하되 스키마 생성만 생략하는 트랜잭션 실행 경로를 둔다. 이미 존재하는 스키마와 그 안의 이력 테이블만 사용한다.
3. **풀러**: 세션 상태 의존성과 관리 작업을 고려해 Supavisor session 5432를 배포 기본으로 정했다. 6543은 실제 대상에서 추가 검증 후 선택하도록 문서화했다. 연결 옵션과 롤 기본 search_path를 함께 지정한다.
4. **전용 스키마 백업**: 전체 DB dump나 스키마 DROP/CREATE를 피하도록 DB_SCHEMA 지정 시 앱 논리 백업을 사용한다. 전용 롤로 복구할 수 있고 public의 다른 앱 자료를 포함하지 않는다. 임의 DDL·스키마명 변경·드라이버 변환은 지원하지 않는다.
5. **증빙 원본 보존**: 삭제 API는 기존의 논리 삭제를 유지한다. 드라이버의 물리 삭제는 실패 정리와 오래된 가져오기 원본 제거에 사용한다.
6. **public 권한**: PostgreSQL의 PUBLIC 상속 권한은 NOINHERIT/롤별 REVOKE로 제거되지 않는다. SQL 예시는 이를 사전 검사해 실패하면 롤/스키마 준비를 중단하며, 기존 public ACL을 자동 변경하지 않는다. 불일치 시 코디네이터 검토 또는 별도 프로젝트가 필요하다.
7. **폰트·PWA**: 기존 PDF 코드는 이미 process.cwd()를 기준으로 해석하므로 유지하고 추적 설정만 추가했다. prebuild의 pwa:build와 생성물 gitignore도 유지했다.
8. **업로드 경계**: Vercel에서는 multipart 경계를 포함한 전체 요청을 4MiB로 제한한다. JSON은 기존 2MiB와 설정값 중 작은 한도다. 로컬 기본값은 그대로다.

## 검증

- `npm run typecheck`: 통과.
- `npm run lint`: 통과.
- `npm test`: 60개 파일, 349개 테스트 통과 (45.77초).
- `npm run build`: 통과. 추가로 `VERCEL=1 npm run build` 통과. 두 환경에서 prebuild → pwa:build 실행 및 한글 폰트 파일 추적 확인.
- `npm run format:check`: 통과.
- `npm run test:e2e`: Chromium 112개 통과 (5.2분). 개발 DB의 사용·명세·지급·증빙·감사·가져오기 건수 실행 전후 동일.
- `.next/server/app/api/statements/[id]/export.pdf/route.js.nft.json`에 NotoSansKR-Regular.ttf와 OFL 파일 포함 확인.
- 실제 PostgreSQL 제한 롤(NOCREATEDB/NOCREATEROLE, public 접근 불가)에서 vehicle 마이그레이션, 연결 3개 search_path, 내장 UUID, 반복 실행, 없는 스키마 거부 검증.
- 동일 환경에서 기본 seed·seedDemo, 증빙 업로드/멱등/타인 열람 차단/손상 검출/논리 삭제, XLSX 원본 재조회·미리보기, 정산 확정, 트랜잭션 blob 롤백과 물리 삭제 검증.
- DB 파일 15개·확정명세 3건을 백업/복구하고 해시·합계 검증. public의 다른 앱을 모사한 테이블과 82 값 보존, public 업무 테이블/별도 drizzle 스키마 미생성 확인.
- 기존 public/drizzle에서 이전 두 해시를 복원하고 새 blob 마이그레이션이 없는 상태부터 업그레이드. 업무 행·시퀀스·이력 보존 및 알 수 없는 해시 거부 검증.
- 로그인 화면 브라우저 검사: 의미 있는 내용, 아이디·비밀번호·로그인 버튼 표시, 오류 오버레이 없음. agent-browser CLI가 없어 설치된 ego-browser로 같은 관찰을 수행하고 작업 탭을 닫았다.

## 공용 파일과 운영 자료

공용 변경: `src/server/db/schema.ts`(blob 테이블), `package.json`(db:deploy), `src/server/http.ts`(JSON 한도), `next.config.ts`(폰트 추적). 권한·금액·업무 상태 판단 로직은 변경하지 않았다. 설계 부록·README·OPERATIONS에 배포 확장을 연결했다.

배포 환경·롤 생성 SQL·시드·백업·제약은 [DEPLOY](../DEPLOY.md)에 있다. SSL 인증서 체인·실제 Supavisor 연결·Vercel 원격 런타임은 실제 프로젝트에 연결한 배포 후 검증 대상이다. 비밀값과 `.data/`, `storage/`, 빌드/PWA 생성물은 커밋하지 않는다.

## 커밋과 최종 상태

- `8f634d4`: 전용 DB 스키마·접속 설정·기존 마이그레이션 이력 호환.
- `4d06d87`: DB 파일 드라이버·범위 제한 백업/복구·서버리스 제한·실제 PG 통합 테스트.
- 문서 커밋: 배포 지침·설계/운영 연결·환경 예시·작업 보고서.
- 빌드·E2E 생성물은 모두 무시 경로에 남으며, 커밋 후 추적 파일 및 미추적 작업 파일이 없는 상태로 인계한다.
