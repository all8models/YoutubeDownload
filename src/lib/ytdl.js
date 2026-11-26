/**
 * yt-dlp & ffmpeg 고성능 실행 래퍼 (Wrapper)
 *
 * - 사전 컴파일된 시스템 yt-dlp(/usr/local/bin/yt-dlp 등) 우선 탐색으로 Zipapp 기동 오버헤드(~550ms → ~130ms) 단축
 * - 메타데이터 조회 풀(meta)과 미디어 다운로드 풀(download)의 이원화 세마포어(Bulkhead)로 큐 블로킹 방지
 * - 클라이언트 연결 종료(AbortSignal) 시 대기열 즉시 이탈 및 실행 중인 자식 프로세스 SIGTERM 회수
 * - --load-info-json 기반 사전 추출 메타데이터 재사용(실패 시 자동 폴백) 지원
 */

import { create, args as buildYtdlArgs } from 'youtube-dl-exec';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { trace, SpanStatusCode } from '@opentelemetry/api';

/**
 * yt-dlp 바이너리 경로 탐색
 *
 * 우선순위:
 * 1. YOUTUBE_DL_BIN 환경 변수 (컨테이너/운영 환경 즉시 바인딩, 프로세스 탐색 생략)
 * 2. 사전 설치된 표준 경로 (/usr/local/bin/yt-dlp, /opt/homebrew/bin/yt-dlp)
 * 3. system PATH (which yt-dlp)
 * 4. npm 번들 Zipapp (node_modules/youtube-dl-exec/bin/yt-dlp)
 */
function findYtdlBinary() {
  if (
    process.env.YOUTUBE_DL_BIN &&
    fs.existsSync(/*turbopackIgnore: true*/ process.env.YOUTUBE_DL_BIN)
  ) {
    return process.env.YOUTUBE_DL_BIN;
  }

  // 사전 컴파일된 pip/Homebrew 바이너리를 Zipapp보다 우선 탐색하여 스폰 오버헤드 최소화
  const fastSystemPaths = ['/usr/local/bin/yt-dlp', '/opt/homebrew/bin/yt-dlp', '/usr/bin/yt-dlp'];
  for (const candidate of fastSystemPaths) {
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
      return candidate;
    }
  }

  try {
    const whichPath = execSync('which yt-dlp', { encoding: 'utf8' }).trim();
    if (whichPath && fs.existsSync(/*turbopackIgnore: true*/ whichPath)) {
      return whichPath;
    }
  } catch { }

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
 */
function findFfmpegBinary() {
  if (
    process.env.FFMPEG_BIN &&
    fs.existsSync(/*turbopackIgnore: true*/ process.env.FFMPEG_BIN)
  ) {
    return process.env.FFMPEG_BIN;
  }

  const commonPaths = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
  for (const candidate of commonPaths) {
    if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
      return candidate;
    }
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

  try {
    const whichFfmpeg = execSync('which ffmpeg', { encoding: 'utf8' }).trim();
    if (whichFfmpeg && fs.existsSync(/*turbopackIgnore: true*/ whichFfmpeg)) {
      return whichFfmpeg;
    }
  } catch { }

  return null;
}

export const ytdlBinary = findYtdlBinary();
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
 * yt-dlp 플레이어 JS 서명 캐시 디렉토리 반환
 */
export function getYtdlCacheDir() {
  return process.env.YTDL_CACHE_DIR || '';
}

const youtubedl = ytdlBinary ? create(ytdlBinary) : null;
const tracer = trace.getTracer('youtube-downloader-ytdl');

/**
 * AbortSignal을 지원하는 비동기 세마포어 생성기
 */
function createSemaphore(maxConcurrency) {
  let active = 0;
  const queue = [];

  function release() {
    if (queue.length > 0) {
      const entry = queue.shift();
      if (entry.cleanupAbort) entry.cleanupAbort();
      entry.resolve(release);
    } else {
      active = Math.max(0, active - 1);
    }
  }

  function acquire(signal) {
    if (signal?.aborted) {
      const abortErr = new Error('Request aborted before acquiring slot');
      abortErr.name = 'AbortError';
      return Promise.reject(abortErr);
    }

    if (active < maxConcurrency) {
      active += 1;
      return Promise.resolve(release);
    }

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, cleanupAbort: null };
      if (signal) {
        const onAbort = () => {
          const idx = queue.indexOf(entry);
          if (idx !== -1) queue.splice(idx, 1);
          const abortErr = new Error('Request aborted while waiting in queue');
          abortErr.name = 'AbortError';
          reject(abortErr);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        entry.cleanupAbort = () => signal.removeEventListener('abort', onAbort);
      }
      queue.push(entry);
    });
  }

  return {
    acquire,
    get activeCount() {
      return active;
    },
  };
}

