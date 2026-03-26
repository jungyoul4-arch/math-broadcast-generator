/**
 * Gemini API 연동 — 수학 문제 이미지 분석 + HTML/TikZ 생성
 * gemini-3.1-pro 사용
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { generateProblemHtml, type ProblemData } from "./template";
import { renderTikzToPng } from "./tikz-renderer";

function getClient() {
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
  return new GoogleGenerativeAI(key);
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
- 극한: \\lim_{x \\to a} (반드시 \\lim 사용!)
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

## 조건부 함수 (절대 규칙!)
조건부 정의(f(x)={...})는 반드시 \\begin{cases} 환경을 사용하세요.
한 줄로 나열하면 안 됩니다! 반드시 줄바꿈(\\\\)으로 구분하세요.
예시:
$$g(x) = \\begin{cases} \\frac{1}{2}px^2 + \\frac{1}{2}qx + 5 & (x < 0) \\\\ 5 & (x \\geq 0) \\end{cases}$$

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

  const allOps = [...operators, ...symbols];

  let result = html.replace(/\$\$[\s\S]*?\$\$|\$[^$]+?\$/g, (match) => {
    let fixed = match;
    for (const op of allOps) {
      const regex = new RegExp(`(?<!\\\\)(?<![a-zA-Z])${op}(?![a-zA-Z])`, "g");
      fixed = fixed.replace(regex, `\\${op}`);
    }
    fixed = fixed.replace(/->/g, "\\to");
    // 이중 백슬래시 수리 (\\\\op → \\op)
    for (const op of allOps) {
      fixed = fixed.replace(new RegExp(`\\\\\\\\${op}`, "g"), `\\${op}`);
    }
    return fixed;
  });

  return result;
}

/**
 * LaTeX 환경(\begin, \end)의 이중 이스케이프 수리
 * Gemini가 이스케이프 수준을 일관되지 않게 보내면
 * JSON 파싱 후 \\begin{cases} (이중 백슬래시)가 남아 KaTeX 실패
 */
