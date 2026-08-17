/**
 * 파일 다운로드 유틸리티
 *
 * File System Access API(showDirectoryPicker)를 지원하는 브라우저(Chrome, Edge 등)에서는
 * 사용자가 최초 1회 폴더를 선택한 후 모든 파일이 자동 저장됩니다.
 * 지원하지 않는 브라우저에서는 기존 방식(브라우저 다운로드 다이얼로그)으로 동작합니다.
 */

/**
 * 다운로드 폴더 선택
 * @returns {Promise<FileSystemDirectoryHandle|null>} 선택된 폴더 핸들 (실패 시 null)
 */
export async function chooseDownloadDirectory() {
  try {
    // File System Access API 지원 여부 확인
    if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
      return null;
    }
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads',
    });
    return handle;
  } catch (err) {
    // 사용자가 취소한 경우 (DOMException: The user aborted a request)
    if (err.name === 'AbortError') return null;
    console.error('Failed to pick download directory:', err);
    return null;
  }
}

/**
 * 파일명에서 확장자와 기본 이름을 분리하여 인덱스를 증가시킨 새 파일명 생성
 * 예: "video.mp4" → "video (1).mp4" → "video (2).mp4"
 * @param {string} filename - 원본 파일명
 * @returns {string} 인덱스가 증가된 파일명
 */
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

/**
 * 파일이 이미 존재하는지 확인
 */
async function fileExists(dirHandle, filename) {
  try {
    await dirHandle.getFileHandle(filename);
    return true;
  } catch {
    return false;
  }
}

/**
 * 중복 파일명 처리: 사용자에게 덮어쓰기 또는 새 이름 저장 선택
 */
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

/**
 * Blob 데이터를 파일로 저장
 * @param {Blob} blob                      - 저장할 데이터
 * @param {string} filename                - 파일명
 * @param {FileSystemDirectoryHandle|null} dirHandle - 폴더 핸들 (없으면 브라우저 다운로드)
 * @returns {Promise<{method: string, filename: string}>}
 */
export async function saveFile(blob, filename, dirHandle) {
  // ── File System Access API: 선택된 폴더에 직접 저장 ──
  if (dirHandle && typeof dirHandle.getFileHandle === 'function') {
    try {
      let finalName = filename;
      if (await fileExists(dirHandle, filename)) {
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

  // ── 폴백: 브라우저 기본 다운로드 ──
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  return { method: 'browser', filename };
}

/**
 * Fetch Response의 ReadableStream을 RAM 버퍼링 없이 디스크로 즉시 스트리밍 저장 (Zero-Buffer Direct Streaming)
 * @param {Response} response               - fetch Response 객체
 * @param {string} filename                 - 저장할 파일명
 * @param {FileSystemDirectoryHandle|null} dirHandle - 폴더 핸들
 * @returns {Promise<{method: string, filename: string}>}
 */
export async function saveResponseStream(response, filename, dirHandle) {
  // 1. File System Access API 지원 & 폴더 핸들 존재 시: 스트림 직결 파이핑
  if (dirHandle && typeof dirHandle.getFileHandle === 'function' && response.body && typeof response.body.pipeTo === 'function') {
    try {
      let finalName = filename;
      if (await fileExists(dirHandle, filename)) {
        const result = await handleDuplicateFile(dirHandle, filename);
        finalName = result.filename;
      }

      const fileHandle = await dirHandle.getFileHandle(finalName, { create: true });
      const writable = await fileHandle.createWritable();
      
      // 브라우저 메모리에 담아두지 않고 디스크로 바로 파이핑
      await response.body.pipeTo(writable);
      return { method: 'filesystem-stream', filename: finalName };
    } catch (err) {
      console.error('Direct stream piping failed, falling back to blob download:', err);
    }
  }

  // 2. 폴백: Blob으로 변환 후 다운로드
  const blob = await response.blob();
  return saveFile(blob, filename, dirHandle);
}

/**
 * File System Access API 지원 여부 확인
 * @returns {boolean}
 */
export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}
