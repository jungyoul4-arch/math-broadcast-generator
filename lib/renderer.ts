/**
 * Playwright 렌더러 — HTML → 투명 PNG 병렬 변환
 *
 * 성능 최적화:
 * - 싱글턴 브라우저 풀 (cold start 제거)
 * - page.setContent() 직접 주입 (파일 I/O 제거)
 * - KaTeX 렌더링 완료 감지 (고정 대기 제거)
 */
import { chromium, type Browser, type BrowserContext } from "playwright";

const MAX_CONCURRENT = 4;
const KATEX_TIMEOUT = 8000; // KaTeX 로딩 최대 대기

// ─── 싱글턴 브라우저 풀 ───
let _browser: Browser | null = null;
let _browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;

  // 동시 호출 시 중복 launch 방지
  if (_browserPromise) return _browserPromise;

  _browserPromise = chromium.launch().then((b) => {
    _browser = b;
    _browserPromise = null;
    // 브라우저가 예기치 않게 닫히면 참조 정리
    b.on("disconnected", () => {
      _browser = null;
    });
    return b;
  });

  return _browserPromise;
}

export interface RenderResult {
  number: number;
  pngBuffer: Buffer;
  width: number;
  height: number;
}

/**
 * 단일 HTML을 투명 PNG로 렌더링
 * - setContent()로 직접 주입 (파일 I/O 없음)
 * - KaTeX 렌더링 완료 감지 (고정 5초 대기 제거)
 */
async function renderSingle(
  browser: Browser,
  html: string,
  number: number
): Promise<RenderResult> {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  try {
    // ★ 최종 정규화: JSON 왕복 과정에서 백슬래시가 손실/증가되는 문제를 렌더링 직전에 수리
    // KaTeX 표준: \command (1개), \\ 줄바꿈 (2개). 그 외 수준은 전부 정규화.
    const normalizedHtml = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner: string) => {
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
      return `$$${fixed}$$`;
    });

    // ★ 디버그: 정규화 후 최종 $$ 블록 charCodes 확인
    const dollarBlock = normalizedHtml.match(/\$\$([\s\S]*?)\$\$/);
    if (dollarBlock) {
      const block = dollarBlock[0];
      console.log("🎭 [RENDERER] 정규화 후 $$ 블록:", JSON.stringify(block));
      // 줄바꿈(\\) 주변 charCodes 확인
      const idx3x = block.indexOf("3x");
      if (idx3x >= 0) {
        const before3x = block.slice(Math.max(0, idx3x - 5), idx3x);
        console.log("🎭 [RENDERER] 3x 앞 charCodes:", [...before3x].map(c => c.charCodeAt(0)));
      }
    }

    // setContent으로 직접 주입 — 파일 I/O 완전 제거
    await page.setContent(normalizedHtml, { waitUntil: "networkidle" });

    // KaTeX 렌더링 완료를 동적으로 감지 (고정 5초 대기 제거)
    await page.waitForFunction(
      () => {
        const katexElements = document.querySelectorAll(".katex");
        const mathElements = document.querySelectorAll('[data-math-style]');
        // KaTeX가 있으면 렌더 완료 확인, 없으면 바로 통과
        if (katexElements.length > 0 || mathElements.length > 0) return true;
        // auto-render가 아직 실행 안 됐을 수 있으므로 $ 수식이 있는지 확인
        const body = document.body.textContent || "";
        const hasDollarMath = /\$[^$]+\$/.test(body);
        if (!hasDollarMath) return true; // 수식 없으면 바로 통과
        return false; // 수식 있는데 아직 렌더 안 됨 — 대기
      },
      { timeout: KATEX_TIMEOUT }
    ).catch(() => {
      // 타임아웃이어도 진행 (fallback)
    });

    // 폰트 로딩 보장 (짧은 안전 마진)
    await page.waitForTimeout(300);

    const container = await page.$(".problem-container");
    if (!container) {
      throw new Error(`문제 ${number}: .problem-container를 찾을 수 없습니다`);
    }

    const box = await container.boundingBox();
    const pngBuffer = (await container.screenshot({
      omitBackground: true,
    })) as Buffer;

    return {
      number,
      pngBuffer,
      width: box ? Math.round(box.width * 2) : 2400,
      height: box ? Math.round(box.height * 2) : 1600,
    };
  } finally {
    await context.close();
  }
}

/**
 * 여러 HTML을 병렬로 투명 PNG 렌더링
 * 싱글턴 브라우저 재사용 — launch 오버헤드 0
 */
export async function renderMultiple(
  items: Array<{ html: string; number: number }>
): Promise<RenderResult[]> {
  const browser = await getBrowser();
  const results: RenderResult[] = [];

  for (let i = 0; i < items.length; i += MAX_CONCURRENT) {
    const chunk = items.slice(i, i + MAX_CONCURRENT);
    const chunkResults = await Promise.all(
      chunk.map((item) => renderSingle(browser, item.html, item.number))
    );
    results.push(...chunkResults);
  }

  return results.sort((a, b) => a.number - b.number);
}

/**
 * 스트리밍 렌더링 — 완료되는 대로 콜백 호출
 */
export async function renderMultipleStreaming(
  items: Array<{ html: string; number: number }>,
  onResult: (result: RenderResult) => void
): Promise<void> {
  const browser = await getBrowser();

  for (let i = 0; i < items.length; i += MAX_CONCURRENT) {
    const chunk = items.slice(i, i + MAX_CONCURRENT);
    const chunkResults = await Promise.all(
      chunk.map((item) => renderSingle(browser, item.html, item.number))
    );
    for (const result of chunkResults) {
      onResult(result);
    }
  }
}

/**
 * 단일 HTML 렌더링 (미리보기용 — 초록 배경)
 * 싱글턴 브라우저 재사용
 */
export async function renderPreview(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  try {
    // 최종 정규화 (renderSingle과 동일)
    const normalizedHtml = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner: string) => {
      let fixed = inner;
      fixed = fixed.replace(/\\{2,}([a-zA-Z])/g, "\\$1");
      fixed = fixed.replace(/\\{3,}(?=[^a-zA-Z]|$)/g, "\\\\");
      if (fixed.includes("begin{cases}")) {
        fixed = fixed.replace(/(?<!\\)\\(?!\\)(?=\s)/g, "\\\\");
      }
      return `$$${fixed}$$`;
    });
    await page.setContent(normalizedHtml, { waitUntil: "networkidle" });

    await page.waitForFunction(
      () => {
        const katex = document.querySelectorAll(".katex");
        if (katex.length > 0) return true;
        const body = document.body.textContent || "";
        return !/\$[^$]+\$/.test(body);
      },
      { timeout: KATEX_TIMEOUT }
    ).catch(() => {});

    await page.waitForTimeout(300);

    await page.evaluate(() => {
      document.body.style.background = "#0d3b2e";
    });

    const container = await page.$(".problem-container");
    if (!container) throw new Error(".problem-container를 찾을 수 없습니다");

    const pngBuffer = (await container.screenshot({
      omitBackground: false,
    })) as Buffer;

    return pngBuffer;
  } finally {
    await context.close();
  }
}
