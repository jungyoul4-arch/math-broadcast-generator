"use client";

import { memo } from "react";

interface ProblemCardProps {
  number: number;
  subject: string;
  unitName?: string;
  bodyHtml: string;
  originalThumb?: string;
  previewImage?: string;
  status: "pending" | "analyzing" | "ready" | "rendering" | "done" | "error";
  errorMessage?: string;
  pngBase64?: string;
  contiPngBase64?: string;
}

export default memo(function ProblemCard({
  number,
  subject,
  unitName,
  status,
  errorMessage,
  originalThumb,
  previewImage,
  pngBase64,
  contiPngBase64,
}: ProblemCardProps) {
  const statusColors: Record<string, string> = {
    pending: "#9e9e9e",
    analyzing: "#64b5f6",
    ready: "#81c784",
    rendering: "#ffb74d",
    done: "#66bb6a",
    error: "#ef5350",
  };

  const statusLabels: Record<string, string> = {
    pending: "대기 중",
    analyzing: "분석 중...",
    ready: "확인 대기",
    rendering: "렌더링 중...",
    done: "완료",
    error: "오류",
  };

  const displayImage = pngBase64 || contiPngBase64 || previewImage;

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        borderRadius: "12px",
        border: `1px solid ${status === "error" ? "rgba(239,83,80,0.3)" : "rgba(255,255,255,0.08)"}`,
        overflow: "hidden",
        transition: "all 0.2s",
      }}
    >
      {/* 원본 썸네일 (분석 중) */}
      {!displayImage && originalThumb && (
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            padding: "16px",
            display: "flex",
            justifyContent: "center",
            maxHeight: "200px",
            overflow: "hidden",
            opacity: 0.6,
          }}
        >
          <img
            src={originalThumb}
            alt={`원본 ${number}`}
            style={{
              maxWidth: "100%",
              maxHeight: "168px",
              objectFit: "contain",
              borderRadius: "4px",
            }}
          />
        </div>
      )}
      {/* 결과 미리보기 이미지 */}
      {displayImage && (
        <div
          style={{
            background: status === "done"
              ? "repeating-conic-gradient(rgba(255,255,255,0.06) 0% 25%, transparent 0% 50%) 50% / 16px 16px"
              : "#0d3b2e",
            padding: "16px",
            display: "flex",
            justifyContent: "center",
            maxHeight: "300px",
            overflow: "hidden",
          }}
        >
          <img
            src={`data:image/png;base64,${displayImage}`}
            alt={`문제 ${number}`}
            style={{
              maxWidth: "100%",
              maxHeight: "268px",
              objectFit: "contain",
            }}
          />
        </div>
      )}

      {/* 콘티 PNG */}
      {contiPngBase64 && (
        <div
          style={{
            background: "#1a1a2e",
            padding: "12px",
            display: "flex",
            justifyContent: "center",
            maxHeight: "300px",
            overflow: "hidden",
            borderTop: "1px solid rgba(124,77,255,0.3)",
          }}
        >
          <img
            src={`data:image/png;base64,${contiPngBase64}`}
            alt={`콘티 ${number}`}
            style={{
              maxWidth: "100%",
              maxHeight: "268px",
              objectFit: "contain",
            }}
          />
        </div>
      )}

      {/* 카드 정보 */}
      <div style={{ padding: "16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            marginBottom: "8px",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              background:
                "linear-gradient(135deg, #f9a825 0%, #e65100 100%)",
              color: "#fff",
              fontSize: "16px",
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {number}
          </div>
          <span
            style={{
              fontSize: "12px",
              padding: "2px 8px",
              borderRadius: "10px",
              background: "rgba(100,181,246,0.15)",
              color: "#90caf9",
            }}
          >
            {subject}
          </span>
          {unitName && (
            <span
              style={{
                fontSize: "11px",
                padding: "2px 8px",
                borderRadius: "10px",
                background: "rgba(129,199,132,0.15)",
                color: "#a5d6a7",
              }}
            >
              {unitName}
            </span>
          )}
        </div>

        {/* 상태 표시 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "13px",
          }}
        >
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: statusColors[status],
              animation:
                status === "analyzing" || status === "rendering"
                  ? "pulse 1.5s infinite"
                  : "none",
            }}
          />
          <span style={{ color: statusColors[status] }}>
            {statusLabels[status]}
          </span>
          {errorMessage && (
            <span
              style={{
                color: "rgba(239,83,80,0.8)",
                fontSize: "12px",
                marginLeft: "4px",
              }}
            >
              {errorMessage}
            </span>
          )}
        </div>
      </div>
    </div>
  );
})
