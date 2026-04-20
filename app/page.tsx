"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import DropZone from "@/components/DropZone";
import ProblemCard from "@/components/ProblemCard";
import ProgressBar from "@/components/ProgressBar";
import SaveModal from "@/components/SaveModal";

interface ProblemState {
  id: string;
  file: File;
  number: number;
  status: "pending" | "analyzing" | "ready" | "rendering" | "done" | "error";
  errorMessage?: string;
  itemType: "problem" | "lecture-note";
  linkedProblemNumber?: number;
  subject: string;
  type: string;
  points: number;
  source: string;
  unitName: string;
  headerText: string;
  footerText: string;
  bodyHtml: string;
  html?: string;
  contiHtml?: string;
  originalThumb?: string;
  previewImage?: string;
  pngBase64?: string;
  contiPngBase64?: string;
  hasDiagram?: boolean;
}

type AppPhase = "upload" | "analyzing" | "preview" | "rendering" | "done";
type UploadMode = "problem" | "lecture-note";

export default function Home() {
  const [problems, setProblems] = useState<ProblemState[]>([]);
  const [phase, setPhase] = useState<AppPhase>("upload");
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [renderProgress, setRenderProgress] = useState(0);
  const [globalSource, setGlobalSource] = useState("");
  const [saveModalTarget, setSaveModalTarget] = useState<"all" | string | null>(null);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [uploadMode, setUploadMode] = useState<UploadMode>("problem");
  const [autoRender, setAutoRender] = useState(false);
  const autoRenderPending = useRef(false);

  const updateProblem = useCallback(
    (id: string, updates: Partial<ProblemState>) => {
      setProblems((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
      );
    },
    []
  );

  // 1. 파일 업로드 → 대기 목록에 추가 (분석은 아직 시작하지 않음)
  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      const sorted = files.sort((a, b) => a.name.localeCompare(b.name));

      // 원본 썸네일 생성
      const thumbs = await Promise.all(
        sorted.map(
          (file) =>
            new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(file);
            })
        )
      );

      setProblems((prev) => {
        const startNumber = prev.length + 1;
        const newProblems: ProblemState[] = sorted.map((file, i) => ({
          id: `${Date.now()}-${i}`,
          file,
          number: startNumber + i,
          status: "pending" as const,
          itemType: uploadMode,
          subject: "",
          type: "",
          points: 0,
          source: "",
          unitName: "",
          headerText: "",
          footerText: "",
          bodyHtml: "",
          originalThumb: thumbs[i],
        }));
        return [...prev, ...newProblems];
      });
    },
    [uploadMode]
  );

  // 1-1. 개별 문제 삭제 (모든 상태에서 가능)
  const handleRemoveProblem = useCallback((id: string) => {
    setProblems((prev) => {
      const filtered = prev.filter((p) => p.id !== id);
      // 번호 재할당
      const renumbered = filtered.map((p, i) => ({ ...p, number: i + 1 }));
      // 남은 문제가 없으면 upload 페이즈로
      if (renumbered.length === 0) {
        setTimeout(() => { setPhase("upload"); setSavedIds(new Set()); }, 0);
      }
      return renumbered;
    });
  }, []);

  // 1-2. 분석 시작 버튼 (3개씩 배치 처리 — API rate limit 방지)
  const handleStartAnalyze = useCallback(async () => {
    const pendingProblems = problems.filter((p) => p.status === "pending");
    if (pendingProblems.length === 0) return;

    const ANALYZE_BATCH = 10; // 동시 분석 수 (유료 플랜 — 1000+ RPM)

    pendingProblems.forEach((p) => {
      updateProblem(p.id, { status: "analyzing" });
    });
    setPhase("analyzing");
    setAnalyzeProgress(0);

    let completed = 0;

    const analyzeSingle = async (prob: (typeof pendingProblems)[0]) => {
      try {
        const formData = new FormData();
        formData.append("image", prob.file);
        formData.append("number", prob.number.toString());
        formData.append("itemType", prob.itemType);
        const source = prob.source || globalSource;
        if (source) {
          formData.append("source", source);
        }
        if (prob.headerText) {
          formData.append("headerText", prob.headerText);
        }
        if (prob.footerText) {
          formData.append("footerText", prob.footerText);
        }

        const res = await fetch("/api/analyze", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "분석 실패");
        }

        const data = await res.json();

        if (data.itemType === "lecture-note") {
          updateProblem(prob.id, {
            status: "ready",
            subject: "강의노트",
            contiHtml: data.contiHtml,
            hasDiagram: data.hasDiagram === true,
          });
        } else {
          updateProblem(prob.id, {
            status: "ready",
            subject: data.problemData.subject,
            type: data.problemData.type,
            points: data.problemData.points,
            unitName: data.problemData.unitName || "",
            bodyHtml: data.problemData.bodyHtml || "",
            html: data.html,
            hasDiagram: data.hasDiagram === true,
          });
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "알 수 없는 오류";
        updateProblem(prob.id, {
          status: "error",
          errorMessage: message,
        });
      } finally {
        completed++;
        setAnalyzeProgress(completed);
      }
    };

    // 배치 단위로 실행 (3개씩 동시 → 완료 후 다음 3개)
    for (let i = 0; i < pendingProblems.length; i += ANALYZE_BATCH) {
      const batch = pendingProblems.slice(i, i + ANALYZE_BATCH);
      await Promise.all(batch.map(analyzeSingle));
    }

    if (autoRender) {
      autoRenderPending.current = true;
    }
    setPhase("preview");
  }, [problems, updateProblem, globalSource, autoRender]);

  // 2. 미리보기 확인 후 렌더링 시작 (SSE 스트리밍)
  const handleRender = useCallback(async () => {
    const readyProblems = problems.filter(
      (p) => p.status === "ready" && (p.html || p.contiHtml)
    );
    if (readyProblems.length === 0) return;

    setPhase("rendering");
    setRenderProgress(0);

    readyProblems.forEach((p) => {
      updateProblem(p.id, { status: "rendering" });
    });

    try {
      const items: Array<{ html: string; number: number; type: "problem" | "conti" }> = [];
      for (const p of readyProblems) {
        if (p.html) {
          items.push({ html: p.html, number: p.number, type: "problem" });
        }
        if (p.contiHtml) {
          items.push({ html: p.contiHtml, number: p.number + 100000, type: "conti" });
        }
      }

      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "렌더링 실패");
      }

      // SSE 스트리밍 소비 — 완료되는 대로 실시간 반영
      const reader = res.body?.getReader();
      if (!reader) throw new Error("스트림을 읽을 수 없습니다");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const result = JSON.parse(data);
            if (result.error) throw new Error(result.error);

            if (result.number >= 100000) {
              const prob = readyProblems.find((p) => p.number === result.number - 100000);
              if (prob) {
                const isContiOnly = !prob.html;
                updateProblem(prob.id, {
                  contiPngBase64: result.pngBase64,
                  ...(isContiOnly ? { status: "done" as const } : {}),
                });
                if (isContiOnly) {
                  setRenderProgress((prev) => prev + 1);
                }
              }
            } else {
              const prob = readyProblems.find((p) => p.number === result.number);
              if (prob) {
                updateProblem(prob.id, {
                  status: "done",
                  pngBase64: result.pngBase64,
                });
                setRenderProgress((prev) => prev + 1);
              }
            }
          } catch (e) {
            if (e instanceof Error && e.message !== "렌더링 오류") {
              console.warn("SSE 파싱 경고:", e);
            }
          }
        }
      }

      setPhase("done");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "렌더링 오류";
      readyProblems.forEach((p) => {
        updateProblem(p.id, { status: "error", errorMessage: message });
      });
      setPhase("preview");
    }
  }, [problems, updateProblem]);

  // 자동 변환: 분석 완료 → preview 진입 시 자동으로 렌더링 시작
  useEffect(() => {
    if (phase === "preview" && autoRenderPending.current) {
      autoRenderPending.current = false;
      handleRender();
    }
  }, [phase, handleRender]);

  // Pro로 도형 재생성 (전체 재분석, Pro TikZ 사용)
  const handleRegeneratePro = useCallback(async (prob: ProblemState) => {
    if (!prob.file) return;
    updateProblem(prob.id, { status: "analyzing", errorMessage: undefined });

    try {
      const formData = new FormData();
      formData.append("image", prob.file);
      formData.append("number", prob.number.toString());
      formData.append("usePro", "true");
      if (prob.source || globalSource) formData.append("source", prob.source || globalSource);
      if (prob.headerText) formData.append("headerText", prob.headerText);
      if (prob.footerText) formData.append("footerText", prob.footerText);

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Pro 재생성 실패");
      }

      const data = await res.json();
      updateProblem(prob.id, {
        status: "ready",
        subject: data.problemData.subject,
        type: data.problemData.type,
        points: data.problemData.points,
        unitName: data.problemData.unitName || "",
        bodyHtml: data.problemData.bodyHtml || "",
        html: data.html,
        hasDiagram: data.hasDiagram === true,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "재생성 오류";
      updateProblem(prob.id, { status: "ready", errorMessage: message });
    }
  }, [updateProblem, globalSource]);

  // base64 → Blob 다운로드 헬퍼 (data: URL보다 안정적)
  const downloadBase64 = useCallback((base64: string, filename: string) => {
    const byteChars = atob(base64);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([byteArray], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  // 3. 개별 다운로드 (문제 또는 강의노트)
  const handleDownloadProblem = useCallback(
    (prob: ProblemState) => {
      if (prob.pngBase64) {
        downloadBase64(prob.pngBase64, `prob${prob.number}_문제.png`);
      } else if (prob.contiPngBase64) {
        downloadBase64(prob.contiPngBase64, `prob${prob.number}_강의노트.png`);
      }
    },
    [downloadBase64]
  );

  // 3-1. 개별 다운로드 (강의노트)
  const handleDownloadConti = useCallback(
    (prob: ProblemState) => {
      if (!prob.contiPngBase64) return;
      downloadBase64(prob.contiPngBase64, `prob${prob.number}_강의노트.png`);
    },
    [downloadBase64]
  );

  // 4. 전체 ZIP 다운로드
  const handleDownloadAll = useCallback(async () => {
    const doneProblems = problems.filter(
      (p) => p.status === "done" && (p.pngBase64 || p.contiPngBase64)
    );
    if (doneProblems.length === 0) return;

    // 단일 파일이면 직접 다운로드
    if (doneProblems.length === 1) {
      const p = doneProblems[0];
      const base64 = p.pngBase64 || p.contiPngBase64;
      const label = p.pngBase64 ? "문제" : "강의노트";
      downloadBase64(base64!, `prob${p.number}_${label}.png`);
      return;
    }

    // ZIP 다운로드 — 문제 + 강의노트 모두 포함
    const files: Array<{ name: string; base64: string }> = [];
    for (const p of doneProblems) {
      if (p.pngBase64) {
        files.push({ name: `prob${p.number}_문제.png`, base64: p.pngBase64 });
      }
      if (p.contiPngBase64) {
        files.push({ name: `prob${p.number}_강의노트.png`, base64: p.contiPngBase64 });
      }
    }

    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
    });

    if (!res.ok) return;

    const blob = await res.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download =
      doneProblems.length === 1
        ? `prob${doneProblems[0].number}_transparent.png`
        : "math-problems.zip";
    link.click();
    URL.revokeObjectURL(link.href);
  }, [problems]);

  // 5. 새로 시작
  const handleReset = useCallback(() => {
    setProblems([]);
    setPhase("upload");
    setAnalyzeProgress(0);
    setRenderProgress(0);
    setSavedIds(new Set());
  }, []);

  // 6. 라이브러리에 저장 — 자동 태그 생성
  const generateAutoTags = useCallback((prob: ProblemState): string[] => {
    const tags: string[] = [];
    if (prob.subject) tags.push(prob.subject);
    if (prob.unitName) tags.push(prob.unitName);
    if (prob.type) tags.push(prob.type);
    if (prob.points) tags.push(`${prob.points}점`);
    const src = prob.source || globalSource;
    if (src) {
      const patterns: RegExp[] = [
        /(\d{4})/, /(수능|모의고사|학력평가|교육청|평가원)/,
        /(6월|9월|3월|4월|7월|10월|11월)/, /(고[123]|중[123])/, /(기출)/,
      ];
      for (const pat of patterns) {
        const m = src.match(pat);
        if (m) tags.push(m[1]);
      }
    }
    return [...new Set(tags)];
  }, [globalSource]);

  // 원본 이미지 File → base64
  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // data:image/...;base64, 프리픽스 제거
        resolve(result.includes(",") ? result.split(",")[1] : result);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const handleSaveToLibrary = useCallback(async (tags: string[]) => {
    setSavingToLibrary(true);
    try {
      const targetProblems = saveModalTarget === "all"
        ? problems.filter((p) => p.status === "done" && (p.pngBase64 || p.contiPngBase64) && !savedIds.has(p.id))
        : problems.filter((p) => p.id === saveModalTarget && (p.pngBase64 || p.contiPngBase64));

      for (const prob of targetProblems) {
        const originalBase64 = prob.file ? await fileToBase64(prob.file) : undefined;
        const res = await fetch("/api/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itemType: prob.itemType,
            linkedProblemNumber: prob.linkedProblemNumber,
            subject: prob.subject,
            unitName: prob.unitName,
            type: prob.type,
            points: prob.points,
            difficulty: 0,
            source: prob.source || globalSource,
            bodyHtml: prob.bodyHtml,
            headerText: prob.headerText,
            footerText: prob.footerText,
            tags,
            originalImageBase64: originalBase64,
            problemPngBase64: prob.pngBase64,
            contiPngBase64: prob.contiPngBase64,
            html: prob.html,
            contiHtml: prob.contiHtml,
            hasDiagram: prob.hasDiagram === true,
          }),
        });
        if (res.ok) {
          setSavedIds((prev) => new Set(prev).add(prob.id));
        }
      }
      setSaveModalTarget(null);
    } catch (err) {
      console.error("라이브러리 저장 오류:", err);
    } finally {
      setSavingToLibrary(false);
    }
  }, [saveModalTarget, problems, savedIds, globalSource, fileToBase64]);

  const pendingCount = problems.filter((p) => p.status === "pending").length;
  const readyCount = problems.filter((p) => p.status === "ready").length;
  const doneCount = problems.filter((p) => p.status === "done").length;
  const errorCount = problems.filter((p) => p.status === "error").length;

  return (
    <div
      style={{
        maxWidth: "960px",
        margin: "0 auto",
        padding: "40px 24px",
        minHeight: "100vh",
      }}
    >
      {/* 헤더 */}
      <header style={{ marginBottom: "40px" }}>
        <h1
          style={{
            fontSize: "28px",
            fontWeight: 800,
            marginBottom: "8px",
            background: "linear-gradient(135deg, #f9a825, #ff8f00)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Math Broadcast Generator
        </h1>
        <p style={{ fontSize: "15px", color: "rgba(255,255,255,0.5)" }}>
          수학 문제 이미지를 방송용 투명 PNG로 자동 변환
        </p>
      </header>

      {/* 모드 토글: 문제 / 강의노트 */}
      <div style={{
        display: "flex",
        gap: "0",
        marginBottom: "16px",
        borderRadius: "10px",
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.12)",
      }}>
        {(["problem", "lecture-note"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setUploadMode(mode)}
            style={{
              flex: 1,
              padding: "10px 0",
              border: "none",
              background: uploadMode === mode
                ? mode === "problem"
                  ? "linear-gradient(135deg, #42a5f5, #1565c0)"
                  : "linear-gradient(135deg, #ab47bc, #7b1fa2)"
                : "rgba(255,255,255,0.04)",
              color: uploadMode === mode ? "#fff" : "rgba(255,255,255,0.5)",
              fontSize: "14px",
              fontWeight: uploadMode === mode ? 700 : 500,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {mode === "problem" ? "문제" : "강의노트"}
          </button>
        ))}
      </div>

      {/* 출처 입력 */}
      <div style={{ marginBottom: "16px" }}>
        <input
          type="text"
          value={globalSource}
          onChange={(e) => setGlobalSource(e.target.value)}
          placeholder="출처 입력 (예: 2026 수능 21번, 6월 모의고사 30번)"
          className="source-input"
        />
        <style>{`
          .source-input {
            width: 100%;
            padding: 12px 20px;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.15);
            background: rgba(255,255,255,0.04);
            color: #fff;
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s;
          }
          .source-input:focus {
            border-color: rgba(249,168,37,0.5);
          }
        `}</style>
      </div>

      {/* 업로드 영역 — 항상 표시 (렌더링 중에만 비활성화) */}
      <DropZone
        onFilesSelected={handleFilesSelected}
        disabled={phase === "rendering" || phase === "analyzing"}
        compact={problems.length > 0}
      />

      {/* 분석 진행률 */}
      {phase === "analyzing" && (
        <div style={{ marginBottom: "24px" }}>
          <ProgressBar
            current={analyzeProgress}
            total={problems.length}
            active={problems.filter((p) => p.status === "analyzing").length}
            label={uploadMode === "lecture-note" ? "강의노트 이미지 처리 중..." : "Claude API로 문제 분석 중..."}
          />
        </div>
      )}

      {/* 렌더링 진행률 */}
      {phase === "rendering" && (
        <div style={{ marginBottom: "24px" }}>
          <ProgressBar
            current={renderProgress}
            total={problems.filter((p) => p.status === "rendering" || p.status === "done").length}
            active={problems.filter((p) => p.status === "rendering").length}
            label="Playwright로 투명 PNG 렌더링 중..."
          />
        </div>
      )}

      {/* 문제 카드 그리드 */}
      {problems.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "16px",
            marginTop: "24px",
            marginBottom: "24px",
          }}
        >
          {problems.map((prob) => (
            <div key={prob.id} style={{ position: "relative" }}>
              <ProblemCard
                number={prob.number}
                subject={prob.subject || (prob.status === "pending" ? "대기" : "분석 중")}
                unitName={prob.unitName}
                bodyHtml={prob.bodyHtml}
                status={prob.status}
                errorMessage={prob.errorMessage}
                originalThumb={prob.originalThumb}
                previewImage={prob.previewImage}
                pngBase64={prob.pngBase64}
                contiPngBase64={prob.contiPngBase64}
              />
              {prob.itemType === "lecture-note" && (
                <span style={{
                  position: "absolute",
                  top: "8px",
                  left: "8px",
                  background: "rgba(171,71,188,0.85)",
                  color: "#fff",
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: "6px",
                  backdropFilter: "blur(4px)",
                }}>
                  강의노트{prob.linkedProblemNumber ? ` #${prob.linkedProblemNumber}` : ""}
                </span>
              )}
              {/* 문항번호 + 출처 + 머릿말/꼬릿말 입력 (pending 상태에서만) */}
              {prob.status === "pending" && (
                <div style={{ marginTop: "-1px" }}>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <input
                      type="number"
                      value={prob.number}
                      onChange={(e) => updateProblem(prob.id, { number: parseInt(e.target.value) || 1 })}
                      placeholder="번호"
                      style={{
                        width: "60px",
                        padding: "8px 10px",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderTop: "none",
                        background: "rgba(249,168,37,0.08)",
                        color: "#f9a825",
                        fontSize: "14px",
                        fontWeight: 700,
                        textAlign: "center",
                        outline: "none",
                      }}
                    />
                    <input
                      type="text"
                      value={prob.source}
                      onChange={(e) => updateProblem(prob.id, { source: e.target.value })}
                      placeholder="출처 (예: 2026 수능 21번)"
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderTop: "none",
                        borderLeft: "none",
                        background: "rgba(255,255,255,0.03)",
                        color: "#fff",
                        fontSize: "12px",
                        outline: "none",
                      }}
                    />
                    {prob.itemType === "lecture-note" && (
                      <input
                        type="number"
                        value={prob.linkedProblemNumber || ""}
                        onChange={(e) => updateProblem(prob.id, {
                          linkedProblemNumber: e.target.value ? parseInt(e.target.value) : undefined,
                        })}
                        placeholder="연결 문제#"
                        style={{
                          width: "90px",
                          padding: "8px 10px",
                          border: "1px solid rgba(171,71,188,0.3)",
                          borderTop: "none",
                          borderLeft: "none",
                          background: "rgba(171,71,188,0.08)",
                          color: "#ce93d8",
                          fontSize: "12px",
                          textAlign: "center",
                          outline: "none",
                        }}
                      />
                    )}
                  </div>
                  <input
                    type="text"
                    value={prob.headerText}
                    onChange={(e) => updateProblem(prob.id, { headerText: e.target.value })}
                    placeholder="머릿말 (예: OO쌤의 적중문항)"
                    style={{
                      width: "100%",
                      padding: "7px 12px",
                      border: "1px solid rgba(249,168,37,0.15)",
                      borderTop: "none",
                      background: "rgba(249,168,37,0.04)",
                      color: "rgba(255,213,79,0.9)",
                      fontSize: "11px",
                      outline: "none",
                    }}
                  />
                  <input
                    type="text"
                    value={prob.footerText}
                    onChange={(e) => updateProblem(prob.id, { footerText: e.target.value })}
                    placeholder="꼬릿말 (예: 문제분석을 해보세요)"
                    style={{
                      width: "100%",
                      padding: "7px 12px",
                      borderRadius: "0 0 12px 12px",
                      border: "1px solid rgba(100,181,246,0.15)",
                      borderTop: "none",
                      background: "rgba(100,181,246,0.04)",
                      color: "rgba(144,202,249,0.9)",
                      fontSize: "11px",
                      outline: "none",
                    }}
                  />
                </div>
              )}
              {/* 재분석 버튼은 done 상태의 카드 버튼 그룹에 통합 */}
              {/* 삭제 버튼 (pending, ready, error 상태) */}
              {(prob.status === "pending" || prob.status === "ready" || prob.status === "error") && (
                <button
                  onClick={() => handleRemoveProblem(prob.id)}
                  style={{
                    position: "absolute",
                    top: "8px",
                    right: prob.status === "ready" ? "70px" : "8px",
                    background: "rgba(239,83,80,0.8)",
                    border: "none",
                    borderRadius: "50%",
                    color: "#fff",
                    width: "28px",
                    height: "28px",
                    fontSize: "16px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
              {/* 개별 다운로드 + 저장 + 삭제 버튼들 */}
              {prob.status === "done" && (prob.pngBase64 || prob.contiPngBase64) && (
                <div style={{
                  position: "absolute",
                  top: "8px",
                  right: "8px",
                  display: "flex",
                  gap: "4px",
                }}>
                  {!savedIds.has(prob.id) ? (
                    <button
                      onClick={() => setSaveModalTarget(prob.id)}
                      style={{
                        background: "rgba(249,168,37,0.7)",
                        border: "1px solid rgba(249,168,37,0.5)",
                        borderRadius: "8px",
                        color: "#fff",
                        padding: "4px 10px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        backdropFilter: "blur(4px)",
                      }}
                    >
                      저장
                    </button>
                  ) : (
                    <span
                      style={{
                        background: "rgba(102,187,106,0.7)",
                        borderRadius: "8px",
                        color: "#fff",
                        padding: "4px 10px",
                        fontSize: "11px",
                        fontWeight: 600,
                        backdropFilter: "blur(4px)",
                      }}
                    >
                      저장됨
                    </span>
                  )}
                  <button
                    onClick={() => handleDownloadProblem(prob)}
                    style={{
                      background: "rgba(0,0,0,0.6)",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "8px",
                      color: "#fff",
                      padding: "4px 10px",
                      fontSize: "11px",
                      cursor: "pointer",
                      backdropFilter: "blur(4px)",
                    }}
                  >
                    {prob.itemType === "lecture-note" ? "PNG" : "문제"}
                  </button>
                  {prob.contiPngBase64 && (
                    <button
                      onClick={() => handleDownloadConti(prob)}
                      style={{
                        background: "rgba(124,77,255,0.6)",
                        border: "1px solid rgba(124,77,255,0.4)",
                        borderRadius: "8px",
                        color: "#fff",
                        padding: "4px 10px",
                        fontSize: "11px",
                        cursor: "pointer",
                        backdropFilter: "blur(4px)",
                      }}
                    >
                      강의노트
                    </button>
                  )}
                  {prob.itemType !== "lecture-note" && (
                    <button
                      onClick={() => handleRegeneratePro(prob)}
                      style={{
                        background: "rgba(124,77,255,0.7)",
                        border: "1px solid rgba(124,77,255,0.5)",
                        borderRadius: "8px",
                        color: "#fff",
                        padding: "4px 10px",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        backdropFilter: "blur(4px)",
                      }}
                    >
                      재분석
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm(`문제 ${prob.number}번을 삭제하시겠습니까?`)) {
                        handleRemoveProblem(prob.id);
                      }
                    }}
                    style={{
                      background: "rgba(239,83,80,0.7)",
                      border: "none",
                      borderRadius: "8px",
                      color: "#fff",
                      padding: "4px 8px",
                      fontSize: "11px",
                      cursor: "pointer",
                      backdropFilter: "blur(4px)",
                    }}
                  >
                    삭제
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 액션 버튼 — 입력 단계 */}
      {pendingCount > 0 && phase !== "analyzing" && phase !== "rendering" && (
        <div
          style={{
            display: "flex",
            gap: "12px",
            marginTop: "24px",
            alignItems: "center",
          }}
        >
          <button
            onClick={handleStartAnalyze}
            style={{
              padding: "12px 28px",
              borderRadius: "10px",
              border: "none",
              background: "linear-gradient(135deg, #42a5f5, #1565c0)",
              color: "#fff",
              fontSize: "16px",
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(66,165,245,0.3)",
            }}
          >
            분석 시작 ({pendingCount}개)
          </button>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "13px",
              color: "rgba(255,255,255,0.6)",
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={autoRender}
              onChange={(e) => {
                setAutoRender(e.target.checked);
                if (!e.target.checked) autoRenderPending.current = false;
              }}
              style={{ accentColor: "#f9a825" }}
            />
            분석 후 자동 변환
          </label>
        </div>
      )}

      {/* 액션 버튼 — 결과 단계 */}
      {(phase === "preview" || phase === "done") && (
        <div
          style={{
            display: "flex",
            gap: "12px",
            marginTop: "12px",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {readyCount > 0 && (
            <button
              onClick={handleRender}
              style={{
                padding: "12px 28px",
                borderRadius: "10px",
                border: "none",
                background: "linear-gradient(135deg, #f9a825, #e65100)",
                color: "#fff",
                fontSize: "16px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 16px rgba(249,168,37,0.3)",
              }}
            >
              투명 PNG로 변환 ({readyCount}개)
            </button>
          )}

          {phase === "done" && doneCount > 0 && (
            <button
              onClick={handleDownloadAll}
              style={{
                padding: "12px 28px",
                borderRadius: "10px",
                border: "none",
                background: "linear-gradient(135deg, #66bb6a, #388e3c)",
                color: "#fff",
                fontSize: "16px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 16px rgba(102,187,106,0.3)",
              }}
            >
              {doneCount === 1
                ? "PNG 다운로드"
                : `전체 다운로드 (ZIP, ${doneCount}개)`}
            </button>
          )}

          {phase === "done" && doneCount > 0 && doneCount > savedIds.size && (
            <button
              onClick={() => setSaveModalTarget("all")}
              style={{
                padding: "12px 28px",
                borderRadius: "10px",
                border: "none",
                background: "linear-gradient(135deg, #f9a825, #ff8f00)",
                color: "#fff",
                fontSize: "16px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 16px rgba(249,168,37,0.3)",
              }}
            >
              전체 라이브러리 저장 ({doneCount - savedIds.size}개)
            </button>
          )}

          <button
            onClick={handleReset}
            style={{
              padding: "12px 28px",
              borderRadius: "10px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "transparent",
              color: "rgba(255,255,255,0.7)",
              fontSize: "16px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            새로 시작
          </button>

          {errorCount > 0 && phase === "preview" && (
            <p
              style={{
                fontSize: "13px",
                color: "rgba(239,83,80,0.8)",
              }}
            >
              {errorCount}개 문제에서 오류가 발생했습니다.
            </p>
          )}
        </div>
      )}

      {/* 하단 안내 */}
      <footer
        style={{
          marginTop: "60px",
          paddingTop: "24px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: "13px",
          color: "rgba(255,255,255,0.3)",
        }}
      >
        <p>
          Math Broadcast Generator — Claude API + KaTeX + TikZ
        </p>
        <p style={{ marginTop: "4px" }}>
          다크 칠판 스타일 | 투명 배경 PNG | TikZ 도형 | 병렬 처리
        </p>
      </footer>

      {/* 펄스 애니메이션 */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* 저장 모달 */}
      {saveModalTarget && (
        <SaveModal
          autoTags={
            saveModalTarget === "all"
              ? generateAutoTags(problems.find((p) => p.status === "done")!)
              : generateAutoTags(problems.find((p) => p.id === saveModalTarget)!)
          }
          onSave={handleSaveToLibrary}
          onClose={() => setSaveModalTarget(null)}
          saving={savingToLibrary}
        />
      )}
    </div>
  );
}
