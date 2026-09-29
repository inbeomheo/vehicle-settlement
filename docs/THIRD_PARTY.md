# 제3자 저작물 고지

## Noto Sans KR

- 사용 목적: PDFKit 정산명세의 한글 글꼴 임베딩.
- 원본: [google/fonts의 Noto Sans KR](https://github.com/google/fonts/tree/main/ofl/notosanskr)
- 원본 파일: `NotoSansKR[wght].ttf` (가변 TrueType).
- 배포 파일: `assets/fonts/NotoSansKR-Regular.ttf` (fontTools varLib.instancer로 wght=400 정적 인스턴스 생성; PDFKit에서 가변 폰트 기본 100 굵기로 표시되는 문제 방지).
- 라이선스: SIL Open Font License 1.1. 전문·원저작권 고지는 `assets/fonts/OFL-NotoSansKR.txt`에 포함.
- 취득일: 2026-09-29.

- 원본 SHA-256: `194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252`
- 재현: `instantiateVariableFont(TTFont("NotoSansKR[wght].ttf"), {"wght": 400}, inplace=True)` 후 `save("NotoSansKR-Regular.ttf")`.

## 애플리케이션 코드와 의존성

W5 가져오기·백업·복구·E2E 코드는 이 저장소의 DESIGN/API 및 W1~W4 서비스를 기준으로 작성했다. 외부 제품·참고 기획 자료의 애플리케이션 소스 코드를 복사하거나 재사용하지 않았다. 위 Noto 글꼴 자산 및 npm 의존성 사용은 별도다.

설치되는 정확한 버전은 `package-lock.json`, 개별 라이선스 전문은 배포 의존성의 LICENSE/COPYING 파일을 따른다. W5에서 새 npm 패키지를 추가하지 않았다.

| 주요 의존성 | 사용 목적 | 패키지 고지 기준 라이선스 |
| --- | --- | --- |
| Next.js, React, Tailwind CSS | 웹앱·UI | MIT |
| Drizzle ORM, node-postgres(pg) | PostgreSQL 접근 | Apache-2.0 / MIT |
| Zod, decimal.js | 검증·정수 원/소수 수량 계산 | MIT |
| ExcelJS, PDFKit | 엑셀·PDF 생성 | MIT |
| idb | IndexedDB 오프라인 초안 | ISC |
| bcryptjs | 비밀번호 해시 | BSD-3-Clause |
| embedded-postgres / PostgreSQL | 개발용 DB 바이너리 | MIT / PostgreSQL License |
| Vitest / Playwright | 자동 검증 | MIT / Apache-2.0 |

배포물에 포함된 전이 의존성과 PostgreSQL 바이너리의 추가 고지는 각 패키지 제공 라이선스 파일을 함께 유지한다.
