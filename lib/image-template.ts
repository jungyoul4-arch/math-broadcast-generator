/**
 * 이미지 래핑 HTML 템플릿 — 강의노트 탭용
 * 원본 이미지를 다크 스타일 템플릿에 삽입하여 Playwright로 투명 PNG 렌더링
 */

export interface ImageTemplateOptions {
  problemNumber: number;
  source?: string;
}

export function generateImageHtml(
  imageBase64: string,
  mediaType: string,
  options: ImageTemplateOptions
): string {
  const sourceBlock = options.source
    ? `<span class="source-tag">${options.source}</span>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Noto Sans KR', sans-serif;
  color: #fff;
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

.image-box {
  border: 1.5px solid rgba(171,71,188,0.4);
  border-radius: 12px;
  padding: 24px 28px;
  background: transparent;
  text-align: center;
}

.image-box img {
  max-width: 100%;
  height: auto;
  filter: invert(1);
}
</style>
</head>
<body>
<div class="problem-container">
  <div class="problem-header">
    <span class="problem-number">${options.problemNumber}</span>
    <span class="tag lecture-tag">강의노트</span>
    ${sourceBlock}
  </div>

  <div class="image-box">
    <img src="data:${mediaType};base64,${imageBase64}" alt="강의노트 ${options.problemNumber}" />
  </div>
</div>
</body>
</html>`;
}
