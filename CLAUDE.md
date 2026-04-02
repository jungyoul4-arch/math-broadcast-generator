# 프로젝트 헌법 (CLAUDE.md)

## 프로젝트 개요
- **프로젝트명:** math-broadcast-generator (수능 수학 방송 문제 생성기)
- **목적:** 수능 수학 문제 이미지를 업로드하면, AI가 분석하여 방송용 HTML/PNG 콘티(강의노트 포함)를 자동 생성
- **기술 스택:** Next.js 16, React 19, TypeScript, Playwright (HTML→PNG), XeLaTeX + TikZ (수식 렌더링)
- **AI:** Google Gemini (문제 분석), Anthropic Claude (TikZ 생성/보정)
- **배포:** Railway (Dockerfile, Volume `/app/data`)
- **저장소:** 파일시스템 기반 (`data/` 디렉토리) — DB 미사용

## 핵심 규칙
- `data/` 디렉토리는 Railway Volume에 마운트됨 — 로컬 `data/`는 초기 데이터용
- `.gitignore`에 `data/`, `.claude/`, `output/` 포함 — 이들은 커밋하지 않음
- 용어: "콘티" 대신 **"강의노트"** 사용
- LaTeX 렌더링은 XeLaTeX + 나눔명조 폰트 사용 (Dockerfile에서 texlive-lang-korean + fonts-nanum 설치)
- `next.config.ts`에서 `output: "standalone"`, `serverExternalPackages: ["playwright"]` 필수
- **클라우드 동기화 주의**: 이 프로젝트 폴더에 클라우드 동기화가 걸려있으면 `.next/dev/` 캐시 충돌로 Turbopack이 멈춤. `.next/`, `node_modules/`는 동기화에서 반드시 제외
- **dev 서버 시작 전**: 반드시 `rm -rf .next` 실행. "2" 접미사 디렉토리(`cache 2`, `server 2` 등)가 보이면 동기화 충돌 — 즉시 삭제
- **정본 디렉토리**: `Desktop/math-broadcast-generator` (최신). `Desktop/skill/math-broadcast-generator`는 초기 복사본 — 삭제 가능

## 폴더 구조
```
app/
  page.tsx          — 메인 페이지 (문제 업로드 + 분석 + 미리보기)
  admin/page.tsx    — 관리자 페이지 (유저/그룹/라이브러리 관리)
  library/page.tsx  — 라이브러리 페이지 (저장된 문제 조회)
  login/page.tsx    — 로그인 페이지
  api/
    analyze/        — AI 문제 분석 (Gemini → 수식/본문 추출)
    render/         — HTML→PNG 렌더링 (Playwright)
    regenerate-tikz/ — TikZ 재생성 (Claude)
    download/       — ZIP 다운로드
    auth/           — 로그인/로그아웃/me
    admin/          — 관리자 API (users, groups, library)
    library/        — 라이브러리 CRUD

components/
  DropZone.tsx      — 이미지 드래그&드롭 + Ctrl+V 붙여넣기
  ProblemCard.tsx   — 문제 카드 (미리보기, 편집)
  ProgressBar.tsx   — 진행률 표시
  SaveModal.tsx     — 저장 모달
  NavBar.tsx        — 내비게이션 바

lib/
  claude.ts         — Claude API 호출 (TikZ 생성)
  renderer.ts       — Playwright 기반 HTML→PNG 렌더링 + LaTeX 정규화
  template.ts       — 문제 HTML 템플릿
  conti-template.ts — 강의노트 HTML 템플릿
  conti.ts          — 강의노트 생성 로직
  latex-renderer.ts — XeLaTeX 렌더링 (tex→pdf→png)
  latex-template.ts — LaTeX 템플릿
  tikz-renderer.ts  — TikZ→PNG 렌더링
  auth.ts           — JWT 인증
  users.ts / groups.ts / library.ts — 데이터 CRUD
```

## API 키 환경변수
- `GEMINI_API_KEY` — Google Gemini API
- `ANTHROPIC_API_KEY` — Anthropic Claude API
- `JWT_SECRET` — JWT 서명용

## ⚠️ 실수 노트 (Mistake Log)

### 2026-03-26: cases(구간별 정의 함수) 렌더링 실패
- **실수:** Gemini가 `\begin{cases}` LaTeX를 다양한 이스케이프 수준(1~4중 백슬래시)으로 반환하여 렌더링 깨짐
- **원인:** JSON 직렬화/역직렬화 과정에서 백슬래시 손실 + Gemini 출력 비일관성
- **해결:** `fixDoubleEscapedEnvironments` + `fixPiecewiseFunctions` + renderer.ts의 setContent 직전 정규화
- **교훈:** AI 출력의 LaTeX는 항상 정규화 단계를 거쳐야 함. JSON 왕복 시 백슬래시 손실을 반드시 복원할 것

### 2026-03-26: Railway 재배포 시 데이터 초기화
- **실수:** 파일시스템 저장소가 재배포마다 날아감
- **원인:** Docker 컨테이너 재생성 시 Volume 미설정
- **해결:** Dockerfile에 `data-init` + `start.sh` 패턴, Railway Volume → `/app/data` 마운트
- **교훈:** Railway에서 파일 영속성이 필요하면 반드시 Volume 설정. Dockerfile은 초기 데이터 복사 패턴 사용

### 2026-03-31: Turbopack 컴파일 무한 대기 + SST 파일 손상
- **실수:** dev 서버가 `Compiling proxy ...`에서 무한 멈춤, 브라우저 접속 불가
- **원인:** 클라우드 동기화가 `.next/dev/` 안에 `"cache 2"`, `"server 2"` 등 중복 디렉토리를 실시간 생성 → Turbopack SST 파일 쓰기 실패 → DB 손상
- **해결:** `rm -rf .next` 후 재시작 + "2" 디렉토리 삭제. 근본 해결은 클라우드 동기화에서 `.next/`, `node_modules/` 제외
- **교훈:** 개발 프로젝트 폴더에 클라우드 동기화를 걸면 빌드 캐시 충돌이 발생한다. 동기화 대상에서 빌드 산출물 디렉토리를 반드시 제외할 것

### 2026-04-02: cases 줄바꿈(\\)이 \\\로 변형되어 한 줄로 렌더링
- **실수:** renderer.ts Step 3의 regex `/\\(?!\\)(?=\s)/g`가 이미 올바른 `\\`(줄바꿈)의 두 번째 `\`까지 매칭하여 `\\\`(3개)로 만듦 → KaTeX 파싱 실패 → cases가 한 줄로 표시
- **원인:** negative lookahead `(?!\\)`만 있고 negative lookbehind `(?<!\\)`가 없어서, `\\` 안의 두 번째 `\`가 "단독 백슬래시"로 오인됨
- **해결:** regex를 `/(?<!\\)\\(?!\\)(?=\s)/g`로 수정 — lookbehind로 앞에 `\`가 있으면 건너뜀
- **교훈:** 백슬래시 정규화 regex는 반드시 앞뒤 문맥(lookbehind + lookahead)을 모두 확인해야 함. 특히 `\\`(2개)를 건드리지 않으면서 `\`(1개)만 처리하려면 lookbehind 필수

## 작업 컨벤션
- 커밋 메시지: `feat:`, `fix:`, `refactor:` 접두사 + 한글 설명
- 브랜치: `main` 단일 브랜치 운영
- 테스트: 별도 테스트 프레임워크 없음 — `npm run dev`로 수동 확인
- AI 프롬프트 수정 시: 기존 프롬프트의 금지 패턴/올바른 예시 유지, 추가만 허용
