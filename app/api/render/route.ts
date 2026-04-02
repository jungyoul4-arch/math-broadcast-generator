import { NextRequest } from "next/server";
import { renderMultipleStreaming } from "@/lib/renderer";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const items: Array<{ html: string; number: number }> = body.items;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "렌더링할 항목이 없습니다" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const MAX_ITEMS = 50;
    const MAX_HTML_SIZE = 100_000; // 100KB per item
    if (items.length > MAX_ITEMS) {
      return new Response(
        JSON.stringify({ error: `최대 ${MAX_ITEMS}개까지 렌더링 가능합니다` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    for (const item of items) {
      if (typeof item.html !== "string" || typeof item.number !== "number") {
        return new Response(
          JSON.stringify({ error: "잘못된 항목 형식입니다 (html: string, number: number 필수)" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      if (item.html.length > MAX_HTML_SIZE) {
        return new Response(
          JSON.stringify({ error: `문제 ${item.number}: HTML이 너무 큽니다 (${MAX_HTML_SIZE} bytes 초과)` }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      if (!item.html.includes("problem-container")) {
        return new Response(
          JSON.stringify({ error: `문제 ${item.number}: .problem-container가 없습니다` }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // SSE 스트리밍 — 완료되는 대로 클라이언트에 전송
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          await renderMultipleStreaming(items, (result) => {
            const data = JSON.stringify({
              number: result.number,
              pngBase64: result.pngBuffer.toString("base64"),
              width: result.width,
              height: result.height,
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          });
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "렌더링 중 오류";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "렌더링 중 오류가 발생했습니다";
    console.error("Render error:", error);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
