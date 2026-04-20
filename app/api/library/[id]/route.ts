import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getProblem, getProblemFile, updateProblemTags, deleteProblem } from "@/lib/library";

/** GET /api/library/[id] — 상세 또는 파일 다운로드 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });

  const { id } = await params;
  const url = new URL(request.url);
  const fileType = url.searchParams.get("file") as "original" | "problem" | "conti" | null;

  if (fileType) {
    const buffer = getProblemFile(id, fileType, session.userId);
    if (!buffer) return NextResponse.json({ error: "파일 없음" }, { status: 404 });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  const problem = getProblem(id, session.userId);
  if (!problem) return NextResponse.json({ error: "문제 없음" }, { status: 404 });
  return NextResponse.json(problem);
}

/** PATCH /api/library/[id] — 태그 수정 (본인 문제만) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  if (!body.tags || !Array.isArray(body.tags)) {
    return NextResponse.json({ error: "tags 배열 필요" }, { status: 400 });
  }

  const updated = await updateProblemTags(session.userId, id, body.tags);
  if (!updated) return NextResponse.json({ error: "문제 없음 (본인 문제만 수정 가능)" }, { status: 404 });
  return NextResponse.json({ success: true, problem: updated });
}

/** DELETE /api/library/[id] — 삭제 (본인 문제만) */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });

  const { id } = await params;
  const deleted = await deleteProblem(session.userId, id);
  if (!deleted) return NextResponse.json({ error: "문제 없음 (본인 문제만 삭제 가능)" }, { status: 404 });
  return NextResponse.json({ success: true });
}
