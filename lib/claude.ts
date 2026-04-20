/**
 * Gemini API 연동 — 수학 문제 이미지 분석 + HTML/TikZ 생성
 * gemini-3.1-pro 사용
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { generateProblemHtml, type ProblemData } from "./template";
import { renderTikzToPng } from "./tikz-renderer";
import { normalizeMathBlock } from "./normalize";

const DEBUG = process.env.MBG_DEBUG === "true";

// ─── Gemini 클라이언트 싱글턴 ───
let _geminiClient: InstanceType<typeof GoogleGenerativeAI> | null = null;

export function getClient(): InstanceType<typeof GoogleGenerativeAI> {
  if (_geminiClient) return _geminiClient;

  let key = process.env.GEMINI_API_KEY;
  if (!key) {
    try {
      const fs = require("fs");
      const path = require("path");
      const envPath = path.join(process.cwd(), ".env.local");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        const match = content.match(/GEMINI_API_KEY=(.+)/);
        if (match) key = match[1].trim();
      }
    } catch {}
  }
  if (!key) {
    throw new Error("GEMINI_API_KEY가 없습니다. .env.local 파일을 확인하세요.");
  }
  _geminiClient = new GoogleGenerativeAI(key);
  return _geminiClient;
}

const SYSTEM_PROMPT = `당신은 수학 문제 이미지를 분석하여 HTML+LaTeX 코드로 변환하는 전문가입니다.

## 작업
사용자가 수학 문제 스크린샷을 보내면:
1. 문제 텍스트를 정확하게 추출합니다
2. 수식은 $...$와 $$...$$ 형태의 LaTeX 인라인/블록으로 변환합니다 (KaTeX에서 렌더링)
3. 한글 텍스트는 그대로 HTML로 씁니다
4. 도형이 있으면 diagramTikz 필드에 TikZ 코드를 생성합니다

## 응답 형식
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트를 추가하지 마세요.

\`\`\`json
{
  "number": 1,
  "subject": "미적분",
  "type": "주관식",
  "points": 4,
  "difficulty": 4,
  "unitName": "수열의 극한",
  "hasDiagram": false,
  "diagramTikz": null,
  "bodyHtml": "HTML+LaTeX 본문 (구하고자 하는 것 반드시 포함!)",
  "questionHtml": null,
  "conditionHtml": "박스 안의 조건부 (원본에 박스가 있는 경우만, 없으면 null)",
  "choicesHtml": null
}
\`\`\`

## 난이도 판단 기준
- difficulty 1: 교과서 기본 (2점 문제, 단순 계산)
- difficulty 2: 기본 응용 (3점 쉬운 문제)
- difficulty 3: 표준 (3점 보통, 4점 쉬운)
- difficulty 4: 준킬러 (4점 어려운, 수능 21번급)
- difficulty 5: 킬러 (수능 30번, 최고난도)

## 수식 규칙 (KaTeX용)
- 인라인 수식: $수식$ (한글 문장 속에 수식)
- 블록 수식: $$수식$$ (독립된 수식 줄)
- 분수: \\frac{a}{b}
- 적분: \\int_{a}^{b}
- 극한: \\lim_{x \\to a} (반드시 \\lim 사용! 독립된 줄의 극한 수식은 반드시 $$...$$ 블록으로 감싸세요)
- displaystyle 극한: \\displaystyle\\lim_{n \\to \\infty}
- 오버라인: \\overline{AB}
- 루트: \\sqrt{x}
- 로그: \\log, \\log_{a} (반드시 \\log 사용!)
- 삼각함수: \\sin, \\cos, \\tan (반드시 백슬래시!)
- 시그마: \\sum_{k=1}^{n}
- 조합: \\binom{n}{r} 또는 {}_{n}\\mathrm{C}_{r}
- 조건부: \\begin{cases} ... \\end{cases} (조건부 함수 필수!)
- 정렬: \\begin{aligned} ... \\end{aligned}
- 화살표: \\to (-> 사용 금지!)

## 조건부 함수 / 구간별 정의 함수 (★★★ 가장 중요한 절대 규칙 ★★★)

구간별로 다르게 정의된 함수(piecewise function)는 반드시 \\begin{cases}...\\end{cases} 환경을 사용하세요.
이 규칙을 어기면 KaTeX에서 모든 조건이 한 줄로 나열되어 방송 사고가 발생합니다!

### ❌ 절대 하면 안 되는 것 (한 줄로 나열됨 → 방송 사고!):
- $$f(x) = \\{ax^2-2 \\quad (x<2) \\quad 3x \\quad (x \\geq 2)\\}$$ ← 중괄호만 사용 금지!
- $$f(x) = \\left\\{ ax^2-2 \\quad (x<2), \\quad 3x \\quad (x \\geq 2) \\right.$$ ← left/right 금지!
- $$f(x) = \\left\\{\\begin{array}{l} ... \\end{array}\\right.$$ ← array 환경 금지! cases만!
- cases 안에서 줄바꿈(\\\\) 없이 한 줄로 쓰기 금지!

### ✅ 반드시 이렇게 (cases 환경 + & 정렬 + \\\\ 줄바꿈):

2개 조건:
$$f(x) = \\begin{cases} ax^2 - 2 & (x < 2) \\\\ 3x & (x \\geq 2) \\end{cases}$$

3개 조건:
$$g(x) = \\begin{cases} x+1 & (x < 0) \\\\ x^2 & (0 \\leq x < 1) \\\\ 2x-1 & (x \\geq 1) \\end{cases}$$

분수 포함:
$$h(t) = \\begin{cases} \\frac{1}{2}pt^2 + \\frac{1}{2}qt + 5 & (t < 0) \\\\ 5 & (t \\geq 0) \\end{cases}$$

절대값 정의:
$$|x| = \\begin{cases} x & (x \\geq 0) \\\\ -x & (x < 0) \\end{cases}$$

### 규칙 요약:
- 각 조건의 수식과 조건 사이에 & 사용 (정렬 기호)
- 각 조건 사이에 \\\\ 사용 (줄바꿈) — 마지막 조건 뒤에는 \\\\ 없음
- 변수가 x, t, n, k 등 무엇이든 동일하게 cases 사용
- \\begin{cases} 앞에 = 기호가 와야 함 (함수명 = \\begin{cases}...)
- 중괄호(\\{, \\left\\{)로 대체하면 KaTeX에서 줄바꿈이 안 됩니다!

## 수식 주의사항 (절대 지켜야 함!)
- lim, log, sin, cos, tan 등은 반드시 \\를 붙여야 합니다!
- $...$로 감싼 수식 안에 한글을 넣지 마세요. 한글은 수식 밖에!
  올바른 예: $a_k > a_2$를 만족시키는
  틀린 예: $a_k > a_2를 만족시키는$
- 블록 수식 $$...$$는 반드시 별도 줄에 배치
- 수식 달러 기호는 반드시 짝을 맞추세요 ($...$, $$...$$)

## 도형 처리 (TikZ — 수능 방송 품질)
도형이 있는 문제는 diagramTikz 필드에 TikZ 코드를 생성합니다.
TikZ 코드는 \\begin{tikzpicture}...\\end{tikzpicture}만 포함합니다.
이 코드는 XeLaTeX + 나눔명조로 컴파일되어 투명 PNG로 변환됩니다.

### TikZ 규칙 (방송 품질 필수!)

#### 컬러 시스템 (모든 도형/그래프에 루틴으로 적용!)
TikZ 코드 시작 부분에 반드시 아래 컬러 정의를 포함하세요:
\\definecolor{mainLine}{HTML}{4FC3F7}    % 메인 도형 선 — 밝은 하늘색
\\definecolor{subLine}{HTML}{FFB74D}     % 보조 선/보조 도형 — 주황색
\\definecolor{accentLine}{HTML}{81C784}  % 강조 선/세번째 요소 — 연두색
\\definecolor{fillA}{HTML}{29B6F6}       % 색칠 영역 A — 파란색
\\definecolor{fillB}{HTML}{FF9800}       % 색칠 영역 B — 주황색
\\definecolor{fillC}{HTML}{66BB6A}       % 색칠 영역 C — 초록색
\\definecolor{dotColor}{HTML}{EF5350}    % 점/교점 강조 — 빨간색
\\definecolor{labelColor}{HTML}{FFFFFF}  % 라벨 — 흰색

#### 적용 규칙 (절대 지켜야 함!!!)

도형 테두리와 색칠 영역은 반드시 다른 색이어야 합니다!

1. 도형 외곽선/테두리: \\draw[mainLine, line width=1.5pt]  → 밝은 하늘색 (#4FC3F7)
2. 색칠/빗금 영역: \\fill[fillB, opacity=0.4]  → 주황색 (#FF9800) 또는 \\fill[fillC, opacity=0.4] → 초록색
3. 보조 선: \\draw[subLine, line width=1.5pt] → 주황색
4. 점/교점: \\filldraw[dotColor] (P) circle (2.5pt); → 빨간색
5. 라벨: text=labelColor → 흰색
6. 직각 표시: \\draw[white!70]

절대 금지:
- 테두리와 색칠을 같은 색으로 하지 마세요!
- cyan, blue 등 직접 색 이름 사용 금지! 반드시 mainLine, fillB 등 정의된 컬러만 사용!
- \\draw에 fillA 사용 금지! (fillA는 테두리와 비슷한 파란색이라 구분 안 됨)
- 색칠은 반드시 fillB(주황) 또는 fillC(초록) 사용!

#### 그래프 전용 규칙
- 축: \\draw[white!50, ->] (x축, y축 — 반투명 흰색 화살표)
- 함수 그래프 1: \\draw[mainLine, line width=1.5pt, smooth] (하늘색)
- 함수 그래프 2: \\draw[subLine, line width=1.5pt, smooth] (주황색)
- 함수 그래프 3: \\draw[accentLine, line width=1.5pt, smooth] (연두색)
- 점근선: \\draw[white!30, dashed] (연한 흰색 점선)
- 격자: \\draw[white!10] (매우 연한 격자)
- 축 라벨: \\node[white!70] (반투명 흰색)
- 원점: \\node[white!70] at (0,0) [below left] {O};

#### 기타
- 여러 그림 나란히 배치: minipage 사용
- 좌표: 수학적으로 정확하게 계산 (대충 배치 금지!)
- 검정색(black) 절대 사용 금지!
- 원본 문제에서 색칠/빗금 영역이 있으면 반드시 색상으로 구분!

### 좌표 계산 팁 (정확한 도형을 위해 반드시 사용)
% 내분점 (m:n)
\\coordinate (D) at ($(A)!{m/(m+n)}!(C)$);
% 수선의 발 (C에서 직선 AB 위로)
\\coordinate (H) at ($(A)!(C)!(B)$);
% 분수 좌표 직접 입력
\\coordinate (P) at ({54/7},{30/7});
% 직각 표시
\\draw[white] ($(C)+(-0.35,0)$) -- ++(0,0.35) -- ++(0.35,0);
% 라벨 수동 오프셋 (겹침 방지)
\\node[above right, text=white] at ($(P)+(0.1,0.2)$) {$A_2$};

### TikZ 예시 (직각삼각형 with 색칠 + 내분점 — 다크 배경용 흰색!)
\\begin{tikzpicture}[scale=1.2, every node/.style={font=\\small, text=white}]
  \\coordinate (A) at (2,4);
  \\coordinate (B) at (0,0);
  \\coordinate (C) at (4,0);
  \\coordinate (D) at ($(A)!{2/3}!(C)$);
  \\coordinate (E) at ($(B)!(A)!(D)$);
  \\draw[white, line width=1.5pt] (A) -- (B) -- (C) -- cycle;
  \\draw[white, line width=1.5pt] (B) -- (D);
  \\draw[white, line width=1.5pt] (A) -- (E);
  % 색칠은 반드시 fillB(주황) 사용! mainLine과 같은 색 금지!
  \\fill[fillB, opacity=0.4] (C) -- (E) -- (D) -- cycle;
  \\draw[white] ($(C)+(-0.35,0)$) -- ++(0,0.35) -- ++(0.35,0);
  \\node[above] at (A) {$A_1$};
  \\node[below left] at (B) {$B_1$};
  \\node[below right] at (C) {$C_1$};
  \\node[below] at (D) {$D_1$};
  \\node[right] at (E) {$E_1$};
\\end{tikzpicture}

### 여러 도형 나란히 배치 예시
diagramTikz에 minipage를 사용하세요:
\\begin{minipage}[b]{0.42\\textwidth}\\centering
\\begin{tikzpicture}[scale=0.55]
  ...R1 도형...
\\end{tikzpicture}\\\\$R_1$
\\end{minipage}\\hfill
\\begin{minipage}[b]{0.52\\textwidth}\\centering
\\begin{tikzpicture}[scale=0.55]
  ...R2 도형...
\\end{tikzpicture}\\\\$R_2$
\\end{minipage}

### 도형 없는 문제
hasDiagram: false, diagramTikz: null

## 빈칸 상자
- 수식 밖(일반 HTML): <span class="answer-box">(가)</span>
- 수식 안($...$ 또는 $$...$$): \\boxed{\\text{(가)}} 사용! (HTML 태그 절대 금지!)

절대 규칙: $...$ 또는 $$...$$ 안에 <span>, <div> 등 HTML 태그를 넣지 마세요!
수식 안 빈칸은 반드시 \\boxed{\\text{(가)}} 형태를 사용하세요.
예시:
  올바름: $$\\frac{a_n}{b_{n+1}} = \\boxed{\\text{(가)}} \\times n$$
  틀림:   $$\\frac{a_n}{b_{n+1}} = <span class="answer-box">(가)</span> \\times n$$

## 풀이 과정 큰 박스
<div class="solution-box">풀이 내용</div>

## 객관식 보기 — 무조건 생략!
객관식 보기(①②③④⑤)가 문제에 있더라도 choicesHtml은 반드시 null로 설정하세요.
방송에서는 보기 없이 문제 본문만 표시합니다. 절대 보기를 포함하지 마세요!

## subject 분류
- 2022 개정: 공통수학1, 공통수학2, 대수, 미적분1, 확률과통계, 미적분2, 기하
- 2015 개정: 수학I, 수학II, 확률과통계, 미적분, 기하

## unitName 분류
수학I/수학II: "수열의 극한", "함수의 극한", "미분계수와 도함수", "도함수의 활용", "정적분의 활용"
미적분: "여러 가지 함수의 미분", "여러 가지 적분법", "급수"
확률과통계: "조건부확률", "확률분포", "통계적 추정"
기하: "이차곡선", "평면벡터의 성분과 내적", "공간도형"

## 중요 (절대 지켜야 함!)
- 수식 하나라도 틀리면 방송 사고입니다
- 빈칸 상자는 반드시 answer-box로 변환
- 수식 $...$ 안에 한글을 넣지 마세요

## 구하고자 하는 것 (절대 누락 금지!)
- bodyHtml 맨 마지막에 "~의 값은?", "~를 구하시오" 등 구하고자 하는 것을 반드시 포함!
- 예: <br><br><span class="question-line">$p + q + h(4)$의 값은?</span>
- questionHtml은 반드시 null! 구하고자 하는 것은 bodyHtml 끝에 넣으세요.
- 원본에 "~의 값은?" 또는 "~를 구하시오"가 있으면 절대 빠뜨리지 마세요!

## 조건 박스 (conditionHtml)
- 원본 문제에서 박스(테두리) 안에 조건이 쓰여 있으면 → conditionHtml에 넣으세요
- 박스가 없는 일반 조건이면 → bodyHtml에 포함
- conditionHtml에 넣은 내용은 자동으로 박스 스타일로 렌더링됩니다
- 예: "자연수 n에 대하여 직선 $y = ...$" 가 박스 안에 있으면 conditionHtml에 넣기

## 기타
- bodyHtml에 문제 전체(본문 + 조건 + 구하고자 하는 것)를 빠짐없이 넣으세요
- 줄바꿈 가독성: 의미 단위로 자연스럽게 줄바꿈하세요. <br> 태그를 적절히 사용
  예시: "0 < ∠CAB < π/6인 호 AB 위의 점 C에 대하여" 를 한 줄로 유지`;

/**
 * JSON 파싱 전 LaTeX 백슬래시 이스케이프 전처리
 *
 * 문제: Gemini가 JSON 안에 `\times`를 넣으면, `\t`가 JSON 탭 이스케이프로 해석됨
 *   - `\times` → `\t`(탭) + `imes`  →  "imes" 으로 표시
 *   - `\theta` → `\t`(탭) + `heta`
 *   - `\nabla` → `\n`(줄바꿈) + `abla`
 *   - `\beta`  → `\b`(백스페이스) + `eta`
 *   - `\forall`→ `\f`(폼피드) + `orall`
 *   - `\right` → `\r`(캐리지리턴) + `ight`
 *
 * 해결: \ 뒤에 알파벳 2글자 이상이면 LaTeX 명령 → \\ 로 이스케이프
 *       이미 \\로 이스케이프된 것은 건드리지 않음
 *       JSON 이스케이프(\n, \t 등)는 1글자이므로 {2,} 패턴에 안 걸림
 */
