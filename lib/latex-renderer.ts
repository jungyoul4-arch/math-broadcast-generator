/**
 * LaTeX 렌더러 — LaTeX → PDF → 투명 PNG 변환
 * pdflatex + Ghostscript 기반
 */
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import os from "os";

const execAsync = promisify(exec);

// 환경변수 또는 OS별 기본 경로 (tikz-renderer.ts와 동일 패턴)
const LATEX_PATH = process.env.LATEX_PATH || (process.platform === "linux" ? "/usr/bin" : "/Library/TeX/texbin");
const GS_PATH = process.env.GS_PATH || (process.platform === "linux" ? "/usr/bin/gs" : "/opt/homebrew/bin/gs");
const DPI = 300;
const MAX_CONCURRENT = 4;

export interface RenderResult {
  number: number;
  pngBuffer: Buffer;
  width: number;
  height: number;
}

/**
 * LaTeX 문서를 투명 PNG로 렌더링
 */
async function renderSingle(
  latexCode: string,
  number: number
): Promise<RenderResult> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "latex-math-"));
  const texFile = path.join(tmpDir, `prob${number}.tex`);
  const pdfFile = path.join(tmpDir, `prob${number}.pdf`);
  const pngFile = path.join(tmpDir, `prob${number}.png`);

  try {
    await fs.writeFile(texFile, latexCode, "utf-8");

    // pdflatex 실행
    const latexCmd = `cd "${tmpDir}" && PATH="${LATEX_PATH}:$PATH" pdflatex -interaction=nonstopmode -halt-on-error "prob${number}.tex"`;

    try {
      await execAsync(latexCmd, { timeout: 30000 });
    } catch (err: unknown) {
      const logFile = path.join(tmpDir, `prob${number}.log`);
      let errorDetail = "";
      try {
        const log = await fs.readFile(logFile, "utf-8");
        const errorLines = log.split("\n").filter(l => l.startsWith("!") || l.includes("Error"));
        errorDetail = errorLines.slice(0, 5).join("\n");
      } catch {}
      throw new Error(`LaTeX 컴파일 실패 (문제 ${number}): ${errorDetail || (err instanceof Error ? err.message : String(err))}`);
    }

    try {
      await fs.access(pdfFile);
    } catch {
      throw new Error(`PDF 파일이 생성되지 않았습니다 (문제 ${number})`);
    }

    // Ghostscript로 PDF → 투명 PNG
    const gsCmd = `"${GS_PATH}" -dNOPAUSE -dBATCH -dSAFER -sDEVICE=pngalpha -r${DPI} -sOutputFile="${pngFile}" "${pdfFile}"`;

    try {
      await execAsync(gsCmd, { timeout: 15000 });
    } catch (err: unknown) {
      throw new Error(`PNG 변환 실패 (문제 ${number}): ${err instanceof Error ? err.message : String(err)}`);
    }

    const pngBuffer = await fs.readFile(pngFile);
    const width = pngBuffer.readUInt32BE(16);
    const height = pngBuffer.readUInt32BE(20);

    return { number, pngBuffer, width, height };
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * 여러 문제를 병렬 렌더링
 */
export async function renderMultipleLatex(
  items: Array<{
    latex: string;
    number: number;
  }>
): Promise<RenderResult[]> {
  const results: RenderResult[] = [];

  for (let i = 0; i < items.length; i += MAX_CONCURRENT) {
    const batch = items.slice(i, i + MAX_CONCURRENT);
    const batchResults = await Promise.all(
      batch.map((item) => renderSingle(item.latex, item.number))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * LaTeX 컴파일 테스트
 */
export async function testLatexCompilation(): Promise<boolean> {
  const testLatex = `\\documentclass[border=10pt]{standalone}
\\usepackage{kotex}
\\usepackage{amsmath}
\\usepackage{xcolor}
\\definecolor{chalkboard}{HTML}{1a3a2a}
\\pagecolor{chalkboard}
\\color{white}
\\begin{document}
테스트: $\\lim_{n \\to \\infty} S_n = \\frac{\\pi}{4}$
\\end{document}`;

  try {
    const result = await renderSingle(testLatex, 0);
    return result.pngBuffer.length > 0;
  } catch {
    return false;
  }
}
