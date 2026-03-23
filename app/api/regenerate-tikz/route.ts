import { NextRequest, NextResponse } from "next/server";
import { regenerateTikzWithPro } from "@/lib/claude";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json({ error: "이미지가 없습니다" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    let mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" = "image/png";
    if (file.type === "image/jpeg" || file.type === "image/jpg") {
      mediaType = "image/jpeg";
    } else if (file.type === "image/webp") {
      mediaType = "image/webp";
    } else if (file.type === "image/gif") {
      mediaType = "image/gif";
    }

    const result = await regenerateTikzWithPro(base64, mediaType);

    return NextResponse.json({
      success: true,
      pngBase64: result.pngBase64,
      diagramLayout: result.diagramLayout,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Pro 재생성 중 오류";
    console.error("Regenerate error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
