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
