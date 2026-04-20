/**
 * 파일시스템 유틸 — 동시 쓰기 안전화
 *
 * Railway 단일 프로세스 환경을 전제로 in-memory mutex를 사용.
 * proper-lockfile과 달리 디스크 `.lock` 파일을 생성하지 않으므로
 * 컨테이너 비정상 종료 시 stale lock 문제가 없음.
 */
import fs from "fs";
import path from "path";

// 파일 경로별 chain된 Promise로 read-modify-write 직렬화
const _locks = new Map<string, Promise<unknown>>();

/**
 * 파일 경로를 키로 하는 async mutex.
 * 같은 경로에 대한 read-modify-write 시퀀스를 직렬화하여 인터리빙 방지.
 */
export async function withFileLock<T>(
  filepath: string,
  fn: () => Promise<T> | T
): Promise<T> {
  const prev = _locks.get(filepath) ?? Promise.resolve();
  const current = prev.then(() => fn());
  // reject 전파하지 않고 다음 락이 계속 실행되도록 체인 보호.
  // tail 참조를 변수에 바인딩해야 Map cleanup이 정확히 동작함
  // (`.catch()`는 호출마다 새 Promise 반환).
  const tail = current.catch(() => undefined);
  _locks.set(filepath, tail);
  try {
    return await current;
  } finally {
    // 마지막 참조였으면 Map에서 제거 (메모리 누수 방지)
    if (_locks.get(filepath) === tail) {
      _locks.delete(filepath);
    }
  }
}

/**
 * Atomic write — 동일 디렉토리의 임시 파일로 쓴 뒤 rename.
 * POSIX에서 rename은 원자적이므로 도중 크래시 시에도 파일이 반쪽으로 손상되지 않음.
 * 기존 `fs.writeFileSync` 대체용 (동기 인터페이스 유지).
 */
export function atomicWriteSync(filepath: string, data: string | Buffer): void {
  const dir = path.dirname(filepath);
  const base = path.basename(filepath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filepath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}
