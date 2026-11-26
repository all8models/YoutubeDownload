import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { rawInfoJsonCache, extractVideoId } from './cache';

// 마지막 클린업 실행 타임스탬프 (불필요한 디스크 I/O 방지용 10분 쓰로틀링)
let lastCleanupTime = 0;
const CLEANUP_THROTTLE_MS = 10 * 60 * 1000;
let initializedTempDir = null;

/**
 * 임시 디렉토리 경로를 반환하고 최초 1회 생성합니다.
 * - Docker 환경에서는 tmpfs(RAM 디스크)로 마운트된 /app/tmp를 사용하여 물리 디스크 I/O를 제거합니다.
 */
export function ensureTempDir() {
  if (initializedTempDir) return initializedTempDir;

  const envDir = process.env.TMP_DOWNLOAD_DIR;
  const tempDir = envDir
    ? path.resolve(/*turbopackIgnore: true*/ envDir)
    : path.join(/*turbopackIgnore: true*/ process.cwd(), 'tmp');
  if (!fs.existsSync(/*turbopackIgnore: true*/ tempDir)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ tempDir, { recursive: true });
  }
  initializedTempDir = tempDir;
  return tempDir;
}

/**
 * 충돌 없는 고유 임시 파일 경로를 생성합니다. (UUID + 타임스탬프 조합)
 *
 * @param {'mp3'|'mp4'|'info.json'} ext - 파일 확장자
 * @returns {string} 생성된 임시 파일 절대 경로
 */
export function createUniqueTempPath(ext) {
  const tempDir = ensureTempDir();
  const allowedExts = new Set(['mp3', 'mp4', 'info.json']);
  const safeExt = allowedExts.has(ext) ? ext : 'mp3';
  const uniqueId = `${Date.now()}-${crypto.randomUUID()}`;
  return path.join(/*turbopackIgnore: true*/ tempDir, `${uniqueId}.${safeExt}`);
}

/**
 * /api/info 단계에서 캐싱해 둔 경량 info_dict가 있다면 임시 .info.json 파일로 기록하고 경로를 반환합니다.
 * (yt-dlp --load-info-json에 전달하여 2.5~3.5초의 YouTube 재추출 과정을 생략)
 *
 * @param {string} url
 * @returns {Promise<string|null>}
 */
export async function prepareCachedInfoJsonFile(url) {
  const videoId = extractVideoId(url);
  if (!videoId) return null;

  const cachedInfo = rawInfoJsonCache.get(videoId);
  if (!cachedInfo) return null;

  try {
    const infoPath = createUniqueTempPath('info.json');
    await fs.promises.writeFile(/*turbopackIgnore: true*/ infoPath, JSON.stringify(cachedInfo), 'utf8');
    return infoPath;
  } catch (err) {
    console.warn('[cleanup] Failed to write cached info.json:', err.message);
    return null;
  }
}

/**
 * 지정된 임시 파일 및 yt-dlp 부속 조각 파일(.part, .ytdl)을 안전하게 삭제합니다.
 *
 * @param {string|null|undefined} tempPath
 */
export async function removeTempFileArtifacts(tempPath) {
  if (!tempPath) return;
  const candidates = [tempPath, `${tempPath}.part`, `${tempPath}.ytdl`];
  await Promise.allSettled(
    candidates.map(async (filePath) => {
      try {
        await fs.promises.unlink(/*turbopackIgnore: true*/ filePath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`[cleanup] Failed to delete temp file ${filePath}:`, err);
        }
      }
    })
  );
}

/**
 * 오래된 임시 다운로드 파일을 삭제합니다. (30분 이상 경과한 파일)
 * 요청마다 발생하는 디스크 탐색을 줄이기 위해 최소 10분 간격으로만 실행됩니다.
 */
export async function cleanupOldTempFiles() {
  const now = Date.now();
  if (now - lastCleanupTime < CLEANUP_THROTTLE_MS) {
    return;
  }
  lastCleanupTime = now;

  const tempDir = ensureTempDir();
  try {
    const files = await fs.promises.readdir(/*turbopackIgnore: true*/ tempDir);
    const maxAgeMs = 30 * 60 * 1000; // 30분 (tmpfs 메모리 보호를 위해 단축)

    await Promise.allSettled(
      files.map(async (file) => {
        const filePath = path.join(/*turbopackIgnore: true*/ tempDir, file);
        try {
          const stats = await fs.promises.stat(/*turbopackIgnore: true*/ filePath);
          if (stats.isFile() && now - stats.mtimeMs > maxAgeMs) {
            await fs.promises.unlink(/*turbopackIgnore: true*/ filePath);
            console.log(`[cleanup] Deleted old temp file: ${file}`);
          }
        } catch (fileErr) {
          if (fileErr.code !== 'ENOENT') {
            console.error(`[cleanup] Failed to check/delete file ${file}:`, fileErr);
          }
        }
      })
    );
  } catch (err) {
    console.error('[cleanup] Failed to clean up old temp files:', err);
  }
}

