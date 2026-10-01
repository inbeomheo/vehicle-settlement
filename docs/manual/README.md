# 사용 설명서

- 설명서 본문(사진 포함): https://claude.ai/artifact/2MyDcSzJbbM4XKjWHqe7rd
- `img/`: 설명서에 들어간 화면. 시연 사이트에서 기사 → 현장 담당자 → 정산 담당자 → 관리자 순으로 한 달 흐름을 실제로 진행하며 찍었다.
- `capture/`: 같은 흐름을 다시 찍는 스크립트. 화면이 바뀌면 다시 돌려 이미지를 교체한다.

## 다시 찍기

시연 데이터를 초기 상태(`npm run seed && npm run seed:demo`)로 되돌린 뒤 순서대로 실행한다. 앞 단계의 결과(보낸 운행, 승인, 정산)가 다음 단계의 화면이 된다.

```sh
cd docs/manual/capture
node driver-a.mjs   # 01~11 기사 운행 등록
node driver-b.mjs   # 12~16 보완 요청 처리, 내 정산, 글자 크기
node site.mjs       # 20~27 현장 담당자 검수
node settle.mjs     # 30~37 월 정산·PDF·지급 기록
node admin.mjs      # 40~42 관리자
node driver-c.mjs   # 15 지급 후 내 정산
```

- `BASE=http://localhost:3000` 으로 로컬 서버를 찍을 수 있다(기본은 시연 사이트).
- `WATCH=1` 이면 브라우저를 화면에 띄워 사람이 쓰는 속도로 진행한다.

## PDF 본문 갱신

웹 설명서와 같은 본문·기존 캡처로 PDF를 만듭니다. 화면 캡처 자체는 바꾸지 않습니다.

```sh
BASE=http://localhost:3173 node docs/manual/export.mjs
```

해당 포트의 로컬 서버가 실행 중이어야 합니다. 생성한 `public/manual/vehicle-manual.pdf`는 텍스트 추출과 페이지 렌더링으로 확인합니다.
