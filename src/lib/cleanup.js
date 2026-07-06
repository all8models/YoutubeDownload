import fs from 'fs';
import path from 'path';

/**
 * 오래된 임시 다운로드 파일을 삭제합니다. (1시간 이상 경과한 파일)
 */
export async function cleanupOldTempFiles() {
  const tempDir = path.join(process.cwd(), 'tmp');
  try {
    if (!fs.existsSync(tempDir)) {
      return;
    }
    const files = await fs.promises.readdir(tempDir);
    const now = Date.now();
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
