/**
 * 라이브러리 — 유저별 문제 저장·검색·태깅 + 그룹 통합
 * 저장소: data/libraries/{userId}/library.json + problems/{id}/
 */
import fs from "fs";
import path from "path";
import { getGroupByUserId } from "./groups";
import { getUserById } from "./users";
import { withFileLock, atomicWriteSync } from "./fs-utils";

// ── 타입 ──────────────────────────────────────

export interface SavedProblem {
  id: string;
  createdAt: string;
  ownerId: string;
  ownerName?: string;

  itemType: "problem" | "lecture-note";
  linkedProblemNumber?: number;

  subject: string;
  unitName: string;
  type: string;
  points: number;
  difficulty: number;
  source: string;
  tags: string[];

  hasOriginal: boolean;
  hasProblemPng: boolean;
  hasContiPng: boolean;
  hasHtml: boolean;
  hasContiHtml: boolean;

  bodyHtml: string;
  headerText?: string;
  footerText?: string;
}

export interface LibraryIndex {
  version: number;
  problems: SavedProblem[];
}

export interface SaveProblemInput {
  itemType?: "problem" | "lecture-note";
  linkedProblemNumber?: number;
  subject: string;
  unitName: string;
  type: string;
  points: number;
  difficulty: number;
  source: string;
  bodyHtml: string;
  headerText?: string;
  footerText?: string;
  tags?: string[];
  originalImageBase64?: string;
  problemPngBase64: string;
  contiPngBase64?: string;
  html: string;
  contiHtml?: string;
  /** 도형 포함 여부 — 클라이언트가 analyze 결과를 기반으로 명시적으로 전달.
   *  과거에는 html.includes("diagram")로 추정했으나 오탐(class명 "diagram-area" 등)이 있어 명시 필드로 분리. */
  hasDiagram?: boolean;
}

export interface LibraryFilter {
  subject?: string;
  unitName?: string;
  type?: string;
  tag?: string;
  search?: string;
  difficulty?: number;
  ownerId?: string;
  itemType?: "problem" | "lecture-note";
  offset?: number;
  limit?: number;
}

// ── 경로 헬퍼 (유저별) ──────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const LIBRARIES_DIR = path.join(DATA_DIR, "libraries");

function userLibDir(userId: string) {
  return path.join(LIBRARIES_DIR, userId);
}
function userProblemsDir(userId: string) {
  return path.join(LIBRARIES_DIR, userId, "problems");
}
function userIndexPath(userId: string) {
  return path.join(LIBRARIES_DIR, userId, "library.json");
}

function ensureUserDirs(userId: string) {
  const libDir = userLibDir(userId);
  const probDir = userProblemsDir(userId);
  if (!fs.existsSync(libDir)) fs.mkdirSync(libDir, { recursive: true });
  if (!fs.existsSync(probDir)) fs.mkdirSync(probDir, { recursive: true });
}

// ── 인덱스 읽기/쓰기 ─────────────────────────

