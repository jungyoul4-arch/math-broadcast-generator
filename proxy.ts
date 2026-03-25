import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 공개 경로 — 인증 불필요
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".svg")
  ) {
    return NextResponse.next();
  }

  const session = await getSessionFromRequest(request);

  // 미인증 → 로그인 리다이렉트
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // /admin 경로는 관리자만
  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (session.role !== "admin") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "권한 없음" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}
