import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const files: Array<{ name: string; base64: string }> = body.files;

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "다운로드할 파일이 없습니다" },
        { status: 400 }
      );
    }

    // 단일 파일이면 바로 PNG 반환
    if (files.length === 1) {
      const buffer = Buffer.from(files[0].base64, "base64");
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="${files[0].name}"`,
        },
      });
    }

    // 여러 파일이면 ZIP으로 묶기
    // Readable.from(buffer) 래핑 제거 — archive.append는 Buffer 직접 수용하므로
    // 중간 사본 1회 제거로 피크 메모리 ~33% 감소
    const archive = archiver("zip", { zlib: { level: 5 } });
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      archive.on("data", (chunk: Buffer) => chunks.push(chunk));
      archive.on("end", resolve);
      archive.on("error", reject);

      for (const file of files) {
        const buffer = Buffer.from(file.base64, "base64");
        archive.append(buffer, { name: file.name });
      }

      archive.finalize();
    });

    const zipBuffer = Buffer.concat(chunks);

    return new NextResponse(zipBuffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="math-problems.zip"',
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "다운로드 생성 중 오류";
    console.error("Download error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
