'use client';

import { isFileSystemAccessSupported } from '../lib/fileDownload';

/**
 * 다운로드 폴더 선택 버튼 컴포넌트
 *
 * - 지원 브라우저: "폴더 선택" 버튼을 표시하여 저장 위치 지정
 * - 미지원 브라우저: 아무것도 렌더링하지 않음 (브라우저 기본 다운로드 사용)
 *
 * @param {{ onSelect: (handle) => void, selected: boolean }} props
 */
export default function DownloadFolderPicker({ onSelect, selected }) {
  if (!isFileSystemAccessSupported()) return null;

  return (
    <div className="folder-picker">
      <button
        className="folder-picker-btn"
        onClick={onSelect}
        title="Choose a folder to auto-save downloads"
      >
        {selected ? (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            Auto-save ON
          </>
        ) : (
          <>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            Choose Save Folder
          </>
        )}
      </button>
    </div>
  );
}