function readIndex(userId: string): LibraryIndex {
  ensureUserDirs(userId);
  const p = userIndexPath(userId);
  if (!fs.existsSync(p)) return { version: 1, problems: [] };
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function writeIndex(userId: string, index: LibraryIndex) {
  ensureUserDirs(userId);
  atomicWriteSync(userIndexPath(userId), JSON.stringify(index, null, 2));
}

// ── 자동 태그 생성 ────────────────────────────

export function generateAutoTags(input: {
  subject?: string;
  unitName?: string;
  type?: string;
  difficulty?: number;
  points?: number;
  source?: string;
  hasDiagram?: boolean;
}): string[] {
  const tags: string[] = [];
  if (input.subject) tags.push(input.subject);
  if (input.unitName) tags.push(input.unitName);
  if (input.type) tags.push(input.type);

  const diffLabels: Record<number, string> = {
    1: "기본", 2: "쉬움", 3: "보통", 4: "준킬러", 5: "킬러",
  };
  if (input.difficulty && diffLabels[input.difficulty]) {
    tags.push(diffLabels[input.difficulty]);
  }
  if (input.points) tags.push(`${input.points}점`);

  if (input.source) {
    const patterns: RegExp[] = [
      /(\d{4})/, /(수능|모의고사|학력평가|교육청|평가원)/,
      /(6월|9월|3월|4월|7월|10월|11월)/, /(고[123]|중[123])/, /(기출)/,
    ];
    for (const pat of patterns) {
      const m = input.source.match(pat);
      if (m) tags.push(m[1]);
    }
  }
  if (input.hasDiagram) tags.push("도형");
  return [...new Set(tags)];
}

// ── ID 생성 ───────────────────────────────────

function generateId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${date}-${rand}`;
}

// ── CRUD (유저별) ─────────────────────────────

/** 문제 저장 (유저의 라이브러리에) */
export async function saveProblem(userId: string, input: SaveProblemInput): Promise<SavedProblem> {
  return withFileLock(userIndexPath(userId), () => {
  const index = readIndex(userId);
  const id = generateId();
  const problemDir = path.join(userProblemsDir(userId), id);
  fs.mkdirSync(problemDir, { recursive: true });

  if (input.originalImageBase64) {
    fs.writeFileSync(
      path.join(problemDir, "original.png"),
      Buffer.from(input.originalImageBase64, "base64")
    );
  }
  fs.writeFileSync(
    path.join(problemDir, "problem.png"),
    Buffer.from(input.problemPngBase64, "base64")
  );
  if (input.contiPngBase64) {
    fs.writeFileSync(
      path.join(problemDir, "conti.png"),
      Buffer.from(input.contiPngBase64, "base64")
    );
  }
  fs.writeFileSync(path.join(problemDir, "problem.html"), input.html, "utf-8");
  if (input.contiHtml) {
    fs.writeFileSync(path.join(problemDir, "conti.html"), input.contiHtml, "utf-8");
  }

  const itemType = input.itemType || "problem";
  const autoTags = generateAutoTags({
    subject: input.subject,
    unitName: input.unitName,
    type: input.type,
    difficulty: input.difficulty,
    points: input.points,
    source: input.source,
    hasDiagram: input.hasDiagram === true,
  });
  if (itemType === "lecture-note") autoTags.push("강의노트");
  const allTags = [...new Set([...autoTags, ...(input.tags || [])])];

  const user = getUserById(userId);
  const saved: SavedProblem = {
    id,
    createdAt: new Date().toISOString(),
    ownerId: userId,
    ownerName: user?.displayName,
    itemType,
    linkedProblemNumber: input.linkedProblemNumber,
    subject: input.subject || "",
    unitName: input.unitName || "",
    type: input.type || "",
    points: input.points || 0,
    difficulty: input.difficulty || 0,
    source: input.source || "",
    tags: allTags,
    hasOriginal: !!input.originalImageBase64,
    hasProblemPng: true,
    hasContiPng: !!input.contiPngBase64,
    hasHtml: true,
    hasContiHtml: !!input.contiHtml,
    bodyHtml: input.bodyHtml || "",
    headerText: input.headerText,
    footerText: input.footerText,
  };

  atomicWriteSync(
    path.join(problemDir, "meta.json"),
    JSON.stringify(saved, null, 2)
  );

  index.problems.push(saved);
  writeIndex(userId, index);
  return saved;
  });
}

// ── 복수 유저 라이브러리 합산 ─────────────────

function mergeLibraries(userIds: string[]): SavedProblem[] {
  const all: SavedProblem[] = [];
  for (const uid of userIds) {
    const index = readIndex(uid);
    const user = getUserById(uid);
    for (const p of index.problems) {
      all.push({ ...p, ownerId: uid, ownerName: user?.displayName || uid });
    }
  }
  return all;
}

/** 라이브러리에 접근 가능한 유저 ID 목록 */
function getAccessibleUserIds(userId: string): string[] {
  const group = getGroupByUserId(userId);
  if (group) {
    // 그룹원 전체 (자신 포함)
    return [...new Set([userId, ...group.memberIds])];
  }
  return [userId];
}

/** 목록 조회 (유저 + 그룹 통합) */
export function listProblems(userId: string, filter: LibraryFilter = {}): {
  problems: SavedProblem[];
  total: number;
  subjects: string[];
  units: string[];
  allTags: string[];
  owners: { id: string; name: string }[];
} {
  const userIds = getAccessibleUserIds(userId);
  let results = mergeLibraries(userIds);

  // 필터링
  if (filter.itemType) results = results.filter((p) => (p.itemType || "problem") === filter.itemType);
  if (filter.subject) results = results.filter((p) => p.subject === filter.subject);
  if (filter.unitName) results = results.filter((p) => p.unitName === filter.unitName);
  if (filter.type) results = results.filter((p) => p.type === filter.type);
  if (filter.difficulty) results = results.filter((p) => p.difficulty === filter.difficulty);
  if (filter.tag) results = results.filter((p) => p.tags.includes(filter.tag!));
  if (filter.ownerId) results = results.filter((p) => p.ownerId === filter.ownerId);
  if (filter.search) {
    const q = filter.search.toLowerCase();
    results = results.filter(
      (p) =>
        p.bodyHtml.toLowerCase().includes(q) ||
        p.source.toLowerCase().includes(q) ||
        p.subject.toLowerCase().includes(q) ||
        p.unitName.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  results.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const total = results.length;
  const subjects = [...new Set(results.map((p) => p.subject).filter(Boolean))];
  const units = filter.subject
    ? [...new Set(results.filter((p) => p.subject === filter.subject).map((p) => p.unitName).filter(Boolean))]
    : [...new Set(results.map((p) => p.unitName).filter(Boolean))];
  const allTags = [...new Set(results.flatMap((p) => p.tags))].sort();
  const owners = [...new Map(results.map((p) => [p.ownerId, { id: p.ownerId, name: p.ownerName || p.ownerId }])).values()];

  const offset = filter.offset || 0;
  const limit = filter.limit || 50;
  results = results.slice(offset, offset + limit);

  return { problems: results, total, subjects, units, allTags, owners };
}

/** 관리자: 전체 유저 라이브러리 조회 */
export function listAllProblems(filter: LibraryFilter = {}): ReturnType<typeof listProblems> {
  if (!fs.existsSync(LIBRARIES_DIR)) {
    return { problems: [], total: 0, subjects: [], units: [], allTags: [], owners: [] };
  }
  const allUserIds = fs.readdirSync(LIBRARIES_DIR).filter((d) => {
    return fs.statSync(path.join(LIBRARIES_DIR, d)).isDirectory();
  });

  let results = mergeLibraries(allUserIds);

  if (filter.itemType) results = results.filter((p) => (p.itemType || "problem") === filter.itemType);
  if (filter.subject) results = results.filter((p) => p.subject === filter.subject);
  if (filter.unitName) results = results.filter((p) => p.unitName === filter.unitName);
  if (filter.type) results = results.filter((p) => p.type === filter.type);
  if (filter.difficulty) results = results.filter((p) => p.difficulty === filter.difficulty);
  if (filter.tag) results = results.filter((p) => p.tags.includes(filter.tag!));
  if (filter.ownerId) results = results.filter((p) => p.ownerId === filter.ownerId);
  if (filter.search) {
    const q = filter.search.toLowerCase();
    results = results.filter(
      (p) =>
        p.bodyHtml.toLowerCase().includes(q) ||
        p.source.toLowerCase().includes(q) ||
        p.subject.toLowerCase().includes(q) ||
        p.unitName.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  results.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const total = results.length;
  const subjects = [...new Set(results.map((p) => p.subject).filter(Boolean))];
  const units = [...new Set(results.map((p) => p.unitName).filter(Boolean))];
  const allTags = [...new Set(results.flatMap((p) => p.tags))].sort();
  const owners = [...new Map(results.map((p) => [p.ownerId, { id: p.ownerId, name: p.ownerName || p.ownerId }])).values()];

  const offset = filter.offset || 0;
  const limit = filter.limit || 50;
  results = results.slice(offset, offset + limit);

  return { problems: results, total, subjects, units, allTags, owners };
}

/** 문제 파일 찾기 (유저 폴더 순회) */
function findProblemPath(problemId: string, accessibleUserIds?: string[]): { userId: string; problemDir: string } | null {
  if (!fs.existsSync(LIBRARIES_DIR)) return null;
  const dirs = accessibleUserIds || fs.readdirSync(LIBRARIES_DIR);
  for (const uid of dirs) {
    const problemDir = path.join(LIBRARIES_DIR, uid, "problems", problemId);
    if (fs.existsSync(problemDir)) return { userId: uid, problemDir };
  }
  return null;
}

/** 개별 문제 조회 */
export function getProblem(problemId: string, userId?: string): SavedProblem | null {
  const userIds = userId ? getAccessibleUserIds(userId) : undefined;
  const found = findProblemPath(problemId, userIds);
  if (!found) return null;
  const metaPath = path.join(found.problemDir, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
}

/** 문제 파일 읽기 (PNG) */
export function getProblemFile(
  problemId: string,
  fileType: "original" | "problem" | "conti",
  userId?: string
): Buffer | null {
  const userIds = userId ? getAccessibleUserIds(userId) : undefined;
  const found = findProblemPath(problemId, userIds);
  if (!found) return null;
  const filenames: Record<string, string> = {
    original: "original.png",
    problem: "problem.png",
    conti: "conti.png",
  };
  const filePath = path.join(found.problemDir, filenames[fileType]);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

/** 태그 수정 (본인 문제만) */
export async function updateProblemTags(
  userId: string,
  problemId: string,
  tags: string[]
): Promise<SavedProblem | null> {
  return withFileLock(userIndexPath(userId), () => {
    const index = readIndex(userId);
    const problem = index.problems.find((p) => p.id === problemId);
    if (!problem) return null;

    problem.tags = [...new Set(tags)];
    const metaPath = path.join(userProblemsDir(userId), problemId, "meta.json");
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      meta.tags = problem.tags;
      atomicWriteSync(metaPath, JSON.stringify(meta, null, 2));
    }
    writeIndex(userId, index);
    return problem;
  });
}

/** 문제 삭제 (본인 문제만) */
export async function deleteProblem(userId: string, problemId: string): Promise<boolean> {
  return withFileLock(userIndexPath(userId), () => {
    const index = readIndex(userId);
    const idx = index.problems.findIndex((p) => p.id === problemId);
    if (idx === -1) return false;

    index.problems.splice(idx, 1);
    writeIndex(userId, index);

    const problemDir = path.join(userProblemsDir(userId), problemId);
    if (fs.existsSync(problemDir)) {
      fs.rmSync(problemDir, { recursive: true, force: true });
    }
    return true;
  });
}

// ── 마이그레이션 (기존 data/library.json → admin 유저) ──

export function migrateOldLibrary(adminUserId: string): number {
  const oldIndexPath = path.join(DATA_DIR, "library.json");
  const oldProblemsDir = path.join(DATA_DIR, "problems");

  if (!fs.existsSync(oldIndexPath)) return 0;

  const oldIndex: LibraryIndex = JSON.parse(fs.readFileSync(oldIndexPath, "utf-8"));
  if (oldIndex.problems.length === 0) return 0;

  ensureUserDirs(adminUserId);
  const newIndex = readIndex(adminUserId);

  for (const problem of oldIndex.problems) {
    const oldDir = path.join(oldProblemsDir, problem.id);
    const newDir = path.join(userProblemsDir(adminUserId), problem.id);

    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      fs.cpSync(oldDir, newDir, { recursive: true });
    }

    if (!newIndex.problems.find((p) => p.id === problem.id)) {
      newIndex.problems.push({ ...problem, ownerId: adminUserId });
    }
  }

  writeIndex(adminUserId, newIndex);

  // 기존 파일 정리
  fs.renameSync(oldIndexPath, oldIndexPath + ".bak");
  if (fs.existsSync(oldProblemsDir)) {
    fs.renameSync(oldProblemsDir, oldProblemsDir + ".bak");
  }

  console.log(`마이그레이션 완료: ${oldIndex.problems.length}개 문제 → ${adminUserId}`);
  return oldIndex.problems.length;
}
