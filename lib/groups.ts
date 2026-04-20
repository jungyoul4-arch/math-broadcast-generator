/**
 * 그룹 관리 — 유저 연합 시스템
 * 같은 그룹 유저들은 라이브러리를 통합 공유
 */
import fs from "fs";
import path from "path";
import { setUserGroup } from "./users";
import { withFileLock, atomicWriteSync } from "./fs-utils";

export interface Group {
  id: string;
  name: string;
  description?: string;
  memberIds: string[];
  createdAt: string;
  createdBy: string;
}

interface GroupsIndex {
  groups: Group[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const GROUPS_PATH = path.join(DATA_DIR, "groups.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readGroups(): GroupsIndex {
  ensureDir();
  if (!fs.existsSync(GROUPS_PATH)) return { groups: [] };
  return JSON.parse(fs.readFileSync(GROUPS_PATH, "utf-8"));
}

function writeGroups(index: GroupsIndex) {
  ensureDir();
  atomicWriteSync(GROUPS_PATH, JSON.stringify(index, null, 2));
}

function generateId(): string {
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** 전체 그룹 목록 */
export function listGroups(): Group[] {
  return readGroups().groups;
}

/** 그룹 조회 */
export function getGroup(id: string): Group | null {
  return readGroups().groups.find((g) => g.id === id) || null;
}

/** 유저가 속한 그룹 조회 */
export function getGroupByUserId(userId: string): Group | null {
  return readGroups().groups.find((g) => g.memberIds.includes(userId)) || null;
}

/** 그룹 생성 */
export async function createGroup(input: {
  name: string;
  description?: string;
  createdBy: string;
}): Promise<Group> {
  return withFileLock(GROUPS_PATH, () => {
    const index = readGroups();
    const group: Group = {
      id: generateId(),
      name: input.name,
      description: input.description,
      memberIds: [],
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    };
    index.groups.push(group);
    writeGroups(index);
    return group;
  });
}

/** 그룹에 멤버 추가 (groups.json과 users.json 양쪽 업데이트) */
export async function addMemberToGroup(groupId: string, userId: string): Promise<Group | null> {
  return withFileLock(GROUPS_PATH, async () => {
    const index = readGroups();
    const group = index.groups.find((g) => g.id === groupId);
    if (!group) return null;

    // 다른 그룹에서 제거
    for (const g of index.groups) {
      if (g.id !== groupId) {
        const idx = g.memberIds.indexOf(userId);
        if (idx !== -1) {
          g.memberIds.splice(idx, 1);
        }
      }
    }

    if (!group.memberIds.includes(userId)) {
      group.memberIds.push(userId);
    }

    writeGroups(index);
    await setUserGroup(userId, groupId);
    return group;
  });
}

/** 그룹에서 멤버 제거 */
export async function removeMemberFromGroup(groupId: string, userId: string): Promise<Group | null> {
  return withFileLock(GROUPS_PATH, async () => {
    const index = readGroups();
    const group = index.groups.find((g) => g.id === groupId);
    if (!group) return null;

    group.memberIds = group.memberIds.filter((id) => id !== userId);
    writeGroups(index);
    await setUserGroup(userId, undefined);
    return group;
  });
}

/** 그룹 수정 */
export async function updateGroup(
  id: string,
  updates: { name?: string; description?: string }
): Promise<Group | null> {
  return withFileLock(GROUPS_PATH, () => {
    const index = readGroups();
    const group = index.groups.find((g) => g.id === id);
    if (!group) return null;

    if (updates.name !== undefined) group.name = updates.name;
    if (updates.description !== undefined) group.description = updates.description;

    writeGroups(index);
    return group;
  });
}

/** 그룹 삭제 (멤버들의 groupId도 해제) */
export async function deleteGroup(id: string): Promise<boolean> {
  return withFileLock(GROUPS_PATH, async () => {
    const index = readGroups();
    const idx = index.groups.findIndex((g) => g.id === id);
    if (idx === -1) return false;

    const group = index.groups[idx];
    for (const memberId of group.memberIds) {
      await setUserGroup(memberId, undefined);
    }

    index.groups.splice(idx, 1);
    writeGroups(index);
    return true;
  });
}
