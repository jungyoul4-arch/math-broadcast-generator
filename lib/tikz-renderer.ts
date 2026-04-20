/**
 * TikZ → PNG 변환기 (XeLaTeX + 나눔명조)
 * 수능 문제 도형을 방송 품질로 렌더링
 */
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs/promises";
import os from "os";

const execAsync = promisify(exec);
// 환경변수 또는 OS별 기본 경로
const LATEX_PATH = process.env.LATEX_PATH || (process.platform === "linux" ? "/usr/bin" : "/Library/TeX/texbin");
const GS_PATH = process.env.GS_PATH || (process.platform === "linux" ? "/usr/bin/gs" : "/opt/homebrew/bin/gs");

// ─── XeLaTeX 동시성 제한 (Railway 1GB 환경에서 OOM 방지) ───
// 클라이언트가 /api/analyze를 10개 병렬로 호출해도 서버에서 xelatex 프로세스를
// 4개까지만 동시 실행하도록 게이트. 대기 중인 요청은 큐에서 순차 처리.
const TIKZ_CONCURRENCY = Number(process.env.TIKZ_CONCURRENCY || 4);
let _activeTikz = 0;
const _tikzQueue: Array<() => void> = [];

async function acquireTikzSlot(): Promise<void> {
  if (_activeTikz < TIKZ_CONCURRENCY) {
    _activeTikz++;
    return;
  }
  return new Promise<void>((resolve) => {
    _tikzQueue.push(() => {
      _activeTikz++;
      resolve();
    });
  });
}

function releaseTikzSlot(): void {
  _activeTikz--;
  const next = _tikzQueue.shift();
  if (next) next();
}

/**
 * TikZ 코드를 투명 배경 PNG base64로 변환
 * XeLaTeX + 나눔명조 사용 (수능문제 프롬프트 가이드 사양)
 */
export async function renderTikzToPng(tikzCode: string): Promise<string> {
  await acquireTikzSlot();
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tikz-"));
  const texFile = path.join(tmpDir, "diagram.tex");
  const pdfFile = path.join(tmpDir, "diagram.pdf");
  const pngFile = path.join(tmpDir, "diagram.png");

  try {
    // Linux에서는 폰트 이름이 다를 수 있음 (NanumMyeongjo vs Nanum Myeongjo)
    const isLinux = process.platform === "linux";
    const fontConfig = isLinux
      ? `\\usepackage{kotex}\n\\setmainhangulfont{NanumMyeongjo}[AutoFakeBold=2.5]`
      : `\\usepackage{kotex}\n\\setmainhangulfont{Nanum Myeongjo}`;

    const texContent = `\\documentclass[border=8pt]{standalone}
${fontConfig}
\\usepackage{amsmath, amssymb}
\\usepackage{tikz}
\\usepackage{xcolor}
\\usepackage{setspace}
\\usetikzlibrary{calc, arrows.meta, patterns, decorations.markings, positioning, intersections}

% 방송용 컬러 시스템
\\definecolor{mainLine}{HTML}{4FC3F7}
\\definecolor{subLine}{HTML}{FFB74D}
\\definecolor{accentLine}{HTML}{81C784}
\\definecolor{fillA}{HTML}{29B6F6}
\\definecolor{fillB}{HTML}{FF9800}
\\definecolor{fillC}{HTML}{66BB6A}
\\definecolor{dotColor}{HTML}{EF5350}
\\definecolor{labelColor}{HTML}{FFFFFF}
\\color{white}

\\begin{document}
${tikzCode}
\\end{document}
`;

    await fs.writeFile(texFile, texContent, "utf-8");

    // XeLaTeX 실행 (한글 폰트 지원)
    const latexCmd = `cd "${tmpDir}" && PATH="${LATEX_PATH}:$PATH" xelatex -interaction=nonstopmode -halt-on-error diagram.tex`;

    try {
      await execAsync(latexCmd, { timeout: 25000 });
    } catch (err: unknown) {
      const logFile = path.join(tmpDir, "diagram.log");
      let detail = "";
      try {
        const log = await fs.readFile(logFile, "utf-8");
        const errors = log.split("\n").filter(l => l.startsWith("!")).slice(0, 5);
        detail = errors.join("\n");
      } catch {}
      throw new Error(`TikZ 컴파일 실패: ${detail || (err instanceof Error ? err.message : String(err))}`);
    }

    // PDF → 투명 PNG (300 DPI)
    const gsCmd = `"${GS_PATH}" -dNOPAUSE -dBATCH -dSAFER -sDEVICE=pngalpha -r300 -sOutputFile="${pngFile}" "${pdfFile}"`;
    await execAsync(gsCmd, { timeout: 10000 });

    const pngBuffer = await fs.readFile(pngFile);
    return pngBuffer.toString("base64");
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
    releaseTikzSlot();
  }
}
