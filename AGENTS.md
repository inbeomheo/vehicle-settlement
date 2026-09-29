# AGENTS.md

화물차 사용·청구·정산 웹앱. **설계 기준은 `docs/DESIGN.md`** — 코드 작성 전에 반드시 읽는다.
원 기획서 `docs/spec/기획서.txt`, 구현 지시서 `docs/spec/구현지시서.md`.

## 규칙
- 스택·디렉터리·API 형식·데이터 모델은 DESIGN.md 를 따른다. 벗어나야 하면 코디네이터에게 질문.
- 서버가 권한·금액·상태를 최종 판단한다. 클라이언트 값 신뢰 금지.
- 금액은 정수 원, 수량은 decimal.js. float 금액 계산 금지.
- 업무 규칙마다 Vitest 통합 테스트를 둔다 (실제 PostgreSQL).
- 사용자 표시 문구는 한국어. 코드 식별자는 영어.
- 완료 전: `npm run typecheck && npm run lint && npm test`.
- 파일 소유 범위를 지키고, 공용 파일 변경은 최소화 후 보고.
- 비밀값·로컬 DB 데이터(`.data/`, `storage/`)는 커밋하지 않는다.
