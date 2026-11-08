/**
 * yt-dlp & ffmpeg 실행 래퍼 (Wrapper)
 *
 * - Docker(Debian Bookworm, Python 3.11): node_modules 번들 yt-dlp 및 시스템/번들 ffmpeg 자동 감지
 * - macOS (시스템 Python 3.9): Homebrew Python 3.12 기반 yt-dlp 사용
 * - 동시성 제어(Semaphore)를 통해 무분별한 서브프로세스 스폰으로 인한 CPU/메모리 고갈(DoS) 방지
 *
 * 모든 API 라우트는 이 파일을 통해 youtube-dl-exec를 사용해야 합니다.
 */

import { create } from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { trace, SpanStatusCode } from '@opentelemetry/api';

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
  if (
    process.env.YOUTUBE_DL_BIN &&
    fs.existsSync(/*turbopackIgnore: true*/ process.env.YOUTUBE_DL_BIN)
  ) {
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
          if (fs.existsSync(/*turbopackIgnore: true*/ homebrewPath)) {
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
    if (whichPath && fs.existsSync(/*turbopackIgnore: true*/ whichPath)) {
      return whichPath;
    }
  } catch {}

  // 4. npm 번들 (Docker / Python 3.10+ 환경에서 정상 동작)
  const bundledPath = path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    'node_modules',
    'youtube-dl-exec',
    'bin',
    'yt-dlp'
  );
  if (fs.existsSync(/*turbopackIgnore: true*/ bundledPath)) {
    return bundledPath;
  }

  return null;
}

/**
 * ffmpeg 바이너리 경로 탐색
 *
 * 우선순위:
 * 1. FFMPEG_BIN 환경 변수
 * 2. node_modules/ffmpeg-static/ffmpeg (로컬 개발 환경)
 * 3. 시스템 PATH (/usr/bin/ffmpeg, /opt/homebrew/bin/ffmpeg 등 - Docker Standalone 환경)
 */
function findFfmpegBinary() {
  if (
    process.env.FFMPEG_BIN &&
    fs.existsSync(/*turbopackIgnore: true*/ process.env.FFMPEG_BIN)
  ) {
    return process.env.FFMPEG_BIN;
  }

  const bundledFfmpeg = path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    'node_modules',
    'ffmpeg-static',
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  );
  if (fs.existsSync(/*turbopackIgnore: true*/ bundledFfmpeg)) {
    return bundledFfmpeg;
  }

  const commonPaths = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
  for (const candidate of commonPaths) {
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
      return candidate;
    }
  }

  try {
    const whichFfmpeg = execSync('which ffmpeg', { encoding: 'utf8' }).trim();
    if (whichFfmpeg && fs.existsSync(/*turbopackIgnore: true*/ whichFfmpeg)) {
      return whichFfmpeg;
    }
  } catch {}

  return null;
}

const ytdlBinary = findYtdlBinary();
export const ffmpegBinary = findFfmpegBinary();

if (ytdlBinary) {
  console.log(`[ytdl] Using yt-dlp: ${ytdlBinary}`);
} else {
  console.error(
    '[ytdl] yt-dlp not found. macOS: pip3 install yt-dlp / Linux: apt install yt-dlp'
  );
}

if (ffmpegBinary) {
  console.log(`[ytdl] Using ffmpeg: ${ffmpegBinary}`);
}

/**
 * 환경에 맞는 yt-dlp 바이너리로 구성된 youtube-dl-exec 인스턴스
 */
const youtubedl = ytdlBinary ? create(ytdlBinary) : null;

const tracer = trace.getTracer('youtube-downloader-ytdl');

/**
 * 경량 세마포어(Semaphore)를 통한 yt-dlp 동시 프로세스 수 제한
 * 다수의 동시 요청 시 서버 CPU/메모리 스파이크 방지
 */
const MAX_CONCURRENT_YTDL = Math.max(
  1,
  parseInt(process.env.YTDL_MAX_CONCURRENCY || '4', 10) || 4
);
let activeCount = 0;
const waitQueue = [];

function acquireSlot() {
  if (activeCount < MAX_CONCURRENT_YTDL) {
    activeCount += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitQueue.push(resolve);
  });
}

function releaseSlot() {
  if (waitQueue.length > 0) {
    const next = waitQueue.shift();
    next();
  } else {
    activeCount = Math.max(0, activeCount - 1);
  }
}

export default async function ytdl(url, flags = {}) {
  if (!youtubedl) {
    throw new Error(
      'yt-dlp binary not found. Install it: pip3 install yt-dlp'
    );
  }

  if (typeof url !== 'string' || url.trim().startsWith('-')) {
    throw new Error('Invalid URL parameter');
  }

  // yt-dlp 안정적인 다운로드 및 멀티스레드 병렬 다운로드 옵션
  const mergedFlags = {
    retries: 5,
    fragmentRetries: 5,
    concurrentFragments: 4, // 4개 스레드 병렬 조각 다운로드로 속도 대폭 향상
    ...flags,
  };

  // SSL 인증서 검증 우회는 환경변수(YTDL_NO_CHECK_CERTIFICATE=true)가 설정된 경우에만 활성화 (기본값: false로 MITM 방어)
  if (
    mergedFlags.noCheckCertificate === undefined &&
    process.env.YTDL_NO_CHECK_CERTIFICATE === 'true'
  ) {
    mergedFlags.noCheckCertificate = true;
  }

  await acquireSlot();
  try {
    return await tracer.startActiveSpan('yt-dlp-execution', async (span) => {
      try {
        span.setAttribute('yt-dlp.url', url);
        span.setAttribute('yt-dlp.flags', JSON.stringify(mergedFlags));
        span.setAttribute('yt-dlp.active_concurrency', activeCount);

        const result = await youtubedl(url, mergedFlags);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message || 'yt-dlp execution failed',
        });
        throw error;
      } finally {
        span.end();
      }
    });
  } finally {
    releaseSlot();
  }
}

