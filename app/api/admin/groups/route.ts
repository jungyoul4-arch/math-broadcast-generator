import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listGroups, createGroup } from "@/lib/groups";

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "admin") return null;
  return session;
}

/** GET — 전체 그룹 목록 */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "권한 없음" }, { status: 403 });
  return NextResponse.json({ groups: listGroups() });
}

/** POST — 그룹 생성 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "권한 없음" }, { status: 403 });

  const { name, description } = await request.json();
  if (!name) return NextResponse.json({ error: "그룹 이름 필요" }, { status: 400 });

  const group = await createGroup({ name, description, createdBy: admin.userId });
  return NextResponse.json({ success: true, group });
}
