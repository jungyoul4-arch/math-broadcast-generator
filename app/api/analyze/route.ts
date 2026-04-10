import { NextRequest, NextResponse } from "next/server";
import { analyzeProblemImage } from "@/lib/claude";
import { removeBackground } from "@/lib/image-processor";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;
    const numberStr = formData.get("number") as string | null;
    const itemType = (formData.get("itemType") as string | null) || "problem";

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

    // 강의노트 파이프라인 (이미지 배경 제거 → 투명 PNG)
    if (itemType === "lecture-note") {
      const imageBuffer = Buffer.from(base64, "base64");
      const threshold = formData.get("threshold")
        ? parseInt(formData.get("threshold") as string, 10)
        : undefined;
      const result = await removeBackground(imageBuffer, { threshold });

      return NextResponse.json({
        success: true,
        itemType: "lecture-note",
        pngBase64: result.pngBase64,
        width: result.width,
        height: result.height,
      });
    }

    // 문제 파이프라인 (기본)
    const result = await analyzeProblemImage(base64, mediaType, number, source || undefined, headerText || undefined, footerText || undefined, usePro);

    return NextResponse.json({
      success: true,
      itemType: "problem",
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
