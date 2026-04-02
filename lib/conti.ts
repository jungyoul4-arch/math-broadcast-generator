/**
 * 콘티 생성기 — Claude Opus 4.6으로 핵심 질문 + 필수 개념 빈칸 생성
 * 출제자 의도 역추적 → 호기심 유발 → 아하! 순간
 */
import Anthropic from "@anthropic-ai/sdk";

// ─── Anthropic 클라이언트 싱글턴 ───
let _anthropicClient: InstanceType<typeof Anthropic> | null = null;

function getClient(): InstanceType<typeof Anthropic> {
  if (_anthropicClient) return _anthropicClient;

  let key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    try {
      const fs = require("fs");
      const path = require("path");
      const envPath = path.join(process.cwd(), ".env.local");
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, "utf-8");
        const match = content.match(/ANTHROPIC_API_KEY=(.+)/);
        if (match) key = match[1].trim();
      }
    } catch {}
  }
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY가 없습니다.");
  }
  _anthropicClient = new Anthropic({ apiKey: key });
  return _anthropicClient;
}

export interface ContiData {
  questions: Array<{
    number: number;
    text: string; // 질문 텍스트 (KaTeX 수식 포함 가능)
  }>;
  concepts: Array<{
    number: number;
    text: string; // 빈칸이 포함된 개념/공식 텍스트
  }>;
}

const CONTI_PROMPT = `당신은 대한민국 최고의 수학 인강 강사입니다.
학생이 문제를 풀기 전에, 출제자의 의도를 점진적으로 파악하며 호기심을 유발하여 "아하!" 하고 깨달음에 이르게 하는 콘티를 만듭니다.

## 콘티 구성 원칙
1. 답을 구하는 것이 목적이 아니라, 문제를 이해하는 것이 목적
2. 출제자의 의도를 역추적하는 질문
3. 점진적으로 깊어지는 호기심 유발
4. 최대 4개 이하의 핵심 질문만

## 핵심 질문 규칙
- 4개 이하로 엄격히 제한
- 각 질문은 이전 질문의 답에서 자연스럽게 이어져야 함
- "왜?", "어떻게?", "무엇이?" 형태의 열린 질문
- 수식이 필요하면 $...$ 또는 $$...$$ 사용 (KaTeX 렌더링)
- 마지막 질문은 출제자의 핵심 의도에 도달하는 질문

## 필수 개념/공식 규칙
- 이 문제를 풀기 위해 반드시 알아야 하는 개념과 공식
- 3~5개로 제한
- 핵심 부분을 빈칸( ______ )으로 만들어 학생이 채우게 함
- 수식에서 핵심 부분만 빈칸: 예) $\\lim_{\\theta \\to 0} \\frac{\\sin\\theta}{\\theta} =$ ______
- 개념 설명에서 핵심 용어 빈칸: 예) 같은 호에 대한 ______은 서로 같다

## 응답 형식
반드시 아래 JSON 형식으로만 응답하세요.

\`\`\`json
{
  "questions": [
    {"number": 1, "text": "질문 내용"},
    {"number": 2, "text": "질문 내용"},
    {"number": 3, "text": "질문 내용"}
  ],
  "concepts": [
    {"number": 1, "text": "빈칸 포함 개념/공식"},
    {"number": 2, "text": "빈칸 포함 개념/공식"},
    {"number": 3, "text": "빈칸 포함 개념/공식"}
  ]
}
\`\`\``;

export async function generateConti(
  imageBase64: string,
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"
): Promise<ContiData> {
  const response = await getClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: CONTI_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          { type: "text", text: "이 수학 문제의 콘티를 만들어주세요." },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("콘티 생성 실패: 텍스트 응답 없음");
  }

  let jsonStr = textBlock.text.trim();
  const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  return JSON.parse(jsonStr);
}
