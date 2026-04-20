/**
 * 유저 관리 — data/users.json 기반 CRUD
 */
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { withFileLock, atomicWriteSync } from "./fs-utils";

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  role: "admin" | "user";
  groupId?: string;
  createdAt: string;
}

export interface UsersIndex {
  users: User[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const BCRYPT_ROUNDS = 10;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readUsers(): UsersIndex {
  ensureDir();
  if (!fs.existsSync(USERS_PATH)) {
    return { users: [] };
  }
  return JSON.parse(fs.readFileSync(USERS_PATH, "utf-8"));
}

function writeUsers(index: UsersIndex) {
  ensureDir();
  atomicWriteSync(USERS_PATH, JSON.stringify(index, null, 2));
}

function generateId(): string {
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 초기 admin 계정 자동 생성 (users.json 없거나 비어있을 때) */
export async function ensureAdminExists(): Promise<void> {
  return withFileLock(USERS_PATH, async () => {
    const index = readUsers();
    const hasAdmin = index.users.some((u) => u.role === "admin");
    if (hasAdmin) return;

    const password = process.env.ADMIN_PASSWORD || "admin1234";
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    index.users.push({
      id: generateId(),
      username: "admin",
      passwordHash: hash,
      displayName: "관리자",
      role: "admin",
      createdAt: new Date().toISOString(),
    });

    writeUsers(index);
    console.log("초기 관리자 계정 생성됨 (admin / ADMIN_PASSWORD 환경변수)");
  });
}

/** 로그인 인증 */
export async function authenticateUser(
  username: string,
  password: string
): Promise<User | null> {
  await ensureAdminExists();
  const index = readUsers();
  const user = index.users.find((u) => u.username === username);
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? user : null;
}

/** 유저 조회 (ID) */
export function getUserById(id: string): User | null {
  const index = readUsers();
  return index.users.find((u) => u.id === id) || null;
}

/** 유저 조회 (username) */
export function getUserByUsername(username: string): User | null {
  const index = readUsers();
  return index.users.find((u) => u.username === username) || null;
}

/** 전체 유저 목록 (비밀번호 제외) */
export function listUsers(): Omit<User, "passwordHash">[] {
  const index = readUsers();
  return index.users.map(({ passwordHash: _, ...rest }) => rest);
}

/** 유저 생성 (관리자용) */
export async function createUser(input: {
  username: string;
  password: string;
  displayName: string;
  role?: "admin" | "user";
}): Promise<Omit<User, "passwordHash">> {
  return withFileLock(USERS_PATH, async () => {
    const index = readUsers();

    if (index.users.some((u) => u.username === input.username)) {
      throw new Error("이미 존재하는 아이디입니다");
    }

    const hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const user: User = {
      id: generateId(),
      username: input.username,
      passwordHash: hash,
      displayName: input.displayName,
      role: input.role || "user",
      createdAt: new Date().toISOString(),
    };

    index.users.push(user);
    writeUsers(index);

    const { passwordHash: _, ...safe } = user;
    return safe;
  });
}

/** 유저 수정 (관리자용) */
export async function updateUser(
  id: string,
  updates: {
    displayName?: string;
    role?: "admin" | "user";
    groupId?: string | null;
    password?: string;
  }
): Promise<Omit<User, "passwordHash"> | null> {
  return withFileLock(USERS_PATH, async () => {
    const index = readUsers();
    const user = index.users.find((u) => u.id === id);
    if (!user) return null;

    if (updates.displayName !== undefined) user.displayName = updates.displayName;
    if (updates.role !== undefined) user.role = updates.role;
    if (updates.groupId !== undefined) {
      user.groupId = updates.groupId || undefined;
    }
    if (updates.password) {
      user.passwordHash = await bcrypt.hash(updates.password, BCRYPT_ROUNDS);
    }

    writeUsers(index);
    const { passwordHash: _, ...safe } = user;
    return safe;
  });
}

/** 유저의 그룹 설정 (그룹 관리에서 사용).
 *  users.json을 수정하므로 USERS_PATH 락을 직접 획득한다.
 *  호출부(groups.ts)는 GROUPS_PATH 락 내부에서 이 함수를 await하므로
 *  락 순서는 항상 GROUPS_PATH → USERS_PATH 단방향이 유지되어 교차 데드락 없음.
 */
export async function setUserGroup(userId: string, groupId: string | undefined): Promise<boolean> {
  return withFileLock(USERS_PATH, () => {
    const index = readUsers();
    const user = index.users.find((u) => u.id === userId);
    if (!user) return false;
    user.groupId = groupId;
    writeUsers(index);
    return true;
  });
}

/** 유저 삭제 */
export async function deleteUser(id: string): Promise<boolean> {
  return withFileLock(USERS_PATH, async () => {
    const index = readUsers();
    const idx = index.users.findIndex((u) => u.id === id);
    if (idx === -1) return false;

    // admin은 최소 1명 유지
    const user = index.users[idx];
    if (user.role === "admin") {
      const adminCount = index.users.filter((u) => u.role === "admin").length;
      if (adminCount <= 1) throw new Error("마지막 관리자는 삭제할 수 없습니다");
    }

    index.users.splice(idx, 1);
    writeUsers(index);
    return true;
  });
}
