import sharp from "sharp";

export interface ProcessOptions {
  threshold?: number; // 0-255, 배경 판정 임계값 (기본 240)
}

export interface ProcessResult {
  pngBase64: string;
  width: number;
  height: number;
}

export async function removeBackground(
  imageBuffer: Buffer,
  options?: ProcessOptions
): Promise<ProcessResult> {
  const threshold = options?.threshold ?? 240;
  const image = sharp(imageBuffer).ensureAlpha();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 흰색/밝은 배경 픽셀을 투명으로 변환
  const pixels = new Uint8Array(data);
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i],
      g = pixels[i + 1],
      b = pixels[i + 2];
    if (r >= threshold && g >= threshold && b >= threshold) {
      pixels[i + 3] = 0;
    }
  }

  const result = await sharp(Buffer.from(pixels), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    pngBase64: result.data.toString("base64"),
    width: info.width,
    height: info.height,
  };
}
