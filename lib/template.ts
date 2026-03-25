/**
 * HTML 템플릿 생성기 — 다크 칠판 스타일 + KaTeX
 * 도형은 TikZ PNG로 삽입 (하이브리드)
 */

export interface ProblemData {
  number: number;
  subject: string;
  type: string;
  points: number;
  difficulty: number;
  unitName?: string;
  source?: string;
  headerText?: string;  // 머릿말 (예: "OO쌤의 적중문항")
  footerText?: string;  // 꼬릿말 (예: "문제분석을 해보세요")
  bodyHtml: string;
  questionHtml: string;
  conditionHtml?: string;
  hasDiagram?: boolean;
  diagramPngBase64?: string;
  diagramLayout?: "single" | "wide" | "multi";
  choicesHtml?: string;
}

export function generateProblemHtml(problem: ProblemData): string {
  const diff = Math.max(1, Math.min(5, problem.difficulty || 3));
  const stars = '★'.repeat(diff) + '☆'.repeat(5 - diff);

  const sourceBlock = problem.source
    ? `<span class="source-tag">${problem.source}</span>`
    : '';

  const headerBlock = problem.headerText
    ? `<div class="header-banner">${problem.headerText}</div>`
    : '';

  const footerBlock = problem.footerText
    ? `<div class="footer-banner">${problem.footerText}</div>`
    : '';

  const conditionBlock = problem.conditionHtml
    ? `<span class="condition">${problem.conditionHtml}</span>`
    : '';

  // 도형 레이아웃에 따른 CSS 클래스
  const layoutClass = problem.diagramLayout === "multi" ? "diagram-multi"
    : problem.diagramLayout === "wide" ? "diagram-wide"
    : "diagram-single";

  const diagramBlock = problem.diagramPngBase64
    ? `<div class="diagram-area ${layoutClass}">
        <img src="data:image/png;base64,${problem.diagramPngBase64}" alt="도형" class="diagram-img" />
      </div>`
    : '';

  // 객관식 보기는 생략 (방송에서는 보기 없이 문제만 표시)
  const choicesBlock = '';

  const unitTag = problem.unitName
    ? `<span class="tag unit-tag">${problem.unitName}</span>`
    : '';

  const subjectTag = `<span class="tag subject-tag">${problem.subject}</span>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Noto Sans KR', sans-serif;
  color: #fff;
  line-height: 1.85;
  -webkit-font-smoothing: antialiased;
}

.problem-container {
  padding: 32px 40px;
  max-width: 720px;
  position: relative;
}

.problem-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.source-tag {
  margin-left: auto;
  font-size: 18px;
  color: rgba(255,255,255,0.85);
  font-weight: 600;
}
.problem-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #f9a825 0%, #e65100 100%);
  color: #fff;
  font-size: 22px;
  font-weight: 900;
  box-shadow: 0 4px 12px rgba(249,168,37,0.4);
}
.stars {
  color: #ffd700;
  font-size: 14px;
  letter-spacing: 1px;
}
.tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}
.subject-tag {
  background: rgba(100,181,246,0.2);
  color: #90caf9;
}
.unit-tag {
  background: rgba(129,199,132,0.2);
  color: #a5d6a7;
}

.problem-box {
  border: none;
  border-radius: 12px;
  padding: 24px 28px;
  margin-bottom: 16px;
  background: transparent;
}

.problem-body {
  font-size: 19px;
  font-weight: 400;
  line-height: 2;
}

.condition {
  display: block;
  margin-top: 6px;
  font-size: 15px;
  color: rgba(255,255,255,0.65);
}

.diagram-area {
  margin: 20px auto 16px;
  text-align: center;
}
.diagram-single {
  max-width: 55%;
}
.diagram-wide {
  max-width: 75%;
}
.diagram-multi {
  max-width: 90%;
}
.diagram-img {
  max-width: 100%;
  height: auto;
}

.choices-area {
  margin-top: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
}
.choice-item {
  font-size: 17px;
  min-width: 120px;
}

.answer-box {
  display: inline-block;
  border: none;
  border-radius: 4px;
  padding: 2px 12px;
  margin: 0 4px;
  min-width: 40px;
  text-align: center;
  font-weight: 600;
  background: rgba(255,255,255,0.08);
}

.solution-box {
  border: none;
  border-radius: 8px;
  padding: 16px 20px;
  margin: 12px 0;
  background: rgba(255,255,255,0.03);
}

.question-line {
  font-size: 19px;
  font-weight: 700;
}

.header-banner {
  padding: 14px 24px;
  margin-bottom: 20px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(249,168,37,0.12), rgba(255,143,0,0.08));
  border: 1.5px solid rgba(249,168,37,0.3);
  font-size: 20px;
  font-weight: 700;
  color: rgba(255,213,79,0.95);
  letter-spacing: 0.3px;
}

.footer-banner {
  padding: 14px 24px;
  margin-top: 20px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(100,181,246,0.1), rgba(66,165,245,0.06));
  border: 1.5px solid rgba(100,181,246,0.25);
  font-size: 19px;
  font-weight: 600;
  color: rgba(144,202,249,0.9);
}

.katex, .katex * { color: #fff !important; }
.katex .mord, .katex .mbin, .katex .mrel,
.katex .mopen, .katex .mclose, .katex .mpunct,
.katex .mop, .katex .minner { color: #fff !important; }
</style>
</head>
<body>
<div class="problem-container">
  ${headerBlock}

  <div class="problem-header">
    <span class="problem-number">${problem.number}</span>
    <span class="stars">${stars}</span>
    ${subjectTag}
    ${unitTag}
    ${sourceBlock}
  </div>

  <div class="problem-box">
    <div class="problem-body">
      ${problem.bodyHtml}
      ${conditionBlock}
    </div>
    ${diagramBlock}
    ${choicesBlock}
  </div>

  ${footerBlock}
</div>

<script>
document.addEventListener("DOMContentLoaded", function() {
  if (typeof renderMathInElement !== 'undefined') {
    renderMathInElement(document.body, {
      delimiters: [
        {left: "$$", right: "$$", display: true},
        {left: "$", right: "$", display: false},
        {left: "\\\\[", right: "\\\\]", display: true},
        {left: "\\\\(", right: "\\\\)", display: false}
      ],
      throwOnError: false
    });
  }
});
</script>
</body>
</html>`;
}
