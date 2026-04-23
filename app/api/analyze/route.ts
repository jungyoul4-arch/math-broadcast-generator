import { NextRequest, NextResponse } from "next/server";
import { analyzeProblemImage, extractTextFromImage, getClient, detectDiagram, generateTikz } from "@/lib/claude";
import { renderTikzToPng } from "@/lib/tikz-renderer";
import { generateLectureNoteHtml } from "@/lib/image-template";

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

    // 강의노트 파이프라인 (AI 텍스트/수식 추출 + 도형 감지/생성 → 다크 스타일 HTML)
    if (itemType === "lecture-note") {
      const client = getClient();
      const imageContent = { inlineData: { mimeType: mediaType, data: base64 } };

      // Phase 1: 텍스트 추출 + 도형 감지 병렬
      const [bodyHtml, hasDiagramDetected] = await Promise.all([
        extractTextFromImage(base64, mediaType),
        detectDiagram(client, imageContent),
      ]);

      // 도형 감지 시: 그래프 라벨만 있으면 bodyHtml 비움, 완성된 수식/한글이 있으면 유지
      let finalBodyHtml = bodyHtml;
      if (hasDiagramDetected) {
        const plainText = bodyHtml.replace(/<[^>]*>/g, "").trim();
        const hasKorean = /[가-힣]/.test(plainText);
        // 자주 쓰이는 수식 명령어 전반을 커버 (누락 시 본문이 통째로 비워지는 버그 방지)
        const hasCompleteFormula =
          /\\(lim|sum|int|frac|dfrac|tfrac|begin|leq|geq|neq|approx|equiv|log|ln|exp|sin|cos|tan|sec|csc|cot|sqrt|cdot|times|div|pm|infty|partial|nabla|forall|exists|in|subset|supset|cup|cap|pi|alpha|beta|gamma|theta|phi|lambda|mu|sigma|omega|Delta|Sigma|Omega)(?![a-zA-Z])/.test(plainText)
          || /\$[^$]{15,}\$/.test(plainText);
        if (!hasKorean && !hasCompleteFormula) {
          console.log("강의노트: 그래프 라벨만 감지 → bodyHtml 비움");
          finalBodyHtml = "";
        }
      }

      // Phase 2: 도형 있으면 TikZ 생성 + 렌더링
      let diagramPngBase64: string | undefined;
      let diagramLayout: "single" | "wide" | "multi" = "single";
      if (hasDiagramDetected) {
        console.log("강의노트: 도형 감지됨 → TikZ 생성 시작");
        const tikzCode = await generateTikz(client, imageContent, "pro");
        if (tikzCode) {
          if (tikzCode.includes("minipage") || tikzCode.includes("\\hfill")) {
            diagramLayout = "multi";
          } else if ((tikzCode.includes("->") && tikzCode.includes("axis")) || tikzCode.match(/\\draw.*\(-?\d+,-?\d+\).*--.*\(-?\d+,-?\d+\)/)) {
            diagramLayout = "wide";
          }
          try {
            diagramPngBase64 = await renderTikzToPng(tikzCode);
            console.log("강의노트: TikZ 렌더링 성공");
          } catch (err) {
            console.error("강의노트: TikZ 렌더링 실패:", err);
          }
        }
      }

      const contiHtml = generateLectureNoteHtml(finalBodyHtml, {
        problemNumber: number ?? 1,
        source: source || undefined,
        diagramPngBase64,
        diagramLayout,
      });

      return NextResponse.json({
        success: true,
        itemType: "lecture-note",
        contiHtml,
        hasDiagram: hasDiagramDetected,
        diagramLayout,
      });
    }

    // 문제 파이프라인 (기본)
    const result = await analyzeProblemImage(base64, mediaType, number, source || undefined, headerText || undefined, footerText || undefined, usePro);

    return NextResponse.json({
      success: true,
      itemType: "problem",
      problemData: result.problemData,
      html: result.html,
      // problemData.hasDiagram 필드는 Gemini가 직접 판정
      hasDiagram: result.problemData?.hasDiagram === true,
      diagramLayout: result.problemData?.diagramLayout,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "분석 중 오류가 발생했습니다";
    console.error("Analyze error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
