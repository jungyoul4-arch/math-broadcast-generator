import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listUsers, createUser, deleteUser, updateUser } from "@/lib/users";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}

/** GET /api/admin/users — 전체 유저 목록 */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  return NextResponse.json({ users: listUsers() });
}

/** POST /api/admin/users — 유저 생성 */
export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "권한 없음" }, { status: 403 });

  try {
    const { username, password, displayName, role } = await request.json();
    if (!username || !password || !displayName) {
      return NextResponse.json({ error: "아이디, 비밀번호, 이름을 입력하세요" }, { status: 400 });
    }
    const user = await createUser({ username, password, displayName, role });
    return NextResponse.json({ success: true, user });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "생성 오류";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** PATCH /api/admin/users — 유저 수정 (body에 id 포함) */
export async function PATCH(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "권한 없음" }, { status: 403 });

  try {
    const { id, ...updates } = await request.json();
    if (!id) return NextResponse.json({ error: "유저 ID 필요" }, { status: 400 });
    const user = await updateUser(id, updates);
    if (!user) return NextResponse.json({ error: "유저 없음" }, { status: 404 });
    return NextResponse.json({ success: true, user });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "수정 오류";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** DELETE /api/admin/users — 유저 삭제 (body에 id) */
export async function DELETE(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "권한 없음" }, { status: 403 });

  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "유저 ID 필요" }, { status: 400 });
    await deleteUser(id);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "삭제 오류";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
