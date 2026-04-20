import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateGroup, deleteGroup, addMemberToGroup, removeMemberFromGroup } from "@/lib/groups";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}

/** PATCH — 그룹 수정 / 멤버 추가·제거 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "권한 없음" }, { status: 403 });

  const { id } = await params;
  const body = await request.json();

  // 멤버 추가
  if (body.addMember) {
    const group = await addMemberToGroup(id, body.addMember);
    if (!group) return NextResponse.json({ error: "그룹 없음" }, { status: 404 });
    return NextResponse.json({ success: true, group });
  }

  // 멤버 제거
  if (body.removeMember) {
    const group = await removeMemberFromGroup(id, body.removeMember);
    if (!group) return NextResponse.json({ error: "그룹 없음" }, { status: 404 });
    return NextResponse.json({ success: true, group });
  }

  // 이름/설명 수정
  const group = await updateGroup(id, { name: body.name, description: body.description });
  if (!group) return NextResponse.json({ error: "그룹 없음" }, { status: 404 });
  return NextResponse.json({ success: true, group });
}

/** DELETE — 그룹 삭제 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "권한 없음" }, { status: 403 });

  const { id } = await params;
  const deleted = await deleteGroup(id);
  if (!deleted) return NextResponse.json({ error: "그룹 없음" }, { status: 404 });
  return NextResponse.json({ success: true });
}
