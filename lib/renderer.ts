/**
 * Playwright 렌더러 — HTML → 투명 PNG 병렬 변환
 *
 * 성능 최적화:
 * - 싱글턴 브라우저 풀 (cold start 제거)
 * - page.setContent() 직접 주입 (파일 I/O 제거)
 * - KaTeX 렌더링 완료 감지 (고정 대기 제거)
 * - KaTeX CSS/JS 인라인 삽입 (CDN 의존 제거)
 */
import { chromium, type Browser, type BrowserContext } from "playwright";
import fs from "fs";
import path from "path";
import { normalizeLatexInHtml, renderLatexSsr } from "./normalize";

const MAX_CONCURRENT = 4;
const MAX_PAGES = 8; // 컨텍스트 내 최대 동시 페이지 수
const KATEX_TIMEOUT = 8000; // KaTeX 로딩 최대 대기
let _openPages = 0;

// ─── 페이지 세마포어 (원자적 check-and-increment + 대기 큐) ───
// check-then-increment 비원자성으로 인한 race 방지
const _pageQueue: Array<() => void> = [];

async function acquirePage(): Promise<void> {
  if (_openPages < MAX_PAGES) {
    _openPages++;
    return;
  }
  return new Promise<void>((resolve) => {
    _pageQueue.push(() => {
      _openPages++;
      resolve();
    });
  });
}

function releasePage(): void {
  _openPages--;
  const next = _pageQueue.shift();
  if (next) next();
}

// ─── KaTeX 자원 로컬 캐시 (모듈 로드 시 1회 읽기) ───
let _katexCss: string | null = null;
let _katexJs: string | null = null;
let _autoRenderJs: string | null = null;

function getKatexAssets(): { css: string; js: string; autoRender: string } {
  if (!_katexCss) {
    const katexDir = path.join(process.cwd(), "public", "katex");
    try {
      _katexCss = fs.readFileSync(path.join(katexDir, "katex.min.css"), "utf-8");
      _katexJs = fs.readFileSync(path.join(katexDir, "katex.min.js"), "utf-8");
      _autoRenderJs = fs.readFileSync(path.join(katexDir, "auto-render.min.js"), "utf-8");
      // 폰트 경로를 인라인 base64로는 변환하지 않고, 상대 경로를 file:// 절대 경로로 변환
      const fontsDir = path.join(katexDir, "fonts");
      _katexCss = _katexCss.replace(/url\(fonts\//g, `url(file://${fontsDir}/`);
      console.log("✅ KaTeX 로컬 자원 로드 완료 (CDN 미사용)");
    } catch {
      console.warn("⚠ KaTeX 로컬 자원 없음 — CDN fallback 사용");
      _katexCss = "";
      _katexJs = "";
      _autoRenderJs = "";
    }
  }
  return { css: _katexCss!, js: _katexJs!, autoRender: _autoRenderJs! };
}

/**
 * Playwright Context에 CDN 인터셉트 라우트를 등록
 * CDN 요청을 로컬 파일로 응답 → 네트워크 0, defer 실행 순서 유지
 */
let _routesRegistered = false;

async function registerLocalRoutes(context: BrowserContext): Promise<void> {
  if (_routesRegistered) return;

  const assets = getKatexAssets();
  if (!assets.css) return; // 로컬 자원 없으면 CDN 그대로 사용

  // KaTeX CSS
  await context.route("**/katex*/*.css", (route) => {
    route.fulfill({ body: assets.css, contentType: "text/css" });
  });
  // KaTeX JS
  await context.route("**/katex.min.js", (route) => {
    route.fulfill({ body: assets.js, contentType: "application/javascript" });
  });
  // auto-render JS
  await context.route("**/auto-render.min.js", (route) => {
    route.fulfill({ body: assets.autoRender, contentType: "application/javascript" });
  });
  // Google Fonts — 빈 응답 (시스템 폰트 사용)
  await context.route("**/fonts.googleapis.com/**", (route) => {
    route.fulfill({ body: "", contentType: "text/css" });
  });
  await context.route("**/fonts.gstatic.com/**", (route) => {
    route.fulfill({ body: "", contentType: "font/woff2" });
  });

  _routesRegistered = true;
  console.log("✅ CDN 인터셉트 라우트 등록 완료 (로컬 KaTeX 사용)");
}

// ─── 싱글턴 브라우저 + 컨텍스트 풀 ───
let _browser: Browser | null = null;
let _browserPromise: Promise<Browser> | null = null;
let _context: BrowserContext | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;

  // 동시 호출 시 중복 launch 방지
  if (_browserPromise) return _browserPromise;

  _browserPromise = chromium.launch().then((b) => {
    _browser = b;
    _browserPromise = null;
    _context = null; // 브라우저 재시작 시 컨텍스트도 리셋
    // 브라우저가 예기치 않게 닫히면 참조 정리
    b.on("disconnected", () => {
      _browser = null;
      _context = null;
      _routesRegistered = false;
    });
    return b;
  });

  return _browserPromise;
}

/**
 * 싱글턴 컨텍스트 — 브라우저 내 1개 컨텍스트 재사용
 * KaTeX 인라인 자원의 파싱 결과가 캐시되어 후속 렌더링이 빨라짐
 */
async function getContext(browser: Browser): Promise<BrowserContext> {
  if (_context) return _context;
  _context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 2,
  });
  // CDN 요청을 로컬 파일로 인터셉트
  await registerLocalRoutes(_context);
  return _context;
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
  await acquirePage();
  const context = await getContext(browser);
  let page;
  try {
    page = await context.newPage();
  } catch (e) {
    releasePage();
    throw e;
  }

  try {
    // SSR: 정규화 → KaTeX를 서버에서 HTML로 변환 → Playwright는 완성 HTML만 렌더링
    const ssrHtml = renderLatexSsr(normalizeLatexInHtml(html));
    await page.setContent(ssrHtml, { waitUntil: "load" });

    // SSR이 처리 못한 수식이 남아있을 경우 브라우저 KaTeX JS fallback 대기
    const hasRemainingMath = await page.evaluate(() => {
      const body = document.body.textContent || "";
      return /\$[^$]+\$/.test(body);
    });
    if (hasRemainingMath) {
      await page.waitForFunction(
        () => document.querySelectorAll(".katex").length > 0,
        { timeout: KATEX_TIMEOUT }
      ).catch(() => {});
    }

    // 폰트 로딩 보장 (KaTeX 웹폰트는 로컬이므로 짧게)
    await page.waitForTimeout(100);

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
    releasePage();
    await page.close().catch(() => {});
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
  await acquirePage();
  const browser = await getBrowser();
  const context = await getContext(browser);
  let page;
  try {
    page = await context.newPage();
  } catch (e) {
    releasePage();
    throw e;
  }

  try {
    // SSR: 정규화 → KaTeX를 서버에서 HTML로 변환
    const ssrHtml = renderLatexSsr(normalizeLatexInHtml(html));
    await page.setContent(ssrHtml, { waitUntil: "load" });

    const hasRemainingMath = await page.evaluate(() => {
      const body = document.body.textContent || "";
      return /\$[^$]+\$/.test(body);
    });
    if (hasRemainingMath) {
      await page.waitForFunction(
        () => document.querySelectorAll(".katex").length > 0,
        { timeout: KATEX_TIMEOUT }
      ).catch(() => {});
    }

    await page.waitForTimeout(100);

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
    releasePage();
    await page.close().catch(() => {});
  }
}
