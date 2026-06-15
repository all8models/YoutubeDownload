/**
 * yt-dlp 실행 래퍼 (Wrapper)
 *
 * - Docker(Debian Bookworm, Python 3.11): node_modules 번들 yt-dlp 그대로 사용
 * - macOS (시스템 Python 3.9): Homebrew Python 3.12 기반 yt-dlp 사용
 *
 * 모든 API 라우트는 이 파일을 통해 youtube-dl-exec를 사용해야 합니다.
 */

import { create } from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * yt-dlp 바이너리 경로 탐색
 *
 * 우선순위:
 * 1. YOUTUBE_DL_BIN 환경 변수 (명시적 지정)
 * 2. macOS + Python < 3.10 → Homebrew yt-dlp (/opt/homebrew/bin/yt-dlp)
 * 3. system PATH (which yt-dlp)
 * 4. npm 번들 (node_modules/youtube-dl-exec/bin/yt-dlp)
 */
function findYtdlBinary() {
  // 1. 환경 변수
  if (process.env.YOUTUBE_DL_BIN && fs.existsSync(process.env.YOUTUBE_DL_BIN)) {
    return process.env.YOUTUBE_DL_BIN;
  }

  // 2. macOS에서 시스템 Python이 3.9 이하이면 Homebrew 경로 우선 사용
  const isMac = process.platform === 'darwin';
  if (isMac) {
    try {
      const pyVer = execSync('python3 --version 2>/dev/null || python3 -V', {
        encoding: 'utf8',
      }).trim();
      const match = pyVer.match(/Python (\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        if (major < 3 || (major === 3 && minor < 10)) {
          // Python 3.9 이하 → Homebrew yt-dlp 사용
          const homebrewPath = '/opt/homebrew/bin/yt-dlp';
          if (fs.existsSync(homebrewPath)) {
            return homebrewPath;
          }
        }
      }
    } catch {
      // python3 없으면 무시하고 계속 진행
    }
  }

  // 3. system PATH
  try {
    const whichPath = execSync('which yt-dlp', { encoding: 'utf8' }).trim();
    if (whichPath && fs.existsSync(whichPath)) {
      return whichPath;
    }
  } catch {}

  // 4. npm 번들 (Docker / Python 3.10+ 환경에서 정상 동작)
  const bundledPath = path.join(
    process.cwd(),
    'node_modules',
    'youtube-dl-exec',
    'bin',
    'yt-dlp'
  );
  if (fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  return null;
}

const ytdlBinary = findYtdlBinary();

if (ytdlBinary) {
  console.log(`[ytdl] Using: ${ytdlBinary}`);
} else {
  console.error(
    '[ytdl] yt-dlp not found. macOS: pip3 install yt-dlp / Linux: apt install yt-dlp'
  );
}

/**
 * 환경에 맞는 yt-dlp 바이너리로 구성된 youtube-dl-exec 인스턴스
 */
const youtubedl = ytdlBinary ? create(ytdlBinary) : null;

export default async function ytdl(url, flags) {
  if (!youtubedl) {
    throw new Error(
      'yt-dlp binary not found. Install it: pip3 install yt-dlp'
    );
  }
  return youtubedl(url, flags);
}