function escapeLatexInJson(jsonStr: string): string {
  // 1) 알파벳 2글자 이상 LaTeX 명령어: \times → \\times
  let result = jsonStr.replace(
    /\\\\|\\([a-zA-Z]{2,})/g,
    (match, letters) => (letters ? "\\\\" + letters : match)
  );
  // 2) LaTeX 특수문자 이스케이프: \{ → \\{, \} → \\}, \, → \\, 등
  //    JSON에서 유효하지 않은 이스케이프 시퀀스 → "Bad escaped character" 에러 발생
  //    이미 \\로 이스케이프된 것은 건드리지 않음
  result = result.replace(/(?<!\\)\\([{},;:!>< #%&_^~|])/g, "\\\\$1");
  return result;
}

/**
 * 수식 내 함수명 자동 교정
 */
function fixMathOperators(html: string): string {
  // 연산자 함수 (백슬래시 없이 쓰면 이탤릭으로 렌더링되는 것들)
  const operators = [
    "lim", "log", "sin", "cos", "tan", "max", "min", "sup", "inf",
    "ln", "exp", "sec", "csc", "cot", "arcsin", "arccos", "arctan",
  ];

  // 기호 명령어 (백슬래시 없이 쓰면 완전히 깨지는 것들)
  const symbols = [
    "times", "cdot", "div", "pm", "mp", "ast", "star", "circ",
    "bullet", "oplus", "otimes", "odot",
    "leq", "geq", "neq", "approx", "equiv", "sim", "simeq",
    "ll", "gg", "prec", "succ", "preceq", "succeq",
    "subset", "supset", "subseteq", "supseteq", "in", "notin", "ni",
    "cap", "cup", "setminus", "emptyset", "varnothing",
    "forall", "exists", "nexists", "neg", "land", "lor",
    "implies", "iff", "therefore", "because",
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon",
    "zeta", "eta", "theta", "vartheta", "iota", "kappa",
    "lambda", "mu", "nu", "xi", "omicron", "pi", "varpi",
    "rho", "varrho", "sigma", "varsigma", "tau", "upsilon",
    "phi", "varphi", "chi", "psi", "omega",
    "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta",
    "Theta", "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi",
    "Omicron", "Pi", "Rho", "Sigma", "Tau", "Upsilon",
    "Phi", "Chi", "Psi", "Omega",
    "infty", "nabla", "partial", "angle", "measuredangle",
    "perp", "parallel", "propto",
    "rightarrow", "leftarrow", "leftrightarrow",
    "Rightarrow", "Leftarrow", "Leftrightarrow",
    "uparrow", "downarrow", "mapsto", "hookrightarrow", "hookleftarrow",
    "to", "gets",
    "quad", "qquad", "text", "mathrm", "mathbf", "mathit", "mathbb",
    "overline", "underline", "hat", "bar", "vec", "dot", "ddot", "tilde",
    "sqrt", "frac", "dfrac", "tfrac", "binom", "dbinom", "tbinom",
    "sum", "prod", "coprod", "int", "iint", "iiint", "oint",
    "bigcup", "bigcap", "bigoplus", "bigotimes",
    "displaystyle", "textstyle", "scriptstyle",
    "left", "right", "big", "Big", "bigg", "Bigg",
    "not", "prime", "ldots", "cdots", "vdots", "ddots",
  ];

  // 통합 regex: 긴 연산자를 먼저 매칭하도록 길이 역순 정렬 (1회 컴파일, 재사용)
  const allOps = [...operators, ...symbols].sort((a, b) => b.length - a.length);
  const opsPattern = allOps.join("|");
  const unescapedOpRegex = new RegExp(`(?<!\\\\)(?<![a-zA-Z])(${opsPattern})(?![a-zA-Z])`, "g");
  const doubleEscapedOpRegex = new RegExp(`\\\\\\\\(${opsPattern})(?![a-zA-Z])`, "g");

  // 텍스트 블록(\text{...}, \mathrm{...}, \mathbf{...} 등)을 플레이스홀더로 마스킹
  // → 연산자 regex가 텍스트 내부의 한글/영단어("in defined" 같은)를 건드리지 않도록
  // 중첩 중괄호 균형 고려 (깊이 카운트로 올바른 닫는 `}` 찾기)
  const maskTextBlocks = (s: string): { masked: string; blocks: string[] } => {
    const blocks: string[] = [];
    const cmdRegex = /\\(?:text|mathrm|mathbf|mathit|mathbb|textbf|textit|operatorname)\{/g;
    let out = "";
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    while ((m = cmdRegex.exec(s)) !== null) {
      const start = m.index;
      const openIdx = start + m[0].length - 1; // `{` 위치
      // 중괄호 균형 맞추기
      let depth = 1;
      let i = openIdx + 1;
      while (i < s.length && depth > 0) {
        const ch = s[i];
        if (ch === "\\") { i += 2; continue; } // 이스케이프 스킵
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        i++;
      }
      if (depth !== 0) break; // 짝 안 맞으면 포기
      const full = s.slice(start, i);
      blocks.push(full);
      out += s.slice(lastIdx, start) + `\x00TEXT${blocks.length - 1}\x00`;
      lastIdx = i;
      cmdRegex.lastIndex = i;
    }
    out += s.slice(lastIdx);
    return { masked: out, blocks };
  };

  const restoreTextBlocks = (s: string, blocks: string[]): string =>
    s.replace(/\x00TEXT(\d+)\x00/g, (_, idx) => blocks[Number(idx)]);

  let result = html.replace(/\$\$[\s\S]*?\$\$|\$[^$]+?\$/g, (match) => {
    // 텍스트 블록 마스킹 → 연산자 변환 → 복원
    const { masked, blocks } = maskTextBlocks(match);
    let fixed = masked;
    fixed = fixed.replace(unescapedOpRegex, "\\$1");
    fixed = fixed.replace(/->/g, "\\to");
    fixed = fixed.replace(doubleEscapedOpRegex, "\\$1");
    return restoreTextBlocks(fixed, blocks);
  });

  return result;
}

/**
 * LaTeX 환경(\begin, \end)의 이중 이스케이프 수리
 * Gemini가 이스케이프 수준을 일관되지 않게 보내면
 * JSON 파싱 후 \\begin{cases} (이중 백슬래시)가 남아 KaTeX 실패
 *
 * 실제 정규화 로직은 lib/normalize.ts의 normalizeMathBlock 단일 소스 사용
 * (cases 환경 내부/외부 분기 규칙 포함)
 */
function fixDoubleEscapedEnvironments(html: string): string {
  // 블록 수식 $$...$$ 처리
  let result = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner: string) => {
    return `$$${normalizeMathBlock(inner)}$$`;
  });

  // 인라인 수식 $...$ 처리
  result = result.replace(/(?<!\$)\$(?!\$)((?:[^$\\]|\\.)*?)\$(?!\$)/g, (_, inner: string) => {
    return `$${normalizeMathBlock(inner)}$`;
  });

  return result;
}

/**
 * 구간별 정의 함수 자동 수정: cases 환경 없이 한 줄로 나열된 경우 → cases로 변환
 *
 * 감지 패턴 예:
 *   $$f(x) = \{ax^2-2 \quad (x < 2) \quad 3x \quad (x \geq 2)\}$$
 *   $$f(x) = \left\{ ax^2-2 (x<2), 3x (x≥2) \right.$$
 *
 * 변환 결과:
 *   $$f(x) = \begin{cases} ax^2-2 & (x < 2) \\ 3x & (x \geq 2) \end{cases}$$
 */
function fixPiecewiseFunctions(html: string): string {
  if (DEBUG) console.log("🔍 [DEBUG] fixPiecewiseFunctions 입력:", JSON.stringify(html).slice(0, 500));
  return html.replace(/\$\$([\s\S]*?)\$\$/g, (match, inner: string) => {
    // cases가 이미 있으면 건너뛰기
    if (inner.includes("\\begin{cases}")) {
      if (DEBUG) console.log("✅ [DEBUG] cases 이미 존재, 스킵");
      return match;
    }

    // 조건 패턴이 2개 이상 있는지 확인: (변수 부등호 값) 형태
    const condPattern = /\(\s*[a-zA-Z]\s*(?:[<>≤≥]|\\leq|\\geq|\\le|\\ge|\\leqslant|\\geqslant)\s*[^)]*\)/g;
    const conditions = inner.match(condPattern);
    if (DEBUG) console.log("🔍 [DEBUG] $$ 블록 내용:", JSON.stringify(inner).slice(0, 300));
    if (DEBUG) console.log("🔍 [DEBUG] 조건 패턴 감지:", conditions);
    if (!conditions || conditions.length < 2) return match;

    // = \{ 또는 = \left\{ 패턴이 있는지 확인
    const hasBraceOpen = /=\s*(?:\\left\s*)?\\?\{/.test(inner);
    if (DEBUG) console.log("🔍 [DEBUG] 중괄호 열기 감지:", hasBraceOpen, "inner:", JSON.stringify(inner).slice(0, 200));
    if (!hasBraceOpen) return match;

    console.log("🔧 구간별 함수 자동 수정: cases 환경으로 변환");

    let fixed = inner;

    // Step 1: 여는 중괄호를 \begin{cases}로 교체
    fixed = fixed.replace(/=\s*\\left\s*\\\{/, "= \\begin{cases}");
    fixed = fixed.replace(/=\s*\\\{/, "= \\begin{cases}");

    // Step 2: 닫는 중괄호를 \end{cases}로 교체
    // `\right\}` / `\right.` 패턴만 정확히 매칭 (optional `?` 제거해 `\right` 단독 오매칭 방지)
    fixed = fixed.replace(/\\right\s*\\\}\s*$/, "\\end{cases}");
    fixed = fixed.replace(/\\right\s*\.\s*$/, "\\end{cases}");
    // 마지막 \} 제거 (cases 닫는 중괄호)
    if (!fixed.includes("\\end{cases}")) {
      // 마지막 조건 뒤의 \}를 \end{cases}로 교체
      const lastCondIdx = fixed.lastIndexOf(conditions[conditions.length - 1]);
      if (lastCondIdx >= 0) {
        const afterLastCond = fixed.slice(lastCondIdx + conditions[conditions.length - 1].length);
        const braceMatch = afterLastCond.match(/\s*\\\}\s*$/);
        if (braceMatch) {
          fixed = fixed.slice(0, fixed.length - braceMatch[0].length) + " \\end{cases}";
        } else {
          fixed = fixed.trimEnd() + " \\end{cases}";
        }
      }
    }

    // Step 3: 각 조건 앞에 & 추가, 각 조건 뒤에 \\ 추가 (마지막 제외)
    for (let i = 0; i < conditions.length; i++) {
      const cond = conditions[i];
      if (i < conditions.length - 1) {
        // 중간 조건: & cond \\
        fixed = fixed.replace(cond, `& ${cond} \\\\`);
      } else {
        // 마지막 조건: & cond
        fixed = fixed.replace(cond, `& ${cond}`);
      }
    }

    // Step 4: \quad, 콤마 등 불필요한 구분자 정리
    fixed = fixed.replace(/\\quad\s*&/g, " &");
    fixed = fixed.replace(/,\s*&/g, " &");
    fixed = fixed.replace(/\\\\\s*\\quad/g, "\\\\");
    fixed = fixed.replace(/\\\\\s*,/g, "\\\\");

    return `$$${fixed}$$`;
  });
}

/**
 * 수식 안의 answer-box HTML → \boxed{} 변환 (KaTeX 파싱 실패 방지)
 * $$...$$ 또는 $...$ 안에 <span class="answer-box"> 가 있으면 자동 변환
 */
function fixAnswerBoxInMath(html: string): string {
  // 블록 수식 $$...$$ 처리
  let result = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, content) => {
    if (content.includes("answer-box") || content.includes("<span") || content.includes("<div")) {
      const fixed = content
        .replace(/<span\s+class=["']answer-box["']>(.*?)<\/span>/gi, (_: string, text: string) => `\\boxed{\\text{${text}}}`)
        .replace(/<[^>]+>/g, ""); // 남은 HTML 태그 제거
      return `$$${fixed}$$`;
    }
    return match;
  });

  // 인라인 수식 $...$ 처리 ($$는 이미 처리됨)
  result = result.replace(/(?<!\$)\$(?!\$)((?:[^$\\]|\\.)*?)\$(?!\$)/g, (match, content) => {
    if (content.includes("answer-box") || content.includes("<span") || content.includes("<div")) {
      const fixed = content
        .replace(/<span\s+class=["']answer-box["']>(.*?)<\/span>/gi, (_: string, text: string) => `\\boxed{\\text{${text}}}`)
        .replace(/<[^>]+>/g, "");
      return `$${fixed}$`;
    }
    return match;
  });

  return result;
}

export interface AnalysisResult {
  problemData: ProblemData;
  html: string;
}

/**
 * Step 0: Flash로 도형 유무만 빠르게 판별 (0.5~1초)
 */
export async function detectDiagram(
  client: InstanceType<typeof GoogleGenerativeAI>,
  imageContent: { inlineData: { mimeType: string; data: string } }
): Promise<boolean> {
  const model = client.getGenerativeModel({
    model: "gemini-3-flash-preview",
    systemInstruction: "이미지를 보고 도형, 그래프, 그림이 있는지만 판단하세요. 반드시 true 또는 false만 응답하세요.",
  });
  const result = await model.generateContent([
    imageContent,
    { text: "이 수학 문제에 도형, 그래프, 또는 그림이 있습니까? true/false만 답하세요." },
  ]);
  const text = result.response.text()?.trim().toLowerCase() || "";
  return text.includes("true");
}

/**
 * 텍스트 분석 (Flash 기본, 검증 실패 시 Pro 자동 재시도)
 */
async function analyzeText(
  client: InstanceType<typeof GoogleGenerativeAI>,
  imageContent: { inlineData: { mimeType: string; data: string } },
  userMessage: string,
  tier: "flash" | "pro" = "flash"
): Promise<Record<string, unknown>> {
  const modelName = tier === "pro" ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
  });
  const result = await model.generateContent([imageContent, { text: userMessage }]);
  const responseText = result.response.text();
  if (!responseText) throw new Error(`Gemini ${tier} 응답 없음`);

  let jsonStr = responseText.trim();
  const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  // ★ 디버그: Gemini 원본 JSON (escapeLatexInJson 적용 전)
  const casesArea = jsonStr.match(/begin.{0,50}cases/)?.[0];
  if (casesArea) {
    if (DEBUG) console.log("🔬 [DEBUG] Gemini 원본 cases 근처:", JSON.stringify(casesArea));
    if (DEBUG) console.log("🔬 [DEBUG] 백슬래시 charCodes:", [...casesArea].map(c => c === '\\' ? '\\' : '').filter(Boolean).length, "개");
  }

  const escaped = escapeLatexInJson(jsonStr);

  // ★ 디버그: escapeLatexInJson 후
  const casesArea2 = escaped.match(/begin.{0,50}cases/)?.[0];
  if (casesArea2) {
    if (DEBUG) console.log("🔬 [DEBUG] escapeLatex 후 cases 근처:", JSON.stringify(casesArea2));
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(escaped);
  } catch {
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e2) {
      throw new Error(`${tier} JSON 파싱 실패: ${(e2 as Error).message}\n원본: ${jsonStr.slice(0, 300)}`);
    }
  }

  // ★ 디버그: Gemini 원본 bodyHtml 출력
  if (DEBUG) console.log("📋 [DEBUG] Gemini bodyHtml 원본:", JSON.stringify((parsed.bodyHtml as string) || "").slice(0, 500));

  // ★ 검증: 조건부 함수가 있는데 \begin{cases}가 누락되면 재시도
  const allHtml = ((parsed.bodyHtml as string) || "") + ((parsed.conditionHtml as string) || "");
  // 다양한 변수(x,t,n,k 등)와 부등호 패턴 감지
  const conditionRegex = /\(\s*[a-zA-Z]\s*(?:[<>≤≥]|\\leq|\\geq|\\le|\\ge|\\leqslant|\\geqslant)/;
  // 중괄호 + 조건이 한 줄로 나열된 패턴 감지
  const inlineBraceRegex = /\\?\{[^}]*\(\s*[a-zA-Z]\s*[<>≤≥][^}]*\(\s*[a-zA-Z]\s*[<>≤≥]/;
  const hasConditionPattern = conditionRegex.test(allHtml);
  const hasInlineBrace = inlineBraceRegex.test(allHtml);
  const hasCasesEnv = /\\begin\{cases\}/.test(allHtml);
  const needsCases = hasConditionPattern && !hasCasesEnv;
  const hasBrokenCases = hasInlineBrace && !hasCasesEnv;

  if (tier === "flash" && (needsCases || hasBrokenCases)) {
    console.log("⚠ Flash가 cases 환경 누락 — Pro로 자동 재시도");
    const casesWarning = "\n\n⚠️ 중요: 이 문제에는 구간별 정의 함수가 있습니다. 반드시 \\begin{cases}...\\end{cases} 환경을 사용하세요! \\{ \\}로 감싸거나 한 줄로 나열하면 안 됩니다!";
    return analyzeText(client, imageContent, userMessage + casesWarning, "pro");
  }

  if (tier === "pro" && (needsCases || hasBrokenCases)) {
    console.warn("⚠ Pro도 cases 환경 누락 — 후처리로 자동 수정 시도");
  }

  return parsed;
}

/**
 * TikZ 코드 생성 (코드블록 응답 — JSON 이스케이프 문제 없음)
 * tier: "flash" (빠름, 기본) | "pro" (정확, 재생성용)
 */
export async function generateTikz(
  client: InstanceType<typeof GoogleGenerativeAI>,
  imageContent: { inlineData: { mimeType: string; data: string } },
  tier: "flash" | "pro" = "flash"
): Promise<string | null> {
  const tikzRulesSection = SYSTEM_PROMPT.includes("## 도형 처리 (TikZ")
    ? SYSTEM_PROMPT.slice(
        SYSTEM_PROMPT.indexOf("## 도형 처리 (TikZ"),
        SYSTEM_PROMPT.indexOf("## 빈칸 상자") > 0
          ? SYSTEM_PROMPT.indexOf("## 빈칸 상자")
          : undefined
      )
    : "";

  const modelName = tier === "pro" ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: [
      "당신은 수학 문제의 도형을 TikZ 코드로 변환하는 전문가입니다.",
      "사용자가 수학 문제 이미지를 보내면, 도형/그래프 부분만 TikZ 코드로 생성합니다.",
      "",
      "응답 형식: ```latex 코드블록 안에 \\begin{tikzpicture}...\\end{tikzpicture}만 넣으세요.",
      "JSON으로 감싸지 마세요. 순수 TikZ 코드만 응답하세요.",
      "",
      tikzRulesSection,
    ].join("\n"),
  });

  const result = await model.generateContent([
    imageContent,
    { text: "이 수학 문제의 도형/그래프를 TikZ 코드로 생성해주세요. ```latex 코드블록으로 응답하세요." },
  ]);
  const text = result.response.text();
  if (!text) return null;

  const codeMatch = text.match(/```(?:latex|tikz)?\s*([\s\S]*?)```/);
  const tikzCode = codeMatch ? codeMatch[1].trim() : text.trim();
  return tikzCode.includes("\\begin{tikzpicture}") ? tikzCode : null;
}

export async function analyzeProblemImage(
  imageBase64: string,
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif",
  problemNumber?: number,
  source?: string,
  headerText?: string,
  footerText?: string,
  usePro?: boolean
): Promise<AnalysisResult> {
  const client = getClient();

  const userMessage = problemNumber
    ? `이 수학 문제를 분석해주세요. 문제 번호는 ${problemNumber}번입니다.`
    : "이 수학 문제를 분석해주세요.";

  const imageContent = {
    inlineData: { mimeType: mediaType, data: imageBase64 },
  };

  // Phase 1: 텍스트 분석 + 도형 유무 감지를 병렬 실행 (Flash는 ~0.5초)
  const textTier = usePro ? "pro" : "flash";
  console.log(`${textTier}(텍스트) + Flash(도형감지) 병렬 시작`);

  const [parsed, hasDiagramDetected] = await Promise.all([
    analyzeText(client, imageContent, userMessage, textTier),
    detectDiagram(client, imageContent),
  ]);

  // Phase 2: 도형이 있을 때만 Pro TikZ 생성 (비용 절감)
  let tikzCode: string | null = null;
  if (hasDiagramDetected) {
    console.log("도형 감지됨 → Pro TikZ 생성 시작");
    tikzCode = await generateTikz(client, imageContent, "pro");
  } else {
    console.log("도형 없음 → TikZ 생성 스킵 (Pro API 비용 절감)");
  }

  const hasDiagram = !!tikzCode;
  if (tikzCode) {
    console.log("Pro TikZ 생성 성공");
  } else {
    console.log("도형 없음 (Pro가 TikZ 미반환)");
  }

  // TikZ → PNG 렌더링 + 레이아웃 자동 판별
  let diagramPngBase64: string | undefined;
  let diagramLayout: "single" | "wide" | "multi" = "single";

  if (tikzCode) {
    // 레이아웃 자동 판별 (TikZ 코드 분석)
    if (tikzCode.includes("minipage") || tikzCode.includes("\\hfill")) {
      diagramLayout = "multi";  // 여러 도형 나란히 (R1, R2 등)
    } else if (tikzCode.includes("->") && tikzCode.includes("axis") || tikzCode.match(/\\draw.*\(-?\d+,-?\d+\).*--.*\(-?\d+,-?\d+\)/)) {
      diagramLayout = "wide";   // 좌표계/그래프
    }
    console.log(`도형 레이아웃: ${diagramLayout}`);

    try {
      console.log("TikZ 렌더링 시작:", tikzCode.slice(0, 100));
      diagramPngBase64 = await renderTikzToPng(tikzCode);
      console.log("TikZ 렌더링 성공");
    } catch (err) {
      console.error("TikZ 렌더링 실패:", err);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = parsed as any;
  const problemData: ProblemData = {
    number: problemNumber ?? p.number ?? 1,
    subject: p.subject || "수학",
    type: p.type || "주관식",
    points: p.points || 4,
    difficulty: p.difficulty || 3,
    unitName: p.unitName || undefined,
    source: source || undefined,
    headerText: headerText || undefined,
    footerText: footerText || undefined,
    bodyHtml: fixPiecewiseFunctions(fixDoubleEscapedEnvironments(fixAnswerBoxInMath(fixMathOperators(p.bodyHtml || "")))),
    questionHtml: "",
    conditionHtml: p.conditionHtml ? fixPiecewiseFunctions(fixDoubleEscapedEnvironments(fixAnswerBoxInMath(fixMathOperators(p.conditionHtml)))) : undefined,
    hasDiagram: !!hasDiagram,
    diagramPngBase64,
    diagramLayout,
    choicesHtml: p.choicesHtml || undefined,
  };

  // 최종 bodyHtml에서 cases 주변 실제 문자열 확인
  const finalBody = problemData.bodyHtml;
  const beginIdx = finalBody.indexOf("begin{cases}");
  if (beginIdx >= 0) {
    const around = finalBody.slice(Math.max(0, beginIdx - 5), beginIdx + 20);
    if (DEBUG) console.log("🔬 [DEBUG] 최종 begin{cases} 주변:", JSON.stringify(around));
    if (DEBUG) console.log("🔬 [DEBUG] begin 앞 5글자 charCodes:", [...finalBody.slice(Math.max(0, beginIdx - 5), beginIdx)].map(c => c.charCodeAt(0)));
  }

  const html = generateProblemHtml(problemData);

  return { problemData, html };
}

/**
 * Pro로 TikZ 재생성 (사용자가 "Pro로 재생성" 버튼 클릭 시)
 */
export async function regenerateTikzWithPro(
  imageBase64: string,
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
): Promise<{ tikzCode: string | null; pngBase64: string | null; diagramLayout: "single" | "wide" | "multi" }> {
  const client = getClient();
  const imageContent = {
    inlineData: { mimeType: mediaType, data: imageBase64 },
  };

  console.log("Pro TikZ 재생성 시작...");
  const tikzCode = await generateTikz(client, imageContent, "pro");

  let pngBase64: string | null = null;
  let diagramLayout: "single" | "wide" | "multi" = "single";

  if (tikzCode) {
    if (tikzCode.includes("minipage") || tikzCode.includes("\\hfill")) {
      diagramLayout = "multi";
    } else if (tikzCode.includes("->") && tikzCode.includes("axis") || tikzCode.match(/\\draw.*\(-?\d+,-?\d+\).*--.*\(-?\d+,-?\d+\)/)) {
      diagramLayout = "wide";
    }

    try {
      pngBase64 = await renderTikzToPng(tikzCode);
      console.log("Pro TikZ 재생성 성공");
    } catch (err) {
      console.error("Pro TikZ 렌더링 실패:", err);
    }
  }

  return { tikzCode, pngBase64, diagramLayout };
}

export async function analyzeMultipleProblems(
  images: Array<{
    base64: string;
    mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    number: number;
    source?: string;
  }>
): Promise<AnalysisResult[]> {
  // 청크 기반 동시성 제한 (renderTikzToPng 내부 세마포어와 조합되어 안전)
  const CONCURRENCY = Number(process.env.ANALYZE_CONCURRENCY || 4);
  const results: AnalysisResult[] = [];
  for (let i = 0; i < images.length; i += CONCURRENCY) {
    const chunk = images.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map((img) =>
        analyzeProblemImage(img.base64, img.mediaType, img.number, img.source)
      )
    );
    results.push(...chunkResults);
  }
  return results;
}

// ─── 강의노트용: 이미지에서 텍스트/수식만 추출 (메타데이터 없음) ───

const EXTRACT_TEXT_PROMPT = `당신은 수학 관련 이미지에서 텍스트와 수식을 정확하게 추출하는 전문가입니다.

## 작업
사용자가 보낸 이미지(인쇄체, 필기체, 판서 등)에서 모든 텍스트와 수식을 추출하여 HTML+LaTeX로 변환합니다.

## 응답 형식
반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트를 추가하지 마세요.

\`\`\`json
{
  "bodyHtml": "추출된 텍스트와 수식을 HTML+LaTeX로 변환한 결과"
}
\`\`\`

## 규칙
- 이미지의 모든 텍스트를 빠짐없이 추출합니다
- 한글 텍스트는 HTML로, 수식은 $...$와 $$...$$ LaTeX로 변환합니다
- 텍스트는 하나의 흐르는 문장으로 연결합니다. 이미지 폭 때문에 생긴 자연 줄넘김에 <br>을 넣지 마세요
- <br>은 문단 구분, 번호 항목((1), (2) 등) 사이, 또는 내용상 의도적인 줄바꿈에만 사용합니다
- 번호 매기기(①②③ 등)가 있으면 그대로 유지합니다
- 밑줄, 굵은 글씨 등 서식이 있으면 <u>, <b> 등으로 표현합니다
- 필기체/손글씨도 최대한 정확하게 인식합니다

## 수식 규칙 (KaTeX용)
- 인라인 수식: $수식$ (문장 속 수식)
- 블록 수식: $$수식$$ (독립된 수식)
- 분수: \\frac{a}{b}
- 적분: \\int_{a}^{b}
- 극한: \\lim_{x \\to a} (반드시 \\lim 사용! 독립된 줄의 극한 수식은 반드시 $$...$$ 블록으로 감싸세요)
- 로그: \\log (반드시 \\log 사용!)
- 삼각함수: \\sin, \\cos, \\tan (반드시 백슬래시!)
- 조건부 함수: \\begin{cases}...\\end{cases} 환경 필수!
- 조건부 함수에서 각 조건 사이에 & (정렬) + \\\\ (줄바꿈) 사용
- lim, log, sin, cos, tan 등은 반드시 \\를 붙여야 합니다!
- $...$로 감싼 수식 안에 한글을 넣지 마세요. 한글은 수식 밖에!`;

export async function extractTextFromImage(
  base64: string,
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: "gemini-3-flash-preview",
    systemInstruction: EXTRACT_TEXT_PROMPT,
  });

  const imageContent = {
    inlineData: { mimeType: mediaType, data: base64 },
  };

  const result = await model.generateContent([
    imageContent,
    { text: "이 이미지에서 모든 텍스트와 수식을 추출하여 HTML+LaTeX로 변환해주세요." },
  ]);

  const responseText = result.response.text();
  if (!responseText) throw new Error("Gemini 응답 없음");

  let jsonStr = responseText.trim();
  const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  const escaped = escapeLatexInJson(jsonStr);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(escaped);
  } catch {
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e2) {
      throw new Error(`JSON 파싱 실패: ${(e2 as Error).message}`);
    }
  }

  let bodyHtml = (parsed.bodyHtml as string) || "";
  bodyHtml = fixMathOperators(bodyHtml);
  bodyHtml = fixDoubleEscapedEnvironments(bodyHtml);
  bodyHtml = fixPiecewiseFunctions(bodyHtml);

  return bodyHtml;
}
