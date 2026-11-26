/**
 * 파일 다운로드 및 클라이언트 동시성 제어 유틸리티
 *
 * - File System Access API 지원 브라우저: RAM 버퍼링 없는 디스크 직결 스트리밍 저장
 * - 실시간 전송 진행률(%, MB) 스로틀링 콜백(150ms 간격) 지원
 * - 클라이언트 다운로드 동시성 제한 큐(최대 3개 병렬)로 브라우저 도메인당 소켓 고갈 방지
 */

const MAX_CLIENT_CONCURRENT_DOWNLOADS = 3;
let activeClientDownloads = 0;
const clientDownloadQueue = [];

/**
 * 클라이언트 측 동시 다운로드 수를 제한하여 브라우저 HTTP 커넥션 풀 포화를 방지합니다.
 *
 * @template T
 * @param {() => Promise<T>} taskFn
 * @param {() => void} [onStart] - 대기열에서 빠져나와 실제 네트워크 요청이 시작될 때 호출
 * @returns {{ queued: boolean, promise: Promise<T> }}
 */
export function enqueueClientDownload(taskFn, onStart) {
  const willQueue = activeClientDownloads >= MAX_CLIENT_CONCURRENT_DOWNLOADS;

  const promise = new Promise((resolve, reject) => {
    const run = async () => {
      activeClientDownloads += 1;
      try {
        onStart?.();
        const result = await taskFn();
        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        activeClientDownloads = Math.max(0, activeClientDownloads - 1);
        if (clientDownloadQueue.length > 0) {
          const nextTask = clientDownloadQueue.shift();
          nextTask();
        }
      }
    };

    if (!willQueue) {
      run();
    } else {
      clientDownloadQueue.push(run);
    }
  });

  return { queued: willQueue, promise };
}

/**
 * 다운로드 폴더 선택
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function chooseDownloadDirectory() {
  try {
    if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
      return null;
    }
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads',
    });
    return handle;
  } catch (err) {
    if (err.name === 'AbortError') return null;
    console.error('Failed to pick download directory:', err);
    return null;
  }
}

function incrementFilename(filename) {
  const dotIdx = filename.lastIndexOf('.');
  const name = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const ext = dotIdx > 0 ? filename.slice(dotIdx) : '';
  const match = name.match(/^(.*) \((\d+)\)$/);
  if (match) {
    const num = parseInt(match[2], 10) + 1;
    return `${match[1]} (${num})${ext}`;
  }
  return `${name} (1)${ext}`;
}

async function fileExists(dirHandle, filename) {
  try {
    await dirHandle.getFileHandle(filename);
    return true;
  } catch {
    return false;
  }
}

async function handleDuplicateFile(dirHandle, filename) {
  const overwrite = window.confirm(
    `"${filename}" already exists.\n\nOK = Overwrite\nCancel = Save with a new name`
  );
  if (overwrite) {
    return { action: 'overwrite', filename };
  }
  let newName = incrementFilename(filename);
  while (await fileExists(dirHandle, newName)) {
    newName = incrementFilename(newName);
  }
  return { action: 'rename', filename: newName };
}

export function triggerNativeBrowserDownload(downloadUrl, filename) {
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { method: 'browser-direct', filename };
}

/**
 * fetch 호출 전(사용자 클릭 제스처가 활성화된 시점)에 폴더 권한을 검증하고 중복 파일명을 확정합니다.
 */
export async function prepareDirectoryTarget(filename, dirHandle) {
  if (!dirHandle || typeof dirHandle.getFileHandle !== 'function') {
    return { validDirHandle: null, finalName: filename };
  }

  try {
    if (typeof dirHandle.queryPermission === 'function') {
      let perm = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted' && typeof dirHandle.requestPermission === 'function') {
        perm = await dirHandle.requestPermission({ mode: 'readwrite' });
      }
      if (perm !== 'granted') {
        return { validDirHandle: null, finalName: filename };
      }
    }

    let finalName = filename;
    if (await fileExists(dirHandle, filename)) {
      const result = await handleDuplicateFile(dirHandle, filename);
      finalName = result.filename;
    }

    return { validDirHandle: dirHandle, finalName };
  } catch (err) {
    console.warn('Directory handle preparation failed, will use browser download fallback:', err);
    return { validDirHandle: null, finalName: filename };
  }
}