function fixDoubleEscapedEnvironments(html: string): string {
  return html
    // 수식 안의 이중 이스케이프 수리: \\begin{ → \begin{, \\end{ → \end{
    .replace(/\\\\begin\{/g, "\\begin{")
    .replace(/\\\\end\{/g, "\\end{")
    // 삼중/사중 이스케이프도 정규화
    .replace(/\\\\\\\\begin\{/g, "\\begin{")
    .replace(/\\\\\\\\end\{/g, "\\end{");
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
async function detectDiagram(
  client: InstanceType<typeof GoogleGenerativeAI>,
  imageContent: { inlineData: { mimeType: string; data: string } }
): Promise<boolean> {
  const model = client.getGenerativeModel({
    model: "gemini-3-flash-preview",
    systemInstruction: [
      "당신은 수학 문제 이미지에서 도형/그래프/그림이 **실제로 눈에 보이는지** 판단하는 전문가입니다.",
      "",
      "## 판단 기준",
      "true를 반환하는 경우 (이미지에 시각적 요소가 실제로 존재):",
      "- 좌표평면, 그래프, 함수 곡선이 그려져 있는 경우",
      "- 삼각형, 원, 사각형 등 기하학적 도형이 그려져 있는 경우",
      "- 벤다이어그램, 수직선, 표 등 시각적 다이어그램이 있는 경우",
      "- 그림, 도식, 좌표점 등이 이미지에 포함된 경우",
      "",
      "false를 반환하는 경우 (텍스트와 수식만 존재):",
      "- 수식, 함수식, 방정식만 텍스트로 적혀있는 경우",
      "- 문제에서 그래프나 도형을 '언급'하지만 실제로 그리지 않은 경우",
      "- 함수 f(x)를 정의하고 접선, 넓이 등을 구하라는 문제이지만 그래프는 안 그려진 경우",
      "- 보기 번호(①②③④⑤)만 있고 시각적 도형이 없는 경우",
      "",
      "## 핵심 원칙",
      "- 문제가 그래프를 '필요로 할 수 있다'는 것과 이미지에 그래프가 '실제로 있다'는 것은 다릅니다.",
      "- 반드시 이미지에 **눈으로 볼 수 있는** 도형/그래프/그림이 있을 때만 true입니다.",
      "- 수식만 있는 문제는 아무리 복잡해도 false입니다.",
      "",
      "반드시 true 또는 false만 응답하세요.",
    ].join("\n"),
  });
  const result = await model.generateContent([
    imageContent,
    { text: "이 수학 문제 이미지에 도형, 그래프, 또는 그림이 **실제로 눈에 보이게 그려져** 있습니까? 수식만 있고 시각적 도형이 없으면 false입니다. true/false만 답하세요." },
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

  const escaped = escapeLatexInJson(jsonStr);

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

  // ★ 검증: 조건부 함수가 있는데 \begin{cases}가 누락되면 Pro로 재시도
  if (tier === "flash") {
    const bodyHtml = (parsed.bodyHtml as string) || "";
    const hasConditionPattern = /\(x\s*[<>≤≥\\leq\\geq\\le\\ge]/.test(bodyHtml);
    const hasCasesEnv = /\\begin\{cases\}/.test(bodyHtml);

    if (hasConditionPattern && !hasCasesEnv) {
      console.log("⚠ Flash가 cases 환경 누락 — Pro로 자동 재시도");
      return analyzeText(client, imageContent, userMessage, "pro");
    }
  }

  return parsed;
}

/**
 * TikZ 코드 생성 (코드블록 응답 — JSON 이스케이프 문제 없음)
 * tier: "flash" (빠름, 기본) | "pro" (정확, 재생성용)
 */
async function generateTikz(
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
      "사용자가 수학 문제 이미지를 보내면, 이미지에 **실제로 그려져 있는** 도형/그래프 부분만 TikZ 코드로 생성합니다.",
      "",
      "## 절대 금지 사항",
      "- 이미지에 도형/그래프/그림이 **실제로 보이지 않으면** 절대로 TikZ 코드를 생성하지 마세요.",
      "- 수식만 있는 문제에 대해 '이해를 돕기 위해' 또는 '시각화를 위해' 그래프를 임의로 생성하지 마세요.",
      "- 문제가 함수, 접선, 넓이를 언급하더라도 이미지에 그래프가 그려져 있지 않으면 생성하지 마세요.",
      "- 원본 이미지에 없는 도형을 추가하는 것은 금지입니다.",
      "",
      "## 도형이 없는 경우의 응답",
      "이미지에 시각적 도형/그래프가 없으면 '도형 없음'이라고만 응답하세요.",
      "",
      "## 도형이 있는 경우의 응답",
      "응답 형식: ```latex 코드블록 안에 \\begin{tikzpicture}...\\end{tikzpicture}만 넣으세요.",
      "JSON으로 감싸지 마세요. 순수 TikZ 코드만 응답하세요.",
      "",
      tikzRulesSection,
    ].join("\n"),
  });

  const result = await model.generateContent([
    imageContent,
    { text: "이 수학 문제 이미지에 **실제로 그려진** 도형/그래프가 있다면 TikZ 코드로 생성해주세요. 수식만 있고 도형이 없으면 '도형 없음'이라고만 답하세요. ```latex 코드블록으로 응답하세요." },
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

  // Step 0: Flash로 도형 유무 빠르게 판별 (게이트)
  // Step 1: 텍스트 분석 + (도형 있을 때만) TikZ 생성
  const textTier = usePro ? "pro" : "flash";

  // 도형 감지와 텍스트 분석을 병렬로 시작
  const [diagramDetected, parsed] = await Promise.all([
    detectDiagram(client, imageContent),
    analyzeText(client, imageContent, userMessage, textTier),
  ]);
  console.log(`도형 감지: ${diagramDetected}, 텍스트(${textTier}) 완료`);

  // 도형이 감지된 경우에만 TikZ 생성
  let tikzCode: string | null = null;
  if (diagramDetected) {
    console.log("도형 감지됨 → Pro TikZ 생성 시작");
    tikzCode = await generateTikz(client, imageContent, "pro");
  }

  const hasDiagram = !!tikzCode;
  if (tikzCode) {
    console.log("Pro TikZ 생성 성공");
  } else if (diagramDetected) {
    console.log("도형 감지되었으나 TikZ 생성 실패 (Pro가 TikZ 미반환)");
  } else {
    console.log("도형 없음 (Flash 감지: false → TikZ 생성 건너뜀)");
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
    bodyHtml: fixDoubleEscapedEnvironments(fixAnswerBoxInMath(fixMathOperators(p.bodyHtml || ""))),
    questionHtml: "",
    conditionHtml: p.conditionHtml ? fixDoubleEscapedEnvironments(fixAnswerBoxInMath(fixMathOperators(p.conditionHtml))) : undefined,
    hasDiagram: !!hasDiagram,
    diagramPngBase64,
    diagramLayout,
    choicesHtml: p.choicesHtml || undefined,
  };

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
  return Promise.all(
    images.map((img) => analyzeProblemImage(img.base64, img.mediaType, img.number, img.source))
  );
}
