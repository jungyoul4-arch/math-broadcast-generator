# 세션 로그 — 2026-04-02 (2차)

## 완료된 작업 (커밋 4개)

### ⑦ KaTeX SSR + ⑨ 자동 변환 옵션 (커밋 2eb96cb)
- `lib/normalize.ts`에 `renderLatexSsr()` 함수 추가 — `katex.renderToString()`으로 Node.js에서 수식을 미리 HTML 변환
- `lib/renderer.ts`에서 `setContent()` 직전에 SSR 적용, `waitUntil`을 `"networkidle"` → `"load"`로 변경
- "분석 후 자동 변환" 체크박스 추가 (기본값: 꺼짐)
- 9개 비효율성 최적화 모두 완료 (9/9)

### KaTeX SSR cases 한 줄 렌더링 버그 수정 (커밋 986c1b7)
- conditionHtml의 cases가 `$...$` (inline)으로 들어올 때 displayMode: false로 렌더링되어 `\\` 줄바꿈이 무시되던 버그
- `\begin{cases}` 등 환경을 자동 감지하여 display mode로 전환
- `output: "html"` 옵션 제거 → 기본값(htmlAndMathml)으로 완전한 렌더링

### Playwright 메모리 안전성 + KaTeX 에러 가시성 + 렌더 API 검증 (커밋 744c3a1)
- 동시 페이지 수 추적(`_openPages`) + quota 제한(MAX_PAGES=8)
- `page.close()` 실패 방어, disconnect 시 `_routesRegistered` 리셋
- KaTeX SSR 실패 시 콘솔 경고 + errorColor로 오류 가시화
- 렌더 API: 항목 수/타입/크기 검증, `.problem-container` 존재 확인

### 3단계 리뷰 체인 지적 반영 (커밋 ac4232e)
- errorColor `#ffffff` → `#ff6b6b` (투명 PNG 위 오류 가시화)
- autoRender 체크박스 해제 시 `autoRenderPending.current = false` 동기화

## 3단계 리뷰 체인 결과
- 검토자(feature-dev) → 피드백(coderabbit) → 평가자(superpowers)
- 종합 등급: **B+** — 프로덕션 배포 가능, show-stopper 없음
- Playwright 테스트: 기하(14번, TikZ 도형) + 확률통계(27번, cases 환경) 모두 정상 렌더링 확인

## 다음 세션에서 할 일
- Railway 프로덕션 배포 (로컬 검증 완료)
- 필요 시 추가 문제 유형별 테스트

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