/**
 * ReadableStream에 150ms 간격 스로틀링 진행률 추적기를 부착합니다.
 */
function wrapStreamWithProgress(bodyStream, totalBytes, onProgress) {
  if (!bodyStream || !onProgress || typeof TransformStream === 'undefined') {
    return bodyStream;
  }

  let receivedBytes = 0;
  let lastEmitTime = 0;

  return bodyStream.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength;
        const now = performance.now();
        if (now - lastEmitTime >= 150) {
          lastEmitTime = now;
          if (totalBytes > 0) {
            const pct = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
            onProgress(`${pct}%`);
          } else {
            const mb = (receivedBytes / (1024 * 1024)).toFixed(1);
            onProgress(`${mb}MB`);
          }
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (totalBytes > 0) {
          onProgress('100%');
        }
      },
    })
  );
}

export async function saveFile(blob, filename, dirHandle, options = {}) {
  if (dirHandle && typeof dirHandle.getFileHandle === 'function') {
    try {
      let finalName = options.preResolvedName || filename;
      if (!options.preResolvedName && (await fileExists(dirHandle, filename))) {
        const result = await handleDuplicateFile(dirHandle, filename);
        finalName = result.filename;
      }

      const fileHandle = await dirHandle.getFileHandle(finalName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { method: 'filesystem', filename: finalName };
    } catch (err) {
      console.error('FileSystem save failed, falling back to browser download:', err);
    }
  }

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 10000);
  return { method: 'browser', filename };
}

/**
 * Fetch Response의 ReadableStream을 RAM 버퍼링 없이 디스크로 즉시 스트리밍 저장합니다.
 *
 * @param {Response} response
 * @param {string} filename
 * @param {FileSystemDirectoryHandle|null} dirHandle
 * @param {{ preResolvedName?: string, fallbackUrl?: string, onProgress?: (text: string) => void }} [options]
 */
export async function saveResponseStream(response, filename, dirHandle, options = {}) {
  const totalBytes = parseInt(response.headers.get('Content-Length') || '0', 10) || 0;

  // 1. File System Access API 직결 파이핑 (먼저 파일 핸들을 확보하여 실패 시에도 response.body 보존)
  if (
    dirHandle &&
    typeof dirHandle.getFileHandle === 'function' &&
    response.body &&
    typeof response.body.pipeTo === 'function'
  ) {
    try {
      let finalName = options.preResolvedName || filename;
      if (!options.preResolvedName && (await fileExists(dirHandle, filename))) {
        const result = await handleDuplicateFile(dirHandle, filename);
        finalName = result.filename;
      }

      const fileHandle = await dirHandle.getFileHandle(finalName, { create: true });
      const writable = await fileHandle.createWritable();
      const trackedBody = wrapStreamWithProgress(response.body, totalBytes, options.onProgress);

      await trackedBody.pipeTo(writable);
      return { method: 'filesystem-stream', filename: finalName };
    } catch (err) {
      console.error('Direct stream piping failed, falling back to download:', err);
      if (response.bodyUsed && options.fallbackUrl) {
        return triggerNativeBrowserDownload(options.fallbackUrl, filename);
      }
      dirHandle = null;
    }
  }

  // 2. 폴백: 진행률을 추적하며 Blob으로 변환 후 브라우저 기본 다운로드 수행
  if (!response.bodyUsed) {
    try {
      let blob;
      if (response.body && options.onProgress) {
        const trackedBody = wrapStreamWithProgress(response.body, totalBytes, options.onProgress);
        blob = await new Response(trackedBody, { headers: response.headers }).blob();
      } else {
        blob = await response.blob();
      }
      return await saveFile(blob, filename, dirHandle, options);
    } catch (err) {
      console.error('Blob conversion failed:', err);
      if (options.fallbackUrl) {
        return triggerNativeBrowserDownload(options.fallbackUrl, filename);
      }
      throw err;
    }
  } else if (options.fallbackUrl) {
    return triggerNativeBrowserDownload(options.fallbackUrl, filename);
  }

  throw new Error('Response stream already consumed');
}

export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}
