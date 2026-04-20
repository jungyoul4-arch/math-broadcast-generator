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
 * 수식 블록 내부의 백슬래시를 정규화
 *
 * cases 환경 안에서는 `\\`(줄바꿈)이 의미를 갖기 때문에 외부와 다른 규칙 적용:
 *   - 외부: 영문자 앞 2개+ → 1개, 비영문자 앞 3개+ → 2개 (공격적 축약)
 *   - 내부: 4개+ → 1개, 3개+ → 2개, `\\(영문자)` → `\(영문자)` (줄바꿈 보존)
 *
 * 참고: claude.ts에서도 동일 함수를 import하여 재사용 (단일 소스).
 */
export function normalizeMathBlock(inner: string): string {
  // 1) cases 영역을 플레이스홀더로 추출 — 모든 이스케이프 수준(\begin ~ \\\\begin) 대응
  const casesBlocks: string[] = [];
  const withPlaceholder = inner.replace(
    /\\+begin\{cases\}[\s\S]*?\\+end\{cases\}/g,
    (match) => {
      casesBlocks.push(match);
      return `\x00CASES${casesBlocks.length - 1}\x00`;
    }
  );

  // 2) cases 외부: 공격적 정규화 (줄바꿈 `\\` 없음 가정)
  let outsideFixed = withPlaceholder;
  outsideFixed = outsideFixed.replace(/\\{2,}([a-zA-Z])/g, "\\$1");
  outsideFixed = outsideFixed.replace(/\\{3,}(?=[^a-zA-Z]|$)/g, "\\\\");

  // 3) cases 내부: 줄바꿈 `\\` 보존
  const casesFixed = casesBlocks.map((block) => {
    let b = block;
    // Gemini 과잉 이스케이프: 4+ 백슬래시 + 영문자 → 1개 (`\\\\frac` → `\frac`)
    b = b.replace(/\\{4,}([a-zA-Z])/g, "\\$1");
    // Gemini 과잉 이스케이프: 3+ 백슬래시 + 비영문자/끝 → 2개 (줄바꿈)
    b = b.replace(/\\{3,}(?=[^a-zA-Z]|$)/g, "\\\\");
    // 정확히 2개 + 영문자 → 1개 (double-escaped 명령어, `\\frac` → `\frac`)
    //   `\\ `(공백)/`\\\n`/`\\` 끝 등 줄바꿈 시나리오는 영문자 lookahead로 제외됨
    b = b.replace(/(?<!\\)\\\\(?=[a-zA-Z])/g, "\\");
    // JSON 왕복 손실 복원: 단독 `\` + 공백 → `\\` (cases 줄바꿈 손실 복구)
    b = b.replace(/(?<!\\)\\(?!\\)(?=\s)/g, "\\\\");
    return b;
  });

  // 4) 플레이스홀더 복원
  return outsideFixed.replace(/\x00CASES(\d+)\x00/g, (_, idx) => casesFixed[Number(idx)]);
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
        "\\$1\\limits_"
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
