import fs from 'fs';
import path from 'path';

// 마지막 클린업 실행 타임스탬프 (불필요한 디스크 I/O 방지용 10분 쓰로틀링)
let lastCleanupTime = 0;
const CLEANUP_THROTTLE_MS = 10 * 60 * 1000;

/**
 * 오래된 임시 다운로드 파일을 삭제합니다. (1시간 이상 경과한 파일)
 * 요청마다 발생하는 과도한 디스크 탐색을 줄이기 위해 최소 10분 간격으로만 실행됩니다.
 */
export async function cleanupOldTempFiles() {
  const now = Date.now();
  if (now - lastCleanupTime < CLEANUP_THROTTLE_MS) {
    return; // 10분 이내 재실행 방지
  }
  lastCleanupTime = now;

  const tempDir = path.join(process.cwd(), 'tmp');
  try {
    if (!fs.existsSync(tempDir)) {
      return;
    }
    const files = await fs.promises.readdir(tempDir);
    const oneHour = 60 * 60 * 1000; // 1시간 (밀리초)

    for (const file of files) {
      const filePath = path.join(tempDir, file);
      try {
        const stats = await fs.promises.stat(filePath);
        if (stats.isFile() && now - stats.mtimeMs > oneHour) {
          await fs.promises.unlink(filePath);
          console.log(`[cleanup] Deleted old temp file: ${file}`);
        }
      } catch (fileErr) {
        console.error(`[cleanup] Failed to check/delete file ${file}:`, fileErr);
      }
    }
  } catch (err) {
    console.error('[cleanup] Failed to clean up old temp files:', err);
  }
}
