"use client";

interface ProgressBarProps {
  current: number;
  total: number;
  label: string;
  /** 현재 처리 중(analyzing/rendering)인 항목 수 — 대기 중 항목 계산용 */
  active?: number;
}

export default function ProgressBar({
  current,
  total,
  label,
  active,
}: ProgressBarProps) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  // 대기 중 = total - 완료 - 진행중 (active가 전달된 경우만)
  const waiting = typeof active === "number"
    ? Math.max(0, total - current - active)
    : 0;

  return (
    <div style={{ marginBottom: "16px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "6px",
          fontSize: "13px",
          color: "rgba(255,255,255,0.6)",
        }}
      >
        <span>{label}</span>
        <span>
          {current}/{total} ({percent}%)
          {waiting > 0 && (
            <span style={{ marginLeft: "8px", color: "rgba(255,255,255,0.4)" }}>
              · 대기 중 {waiting}
            </span>
          )}
        </span>
      </div>
      <div
        style={{
          height: "6px",
          background: "rgba(255,255,255,0.08)",
          borderRadius: "3px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${percent}%`,
            background: "linear-gradient(90deg, #f9a825, #ff8f00)",
            borderRadius: "3px",
            transition: "width 0.3s ease",
          }}
        />
      </div>
    </div>
  );
}