/**
 * 임시 파일을 고속 256KB Pull 기반 Web ReadableStream으로 감싸 NextResponse로 반환하며,
 * 스트림 완료, 에러, 또는 클라이언트 연결 중단(cancel/abort) 시 즉시 파일을 삭제합니다.
 *
 * @param {string} tempPath - 스트리밍할 임시 파일 경로
 * @param {{ contentType: string, filename: string, signal?: AbortSignal }} options
 * @returns {Promise<{ response: NextResponse, size: number }>}
 */
export async function createStreamingFileResponse(tempPath, { contentType, filename, signal }) {
  const stat = await fs.promises.stat(/*turbopackIgnore: true*/ tempPath);
  const fileHandle = await fs.promises.open(/*turbopackIgnore: true*/ tempPath, 'r');

  let cleanedUp = false;
  const cleanupOnce = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      await fileHandle.close();
    } catch { }
    await removeTempFileArtifacts(tempPath);
  };

  if (signal) {
    if (signal.aborted) {
      await cleanupOnce();
    } else {
      signal.addEventListener(
        'abort',
        () => {
          cleanupOnce();
        },
        { once: true }
      );
    }
  }

  // 256KB 청크 + 단일 재사용 버퍼로 read() 시스템 콜 횟수 4배 절감 및 GC 압력 최소화
  const CHUNK_SIZE = 256 * 1024;
  const reusableBuffer = Buffer.allocUnsafe(CHUNK_SIZE);

  const webStream = new ReadableStream({
    async pull(controller) {
      if (cleanedUp) {
        try {
          controller.close();
        } catch { }
        return;
      }
      try {
        const { bytesRead } = await fileHandle.read(reusableBuffer, 0, CHUNK_SIZE, null);
        if (bytesRead === 0) {
          await cleanupOnce();
          controller.close();
        } else {
          // 정확히 읽힌 크기만큼만 독립 Uint8Array 복사본 생성
          const chunkCopy = new Uint8Array(bytesRead);
          chunkCopy.set(reusableBuffer.subarray(0, bytesRead));
          controller.enqueue(chunkCopy);
        }
      } catch (err) {
        await cleanupOnce();
        try {
          controller.error(err);
        } catch { }
      }
    },
    async cancel() {
      await cleanupOnce();
    },
  });

  const safeFilename = filename.replace(/["\r\n]/g, '_');
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Content-Disposition', `attachment; filename="${safeFilename}"`);
  headers.set('Content-Length', stat.size.toString());
  headers.set('Cache-Control', 'no-store');

  return {
    response: new NextResponse(webStream, { headers }),
    size: stat.size,
  };
}

/**
 * yt-dlp 실행 에러를 분석하여 사용자 친화적인 메시지와 HTTP 상태 코드를 반환합니다.
 *
 * @param {Error} error
 * @param {string} [defaultMessage='Failed to download']
 * @returns {{ errorMessage: string, statusCode: number }}
 */
export function classifyDownloadError(error, defaultMessage = 'Failed to download') {
  const errStr = error?.message || '';

  if (error?.name === 'AbortError' || errStr.includes('aborted')) {
    return {
      errorMessage: '다운로드 요청이 취소되었습니다.',
      statusCode: 499,
    };
  }
  if (errStr.includes('blocked due to the claimed content')) {
    return {
      errorMessage: '이 영상은 저작권 침해 주장(Netflix 등)으로 인해 차단되어 다운로드할 수 없습니다.',
      statusCode: 403,
    };
  }
  if (errStr.includes('Video unavailable') || errStr.includes('not available in your country')) {
    return {
      errorMessage: '이 영상은 지역 제한(국가 제한) 또는 비활성화로 인해 다운로드할 수 없습니다.',
      statusCode: 403,
    };
  }
  if (errStr.includes('Private video')) {
    return {
      errorMessage: '이 영상은 비공개 동영상이라 다운로드할 수 없습니다.',
      statusCode: 403,
    };
  }
  if (errStr.includes('Join this channel to get access') || errStr.includes('members-only')) {
    return {
      errorMessage: '이 영상은 멤버십 전용 동영상이라 다운로드할 수 없습니다.',
      statusCode: 403,
    };
  }
  if (errStr.includes('HTTP Error 429') || errStr.includes('Too Many Requests')) {
    return {
      errorMessage: '유튜브 요청 한도(Rate Limit)를 초과했습니다. 잠시 후 다시 시도해주세요.',
      statusCode: 429,
    };
  }
  if (errStr.includes('HTTP Error 403') || errStr.includes('403: Forbidden')) {
    return {
      errorMessage: '유튜브 스트림 접근이 일시적으로 제한되었습니다 (HTTP 403). 잠시 후 다시 시도해주세요.',
      statusCode: 403,
    };
  }

  return {
    errorMessage: defaultMessage,
    statusCode: 500,
  };
}
