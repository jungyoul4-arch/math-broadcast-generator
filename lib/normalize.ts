/**
 * LaTeX 백슬래시 정규화 + KaTeX SSR
 *
 * KaTeX 표준:
 *   \command  = 백슬래시 1개 + 명령어 (예: \begin, \geq, \frac)
 *   \\        = 백슬래시 2개 (줄바꿈, cases 환경 등)
 *
 * Gemini/JSON 왕복 과정에서 백슬래시 수가 변동되는 문제를 해결합니다.
 * SSR: Node.js에서 katex.renderToString()으로 수식을 미리 HTML로 변환합니다.
 */
import katex from "katex";

const DEBUG = process.env.MBG_DEBUG === "true";

/**
 * $$ 블록 수식 내부의 백슬래시를 정규화
 */
function normalizeMathBlock(inner: string): string {
  let fixed = inner;
  // Step 1: 2개 이상 연속 백슬래시 + 영문자 → 1개 + 영문자 (명령어 정규화)
  fixed = fixed.replace(/\\{2,}([a-zA-Z])/g, "\\$1");
  // Step 2: 3개 이상 연속 백슬래시 + 비영문자/끝 → 2개 (줄바꿈 정규화)
  fixed = fixed.replace(/\\{3,}(?=[^a-zA-Z]|$)/g, "\\\\");
  // Step 3: cases 환경 안에서 손실된 줄바꿈 복원
  // 단독 \ + 공백(줄바꿈이 1개로 줄어든 경우) → \\ (2개로 복원)
  // (?<!\\) lookbehind로 이미 올바른 \\의 두 번째 \는 건너뜀
  if (fixed.includes("begin{cases}")) {
    fixed = fixed.replace(/(?<!\\)\\(?!\\)(?=\s)/g, "\\\\");
  }
  return fixed;
}

/**
 * HTML 내 모든 $$ 블록 수식을 정규화
 */
export function normalizeLatexInHtml(html: string): string {
  return html.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner: string) => {
    return `$$${normalizeMathBlock(inner)}$$`;
  });
}

/**
 * 단일 수식을 KaTeX SSR로 변환 — 실패 시 원본 반환 (fallback 보장)
 */
function renderOne(latex: string, displayMode: boolean): string {
  try {
    // cases/aligned 등 환경은 inline이라도 display mode로 렌더링 (줄바꿈 필수)
    const needsDisplay = displayMode
      || /\\begin\{(cases|aligned|array|pmatrix|bmatrix|vmatrix)\}/.test(latex);
    // inline 대형 연산자(lim, sum, prod, bigcap, bigcup)에 아래/위첨자가 있으면
    // \displaystyle을 국소 주입하여 첨자를 위/아래로 배치 (블록 가운데정렬 없음)
    let processedLatex = latex;
    if (!needsDisplay) {
      processedLatex = processedLatex.replace(
        /\\(lim|sum|prod|bigcap|bigcup)\s*_/g,
        "\\displaystyle\\$1_"
      );
    }
    return katex.renderToString(processedLatex, {
      displayMode: needsDisplay,
      throwOnError: false,
      errorColor: DEBUG ? "#ff0000" : "#ff6b6b",
    });
  } catch (e) {
    if (DEBUG) {
      console.warn("⚠ [KaTeX SSR] 변환 실패:", latex.substring(0, 80), e instanceof Error ? e.message : "");
    }
    // SSR 실패 → 원본 유지, 브라우저 KaTeX JS가 처리
    return displayMode ? `$$${latex}$$` : `$${latex}$`;
  }
}

/**
 * HTML 내 모든 $...$, $$...$$ 수식을 서버사이드 KaTeX HTML로 변환
 * - 정규화(normalizeLatexInHtml) 적용 후 호출할 것
 * - 변환 실패한 수식은 원본 그대로 남아 브라우저 KaTeX가 fallback 처리
 */
export function renderLatexSsr(html: string): string {
  // 1) display math: $$...$$
  let result = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner: string) => {
    return renderOne(inner.trim(), true);
  });
  // 2) inline math: $...$ ($$는 이미 처리되었으므로 안전)
  result = result.replace(/\$([^$\n]+?)\$/g, (_, inner: string) => {
    return renderOne(inner.trim(), false);
  });
  return result;
}
