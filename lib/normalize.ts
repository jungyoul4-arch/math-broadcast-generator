/**
 * LaTeX 백슬래시 정규화 — KaTeX 표준으로 통일
 *
 * KaTeX 표준:
 *   \command  = 백슬래시 1개 + 명령어 (예: \begin, \geq, \frac)
 *   \\        = 백슬래시 2개 (줄바꿈, cases 환경 등)
 *
 * Gemini/JSON 왕복 과정에서 백슬래시 수가 변동되는 문제를 해결합니다.
 */

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
