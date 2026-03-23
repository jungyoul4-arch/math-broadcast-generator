import { NextRequest, NextResponse } from "next/server";
import { analyzeProblemImage } from "@/lib/claude";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;
    const numberStr = formData.get("number") as string | null;

    if (!file) {
      return NextResponse.json({ error: "이미지가 없습니다" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    let mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif" =
      "image/png";
    if (file.type === "image/jpeg" || file.type === "image/jpg") {
      mediaType = "image/jpeg";
    } else if (file.type === "image/webp") {
      mediaType = "image/webp";
    } else if (file.type === "image/gif") {
      mediaType = "image/gif";
    }

    const number = numberStr ? parseInt(numberStr, 10) : undefined;
    const source = formData.get("source") as string | null;
    const headerText = formData.get("headerText") as string | null;
    const footerText = formData.get("footerText") as string | null;
    const usePro = formData.get("usePro") === "true";

    const result = await analyzeProblemImage(base64, mediaType, number, source || undefined, headerText || undefined, footerText || undefined, usePro);

    return NextResponse.json({
      success: true,
      problemData: result.problemData,
      html: result.html,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "분석 중 오류가 발생했습니다";
    console.error("Analyze error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