// 1. 메타데이터 조회 전용 풀 (빠른 응답 보장, 다운로드 작업에 블로킹되지 않음)
const META_CONCURRENCY = Math.max(
  2,
  parseInt(process.env.YTDL_META_CONCURRENCY || '6', 10) || 6
);
const metaSemaphore = createSemaphore(META_CONCURRENCY);

// 2. 미디어 다운로드/변환 전용 풀 (CPU/네트워크 대역폭 보호)
const DOWNLOAD_CONCURRENCY = Math.max(
  1,
  parseInt(
    process.env.YTDL_DOWNLOAD_CONCURRENCY || process.env.YTDL_MAX_CONCURRENCY || '4',
    10
  ) || 4
);
const downloadSemaphore = createSemaphore(DOWNLOAD_CONCURRENCY);

/**
 * 스트리밍 파이프라인 등에서 다운로드 슬롯을 직접 점유할 때 사용합니다.
 * @param {AbortSignal} [signal]
 * @returns {Promise<() => void>} release 함수
 */
export function acquireDownloadSlot(signal) {
  return downloadSemaphore.acquire(signal);
}

/**
 * --load-info-json 전용 실행 헬퍼 (위치 인자 url 없이 info JSON 파일만 로드)
 */
function execWithInfoJson(infoJsonPath, mergedFlags, signal) {
  return new Promise((resolve, reject) => {
    const cliArgs = ['--load-info-json', infoJsonPath, ...buildYtdlArgs(mergedFlags)];
    const child = spawn(ytdlBinary, cliArgs, {
      signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stderrChunks = [];
    child.stdout.resume(); // 출력 버퍼 블로킹 방지
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        reject(new Error(stderr || `yt-dlp --load-info-json exited with code ${code}`));
      }
    });
  });
}

/**
 * yt-dlp 실행 함수
 *
 * @param {string} url - 대상 YouTube URL
 * @param {Object} [flags={}] - yt-dlp CLI 플래그 객체
 * @param {{ pool?: 'meta'|'download', signal?: AbortSignal, infoJsonPath?: string }} [options={}]
 */
export default async function ytdl(url, flags = {}, options = {}) {
  if (!youtubedl) {
    throw new Error('yt-dlp binary not found. Install it: pip3 install yt-dlp');
  }

  if (typeof url !== 'string' || url.trim().startsWith('-')) {
    throw new Error('Invalid URL parameter');
  }

  const isDownloadTask =
    options.pool === 'download' ||
    Boolean(flags.output || flags.extractAudio || flags.mergeOutputFormat);
  const semaphore = isDownloadTask ? downloadSemaphore : metaSemaphore;
  const poolName = isDownloadTask ? 'download' : 'meta';

  const cacheDir = getYtdlCacheDir();
  const mergedFlags = {
    retries: 5,
    fragmentRetries: 5,
    concurrentFragments: isDownloadTask ? 8 : 4,
    ...(cacheDir ? { cacheDir } : {}),
    ...flags,
  };

  if (
    mergedFlags.noCheckCertificate === undefined &&
    process.env.YTDL_NO_CHECK_CERTIFICATE === 'true'
  ) {
    mergedFlags.noCheckCertificate = true;
  }

  const release = await semaphore.acquire(options.signal);
  try {
    return await tracer.startActiveSpan('yt-dlp-execution', async (span) => {
      try {
        span.setAttribute('yt-dlp.url', url);
        span.setAttribute('yt-dlp.pool', poolName);
        span.setAttribute('yt-dlp.active_concurrency', semaphore.activeCount);

        const spawnOpts = options.signal ? { signal: options.signal } : {};

        // 사전 추출된 Info-JSON이 있는 경우 YouTube 재추출을 건너뛰고 즉시 스트림 다운로드 시도
        if (options.infoJsonPath && fs.existsSync(/*turbopackIgnore: true*/ options.infoJsonPath)) {
          try {
            span.setAttribute('yt-dlp.reused_info_json', true);
            await execWithInfoJson(options.infoJsonPath, mergedFlags, options.signal);
            span.setStatus({ code: SpanStatusCode.OK });
            return '';
          } catch (reuseErr) {
            if (reuseErr.name === 'AbortError' || options.signal?.aborted) {
              throw reuseErr;
            }
            console.warn('[ytdl] --load-info-json fallback to live extraction:', reuseErr.message);
            span.setAttribute('yt-dlp.reused_info_json_fallback', true);
          }
        }

        const result = await youtubedl(url, mergedFlags, spawnOpts);
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
    release();
  }
}
