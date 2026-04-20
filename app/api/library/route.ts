import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listProblems, saveProblem } from "@/lib/library";

/** GET /api/library — 내 라이브러리 (+ 그룹 통합) */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const itemTypeParam = searchParams.get("itemType");
  const result = listProblems(session.userId, {
    subject: searchParams.get("subject") || undefined,
    unitName: searchParams.get("unit") || undefined,
    type: searchParams.get("type") || undefined,
    tag: searchParams.get("tag") || undefined,
    search: searchParams.get("search") || undefined,
    difficulty: searchParams.get("difficulty") ? parseInt(searchParams.get("difficulty")!) : undefined,
    ownerId: searchParams.get("owner") || undefined,
    itemType: itemTypeParam === "problem" || itemTypeParam === "lecture-note" ? itemTypeParam : undefined,
    offset: searchParams.get("offset") ? parseInt(searchParams.get("offset")!) : 0,
    limit: searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : 50,
  });

  return NextResponse.json(result);
}

/** POST /api/library — 내 라이브러리에 저장 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });

  try {
    const body = await request.json();
    if (!body.problemPngBase64) {
      return NextResponse.json({ error: "변환된 PNG가 필요합니다" }, { status: 400 });
    }

    // 검색 인덱스 bodyHtml — contentBlocks가 있으면 그 html을 이어 붙여 텍스트 검색 인덱스로 사용.
    // (렌더 source of truth는 body.html 문자열이며 bodyHtml은 검색/미리보기 용도.)
    const searchIndexBody =
      Array.isArray(body.contentBlocks) && body.contentBlocks.length > 0
        ? body.contentBlocks
            .map((b: { html?: string }) => (b && typeof b.html === "string" ? b.html : ""))
            .join("\n")
        : (body.bodyHtml || "");

    const saved = await saveProblem(session.userId, {
      itemType: body.itemType || "problem",
      linkedProblemNumber: body.linkedProblemNumber,
      subject: body.subject || "",
      unitName: body.unitName || "",
      type: body.type || "",
      points: body.points || 0,
      difficulty: body.difficulty || 0,
      source: body.source || "",
      bodyHtml: searchIndexBody,
      headerText: body.headerText,
      footerText: body.footerText,
      tags: body.tags || [],
      originalImageBase64: body.originalImageBase64,
      problemPngBase64: body.problemPngBase64,
      contiPngBase64: body.contiPngBase64,
      html: body.html || "",
      contiHtml: body.contiHtml,
      hasDiagram: body.hasDiagram === true,
    });

    return NextResponse.json({ success: true, problem: saved });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "저장 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
