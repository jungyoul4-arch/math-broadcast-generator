# 세션 로그 — 2026-04-02 (2차)

## 완료된 작업

### ⑦ KaTeX SSR (서버사이드 수식 렌더링)
- `lib/normalize.ts`에 `renderLatexSsr()` 함수 추가 — `katex.renderToString()`으로 Node.js에서 수식을 미리 HTML 변환
- `lib/renderer.ts`에서 `setContent()` 직전에 SSR 적용, `waitUntil`을 `"networkidle"` → `"load"`로 변경
- KaTeX JS 대기 로직을 fallback 전용으로 경량화 (SSR 실패 시에만 동작)
- 안전 마진 300ms → 100ms로 축소
- `@types/katex` devDependency 추가

### ⑨ 자동 변환 옵션 (UX 개선)
- "분석 후 자동 변환" 체크박스 추가 (기본값: 꺼짐)
- 분석 완료 → preview 진입 시 자동으로 `handleRender()` 호출
- `useRef` + `useEffect` 패턴으로 state 의존성 안정적 처리

## 다음 세션에서 할 일
- 9개 비효율성 모두 완료 — 추가 최적화 필요 시 새로운 분석 진행

---

# 세션 로그 — 2026-04-02

## 완료된 작업

### 버그 수정 (커밋 c787e3a)
- cases 줄바꿈(`\\`) 정규화 regex에 `(?<!\\)` lookbehind 추가
- renderer.ts Step 3이 올바른 `\\`를 `\\\`로 변형하여 KaTeX 파싱 실패하던 버그 수정
- CLAUDE.md 실수 노트에 기록

### 7가지 성능/구조 최적화 (커밋 ba27eb3)
1. **detectDiagram 활용** — 도형 없는 문제에서 Pro TikZ API 호출 스킵 (비용 절감)
2. **KaTeX/폰트 로컬 번들링** — Playwright route 인터셉트로 CDN 의존 제거
3. **API 클라이언트 싱글턴** — Gemini/Anthropic 인스턴스 재사용
4. **Playwright Context 재사용** — 매 렌더링마다 생성/삭제 → 싱글턴
5. **fixMathOperators 통합 regex** — 300번 new RegExp → 2개 통합 regex
6. **정규화 함수 통합** — 3곳 중복 → lib/normalize.ts 단일 소스
7. **디버그 로그 조건부** — MBG_DEBUG=true일 때만 출력

### 비효율성 분석 보고서
- Sequential Thinking MCP + Playwright MCP + Context7 MCP 활용
- 실측 데이터: analyze API 16~26초, render API 1.5~3.2초, Google Fonts 303ms
- 9개 비효율성 발견, 7개 수정 완료

## 다음 세션에서 할 일
- [ ] ⑦ KaTeX SSR (서버사이드 렌더링) — katex.renderToString()으로 Node.js에서 수식 미리 변환, 구조 변경 필요
- [ ] ⑨ 자동 변환 옵션 — 분석 완료 후 자동 렌더링 시작 (UX 개선)

## 중요 결정사항
- KaTeX 인라인 삽입 방식은 실패 (defer 실행 순서 깨짐) → Playwright route 인터셉트 방식 채택
- 정규화 로직은 lib/normalize.ts로 통합 — 향후 수정 시 1곳만 변경
- 디버그 로그는 MBG_DEBUG 환경변수로 제어

---

# 세션 로그 — 2026-03-31

## 완료된 작업

### 1. 프로젝트 오염 정리
- 바탕화면의 "2" 접미사 중복 디렉토리 12개 삭제 (`app 2`, `components 2`, `.git 2` 등)
- 원인: 클라우드 동기화에 의한 파일 충돌 복사본

### 2. Turbopack 컴파일 무한 대기 원인 진단
- **증상:** `npm run dev` 후 `Compiling proxy ...`에서 무한 멈춤, 브라우저 접속 불가
- **근본 원인:** 클라우드 동기화가 `.next/dev/` 캐시 파일을 실시간 동기화하면서 충돌 복사본 생성 → Turbopack DB 손상
- **해결:** `rm -rf .next` + "2" 디렉토리 삭제 후 정상 동작 확인

### 3. 보리스 워크플로우 세팅
- CLAUDE.md (프로젝트 헌법) 생성

---

# 이전 세션 로그 — 2026-03-26 ~ 2026-03-27

## 완료된 작업
1. 구간별 정의 함수(cases) 렌더링 안정성 강화 (`c1e6f4c`)
2. Railway Volume 설정 + 그룹 멤버 추가 (`06623cf`)
3. Ctrl+V 붙여넣기 이미지 업로드 (`21953ac`)
4. 라이브러리/관리자 페이지 이미지 미리보기 (`6df1225`)
5. 강의노트 기능 추가 (`514f6a1`)
