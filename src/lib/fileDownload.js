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
 * Blob 데이터를 파일로 저장
 * @param {Blob} blob                      - 저장할 데이터
 * @param {string} filename                - 파일명
 * @param {FileSystemDirectoryHandle|null} dirHandle - 폴더 핸들 (없으면 브라우저 다운로드)
 */
export async function saveFile(blob, filename, dirHandle) {
  // ── File System Access API 사용 가능한 경우: 선택된 폴더에 직접 저장 ──
  if (dirHandle && typeof dirHandle.getFileHandle === 'function') {
    try {
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { method: 'filesystem', filename };
    } catch (err) {
      console.error('FileSystem save failed, falling back to browser download:', err);
      // 실패 시 브라우저 다운로드로 폴백
    }
  }

  // ── 폴백: 브라우저 기본 다운로드 (다운로드 다이얼로그 표시) ──
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
 * File System Access API 지원 여부 확인
 * @returns {boolean}
 */
export function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}
