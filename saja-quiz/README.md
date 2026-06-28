# 사자성어 퀴즈 (四字成語 Quiz)

브라우저에서 바로 실행되는 사자성어 학습·퀴즈 웹앱입니다. React 기반 단일 페이지이며 **인터넷 없이도** 동작합니다(라이브러리를 `vendor/`에 포함).

## 기능
- **학습 모드 (플래시카드)** — 한자 · 독음(뜻+음) · 직역/의역 · 유래를 카드로 학습 (10/20/전체)
- **뜻 보고 사자성어 찾기** — 4지선다 / 주관식 입력
- **독음 듣고 사자성어 찾기** — 독음 음성 2회 재생 후 4지선다 (Web Speech API)
- **빈칸 채우기** — 빈칸 한자 4지선다 / 독음 주관식 입력, 힌트 토글
- 문제 수 선택(10/20/전체), 점수·정답률 집계

## 로컬 실행
`index.html`을 브라우저로 더블클릭하거나:
```bash
python3 -m http.server 4187   # http://localhost:4187
```

## GitHub Pages 배포
저장소 **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `/(root)`** 선택 후 저장하면
`https://<사용자명>.github.io/<저장소명>/` 에서 공개됩니다.

## 데이터
`idioms.js`의 `window.IDIOMS` 배열. 원본 교재 텍스트에서 추출했습니다.
