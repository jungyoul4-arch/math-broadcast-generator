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
  "bodyHtml": "HTML+LaTeX 본문 (구하고자 하는 것 포함, 문제 전체)",
  "questionHtml": null,
  "conditionHtml": null,
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
- 조건부: \\begin{cases} ... \\end{cases}
- 정렬: \\begin{aligned} ... \\end{aligned}
- 화살표: \\to (-> 사용 금지!)

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

1. 도형 외곽선/테두리: \\draw[mainLine, thick]  → 밝은 하늘색 (#4FC3F7)
2. 색칠/빗금 영역: \\fill[fillB, opacity=0.4]  → 주황색 (#FF9800) 또는 \\fill[fillC, opacity=0.4] → 초록색
3. 보조 선: \\draw[subLine, thick] → 주황색
4. 점/교점: \\filldraw[dotColor] (P) circle (2pt); → 빨간색
5. 라벨: text=labelColor → 흰색
6. 직각 표시: \\draw[white!70]

절대 금지:
- 테두리와 색칠을 같은 색으로 하지 마세요!
- cyan, blue 등 직접 색 이름 사용 금지! 반드시 mainLine, fillB 등 정의된 컬러만 사용!
- \\draw에 fillA 사용 금지! (fillA는 테두리와 비슷한 파란색이라 구분 안 됨)
- 색칠은 반드시 fillB(주황) 또는 fillC(초록) 사용!

#### 그래프 전용 규칙
- 축: \\draw[white!50, ->] (x축, y축 — 반투명 흰색 화살표)
- 함수 그래프 1: \\draw[mainLine, thick, smooth] (하늘색)
- 함수 그래프 2: \\draw[subLine, thick, smooth] (주황색)
- 함수 그래프 3: \\draw[accentLine, thick, smooth] (연두색)
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
  \\draw[white, thick] (A) -- (B) -- (C) -- cycle;
  \\draw[white, thick] (B) -- (D);
  \\draw[white, thick] (A) -- (E);
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
<span class="answer-box">①</span>
<span class="answer-box">&nbsp;&nbsp;&nbsp;</span>

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

## 중요
- 수식 하나라도 틀리면 방송 사고입니다
- 빈칸 상자는 반드시 answer-box로 변환
- 수식 $...$ 안에 한글을 넣지 마세요
- questionHtml은 반드시 null로! 구하고자 하는 것은 bodyHtml에 포함시키세요. 중복 표시 금지!
- bodyHtml에 문제 전체(본문 + 구하고자 하는 것)를 모두 넣으세요
- 줄바꿈 가독성: 의미 단위로 자연스럽게 줄바꿈하세요. 단어 중간에서 끊기지 않도록 <br> 태그를 적절히 사용하세요.
  예시: "0 < ∠CAB < π/6인 호 AB 위의 점 C에 대하여" 를 한 줄로 유지`;

/**
 * 수식 내 함수명 자동 교정
 */
function fixMathOperators(html: string): string {
  const operators = [
    "lim", "log", "sin", "cos", "tan", "max", "min", "sup", "inf",
    "ln", "exp", "sec", "csc", "cot", "arcsin", "arccos", "arctan"
  ];

  let result = html.replace(/\$\$[\s\S]*?\$\$|\$[^$]+?\$/g, (match) => {
    let fixed = match;
    for (const op of operators) {
      const regex = new RegExp(`(?<!\\\\)(?<![a-zA-Z])${op}(?![a-zA-Z])`, "g");
      fixed = fixed.replace(regex, `\\${op}`);
    }
    fixed = fixed.replace(/->/g, "\\to");
    for (const op of operators) {
      fixed = fixed.replace(new RegExp(`\\\\\\\\${op}`, "g"), `\\${op}`);
    }
    return fixed;
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
 * Flash로 텍스트 분석 (도형 TikZ 제외)
 */
async function analyzeText(
  client: InstanceType<typeof GoogleGenerativeAI>,
  imageContent: { inlineData: { mimeType: string; data: string } },
  userMessage: string
): Promise<Record<string, unknown>> {
  const model = client.getGenerativeModel({
    model: "gemini-3-flash-preview",
    systemInstruction: SYSTEM_PROMPT,
  });
  const result = await model.generateContent([imageContent, { text: userMessage }]);
  const responseText = result.response.text();
  if (!responseText) throw new Error("Gemini Flash 응답 없음");

  let jsonStr = responseText.trim();
  const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    // LaTeX 백슬래시 수리: \sin, \frac, \pi 등 2글자 이상 명령어 → \\sin 등
    // \n, \t, \b 같은 1글자 JSON 이스케이프는 건드리지 않음
    // 이미 이스케이프된 \\ 도 건드리지 않음
    const fixed = jsonStr.replace(
      /\\\\|\\([a-zA-Z]{2,})/g,
      (match, letters) => letters ? "\\\\" + letters : match
    );
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      throw new Error(`Flash JSON 파싱 실패: ${(e2 as Error).message}\n원본: ${jsonStr.slice(0, 300)}`);
    }
  }
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

  // Step 0: 도형 유무 빠른 판별 (0.5~1초)
  const hasDiagram = await detectDiagram(client, imageContent);
  console.log(`도형 판별: ${hasDiagram ? "있음 → Flash(텍스트) + Pro(TikZ) 병렬" : "없음 → Flash만"}`);

  let parsed: Record<string, unknown>;
  let tikzCode: string | null = null;

  if (hasDiagram) {
    const tikzTier = usePro ? "pro" : "flash";
    console.log(`도형 → ${tikzTier.toUpperCase()} TikZ 생성`);

    const [textResult, tikzResult] = await Promise.all([
      analyzeText(client, imageContent, userMessage),
      generateTikz(client, imageContent, tikzTier),
    ]);
    parsed = textResult;
    parsed.hasDiagram = true;
    tikzCode = tikzResult;
    if (tikzCode) {
      console.log(`${tikzTier.toUpperCase()} TikZ 생성 성공`);
    } else {
      console.warn(`${tikzTier.toUpperCase()} TikZ 생성 실패`);
    }
  } else {
    // 도형 없음 → Flash만
    parsed = await analyzeText(client, imageContent, userMessage);
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
    bodyHtml: fixMathOperators(p.bodyHtml || ""),
    questionHtml: "",
    conditionHtml: p.conditionHtml ? fixMathOperators(p.conditionHtml) : undefined,
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
