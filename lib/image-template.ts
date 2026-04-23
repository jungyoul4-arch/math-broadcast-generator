/**
 * 강의노트 HTML 템플릿 — AI가 추출한 텍스트/수식을 다크 스타일로 렌더링
 * 문제 탭 template.ts와 동일한 스타일 + KaTeX 수식 지원
 */

export interface LectureNoteTemplateOptions {
  problemNumber: number;
  source?: string;
  showHeader?: boolean;   // 번호 배지 + "강의노트" 라벨 표시 (기본값: false)
  showBorder?: boolean;   // content-box 테두리 표시 (기본값: false)
  diagramPngBase64?: string;                    // 도형 PNG (base64)
  diagramLayout?: "single" | "wide" | "multi";  // 도형 레이아웃
}

export function generateLectureNoteHtml(
  bodyHtml: string,
  options: LectureNoteTemplateOptions
): string {
  const showHeader = options.showHeader ?? false;
  const showBorder = options.showBorder ?? false;

  const sourceBlock = options.source
    ? `<span class="source-tag">${options.source}</span>`
    : "";

  const layoutClass = options.diagramLayout === "multi" ? "diagram-multi"
    : options.diagramLayout === "wide" ? "diagram-wide" : "diagram-single";
  const diagramBlock = options.diagramPngBase64
    ? `<div class="diagram-area ${layoutClass}"><img src="data:image/png;base64,${options.diagramPngBase64}" alt="도형" class="diagram-img" /></div>`
    : "";

  // 본문이 공백/태그만 있는 경우 .content-body 자체를 생략 (Playwright boundingBox height=0 방지)
  const bodyIsEmpty = bodyHtml.replace(/<[^>]*>/g, "").trim().length === 0;
  const contentBodyBlock = bodyIsEmpty
    ? ""
    : `<div class="content-body">\n      ${bodyHtml}\n    </div>`;

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

.problem-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, #ab47bc 0%, #7b1fa2 100%);
  color: #fff;
  font-size: 22px;
  font-weight: 900;
  box-shadow: 0 4px 12px rgba(171,71,188,0.4);
}

.source-tag {
  margin-left: auto;
  font-size: 18px;
  color: rgba(255,255,255,0.85);
  font-weight: 600;
}

.tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}

.lecture-tag {
  background: rgba(171,71,188,0.2);
  color: #ce93d8;
}

.content-box {
  border: ${showBorder ? '1.5px solid rgba(171,71,188,0.4)' : 'none'};
  border-radius: 12px;
  padding: 24px 28px;
  background: transparent;
}

.content-body {
  font-size: 19px;
  font-weight: 400;
  line-height: 2;
}

.diagram-area { margin: 20px auto 16px; text-align: center; }
.diagram-single { max-width: 40%; }
.diagram-wide { max-width: 70%; }
.diagram-multi { max-width: 100%; }
.diagram-img { max-width: 100%; height: auto; }

.katex, .katex * { color: #fff !important; }
.katex .mord, .katex .mbin, .katex .mrel,
.katex .mopen, .katex .mclose, .katex .mpunct,
.katex .mop, .katex .minner { color: #fff !important; }
.katex .boxpad { border-color: rgba(255,255,255,0.5) !important; }
.katex .fbox { border-color: rgba(255,255,255,0.5) !important; }
</style>
</head>
<body>
<div class="problem-container">
  ${showHeader ? `<div class="problem-header">
    <span class="problem-number">${options.problemNumber}</span>
    <span class="tag lecture-tag">강의노트</span>
    ${sourceBlock}
  </div>` : ''}

  <div class="content-box">
    ${contentBodyBlock}
    ${diagramBlock}
  </div>
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
